/**
 * Notification tiers, caps and the ask-first digest-only offer (PRD-139).
 *
 * DeliveryRouter applies an urgency floor, quiet hours and per-insight dedup;
 * nothing counted messages across a family. This is the one place that does.
 * It answers "may this message go?" and keeps `notification_ledger`: tier,
 * kind, outcome, reason, a key (insight id or input name) and a timestamp.
 * Counts and times only, never message content.
 *
 *   A  change alert   at most 1 per 14 days
 *   B  digest         exempt from the budget, counted for visibility
 *   C  data needed    at most 2 per quarter, never the same input twice in one
 *   D  life-event     in-app only: never sent outbound from here
 *
 * A global budget of 2 non-digest messages a month covers A, C and D. Critical,
 * dated-obligation and safety messages, and an alert an organizer explicitly
 * released from review, are exempt from every cap and from demotion
 * (amendment 2), but are still logged. Every drop is recorded with its
 * reason, and the caller queues dropped alerts for the digest, so nothing is
 * lost silently.
 *
 * Every number below is a hypothesis with no supporting evidence found
 * (amendment 1); the ledger exists so what each one drops can be read back.
 * The budget is per tenant because delivery preferences and channels are
 * tenant-level today; moving to per member needs per-member channels first.
 *
 * Demotion is asked, never done silently (amendment 3), and keys off clicks
 * and explicit responses, not opens (amendment 4).
 */
import type { Db } from 'mongodb'

export const BUDGET = {
  /** Tier A: one change alert per this many days. */
  tier_a_window_days: 14,
  /** Tier C: data-needed messages per calendar quarter. */
  tier_c_per_quarter: 2,
  /** A + C + D together, per calendar month (UTC). */
  monthly_non_digest: 2,
  /** A sent alert counts as unanswered only after this many days without a response. */
  response_window_days: 7,
  /** Consecutive unanswered A/C alerts before offering digest-only. */
  offer_after_unanswered: 2,
  /** After a "no", do not offer again for this many days. */
  offer_cooldown_days: 90,
} as const

export type Tier = 'A' | 'B' | 'C' | 'D'
export type Exemption = 'critical' | 'dated_obligation' | 'safety' | 'human_release'

export interface SendRequest {
  tenantId: string
  tier: Tier
  /** Short machine label, e.g. "insight_alert", "renewal_reminder", "quiet_care_digest". */
  kind: string
  /** Insight id, or the detector+input for Tier C. Used for dedup and response lookup. */
  key?: string
  exempt?: Exemption
  /** PRD-140: set when this send used the email floor after a push failed. */
  fallback_from?: string
  now?: Date
}

export type Decision = { allow: true; exempt?: Exemption } | { allow: false; reason: DropReason }

export type DropReason =
  'tier_a_cap' | 'tier_c_cap' | 'tier_c_repeat' | 'tier_d_in_app_only' | 'monthly_budget'

interface LedgerRow {
  tenant_id: string
  tier: Tier
  kind: string
  key?: string
  outcome: 'sent' | 'exempt' | 'dropped'
  reason?: string
  fallback_from?: string
  at: Date
}

const DAY = 86_400_000
const LEDGER = 'notification_ledger'

const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
const quarterStart = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1))

/** Ledger writes never change whether a message is sent. */
async function write(db: Db, row: LedgerRow): Promise<void> {
  try {
    await db.collection<LedgerRow>(LEDGER).insertOne(row)
  } catch {
    // bookkeeping only
  }
}

async function countSent(
  db: Db,
  tenantId: string,
  tiers: Tier[],
  since: Date,
  extra: Record<string, unknown> = {},
): Promise<number> {
  try {
    return await db.collection(LEDGER).countDocuments({
      tenant_id: tenantId,
      tier: { $in: tiers },
      outcome: 'sent',
      at: { $gte: since },
      ...extra,
    })
  } catch {
    return 0
  }
}

/**
 * Decide whether a message may be sent. A drop is recorded here; an allowed
 * message is recorded by `recordSent` once delivery is confirmed, so a failed
 * send does not use up the budget.
 */
