/**
 * Revenue truth for marketing intelligence — read-only.
 *
 * Pulls paid invoices, credit notes and subscriptions from Stripe into
 * `revenue_events` / `revenue_subscriptions` so channel economics are computed
 * from what was actually paid, not a constant. Nothing here can change Stripe:
 * the client is built only from STRIPE_READONLY_KEY, and only a Stripe
 * *restricted* key (rk_…) is accepted — the full secret key that runs billing
 * is refused even if someone pastes it into the read-only variable.
 *
 * Both collections are billing/financial records (like credit_ledger), kept
 * as the record of what was paid; see the erasure catalogue.
 */
import Stripe from 'stripe'
import type { Db } from 'mongodb'

/** Minimal shapes we read — keeps the sync testable without the network. */
export interface InvoiceLike {
  id: string
  status?: string | null
  currency: string
  amount_paid: number
  created: number
  livemode?: boolean
  status_transitions?: { paid_at?: number | null } | null
  customer?: string | { id: string } | null
  /** Pre-2025 API shape. */
  subscription?: string | { id: string } | null
  /** 2025+ API shape. */
  parent?: {
    subscription_details?: {
      subscription?: string | { id: string } | null
      metadata?: Record<string, string> | null
    } | null
  } | null
}

export interface CreditNoteLike {
  id: string
  invoice: string | { id: string }
  status?: string | null
  refund_amount?: number | null
  /** Credit notes that reduce what the customer owes also reduce revenue. */
  amount?: number | null
}

export interface SubscriptionLike {
  id: string
  status: string
  currency: string
  customer?: string | { id: string } | null
  metadata?: Record<string, string> | null
  canceled_at?: number | null
  livemode?: boolean
  items?: {
    data: Array<{
      quantity?: number | null
      price?: {
        unit_amount?: number | null
        recurring?: { interval: 'day' | 'week' | 'month' | 'year'; interval_count?: number } | null
      } | null
    }>
  } | null
}

export interface RevenueSource {
  paidInvoices(sinceUnix: number): AsyncIterable<InvoiceLike>
  creditNotes(sinceUnix: number): AsyncIterable<CreditNoteLike>
  subscriptions(): AsyncIterable<SubscriptionLike>
}

export interface RevenueEventDoc {
  invoice_id: string
  tenant_id: string | null
  subscription_id: string | null
  currency: string
  amount_pence: number
  refunded_pence: number
  net_pence: number
  paid_at: Date
  livemode: boolean
  synced_at: Date
}

export interface RevenueSubscriptionDoc {
  subscription_id: string
  tenant_id: string | null
  status: string
  currency: string
  mrr_pence: number
  canceled_at: Date | null
  livemode: boolean
  synced_at: Date
}

export interface RevenueSyncResult {
  configured: boolean
  invoices: number
  credit_notes: number
  subscriptions: number
  non_gbp_invoices: number
  synced_at?: string
}

const MAX_ITEMS = 5000 // hard stop for a runaway listing

const idOf = (v: string | { id: string } | null | undefined): string | null =>
  v == null ? null : typeof v === 'string' ? v : v.id

/**
 * The only way to get a Stripe client for intelligence. Returns null when no
 * key is set. Throws on anything but a restricted key, so a billing-capable
 * secret can never be used for analytics by mistake.
 */
export function readonlyStripeFromEnv(env: NodeJS.ProcessEnv = process.env): RevenueSource | null {
  const key = env['STRIPE_READONLY_KEY']
  if (!key) return null
  if (!/^rk_(test|live)_/.test(key)) {
    throw new Error(
      'STRIPE_READONLY_KEY must be a Stripe restricted key (rk_…). A full secret key is refused: marketing intelligence must not be able to change billing.',
    )
  }
  const stripe = new Stripe(key)
  async function* take<T>(it: AsyncIterable<T>): AsyncIterable<T> {
    let n = 0
    for await (const item of it) {
      if (++n > MAX_ITEMS) return
      yield item
    }
  }
  return {
    paidInvoices: (since) =>
      take(
        stripe.invoices.list({
          status: 'paid',
          created: { gte: since },
          limit: 100,
        }) as unknown as AsyncIterable<InvoiceLike>,
      ),
    creditNotes: (since) =>
      take(
        stripe.creditNotes.list({
          created: { gte: since },
          limit: 100,
        }) as unknown as AsyncIterable<CreditNoteLike>,
      ),
    subscriptions: () =>
      take(
        stripe.subscriptions.list({
          status: 'all',
          limit: 100,
        }) as unknown as AsyncIterable<SubscriptionLike>,
      ),
  }
}

