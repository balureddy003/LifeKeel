/**
 * Family heartbeat (PRD-136 §4) — the weekly/monthly "what moved" email,
 * one per active adult roster member, tenant-level prefs.
 *
 * Deliberately NOT routed through DeliveryRouter.deliver(): the heartbeat
 * isn't insight-shaped and the router's channels are all
 * InsightNotification-typed. Email goes via sendHeartbeatEmail (auth-email
 * shell); web push is deferred — the push channel only speaks
 * InsightNotification, so this batch is email-only (noted in the handoff).
 *
 * Idempotent: a `heartbeat_sends` row per (tenant, member, window_start)
 * means a retried run sends nothing twice. Every read tolerates absent
 * collections/methods — a fake db in tests means a quiet zero-send, not
 * a crash.
 */
import type { Db } from 'mongodb'
import { createLogger, getTenantCollection } from '@lifekeel/platform'
import { sendHeartbeatEmail } from '../auth-email.js'
import { heartbeatUnsubUrl } from '../routes/heartbeat-unsubscribe.js'
import { renderHeartbeat, type HeartbeatData } from '../feed/render-heartbeat.js'
import type { FamilyGroupDoc } from '../routes/family-group.js'
import type { DeliveryPreferences } from '../delivery/delivery-router.js'
import { renderPlaybook, type LifeEventType } from '../life-events/render-playbook.js'
import type { FinancialProfile } from '../routes/family-financial-profile.js'

const log = createLogger({ service: 'family-heartbeat', version: '0.0.0' })

const ADULT_ROLES = new Set(['organizer', 'parent', 'adult'])
const OPEN_INSIGHT_STATES = ['identified', 'sent', 'execution_failed', 'snoozed']
const PLAYBOOK_EVENT_TYPES = new Set<string>(['bereavement', 'disability', 'medical'])
const STALE_PROFILE_MS = 180 * 86_400_000
const REVIEW_INTERVAL_MS = 365 * 86_400_000
const RENEWAL_HORIZON_MS = 30 * 86_400_000

export interface HeartbeatResult {
  tenants: number
  sent: number
  skipped_quiet: number
  skipped_off: number
}

type AnyDoc = Record<string, unknown>

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p
  } catch {
    return fallback
  }
}

async function findAll(
  db: Db,
  tenantId: string,
  name: string,
  filter: AnyDoc = {},
): Promise<AnyDoc[]> {
  try {
    const col = getTenantCollection<AnyDoc>(db, name, tenantId)
    if (typeof col.find !== 'function') return []
    return (await col.find(filter).toArray()) as AnyDoc[]
  } catch {
    return []
  }
}

/** Pending response-plan steps = sum over life-event signals of playbook
 *  steps not yet completed — the same count checklist-reminder uses. */
async function pendingPlaybookSteps(
  db: Db,
  tenantId: string,
  profile: FinancialProfile | null,
): Promise<number> {
  if (!profile) return 0
  // life_event signals live in the global 'signals' collection — queried
  // raw because it isn't the tenant-collection convention (see
  // checklist-reminder.ts for the same pattern).
  const signals = await safe(
    db
      .collection('signals')
      .find({ tenant_id: tenantId, signal_type: 'family.life_event' })
      .toArray(),
    [] as AnyDoc[],
  )
  let pending = 0
  for (const s of signals) {
    const data = (s['data'] ?? {}) as AnyDoc
    if (!PLAYBOOK_EVENT_TYPES.has(String(data['event_type']))) continue
    try {
      const playbook = renderPlaybook(
        data['event_type'] as LifeEventType,
        profile,
        data['affected_member_id'] as string | undefined,
      )
      const completed = new Set((data['completed_step_ids'] as string[] | undefined) ?? [])
      pending += playbook.steps.filter((step) => !completed.has(step.id)).length
    } catch {
      // unknown event type / partial signal — counts as nothing pending
    }
  }
  return pending
}

