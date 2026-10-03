/**
 * Policy renewal reminders — Agent Oak's first Tier 3 (low-stakes,
 * reversible) automatic action.
 *
 * What it does: scans each tenant's family financial profile for policies
 * with a renewal_date, schedules a reminder LEAD_DAYS before each renewal,
 * and pushes an informational notification to the tenant's own registered
 * devices when the reminder comes due. It never contacts the insurer,
 * never compares or recommends products, and never changes anything
 * outside this collection — the only "action" is a notification to the
 * family member who opted into push.
 *
 * Safety properties:
 *  - Deterministic: no LLM anywhere in the loop. Dates come from the
 *    profile; the message is a fixed template.
 *  - Deduped: a unique dedupe_key (tenant + policy fingerprint +
 *    renewal_date + lead_days) means re-runs never create or send twice.
 *  - Self-healing: a policy removed or re-dated in the profile cancels its
 *    pending reminders on the next sync; a reminder whose evidence no
 *    longer matches is cancelled at dispatch time, not sent.
 *  - Consent checked at execution, not just at save: the tenant's
 *    automation.renewal_reminders_enabled setting is re-read before every
 *    send, so turning the feature off takes effect immediately even for
 *    already-scheduled reminders.
 *  - Crash-safe: dispatch claims the reminder (scheduled → sending)
 *    atomically, so two replicas can't both send; a crashed claim is
 *    retried on the next run rather than lost.
 *
 * Scheduled hourly from server.ts under the 'policy-renewal-reminders'
 * cron lock.
 */

import type { Db } from 'mongodb'
import { createHash, randomUUID } from 'node:crypto'
import { createLogger } from '@agentoak/platform'
import { getAuditLogger } from '../audit/audit-log.js'
import { buildDedupeKey, emitReadinessEvent } from '../feed/emit.js'

const log = createLogger({ service: 'policy-renewal-reminders', version: '0.0.0' })

export const DEFAULT_LEAD_DAYS = [30, 7]
const MAX_SEND_ATTEMPTS = 6
const RETRY_BACKOFF_MS = 60 * 60 * 1000 // 1h × attempts — a reminder is not urgent enough to hot-loop
const STALE_CLAIM_MS = 10 * 60 * 1000  // a 'sending' claim older than this crashed mid-dispatch
const DISPATCH_LIMIT = 200

export interface PolicyReminderDoc {
  id: string
  tenant_id: string
  kind: 'policy_renewal'
  dedupe_key: string
  policy_fingerprint: string
  policy: { type: string; provider: string; member_id?: string; policy_number?: string }
  renewal_date: string            // ISO 'YYYY-MM-DD' as entered on the profile
  lead_days: number
  due_at: Date
  next_attempt_at?: Date
  status: 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed'
  attempts: number
  created_at: Date
  updated_at: Date
  sent_at?: Date
  cancelled_reason?: 'policy_changed' | 'reminders_disabled' | 'user_cancelled'
  last_error?: string
}

export interface ReminderRunSummary {
  scheduled: number
  cancelled: number
  sent: number
  failed: number
  deferred: number
}

export async function ensureReminderIndexes(db: Db): Promise<void> {
  const col = db.collection('reminders')
  await col.createIndex({ dedupe_key: 1 }, { unique: true })
  await col.createIndex({ status: 1, due_at: 1 })
  await col.createIndex({ tenant_id: 1, status: 1, due_at: 1 })
}

interface ProfilePolicy {
  type?: string
  provider?: string
  renewal_date?: string
  member_id?: string
  policy_number?: string
}

/**
 * Stable identity of a policy within a profile — policies have no id of
 * their own, so (type, provider, member, policy_number) is what binds a
 * reminder to its evidence. Any change to these produces a different
 * fingerprint, which orphans (and therefore cancels) the old reminders.
 */
function policyFingerprint(policy: ProfilePolicy): string {
  return createHash('sha256')
    .update([policy.type ?? '', policy.provider ?? '', policy.member_id ?? '', policy.policy_number ?? ''].join('|'))
    .digest('hex')
    .slice(0, 24)
}

function dedupeKey(tenantId: string, fingerprint: string, renewalDate: string, leadDays: number): string {
  return createHash('sha256')
    .update([tenantId, 'policy_renewal', fingerprint, renewalDate, String(leadDays)].join('|'))
    .digest('hex')
}

function validLeadDays(value: unknown): number[] {
  if (!Array.isArray(value)) return DEFAULT_LEAD_DAYS
  const days = value.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 365).slice(0, 5)
  return days.length > 0 ? days : DEFAULT_LEAD_DAYS
}

function audit(tenantId: string, action: 'reminder.sent' | 'reminder.cancelled', reminderId: string, metadata: Record<string, unknown>): void {
  getAuditLogger()?.log({
    tenant_id: tenantId,
    user_id: 'system',
    action,
    resource_type: 'reminder',
    resource_id: reminderId,
    metadata,
    ip: '',
    user_agent: '',
    timestamp: new Date(),
  })
}

