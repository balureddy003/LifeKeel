import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  monthlyPence,
  readRevenueSnapshot,
  readonlyStripeFromEnv,
  syncRevenue,
  type CreditNoteLike,
  type InvoiceLike,
  type RevenueSource,
  type SubscriptionLike,
} from '../revenue.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('revenue-test')
})
beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

const NOW = new Date('2026-10-23T12:00:00Z')
const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)

async function* from<T>(items: T[]): AsyncIterable<T> {
  for (const i of items) yield i
}

function source(over: {
  invoices?: InvoiceLike[]
  creditNotes?: CreditNoteLike[]
  subs?: SubscriptionLike[]
}): RevenueSource {
  return {
    paidInvoices: () => from(over.invoices ?? []),
    creditNotes: () => from(over.creditNotes ?? []),
    subscriptions: () => from(over.subs ?? []),
  }
}

const invoice = (
  id: string,
  pence: number,
  iso: string,
  extra: Partial<InvoiceLike> = {},
): InvoiceLike => ({
  id,
  status: 'paid',
  currency: 'gbp',
  amount_paid: pence,
  created: unix(iso),
  status_transitions: { paid_at: unix(iso) },
  parent: { subscription_details: { subscription: 'sub_1', metadata: { tenant_id: 't1' } } },
  ...extra,
})

const monthlySub = (
  id: string,
  tenant: string,
  unit = 799,
  status = 'active',
): SubscriptionLike => ({
  id,
  status,
  currency: 'gbp',
  metadata: { tenant_id: tenant },
  items: {
    data: [{ quantity: 1, price: { unit_amount: unit, recurring: { interval: 'month' } } }],
  },
})

describe('readonlyStripeFromEnv', () => {
  it('is null when no key is configured', () => {
    expect(readonlyStripeFromEnv({})).toBeNull()
  })

  it('refuses a full secret key — billing-capable keys never reach analytics', () => {
    for (const key of ['sk_test_abc', 'sk_live_abc', 'whatever']) {
      expect(() => readonlyStripeFromEnv({ STRIPE_READONLY_KEY: key })).toThrow(/restricted key/i)
    }
  })

  it('does not fall back to STRIPE_SECRET_KEY', () => {
    expect(readonlyStripeFromEnv({ STRIPE_SECRET_KEY: 'sk_test_abc' })).toBeNull()
  })

  it('accepts a restricted key', () => {
    expect(readonlyStripeFromEnv({ STRIPE_READONLY_KEY: 'rk_test_abc' })).not.toBeNull()
  })
})

describe('syncRevenue', () => {
  it('reports unconfigured and writes nothing when there is no source', async () => {
    expect(await syncRevenue(db, null, { now: NOW })).toMatchObject({
      configured: false,
      invoices: 0,
    })
    expect(await db.collection('revenue_events').countDocuments()).toBe(0)
  })

  it('stores paid invoices with the tenant from subscription metadata', async () => {
    await syncRevenue(db, source({ invoices: [invoice('in_1', 799, '2026-10-01T10:00:00Z')] }), {
      now: NOW,
    })
    const row = await db.collection('revenue_events').findOne({ invoice_id: 'in_1' })
    expect(row).toMatchObject({
      tenant_id: 't1',
      subscription_id: 'sub_1',
      currency: 'gbp',
      amount_pence: 799,
      refunded_pence: 0,
      net_pence: 799,
    })
    expect(row?.['paid_at']).toEqual(new Date('2026-10-01T10:00:00Z'))
  })

  it('falls back to the tenant stored against the subscription', async () => {
    await db
      .collection('tenants')
      .insertOne({ tenant_id: 'stored-t', stripe_subscription_id: 'sub_9' })
    const inv = invoice('in_2', 799, '2026-10-02T10:00:00Z', {
      parent: { subscription_details: { subscription: 'sub_9', metadata: null } },
    })
    await syncRevenue(db, source({ invoices: [inv] }), { now: NOW })
    expect(
      (await db.collection('revenue_events').findOne({ invoice_id: 'in_2' }))?.['tenant_id'],
    ).toBe('stored-t')
  })

  it('is idempotent — a second run leaves the same rows', async () => {
    const src = source({
      invoices: [
        invoice('in_1', 799, '2026-10-01T10:00:00Z'),
        invoice('in_2', 799, '2026-10-02T10:00:00Z'),
      ],
      subs: [monthlySub('sub_1', 't1')],
    })
    await syncRevenue(db, src, { now: NOW })
    await syncRevenue(db, src, { now: NOW })
    expect(await db.collection('revenue_events').countDocuments()).toBe(2)
    expect(await db.collection('revenue_subscriptions').countDocuments()).toBe(1)
  })

  it('subtracts refunds issued as credit notes, even from a later sync', async () => {
    const inv = invoice('in_1', 799, '2026-10-01T10:00:00Z')
    await syncRevenue(db, source({ invoices: [inv] }), { now: NOW })
    await syncRevenue(
      db,
      source({
        invoices: [inv],
        creditNotes: [{ id: 'cn_1', invoice: 'in_1', status: 'issued', refund_amount: 300 }],
      }),
      { now: NOW },
    )
    expect(await db.collection('revenue_events').findOne({ invoice_id: 'in_1' })).toMatchObject({
      amount_pence: 799,
      refunded_pence: 300,
      net_pence: 499,
    })
  })

  it('ignores void credit notes and never nets below zero', async () => {
    const inv = invoice('in_1', 500, '2026-10-01T10:00:00Z')
    await syncRevenue(
      db,
      source({
        invoices: [inv],
        creditNotes: [
          { id: 'cn_void', invoice: 'in_1', status: 'void', refund_amount: 500 },
          { id: 'cn_big', invoice: { id: 'in_1' }, status: 'issued', refund_amount: 900 },
        ],
      }),
      { now: NOW },
    )
    expect(
      (await db.collection('revenue_events').findOne({ invoice_id: 'in_1' }))?.['net_pence'],
    ).toBe(0)
  })

  it('stores non-GBP invoices but flags them and leaves them out of totals', async () => {
    const result = await syncRevenue(
      db,
      source({
        invoices: [
          invoice('in_gbp', 799, '2026-10-10T10:00:00Z'),
          invoice('in_eur', 900, '2026-10-11T10:00:00Z', { currency: 'EUR' }),
        ],
      }),
      { now: NOW },
    )
    expect(result.non_gbp_invoices).toBe(1)
    const snap = await readRevenueSnapshot(db, NOW)
    expect(snap).toMatchObject({
      paid_invoices_30d: 1,
      revenue_30d_pence: 799,
      non_gbp_invoices_30d: 1,
    })
  })

  it('skips unpaid invoices', async () => {
    await syncRevenue(
      db,
      source({ invoices: [invoice('in_open', 799, '2026-10-01T10:00:00Z', { status: 'open' })] }),
      { now: NOW },
    )
    expect(await db.collection('revenue_events').countDocuments()).toBe(0)
  })
})