export async function runFamilyHeartbeat(
  db: Db,
  opts: { cadence: 'weekly' | 'monthly'; now?: Date },
): Promise<HeartbeatResult> {
  const now = opts.now ?? new Date()
  const appUrl = process.env['LIFEKEEL_URL'] ?? 'http://localhost:3002'
  const apiUrl = process.env['API_BASE_URL'] ?? 'http://localhost:3001'

  const families = await safe(
    db.collection<FamilyGroupDoc>('family_groups').find({}).toArray(),
    [] as FamilyGroupDoc[],
  )

  const result: HeartbeatResult = { tenants: 0, sent: 0, skipped_quiet: 0, skipped_off: 0 }

  for (const family of families) {
    const tenantId = family.tenant_id
    const prefs = (await safe(
      db.collection('delivery_preferences').findOne({ tenant_id: tenantId }),
      null,
    )) as DeliveryPreferences | null
    const cadence = prefs?.heartbeat_cadence ?? 'weekly'
    if (cadence === 'off' || cadence !== opts.cadence) {
      result.skipped_off++
      continue
    }
    result.tenants++

    const windowStart =
      opts.cadence === 'weekly'
        ? new Date(now.getTime() - 7 * 86_400_000)
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const windowStartIso = windowStart.toISOString().slice(0, 10)

    const adults = (family.members ?? []).filter(
      (m) => m.status === 'active' && ADULT_ROLES.has(m.role) && m.email,
    )
    if (adults.length === 0) continue

    const [events, history, insights, profileDoc] = await Promise.all([
      findAll(db, tenantId, 'readiness_events'),
      findAll(db, tenantId, 'family_readiness_history'),
      safe(db.collection('insights').find({ tenant_id: tenantId }).toArray(), [] as AnyDoc[]),
      safe(getTenantCollection<AnyDoc>(db, 'family_financial_profile', tenantId).findOne({}), null),
    ])

    const inWindow = (d: Date | string | undefined) =>
      d !== undefined && new Date(d).getTime() >= windowStart.getTime()
    const visibleEvents = events.filter(
      (e) => inWindow(e['created_at'] as Date) && e['muted'] !== true,
    )

    const ordered = history
      .filter((h) => inWindow(h['date'] as string) && typeof h['score'] === 'number')
      .sort((a, b) => String(a['date']).localeCompare(String(b['date'])))
    const scoreDelta =
      ordered.length >= 2
        ? (ordered[ordered.length - 1]!['score'] as number) - (ordered[0]!['score'] as number)
        : null

    const openInsights = insights.filter((i) =>
      OPEN_INSIGHT_STATES.includes(String(i['state'])),
    ).length
    const newInsights = insights.filter((i) => inWindow(i['created_at'] as Date)).length
    const resolvedInsights = insights.filter((i) => inWindow(i['resolved_at'] as Date)).length

    const policies = (profileDoc?.['policies'] as AnyDoc[] | undefined) ?? []
    const renewals = policies
      .filter((p) => {
        const d =
          typeof p['renewal_date'] === 'string' ? new Date(p['renewal_date']).getTime() : Number.NaN
        return !Number.isNaN(d) && d >= now.getTime() && d <= now.getTime() + RENEWAL_HORIZON_MS
      })
      .map((p) => ({
        type: String(p['type'] ?? 'policy'),
        renewal_date: String(p['renewal_date']),
      }))

    const pendingSteps = await pendingPlaybookSteps(
      db,
      tenantId,
      profileDoc as FinancialProfile | null,
    )

    const updatedAt = (profileDoc?.['updated_at'] as Date | undefined) ?? null
    const reviewedAt = (profileDoc?.['reviewed_at'] as Date | undefined) ?? null
    const snoozedUntil = (profileDoc?.['review_snoozed_until'] as Date | undefined) ?? null
    const profileStale =
      updatedAt !== null && now.getTime() - updatedAt.getTime() > STALE_PROFILE_MS
    const reviewDue =
      profileDoc !== null &&
      !(snoozedUntil && snoozedUntil.getTime() > now.getTime()) &&
      now.getTime() - (reviewedAt?.getTime() ?? updatedAt?.getTime() ?? now.getTime()) >
        REVIEW_INTERVAL_MS

    const data: HeartbeatData = {
      period: opts.cadence === 'weekly' ? 'week' : 'month',
      window_start: windowStart,
      score_delta: scoreDelta,
      moved_events: visibleEvents.length,
      open_insights: openInsights,
      new_insights: newInsights,
      resolved_insights: resolvedInsights,
      renewals,
      pending_steps: pendingSteps,
      profile_stale: profileStale,
      review_due: reviewDue,
      app_url: appUrl,
    }

    const rendered = renderHeartbeat(data)
    const quiet =
      data.moved_events === 0 &&
      data.new_insights === 0 &&
      data.resolved_insights === 0 &&
      data.renewals.length === 0 &&
      data.pending_steps === 0 &&
      !data.profile_stale &&
      !data.review_due &&
      (data.score_delta === null || data.score_delta === 0)
    if (quiet && !prefs?.heartbeat_quiet_weeks) {
      result.skipped_quiet++
      continue
    }

    const sends = getTenantCollection<AnyDoc>(db, 'heartbeat_sends', tenantId)
    for (const member of adults) {
      try {
        const already =
          typeof sends.findOne === 'function'
            ? await sends
                .findOne({ member_id: member.id, window_start: windowStartIso })
                .catch(() => null)
            : null
        if (already) continue
        await sendHeartbeatEmail(
          member.email,
          member.name,
          rendered,
          heartbeatUnsubUrl(apiUrl, tenantId, member.id),
        )
        if (typeof sends.insertOne === 'function') {
          await sends
            .insertOne({ member_id: member.id, window_start: windowStartIso, sent_at: now })
            .catch(() => {})
        }
        result.sent++
      } catch (err) {
        log.warn(
          { err, tenant_id: tenantId, member_id: member.id },
          'Heartbeat send failed for member — continuing',
        )
      }
    }
  }

  return result
}