/**
 * One pass: reconcile the reminder schedule with current profiles, then
 * dispatch everything that's due. `deliver` is DeliveryRouter.deliverReminder
 * bound — injected so tests exercise the lifecycle without a push service.
 */
export async function runPolicyRenewalReminders(
  db: Db,
  deliver: (tenantId: string, reminder: { id: string; title: string; body: string; url: string }) => Promise<'sent' | 'deferred' | 'failed' | 'no_channel'>,
  opts: { now?: Date; limit?: number; webBaseUrl?: string } = {},
): Promise<ReminderRunSummary> {
  const now = opts.now ?? new Date()
  const webBaseUrl = opts.webBaseUrl ?? process.env['AGENT_OAK_URL'] ?? 'http://localhost:3002'
  const reminders = db.collection<PolicyReminderDoc>('reminders')
  const profilesCol = db.collection('family_financial_profile')
  const settingsCol = db.collection('tenant_settings')
  const summary: ReminderRunSummary = { scheduled: 0, cancelled: 0, sent: 0, failed: 0, deferred: 0 }

  // ── Phase 1+2: reconcile schedule with the current Family Twin ─────────
  const profiles = await profilesCol
    .find({})
    .project({ tenant_id: 1, policies: 1 })
    .toArray() as Array<{ tenant_id: string; policies?: ProfilePolicy[] }>

  for (const profile of profiles) {
    const tenantId = profile.tenant_id
    const settings = await settingsCol.findOne({ tenant_id: tenantId })
    const automation = (settings?.['automation'] ?? {}) as Record<string, unknown>
    const enabled = automation['renewal_reminders_enabled'] === true
    const leadDays = validLeadDays(automation['renewal_reminder_lead_days'])
    const expected = new Set<string>()

    if (enabled) {
      for (const policy of profile.policies ?? []) {
        const renewalMs = Date.parse(policy.renewal_date ?? '')
        if (Number.isNaN(renewalMs) || renewalMs < now.getTime()) continue
        const fingerprint = policyFingerprint(policy)
        for (const lead of leadDays) {
          const dueAt = new Date(Math.max(renewalMs - lead * 86_400_000, now.getTime()))
          const key = dedupeKey(tenantId, fingerprint, policy.renewal_date as string, lead)
          expected.add(key)
          // $setOnInsert only — a re-run must never resurrect or mutate a
          // sent/cancelled/failed reminder for the same policy+date+lead.
          const inserted = await reminders.updateOne(
            { dedupe_key: key },
            {
              $setOnInsert: {
                id: randomUUID(),
                tenant_id: tenantId,
                kind: 'policy_renewal',
                dedupe_key: key,
                policy_fingerprint: fingerprint,
                policy: {
                  type: policy.type ?? 'policy',
                  provider: policy.provider ?? '',
                  ...(policy.member_id ? { member_id: policy.member_id } : {}),
                  ...(policy.policy_number ? { policy_number: policy.policy_number } : {}),
                },
                renewal_date: policy.renewal_date,
                lead_days: lead,
                due_at: dueAt,
                status: 'scheduled',
                attempts: 0,
                created_at: now,
                updated_at: now,
              } satisfies Partial<PolicyReminderDoc>,
            },
            { upsert: true },
          )
          // PRD-136: narrate a newly-scheduled reminder into the feed.
          // Only on insert — a re-run that found the reminder already
          // scheduled must not re-announce it.
          if ((inserted as { upsertedCount?: number }).upsertedCount) {
            const typeLabel = (policy.type ?? 'policy').replace(/_/g, ' ')
            emitReadinessEvent(db, tenantId, {
              type: 'renewal_approaching',
              severity: lead <= 7 ? 'critical' : 'attention',
              direction: null,
              member_id: policy.member_id ?? null,
              domain: 'protection',
              title: `${policy.provider ?? 'A'} ${typeLabel} policy renews on ${policy.renewal_date}`.slice(0, 120),
              summary: `Renewal in ${lead} days — review the renewal terms before it rolls over.`,
              evidence: [
                { label: 'Renews', value: policy.renewal_date },
                { label: 'Reminder', value: `${lead} days ahead` },
              ],
              links: [{ kind: 'profile_field', id: 'policies' }],
              next_check_at: new Date(renewalMs),
              dedupe_key: buildDedupeKey('renewal_approaching', `${fingerprint}:${policy.renewal_date}:${lead}`),
            })
          }
        }
      }
    }

    // Cancel scheduled reminders whose policy disappeared, re-dated, or
    // whose tenant disabled the feature — revocation is effective
    // immediately, not just for reminders created after the toggle.
    const result = await reminders.updateMany(
      { tenant_id: tenantId, kind: 'policy_renewal', status: 'scheduled', dedupe_key: { $nin: [...expected] } },
      { $set: { status: 'cancelled', cancelled_reason: enabled ? 'policy_changed' : 'reminders_disabled', updated_at: now } },
    )
    summary.cancelled += result.modifiedCount
  }

  // ── Phase 3: dispatch due reminders ─────────────────────────────────────
  // 'sending' claims older than STALE_CLAIM_MS crashed between claim and
  // outcome — recover them here rather than losing the reminder. Push
  // delivery is not idempotent, so a recovered claim is a small risk of a
  // duplicate notification; a lost reminder is the worse failure.
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS)
  const due = await reminders
    .find({
      due_at: { $lte: now },
      $and: [
        {
          $or: [
            { status: 'scheduled' },
            { status: 'sending', updated_at: { $lte: staleBefore } },
          ],
        },
        {
          $or: [{ next_attempt_at: { $exists: false } }, { next_attempt_at: { $lte: now } }],
        },
      ],
    })
    .sort({ due_at: 1 })
    .limit(opts.limit ?? DISPATCH_LIMIT)
    .toArray()

  for (const reminder of due) {
    // Atomic claim — two replicas (or an overlapping run) can't both send.
    // The 'sending' branch only matches a claim already proven stale by the
    // due-query window, so an in-flight dispatch on another replica is safe.
    const claim = await reminders.findOneAndUpdate(
      {
        id: reminder.id,
        $or: [
          { status: 'scheduled' },
          { status: 'sending', updated_at: { $lte: staleBefore } },
        ],
      },
      { $set: { status: 'sending', updated_at: now } },
      { returnDocument: 'after' },
    )
    if (!claim) continue

    // Re-verify consent AND evidence at execution time — a lot can change
    // between scheduling and sending.
    const [profile, settings] = await Promise.all([
      profilesCol.findOne({ tenant_id: reminder.tenant_id }, { projection: { policies: 1 } }),
      settingsCol.findOne({ tenant_id: reminder.tenant_id }, { projection: { automation: 1 } }),
    ])
    const automation = (settings?.['automation'] ?? {}) as Record<string, unknown>
    const enabled = automation['renewal_reminders_enabled'] === true
    const stillOnFile = ((profile?.['policies'] ?? []) as ProfilePolicy[]).some(
      (p) => p.renewal_date === reminder.renewal_date && policyFingerprint(p) === reminder.policy_fingerprint,
    )

    if (!enabled || !stillOnFile) {
      await reminders.updateOne(
        { id: reminder.id },
        { $set: { status: 'cancelled', cancelled_reason: enabled ? 'policy_changed' : 'reminders_disabled', updated_at: new Date() } },
      )
      summary.cancelled++
      audit(reminder.tenant_id, 'reminder.cancelled', reminder.id, { reason: enabled ? 'policy_changed' : 'reminders_disabled' })
      continue
    }

    const daysLeft = Math.max(0, Math.ceil((Date.parse(reminder.renewal_date) - now.getTime()) / 86_400_000))
    const typeLabel = reminder.policy.type.replace(/_/g, ' ')
    const result = await deliver(reminder.tenant_id, {
      id: reminder.id,
      title: 'Policy renewal coming up',
      body: `Your ${reminder.policy.provider} ${typeLabel} policy renews on ${reminder.renewal_date} — ${daysLeft} day${daysLeft === 1 ? '' : 's'} away. Review the renewal terms before it rolls over.`,
      url: `${webBaseUrl}/settings/automation`,
    })

    if (result === 'sent') {
      await reminders.updateOne(
        { id: reminder.id },
        { $set: { status: 'sent', sent_at: new Date(), updated_at: new Date() } },
      )
      summary.sent++
      audit(reminder.tenant_id, 'reminder.sent', reminder.id, { renewal_date: reminder.renewal_date, lead_days: reminder.lead_days })
    } else if (result === 'failed') {
      const attempts = reminder.attempts + 1
      await reminders.updateOne(
        { id: reminder.id },
        {
          $set: {
            status: attempts >= MAX_SEND_ATTEMPTS ? 'failed' : 'scheduled',
            attempts,
            last_error: 'push delivery failed',
            ...(attempts < MAX_SEND_ATTEMPTS ? { next_attempt_at: new Date(now.getTime() + attempts * RETRY_BACKOFF_MS) } : {}),
            updated_at: new Date(),
          },
        },
      )
      if (attempts >= MAX_SEND_ATTEMPTS) {
        summary.failed++
        log.error({ reminder_id: reminder.id, tenant_id: reminder.tenant_id, attempts }, 'Policy renewal reminder exhausted retries')
      } else {
        summary.deferred++
      }
    } else {
      // 'deferred' (quiet hours) or 'no_channel' (no registered devices) —
      // leave scheduled without burning an attempt; either condition can
      // resolve on its own before the renewal passes.
      await reminders.updateOne(
        { id: reminder.id },
        { $set: { status: 'scheduled', updated_at: new Date() } },
      )
      summary.deferred++
    }
  }

  summary.scheduled = await reminders.countDocuments({ status: 'scheduled' })
  return summary
}
