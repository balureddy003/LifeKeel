/**
 * OAK-007 + OAK-018: unlike billing-webhook.test.ts's idempotency block
 * (which only re-implements the check against raw Mongo, never calling
 * registerBillingRoutes at all — see that file's own header comment) and
 * billing-webhook-signature.test.ts (real route, but only rejection
 * paths — never a validly-signed event that reaches the side-effect
 * switch), this file drives the actual POST /billing/webhook handler with
 * a genuinely valid Stripe signature and proves the OAK-007 claim-first
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

describe('OAK-007: POST /billing/webhook claims before processing (real route, valid signature)', () => {
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
    // Exactly one 500-credit grant, not two — this is the property OAK-007
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

    const duplicates = [a, b].filter((r) => r.json().duplicate === true)
    expect(duplicates).toHaveLength(1)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(500)
  })
})
