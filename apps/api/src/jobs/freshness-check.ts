/**
 * Daily freshness check (PRD-145): for each family, which detectors can run on
 * current inputs and which are paused, and why. Deterministic, no model call,
 * Tier 0. Stores detector and field names only, never values.
 *
 * One row per (tenant, detector) in `freshness_state`. `since` is when the
 * check last entered its current class (running / paused / not applicable) and
 * survives a missing-to-stale change inside a pause, so "paused for how long"
 * is honest. Leaving a pause stamps `resolved_at` and `last_pause_ms`, which
 * is what the time-from-paused-to-resolved metric (PRD-141) reads.
 *
 * Reads the same dates as policy-renewal-reminders.ts; it does not replace it.
 * Producing a Tier C message from a paused check waits for PRD-139's budget
 * and suppression rules, so nothing is sent from here.
 */
import type { Db } from 'mongodb'
import { createLogger, getTenantCollection } from '@lifekeel/platform'
import { FinancialProfileSchema } from '../routes/family-financial-profile.js'
import type { FamilyGroupDoc } from '../routes/family-group.js'
import {
  evaluateFreshness,
  freshnessShare,
  type DetectorFreshness,
  type FreshnessState,
} from '../freshness/inputs.js'
import { recordJobRun } from './job-runs.js'

const log = createLogger({ service: 'freshness-check', version: '0.0.0' })

export const FRESHNESS_JOB = 'freshness-check'

export interface FreshnessStateDoc {
  tenant_id: string
  detector_id: string
  label: string
  state: FreshnessState
  input: string[]
  since: Date
  checked_at: Date
  resolved_at?: Date
  last_pause_ms?: number
}

const klass = (s: FreshnessState) => (s.startsWith('paused') ? 'paused' : s)

export interface FreshnessSummary {
  tenants: number
  paused_checks: number
  failed: number
}

async function evaluateTenant(db: Db, tenantId: string, now: Date): Promise<DetectorFreshness[]> {
  const doc = (await getTenantCollection<Record<string, unknown>>(
    db,
    'family_financial_profile',
    tenantId,
  ).findOne({})) as Record<string, unknown> | null
  if (!doc) return evaluateFreshness(null, null, now)
  const {
    tenant_id: _t,
    updated_at,
    reviewed_at,
    insights_evaluated_at: _e,
    review_snapshot: _s,
    review_snoozed_until: _z,
    version: _v,
    _id: _i,
    ...rest
  } = doc
  const parsed = FinancialProfileSchema.safeParse(rest)
  // A profile that does not parse is treated as no profile: nothing can run on it.
  const touched = (reviewed_at ?? updated_at ?? null) as Date | null
  return evaluateFreshness(parsed.success ? parsed.data : null, touched, now)
}

export async function runFreshnessCheck(
  db: Db,
  opts: { now?: Date } = {},
): Promise<FreshnessSummary> {
  const now = opts.now ?? new Date()
  const summary: FreshnessSummary = { tenants: 0, paused_checks: 0, failed: 0 }
  const families = await db
    .collection<FamilyGroupDoc>('family_groups')
    .find({})
    .toArray()
    .catch(() => [] as FamilyGroupDoc[])
  const col = db.collection<FreshnessStateDoc>('freshness_state')

  for (const family of families) {
    const tenantId = family.tenant_id
    try {
      const results = await evaluateTenant(db, tenantId, now)
      const previous = (await col.find({ tenant_id: tenantId }).toArray()) as FreshnessStateDoc[]
      for (const r of results) {
        const prev = previous.find((p) => p.detector_id === r.detector_id)
        const changedClass = !prev || klass(prev.state) !== klass(r.state)
        const set: Partial<FreshnessStateDoc> = {
          label: r.label,
          state: r.state,
          input: r.input,
          since: changedClass ? now : prev!.since,
          checked_at: now,
        }
        const unset: Record<string, ''> = {}
        if (prev && klass(prev.state) === 'paused' && r.state === 'running') {
          set.resolved_at = now
          set.last_pause_ms = now.getTime() - prev.since.getTime()
        } else if (changedClass && klass(r.state) === 'paused') {
          unset['resolved_at'] = ''
        }
        await col.updateOne(
          { tenant_id: tenantId, detector_id: r.detector_id },
          { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
          { upsert: true },
        )
        if (klass(r.state) === 'paused') summary.paused_checks++
      }
      summary.tenants++
    } catch (err) {
      summary.failed++
      log.error({ err, tenant_id: tenantId }, 'Freshness check failed for tenant')
    }
  }

  await recordJobRun(db, FRESHNESS_JOB, { ...summary }, now)
  return summary
}

export { freshnessShare }