describe('monthlyPence', () => {
  it('normalises intervals to a month', () => {
    const sub = (unit: number, interval: 'month' | 'year' | 'week' | 'day', count = 1, qty = 1) =>
      ({
        id: 's',
        status: 'active',
        currency: 'gbp',
        items: {
          data: [
            {
              quantity: qty,
              price: { unit_amount: unit, recurring: { interval, interval_count: count } },
            },
          ],
        },
      }) as SubscriptionLike
    expect(monthlyPence(sub(799, 'month'))).toBe(799)
    expect(monthlyPence(sub(9600, 'year'))).toBe(800)
    expect(monthlyPence(sub(2400, 'month', 3))).toBe(800)
    expect(monthlyPence(sub(100, 'month', 1, 3))).toBe(300)
    expect(
      monthlyPence({
        id: 's',
        status: 'active',
        currency: 'gbp',
        items: { data: [{ price: { unit_amount: 500 } }] },
      }),
    ).toBe(0) // one-off price
  })
})

describe('readRevenueSnapshot', () => {
  it('reports not synced until a sync has run, so callers keep the estimate', async () => {
    expect(await readRevenueSnapshot(db, NOW)).toMatchObject({ synced: false, mrr_pence: 0 })
  })

  it('computes MRR from active and past-due GBP subscriptions only', async () => {
    await syncRevenue(
      db,
      source({
        subs: [
          monthlySub('s1', 't1'),
          monthlySub('s2', 't2', 1000, 'past_due'),
          monthlySub('s3', 't3', 500, 'canceled'),
          monthlySub('s4', 't4', 500, 'trialing'),
          { ...monthlySub('s5', 't5'), currency: 'usd' },
        ],
      }),
      { now: NOW },
    )
    const snap = await readRevenueSnapshot(db, NOW)
    expect(snap).toMatchObject({ synced: true, mrr_pence: 1799, active_subscriptions: 2 })
  })

  it('counts a tenant as newly paying only in the window of its first payment', async () => {
    await syncRevenue(
      db,
      source({
        invoices: [
          invoice('old', 799, '2026-08-01T10:00:00Z', {
            parent: {
              subscription_details: { subscription: 'a', metadata: { tenant_id: 'veteran' } },
            },
          }),
          invoice('renew', 799, '2026-10-01T10:00:00Z', {
            parent: {
              subscription_details: { subscription: 'a', metadata: { tenant_id: 'veteran' } },
            },
          }),
          invoice('new', 799, '2026-10-05T10:00:00Z', {
            parent: {
              subscription_details: { subscription: 'b', metadata: { tenant_id: 'fresh' } },
            },
          }),
        ],
      }),
      { now: NOW },
    )
    expect((await readRevenueSnapshot(db, NOW)).new_paying_tenants_30d).toBe(1)
  })
})