export async function decideSend(db: Db, req: SendRequest): Promise<Decision> {
  const now = req.now ?? new Date()
  const drop = async (reason: DropReason): Promise<Decision> => {
    await write(db, {
      tenant_id: req.tenantId,
      tier: req.tier,
      kind: req.kind,
      ...(req.key ? { key: req.key } : {}),
      outcome: 'dropped',
      reason,
      at: now,
    })
    return { allow: false, reason }
  }

  if (req.exempt) return { allow: true, exempt: req.exempt }
  if (req.tier === 'B') return { allow: true }
  if (req.tier === 'D') return drop('tier_d_in_app_only')

  if (req.tier === 'A') {
    const recent = await countSent(
      db,
      req.tenantId,
      ['A'],
      new Date(now.getTime() - BUDGET.tier_a_window_days * DAY),
    )
    if (recent >= 1) return drop('tier_a_cap')
  }

  if (req.tier === 'C') {
    const qs = quarterStart(now)
    if (req.key && (await countSent(db, req.tenantId, ['C'], qs, { key: req.key })) > 0) {
      return drop('tier_c_repeat')
    }
    if ((await countSent(db, req.tenantId, ['C'], qs)) >= BUDGET.tier_c_per_quarter) {
      return drop('tier_c_cap')
    }
  }

  const thisMonth = await countSent(db, req.tenantId, ['A', 'C', 'D'], monthStart(now))
  if (thisMonth >= BUDGET.monthly_non_digest) return drop('monthly_budget')
  return { allow: true }
}

/** Record a confirmed send. Exempt and digest sends are logged but do not use the budget. */
export async function recordSent(db: Db, req: SendRequest): Promise<void> {
  await write(db, {
    tenant_id: req.tenantId,
    tier: req.tier,
    kind: req.kind,
    ...(req.key ? { key: req.key } : {}),
    outcome: req.exempt || req.tier === 'B' ? 'exempt' : 'sent',
    ...(req.exempt ? { reason: req.exempt } : {}),
    ...(req.fallback_from ? { fallback_from: req.fallback_from } : {}),
    at: req.now ?? new Date(),
  })
}

/**
 * Has the family responded to this alert? A signed-in click on it (recorded as
 * an `alert_click` value event), or the insight itself moving on from
 * identified/sent (approved, dismissed, resolved). Opens are not used.
 */
async function responded(db: Db, tenantId: string, row: LedgerRow): Promise<boolean> {
  if (!row.key) return false
  const click = await db
    .collection('value_events')
    .findOne({ tenant_id: tenantId, kind: 'alert_click', key: row.key, at: { $gte: row.at } })
  if (click) return true
  const acted = await db
    .collection('insights')
    .findOne({ id: row.key, tenant_id: tenantId, state: { $nin: ['identified', 'sent'] } })
  return acted !== null
}

interface OfferState {
  digest_mode?: boolean
  digest_offer?: { offered_at: Date }
  digest_offer_declined_at?: Date
}

/**
 * Offer "switch to digest only?" after two consecutive unanswered A/C alerts.
 * It only sets a pending flag (shown in settings and the next digest); it never
 * changes how anything is delivered. Idempotent.
 * @returns true when an offer is now pending.
 */
export async function maybeOfferDigestOnly(
  db: Db,
  tenantId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const prefs = (await db
    .collection('delivery_preferences')
    .findOne({ tenant_id: tenantId })) as OfferState | null
  if (prefs?.digest_offer) return true
  if (prefs?.digest_mode) return false
  const declined = prefs?.digest_offer_declined_at
  if (declined && now.getTime() - declined.getTime() < BUDGET.offer_cooldown_days * DAY) {
    return false
  }

  const recent = (await db
    .collection<LedgerRow>(LEDGER)
    .find({ tenant_id: tenantId, tier: { $in: ['A', 'C'] }, outcome: 'sent' })
    .sort({ at: -1 })
    .limit(BUDGET.offer_after_unanswered)
    .toArray()) as LedgerRow[]
  if (recent.length < BUDGET.offer_after_unanswered) return false

  const settled = now.getTime() - BUDGET.response_window_days * DAY
  for (const row of recent) {
    // Too recent to call unanswered, or answered: no offer.
    if (row.at.getTime() > settled) return false
    if (await responded(db, tenantId, row)) return false
  }
  await db
    .collection('delivery_preferences')
    .updateOne({ tenant_id: tenantId }, { $set: { digest_offer: { offered_at: now } } })
  return true
}

/** Drops by reason over a window, for the operator view. */
export async function droppedByReason(
  db: Db,
  since: Date,
): Promise<{ by_reason: Record<string, number>; families: number }> {
  const rows = (await db
    .collection(LEDGER)
    .find({ outcome: 'dropped', at: { $gte: since } })
    .project({ tenant_id: 1, reason: 1 })
    .toArray()) as unknown as { tenant_id: string; reason: string }[]
  const by_reason: Record<string, number> = {}
  for (const r of rows) by_reason[r.reason] = (by_reason[r.reason] ?? 0) + 1
  return { by_reason, families: new Set(rows.map((r) => r.tenant_id)).size }
}