/** Normalise a subscription's recurring price to pence per month. */
export function monthlyPence(sub: SubscriptionLike): number {
  let total = 0
  for (const item of sub.items?.data ?? []) {
    const unit = item.price?.unit_amount ?? 0
    const rec = item.price?.recurring
    if (!rec || unit <= 0) continue
    const count = Math.max(1, rec.interval_count ?? 1)
    const qty = Math.max(1, item.quantity ?? 1)
    const perMonth =
      rec.interval === 'month'
        ? unit / count
        : rec.interval === 'year'
          ? unit / (12 * count)
          : rec.interval === 'week'
            ? (unit * 52) / (12 * count)
            : (unit * 365) / (12 * count)
    total += perMonth * qty
  }
  return Math.round(total)
}

export async function ensureRevenueIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection('revenue_events').createIndex({ invoice_id: 1 }, { unique: true }),
    db.collection('revenue_events').createIndex({ paid_at: -1 }),
    db.collection('revenue_subscriptions').createIndex({ subscription_id: 1 }, { unique: true }),
  ]).catch(() => {})
}

/** tenant for an invoice: its own metadata, then the stored subscription link. */
async function tenantForInvoice(
  db: Db,
  inv: InvoiceLike,
  subId: string | null,
): Promise<string | null> {
  const meta = inv.parent?.subscription_details?.metadata?.['tenant_id']
  if (meta) return meta
  if (subId) {
    const t = await db
      .collection('tenants')
      .findOne({ stripe_subscription_id: subId }, { projection: { _id: 0, tenant_id: 1 } })
    if (t?.['tenant_id']) return String(t['tenant_id'])
  }
  return null
}

/**
 * Idempotent: re-running with the same Stripe data leaves identical rows.
 * Window defaults to 120 days; credit notes are re-read for the same window so
 * a refund issued later still lands on its invoice.
 */
export async function syncRevenue(
  db: Db,
  source: RevenueSource | null,
  opts: { days?: number; now?: Date } = {},
): Promise<RevenueSyncResult> {
  if (!source)
    return {
      configured: false,
      invoices: 0,
      credit_notes: 0,
      subscriptions: 0,
      non_gbp_invoices: 0,
    }
  const now = opts.now ?? new Date()
  const since = Math.floor((now.getTime() - (opts.days ?? 120) * 86_400_000) / 1000)
  const events = db.collection<RevenueEventDoc>('revenue_events')
  const subs = db.collection<RevenueSubscriptionDoc>('revenue_subscriptions')
  let invoices = 0
  let nonGbp = 0

  for await (const inv of source.paidInvoices(since)) {
    if (inv.status && inv.status !== 'paid') continue
    invoices += 1
    const currency = inv.currency.toLowerCase()
    if (currency !== 'gbp') nonGbp += 1
    const subId = idOf(inv.parent?.subscription_details?.subscription) ?? idOf(inv.subscription)
    const paidAt = new Date((inv.status_transitions?.paid_at ?? inv.created) * 1000)
    const tenant_id = await tenantForInvoice(db, inv, subId)
    await events.updateOne(
      { invoice_id: inv.id },
      {
        $set: {
          tenant_id,
          subscription_id: subId,
          currency,
          amount_pence: inv.amount_paid,
          paid_at: paidAt,
          livemode: inv.livemode === true,
          synced_at: now,
        },
        // refunded_pence is owned by the credit-note pass below.
        $setOnInsert: { refunded_pence: 0, net_pence: inv.amount_paid },
      },
      { upsert: true },
    )
  }

  // Refunds: sum issued credit notes per invoice, then net = paid − refunded.
  const refunds = new Map<string, number>()
  let creditNotes = 0
  for await (const cn of source.creditNotes(since)) {
    if (cn.status && cn.status !== 'issued') continue
    creditNotes += 1
    const inv = idOf(cn.invoice)
    if (!inv) continue
    refunds.set(inv, (refunds.get(inv) ?? 0) + (cn.refund_amount ?? cn.amount ?? 0))
  }
  for (const [invoice_id, refunded] of refunds) {
    const doc = await events.findOne({ invoice_id })
    if (!doc) continue
    await events.updateOne(
      { invoice_id },
      { $set: { refunded_pence: refunded, net_pence: Math.max(0, doc.amount_pence - refunded) } },
    )
  }

  let subscriptions = 0
  for await (const sub of source.subscriptions()) {
    subscriptions += 1
    const tenant_id =
      sub.metadata?.['tenant_id'] ??
      ((
        await db
          .collection('tenants')
          .findOne({ stripe_subscription_id: sub.id }, { projection: { _id: 0, tenant_id: 1 } })
      )?.['tenant_id'] as string | undefined) ??
      null
    await subs.updateOne(
      { subscription_id: sub.id },
      {
        $set: {
          tenant_id,
          status: sub.status,
          currency: sub.currency.toLowerCase(),
          mrr_pence: monthlyPence(sub),
          canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
          livemode: sub.livemode === true,
          synced_at: now,
        },
      },
      { upsert: true },
    )
  }

  await db
    .collection('revenue_sync')
    .updateOne(
      { _id: 'last' as never },
      { $set: { synced_at: now, invoices, credit_notes: creditNotes, subscriptions } },
      { upsert: true },
    )
  return {
    configured: true,
    invoices,
    credit_notes: creditNotes,
    subscriptions,
    non_gbp_invoices: nonGbp,
    synced_at: now.toISOString(),
  }
}

