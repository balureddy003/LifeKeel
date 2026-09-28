/**
 * Continuity check (PRD-130) — the "dead man's switch," shaped to fit the
 * product's actual access model.
 *
 * The vault uses standing adult access — there is nothing locked that a
 * switch could "release." So instead of a release mechanism, this is a
 * three-phase notification state machine per family:
 *
 *   watching        — organizer active within check_in_after_days.
 *   check_in_sent   — organizer inactive past the threshold → they get
 *                     one "still there?" email. Any app activity resets
 *                     silently back to watching.
 *   alerted         — still silent after grace_days → the organizer's
 *                     designated members get a continuity email pointing
 *                     at the vault and emergency plans they already have
 *                     access to.
 *
 * Safety properties:
 *  - Self-resetting: the moment the organizer's last_seen_at moves inside
 *    the threshold, the state clears — no manual "I'm alive" needed, and
 *    a back-from-holiday login silently ends the whole thing.
 *  - Idempotent: phase transitions are persisted; a re-run or a second
 *    replica can't re-send a phase's emails.
 *  - Informational only: no access changes, no document release, no
 *    irreversible anything. Tier 0/1 — email to named humans only.
 *  - Organizer-only opt-in: disabled by default; only the organizer can
 *    enable it or pick designated contacts (see family-continuity.ts).
 *
 * Scheduled daily from server.ts under the 'continuity-check' cron lock.
 */

import type { Db } from 'mongodb'
import { createLogger } from '@agentoak/platform'
import { getFamilyGroupsCollection, getFamilyContinuityStateCollection } from '../db.js'
import type { FamilyGroupDoc } from '../routes/family-group.js'
import type { User } from '../routes/auth-users.js'
import { sendContinuityCheckInEmail, sendContinuityAlertEmail } from '../auth-email.js'
import { getAuditLogger } from '../audit/audit-log.js'

const log = createLogger({ service: 'continuity-check', version: '0.0.0' })

export const DEFAULT_CHECK_IN_DAYS = 30
export const DEFAULT_GRACE_DAYS = 14

interface ContinuityStateDoc extends Record<string, unknown> {
  tenant_id: string
  phase: 'watching' | 'check_in_sent' | 'alerted'
  check_in_sent_at?: Date
  alerted_at?: Date
  inactive_since?: Date
  updated_at: Date
}

export interface ContinuityRunSummary {
  families: number
  checkInsSent: number
  alertsSent: number
  reset: number
}

function audit(tenantId: string, action: 'family.continuity_check_in_sent' | 'family.continuity_alert_sent', metadata: Record<string, unknown>): void {
  getAuditLogger()?.log({
    tenant_id: tenantId,
    user_id: 'system',
    action,
    resource_type: 'family',
    resource_id: tenantId,
    metadata,
    ip: '',
    user_agent: '',
    timestamp: new Date(),
  })
}

export async function runContinuityCheck(
  db: Db,
  opts: { now?: Date; appUrl?: string } = {},
): Promise<ContinuityRunSummary> {
  const now = opts.now ?? new Date()
  const appUrl = opts.appUrl ?? process.env['AGENT_OAK_URL'] ?? 'http://localhost:3002'
  const summary: ContinuityRunSummary = { families: 0, checkInsSent: 0, alertsSent: 0, reset: 0 }
  const states = getFamilyContinuityStateCollection(db)

  const groups = (await getFamilyGroupsCollection(db)
    .find({ 'continuity.enabled': true })
    .toArray()) as unknown as FamilyGroupDoc[]

  for (const group of groups) {
    const continuity = group.continuity
    if (!continuity?.enabled) continue
    summary.families++

    const organizer = group.members.find((m) => m.role === 'organizer' && m.status === 'active')
    if (!organizer) continue

    // The organizer's activity clock: their linked user record's
    // last_seen_at, falling back to joined_at (a never-active organizer
    // counts as inactive from the day they set the family up — the whole
    // point of the feature).
    const user = (await db.collection('users').findOne({
      tenant_id: group.tenant_id,
      $or: [{ id: organizer.user_id ?? '' }, { id: organizer.id }],
    })) as User | null
    const lastSeen = user?.last_seen_at ?? (organizer.joined_at ? new Date(organizer.joined_at) : null)
    if (!lastSeen || Number.isNaN(lastSeen.getTime())) continue

    const checkInAfterDays = continuity.check_in_after_days || DEFAULT_CHECK_IN_DAYS
    const graceDays = continuity.grace_days || DEFAULT_GRACE_DAYS
    const inactiveDays = (now.getTime() - lastSeen.getTime()) / 86_400_000
    const state = (await states.findOne({ tenant_id: group.tenant_id })) as ContinuityStateDoc | null
    const phase = state?.phase ?? 'watching'

    // Active again → reset silently, whatever phase we were in.
    if (inactiveDays < checkInAfterDays) {
      if (phase !== 'watching') {
        await states.updateOne(
          { tenant_id: group.tenant_id },
          { $set: { phase: 'watching', updated_at: now }, $unset: { check_in_sent_at: '', alerted_at: '', inactive_since: '' } },
          { upsert: true },
        )
        summary.reset++
      }
      continue
    }

    if (phase === 'watching') {
      if (user?.email) {
        await sendContinuityCheckInEmail(user.email, user.name ?? organizer.name, Math.floor(inactiveDays), appUrl)
      }
      await states.updateOne(
        { tenant_id: group.tenant_id },
        { $set: { phase: 'check_in_sent', check_in_sent_at: now, inactive_since: lastSeen, updated_at: now } },
        { upsert: true },
      )
      summary.checkInsSent++
      audit(group.tenant_id, 'family.continuity_check_in_sent', { organizer_member_id: organizer.id, inactive_days: Math.floor(inactiveDays) })
      continue
    }

    if (phase === 'check_in_sent' && inactiveDays >= checkInAfterDays + graceDays) {
      // Notify designated members — only active adults with an email on
      // file; a designated child or pending member is silently skipped
      // rather than emailed at a minor.
      const contacts = group.members.filter(
        (m) => continuity.designated_member_ids.includes(m.id) && m.status === 'active' && m.role !== 'child' && m.email,
      )
      for (const contact of contacts) {
        await sendContinuityAlertEmail(contact.email, contact.name, organizer.name, Math.floor(inactiveDays), appUrl)
      }
      await states.updateOne(
        { tenant_id: group.tenant_id },
        { $set: { phase: 'alerted', alerted_at: now, updated_at: now } },
        { upsert: true },
      )
      summary.alertsSent += contacts.length
      audit(group.tenant_id, 'family.continuity_alert_sent', {
        organizer_member_id: organizer.id,
        inactive_days: Math.floor(inactiveDays),
        notified_member_ids: contacts.map((c) => c.id),
      })
    }
  }

  if (summary.checkInsSent > 0 || summary.alertsSent > 0) {
    log.info({ ...summary }, 'Continuity check run')
  }
  return summary
}

export async function ensureContinuityIndexes(db: Db): Promise<void> {
  await getFamilyContinuityStateCollection(db).createIndex({ tenant_id: 1 }, { unique: true }).catch(() => {})
}
