/**
 * EPIC-002: Goal Integrity Job
 *
 * Runs daily to detect duplicate goal documents that share the same logical
 * identity (tenant_id + template_id + vertical, or tenant_id + name when
 * template_id is absent) among active goals. Does NOT auto-merge — writes
 * a `goal_integrity_flags` document listing the duplicate IDs so an admin
 * can review which progress history is authoritative before merging.
 *
 * Follows the billing-cron distributed-lock pattern.
 */

import type { Db } from 'mongodb'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'goal-integrity', version: '0.0.0' })

const LOCK_TTL_MS = 5 * 60 * 1000

async function acquireLock(db: Db): Promise<boolean> {
  const now = new Date()
  const result = await db.collection('cron_locks').findOneAndUpdate(
    { name: 'goal-integrity', expires_at: { $lt: now } },
    { $set: { name: 'goal-integrity', acquired_at: now, expires_at: new Date(now.getTime() + LOCK_TTL_MS) } },
    { upsert: true, returnDocument: 'after' },
  )
  return !!result
}

async function releaseLock(db: Db): Promise<void> {
  await db.collection('cron_locks').deleteOne({ name: 'goal-integrity' }).catch(() => {})
}

interface GoalRecord {
  id: string
  tenant_id: string
  name: string
  template_id?: string
  vertical?: string
  status: string
  created_at: Date
}

export interface IntegrityFlag {
  tenant_id: string
  kind: 'duplicate_template' | 'duplicate_name'
  goal_ids: string[]
  detected_at: Date
  status: 'needs_review'
}

export async function runGoalIntegrityJob(db: Db): Promise<{ tenants_scanned: number; flags_created: number }> {
  if (!(await acquireLock(db))) {
    log.info({ reason: 'lock_held' }, 'Goal integrity job skipped — lock held by another instance')
    return { tenants_scanned: 0, flags_created: 0 }
  }

  try {
    const activeGoals = await db.collection<GoalRecord>('goals')
      .find({ status: { $nin: ['archived', 'achieved', 'failed'] } })
      .toArray()

    const byTenant = new Map<string, GoalRecord[]>()
    for (const goal of activeGoals) {
      const list = byTenant.get(goal.tenant_id) ?? []
      list.push(goal)
      byTenant.set(goal.tenant_id, list)
    }

    const flags: IntegrityFlag[] = []
    const now = new Date()

    for (const [tenantId, goals] of byTenant) {
      // Group by (template_id, vertical) when template_id is present
      const byTemplate = new Map<string, GoalRecord[]>()
      const byName = new Map<string, GoalRecord[]>()
      for (const goal of goals) {
        if (goal.template_id) {
          const key = `${goal.template_id}::${goal.vertical ?? 'default'}`
          const list = byTemplate.get(key) ?? []
          list.push(goal)
          byTemplate.set(key, list)
        }
        const nameList = byName.get(goal.name) ?? []
        nameList.push(goal)
        byName.set(goal.name, nameList)
      }

      for (const [, group] of byTemplate) {
        if (group.length > 1) {
          flags.push({
            tenant_id: tenantId,
            kind: 'duplicate_template',
            goal_ids: group.map(g => g.id).sort(),
            detected_at: now,
            status: 'needs_review',
          })
        }
      }
      for (const [name, group] of byName) {
        if (group.length > 1) {
          // Skip if already flagged via template grouping
          const alreadyFlagged = flags.some(f => f.kind === 'duplicate_template' && f.tenant_id === tenantId && group.every(g => f.goal_ids.includes(g.id)))
          if (!alreadyFlagged) {
            flags.push({
              tenant_id: tenantId,
              kind: 'duplicate_name',
              goal_ids: group.map(g => g.id).sort(),
              detected_at: now,
              status: 'needs_review',
            })
          }
        }
        void name
      }
    }

    // Write flags (idempotent — upsert by tenant_id + goal_ids signature)
    for (const flag of flags) {
      const signature = `${flag.tenant_id}:${flag.kind}:${flag.goal_ids.join(',')}`
      await db.collection('goal_integrity_flags').updateOne(
        { signature },
        { $set: { ...flag, signature, updated_at: now } },
        { upsert: true },
      )
    }

    if (flags.length > 0) {
      log.warn({ flags: flags.length, tenants: byTenant.size }, 'Goal integrity flags created')
    }

    return { tenants_scanned: byTenant.size, flags_created: flags.length }
  } finally {
    await releaseLock(db)
  }
}
