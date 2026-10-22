/**
 * KEEL-007 + KEEL-018: unlike billing-webhook.test.ts's idempotency block
 * (which only re-implements the check against raw Mongo, never calling
 * registerBillingRoutes at all — see that file's own header comment) and
 * billing-webhook-signature.test.ts (real route, but only rejection
 * paths — never a validly-signed event that reaches the side-effect
 * switch), this file drives the actual POST /billing/webhook handler with
 * a genuinely valid Stripe signature and proves the KEEL-007 claim-first
 * fix end to end: the first delivery applies its side effect exactly
 * once, and a replay of the identical event id is a true no-op — not
 * just that a row exists in stripe_webhook_events.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, type Db } from 'mongodb'
import { registerBillingRoutes } from '../billing.js'

const WEBHOOK_SECRET = 'whsec_test_secret_for_idempotency'
const TENANT_ID = 'tenant-webhook-idempotency-test'

function signStripePayload(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const signedPayload = `${timestamp}.${payload}`
  const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')
  return `t=${timestamp},v1=${signature}`
}

describe('KEEL-007: POST /billing/webhook claims before processing (real route, valid signature)', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db
  let app: ReturnType<typeof Fastify>
  let savedSecretKey: string | undefined
  let savedWebhookSecret: string | undefined

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
    db = client.db('webhook_idempotency_test')

    savedSecretKey = process.env['STRIPE_SECRET_KEY']
    savedWebhookSecret = process.env['STRIPE_WEBHOOK_SECRET']
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_dummy_key_for_unit_tests'
    process.env['STRIPE_WEBHOOK_SECRET'] = WEBHOOK_SECRET

    await db.collection('tenants').insertOne({
      tenant_id: TENANT_ID,
      billing: { credits_balance: 0, currency: 'GBP' },
    })

    app = Fastify()
    registerBillingRoutes(app, db)
    await app.ready()
    // registerBillingRoutes creates this index fire-and-forget (matching
    // this codebase's convention elsewhere) — wait for it explicitly here
    // so the test's very next request can't race ahead of the index the
    // whole idempotency guarantee depends on.
    await db.collection('stripe_webhook_events').createIndex({ event_id: 1 }, { unique: true })
  })

  afterEach(async () => {
    await app.close()
    await client.close()
    await mongod.stop()
    if (savedSecretKey === undefined) delete process.env['STRIPE_SECRET_KEY']
    else process.env['STRIPE_SECRET_KEY'] = savedSecretKey
    if (savedWebhookSecret === undefined) delete process.env['STRIPE_WEBHOOK_SECRET']
    else process.env['STRIPE_WEBHOOK_SECRET'] = savedWebhookSecret
  })

  function creditPackEventPayload(eventId: string): string {
    return JSON.stringify({
      id: eventId,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_credit_pack',
          metadata: {
            tenant_id: TENANT_ID,
            purchase_type: 'credit_pack',
            credit_amount: '500',
            credit_pack_id: 'pack_1',
          },
        },
      },
    })
  }

  it('a validly-signed event applies its side effect exactly once', async () => {
    const payload = creditPackEventPayload('evt_idempotency_test_1')
    const signature = signStripePayload(payload, WEBHOOK_SECRET)

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().duplicate).toBeUndefined()

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(500)
  })

  it('replaying the identical event id is a true no-op — credits are not double-applied', async () => {
    const payload = creditPackEventPayload('evt_idempotency_test_2')
    const signature = signStripePayload(payload, WEBHOOK_SECRET)

    const first = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload,
    })
    expect(first.statusCode).toBe(200)

    const replay = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      payload,
    })
    expect(replay.statusCode).toBe(200)
    expect(replay.json().duplicate).toBe(true)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    // Exactly one 500-credit grant, not two — this is the property KEEL-007
    // actually protects; the old code path also eventually recorded the
    // event id, but only after the side effect, leaving a crash-shaped
    // window where a replay in that window would have double-applied it.
    expect(tenant?.['billing']?.['credits_balance']).toBe(500)
  })

  it('two concurrent deliveries of the same event id race safely — only one applies', async () => {
    const payload = creditPackEventPayload('evt_idempotency_test_3')
    const signature = signStripePayload(payload, WEBHOOK_SECRET)

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/billing/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, payload }),
      app.inject({ method: 'POST', url: '/billing/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, payload }),
    ])

    // One applies; the other is either a completed duplicate or told to
    // retry because the first still holds the processing lease (R10).
    const applied = [a, b].filter((r) => r.statusCode === 200 && r.json().duplicate === undefined)
    expect(applied).toHaveLength(1)
    const other = [a, b].find((r) => r !== applied[0])!
    expect(other.statusCode === 409 || other.json().duplicate === true).toBe(true)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(500)
  })

  const deliver = (payload: string) =>
    app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': signStripePayload(payload, WEBHOOK_SECRET) },
      payload,
    })

  it('R10: an event whose processing failed is reprocessed by the next delivery', async () => {
    await db.collection('stripe_webhook_events').insertOne({ event_id: 'evt_failed', status: 'failed', attempts: 1 })
    const res = await deliver(creditPackEventPayload('evt_failed'))
    expect(res.statusCode).toBe(200)
    expect(res.json().duplicate).toBeUndefined()
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(500)
    const claim = await db.collection('stripe_webhook_events').findOne({ event_id: 'evt_failed' })
    expect(claim).toMatchObject({ status: 'completed', attempts: 2 })
  })

  it('R10: a claim abandoned mid-processing is taken over once its lease expires, but not before', async () => {
    await db.collection('stripe_webhook_events').insertOne({
      event_id: 'evt_live',
      status: 'processing',
      lease_until: new Date(Date.now() + 60_000),
    })
    expect((await deliver(creditPackEventPayload('evt_live'))).statusCode).toBe(409)

    await db.collection('stripe_webhook_events').insertOne({
      event_id: 'evt_crashed',
      status: 'processing',
      lease_until: new Date(Date.now() - 1000),
    })
    const res = await deliver(creditPackEventPayload('evt_crashed'))
    expect(res.statusCode).toBe(200)
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(500)
  })

  it('R10: reprocessing after a failure that came after the credit grant does not grant twice', async () => {
    expect((await deliver(creditPackEventPayload('evt_partial'))).statusCode).toBe(200)
    // As if the run crashed after the grant but before marking completed.
    await db.collection('stripe_webhook_events').updateOne({ event_id: 'evt_partial' }, { $set: { status: 'failed' } })
    expect((await deliver(creditPackEventPayload('evt_partial'))).statusCode).toBe(200)
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(500)
  })

  it('R09: a paid invoice never reactivates a deleted household', async () => {
    await db.collection('tenants').updateOne(
      { tenant_id: TENANT_ID },
      { $set: { status: 'deleted', stripe_customer_id: 'cus_deleted', plan: 'family' } },
    )
    const payload = JSON.stringify({
      id: 'evt_invoice_after_delete',
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_1', customer: 'cus_deleted', billing_reason: 'subscription_cycle' } },
    })
    expect((await deliver(payload)).statusCode).toBe(200)
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['status']).toBe('deleted')
  })
})