export interface RevenueSnapshot {
  /** false until a sync has ever succeeded — callers fall back to the estimate. */
  synced: boolean
  last_sync_at: string | null
  /** GBP only; other currencies are counted in non_gbp_* and left out of totals. */
  mrr_pence: number
  active_subscriptions: number
  revenue_30d_pence: number
  paid_invoices_30d: number
  non_gbp_invoices_30d: number
  /** Paid tenants first seen in the window. */
  new_paying_tenants_30d: number
  livemode: boolean | null
}

export async function readRevenueSnapshot(db: Db, now = new Date()): Promise<RevenueSnapshot> {
  const last = await db.collection('revenue_sync').findOne({ _id: 'last' as never })
  const empty: RevenueSnapshot = {
    synced: false,
    last_sync_at: null,
    mrr_pence: 0,
    active_subscriptions: 0,
    revenue_30d_pence: 0,
    paid_invoices_30d: 0,
    non_gbp_invoices_30d: 0,
    new_paying_tenants_30d: 0,
    livemode: null,
  }
  if (!last) return empty
  const since = new Date(now.getTime() - 30 * 86_400_000)
  const [subAgg, invAgg, nonGbp, firstPaid, anyLive] = await Promise.all([
    db
      .collection('revenue_subscriptions')
      .aggregate<{ mrr: number; n: number }>([
        { $match: { status: { $in: ['active', 'past_due'] }, currency: 'gbp' } },
        { $group: { _id: null, mrr: { $sum: '$mrr_pence' }, n: { $sum: 1 } } },
      ])
      .toArray(),
    db
      .collection('revenue_events')
      .aggregate<{ net: number; n: number }>([
        { $match: { paid_at: { $gte: since }, currency: 'gbp' } },
        { $group: { _id: null, net: { $sum: '$net_pence' }, n: { $sum: 1 } } },
      ])
      .toArray(),
    db
      .collection('revenue_events')
      .countDocuments({ paid_at: { $gte: since }, currency: { $ne: 'gbp' } }),
    db
      .collection('revenue_events')
      .aggregate<{ n: number }>([
        { $match: { tenant_id: { $ne: null }, currency: 'gbp' } },
        { $group: { _id: '$tenant_id', first: { $min: '$paid_at' } } },
        { $match: { first: { $gte: since } } },
        { $count: 'n' },
      ])
      .toArray(),
    db.collection('revenue_events').findOne({}, { projection: { livemode: 1 } }),
  ])
  return {
    synced: true,
    last_sync_at: (last['synced_at'] as Date).toISOString(),
    mrr_pence: subAgg[0]?.mrr ?? 0,
    active_subscriptions: subAgg[0]?.n ?? 0,
    revenue_30d_pence: invAgg[0]?.net ?? 0,
    paid_invoices_30d: invAgg[0]?.n ?? 0,
    non_gbp_invoices_30d: nonGbp,
    new_paying_tenants_30d: firstPaid[0]?.n ?? 0,
    livemode: anyLive ? anyLive['livemode'] === true : null,
  }
}
