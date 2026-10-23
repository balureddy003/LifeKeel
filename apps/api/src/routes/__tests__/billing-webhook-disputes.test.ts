/**
 * Refunds, disputes and expired checkouts (Stripe webhook).
 *
 * The contract these pin down: the handlers RECORD the fact on the tenant,
 * write an audit entry and raise an operator alert — and change NOTHING about
 * the plan, status or subscription. Ending someone's access over a refund or
 * a lost dispute is a human decision (CLAUDE.md rule 1).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'node:crypto'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, type Db } from 'mongodb'
import Stripe from 'stripe'

const alerts: Array<{ title: string; severity: string; tenant_id?: string; message: string }> = []
vi.mock('../../billing/billing-alerts.js', () => ({
  sendBillingAlert: vi.fn(
    async (a: { title: string; severity: string; tenant_id?: string; message: string }) => {
      alerts.push(a)
    },
  ),
}))

import { registerBillingRoutes } from '../billing.js'

const WEBHOOK_SECRET = 'whsec_test_secret_for_disputes'
const TENANT_ID = 'tenant-dispute-test'

function sign(payload: string): string {
  const t = Math.floor(Date.now() / 1000)
  const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex')
  return `t=${t},v1=${sig}`
}

async function postEvent(app: ReturnType<typeof Fastify>, event: Record<string, unknown>) {
  const payload = JSON.stringify(event)
  return app.inject({
    method: 'POST',
    url: '/billing/webhook',
    headers: { 'content-type': 'application/json', 'stripe-signature': sign(payload) },
    payload,
  })
}

describe('refund / dispute / expired-checkout webhooks', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db
  let app: ReturnType<typeof Fastify>
  const saved: Record<string, string | undefined> = {}

  beforeEach(async () => {
    alerts.length = 0
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
    db = client.db('webhook_dispute_test')
    for (const k of [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'LIFEKEEL_STRIPE_WEBHOOK_SECRET',
    ])
      saved[k] = process.env[k]
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_dummy_key_for_unit_tests'
    process.env['STRIPE_WEBHOOK_SECRET'] = WEBHOOK_SECRET
    delete process.env['LIFEKEEL_STRIPE_WEBHOOK_SECRET']

    // A real client (so webhooks.constructEvent verifies signatures for real)
    // with only the one network call stubbed.
    const fakeStripe = new Stripe('sk_test_dummy_key_for_unit_tests')
    fakeStripe.charges.retrieve = vi.fn(async (id: string) => ({
      id,
      customer: 'cus_disp',
    })) as unknown as typeof fakeStripe.charges.retrieve

    app = Fastify()
    registerBillingRoutes(app, db, { stripe: fakeStripe })
    await app.ready()
    await db.collection('stripe_webhook_events').createIndex({ event_id: 1 }, { unique: true })
    await db.collection('tenants').insertOne({
      tenant_id: TENANT_ID,
      name: 'Dispute Test',
      plan: 'starter',
      status: 'active',
      stripe_customer_id: 'cus_disp',
      stripe_subscription_id: 'sub_disp',
      billing: { credits_balance: 10, credits_included: 50, currency: 'GBP' },
    })
  })

  afterEach(async () => {
    await app.close()
    await client.close()
    await mongod.stop()
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  const tenant = () => db.collection('tenants').findOne({ tenant_id: TENANT_ID })

  it('charge.refunded records the refund, alerts, and leaves plan and status untouched', async () => {
    const res = await postEvent(app, {
      id: 'evt_refund_1',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_1',
          customer: 'cus_disp',
          amount_refunded: 799,
          currency: 'gbp',
          refunded: true,
        },
      },
    })
    expect(res.statusCode).toBe(200)
    const t = await tenant()
    expect(t?.['billing']?.['last_refund']).toMatchObject({
      charge_id: 'ch_1',
      amount_refunded: 799,
      fully_refunded: true,
    })
    expect(t?.['plan']).toBe('starter')
    expect(t?.['status']).toBe('active')
    expect(t?.['stripe_subscription_id']).toBe('sub_disp')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      title: 'Charge fully refunded',
      severity: 'warning',
      tenant_id: TENANT_ID,
    })
    expect(alerts[0]!.message).toContain('NOT changed')
  })

  it('charge.dispute.created resolves the tenant via the charge, records it and raises a critical alert', async () => {
    const due = Math.floor(Date.now() / 1000) + 7 * 86400
    const res = await postEvent(app, {
      id: 'evt_dispute_open',
      type: 'charge.dispute.created',
      data: {
        object: {
          id: 'dp_1',
          charge: 'ch_9',
          status: 'needs_response',
          reason: 'fraudulent',
          amount: 799,
          currency: 'gbp',
          evidence_details: { due_by: due },
        },
      },
    })
    expect(res.statusCode).toBe(200)
    const t = await tenant()
    expect(t?.['billing']?.['dispute']).toMatchObject({
      dispute_id: 'dp_1',
      status: 'needs_response',
      reason: 'fraudulent',
    })
    expect(new Date(t?.['billing']?.['dispute']?.['evidence_due_by']).getTime()).toBe(due * 1000)
    expect(t?.['status']).toBe('active')
    expect(t?.['plan']).toBe('starter')
    expect(alerts[0]).toMatchObject({ title: 'Payment dispute opened', severity: 'critical' })
  })

  it('charge.dispute.closed updates the status; a lost dispute is critical and still changes no access', async () => {
    await postEvent(app, {
      id: 'evt_dispute_open2',
      type: 'charge.dispute.created',
      data: {
        object: {
          id: 'dp_2',
          charge: 'ch_9',
          status: 'needs_response',
          reason: 'general',
          amount: 799,
          currency: 'gbp',
        },
      },
    })
    alerts.length = 0
    await postEvent(app, {
      id: 'evt_dispute_closed',
      type: 'charge.dispute.closed',
      data: {
        object: {
          id: 'dp_2',
          charge: 'ch_9',
          status: 'lost',
          reason: 'general',
          amount: 799,
          currency: 'gbp',
        },
      },
    })
    const t = await tenant()
    expect(t?.['billing']?.['dispute']?.['status']).toBe('lost')
    expect(t?.['status']).toBe('active')
    expect(alerts[0]).toMatchObject({ severity: 'critical' })
    expect(alerts[0]!.title).toContain('lost')
  })

  it('a re-delivered event is a no-op duplicate (no second alert)', async () => {
    const ev = {
      id: 'evt_refund_dup',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_2',
          customer: 'cus_disp',
          amount_refunded: 100,
          currency: 'gbp',
          refunded: false,
        },
      },
    }
    await postEvent(app, ev)
    const again = await postEvent(app, ev)
    expect(again.json()).toMatchObject({ duplicate: true })
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.title).toBe('Charge partially refunded')
  })

  it('an unknown customer is ignored without error', async () => {
    const res = await postEvent(app, {
      id: 'evt_refund_unknown',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_x',
          customer: 'cus_nobody',
          amount_refunded: 1,
          currency: 'gbp',
          refunded: true,
        },
      },
    })
    expect(res.statusCode).toBe(200)
    expect(alerts).toHaveLength(0)
  })

  it('checkout.session.expired is acknowledged and changes nothing', async () => {
    const res = await postEvent(app, {
      id: 'evt_expired',
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_1', metadata: { tenant_id: TENANT_ID } } },
    })
    expect(res.statusCode).toBe(200)
    const t = await tenant()
    expect(t?.['plan']).toBe('starter')
    expect(alerts).toHaveLength(0)
  })
})
