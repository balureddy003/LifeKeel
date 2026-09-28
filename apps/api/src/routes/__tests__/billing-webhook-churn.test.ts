/**
 * Churn-reason capture — Stripe's portal cancellation survey lands as
 * subscription.cancellation_details on customer.subscription.updated and
 * .deleted. The webhook stores it on the tenant (billing.churn_reason /
 * churn_feedback / churned_at), and /operator/billing aggregates it into
 * churn_by_reason + recent_churned.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, type Db } from 'mongodb'
import { registerBillingRoutes } from '../billing.js'
import { registerOperatorRoutes } from '../operator.js'

const WEBHOOK_SECRET = 'whsec_test_secret_for_churn'
const TENANT_ID = 'tenant-churn-test'

function signStripePayload(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
  return `t=${timestamp},v1=${signature}`
}

async function postEvent(app: ReturnType<typeof Fastify>, event: Record<string, unknown>) {
  const payload = JSON.stringify(event)
  return app.inject({
    method: 'POST',
    url: '/billing/webhook',
    headers: { 'content-type': 'application/json', 'stripe-signature': signStripePayload(payload, WEBHOOK_SECRET) },
    payload,
  })
}

describe('churn-reason capture', () => {
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
    db = client.db('webhook_churn_test')

    savedSecretKey = process.env['STRIPE_SECRET_KEY']
    savedWebhookSecret = process.env['STRIPE_WEBHOOK_SECRET']
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_dummy_key_for_unit_tests'
    process.env['STRIPE_WEBHOOK_SECRET'] = WEBHOOK_SECRET

    app = Fastify()
    registerBillingRoutes(app, db)
    await app.ready()
    await db.collection('stripe_webhook_events').createIndex({ event_id: 1 }, { unique: true })
    await db.collection('tenants').insertOne({
      tenant_id: TENANT_ID,
      name: 'Churn Test',
      plan: 'starter',
      status: 'active',
      stripe_customer_id: 'cus_churn',
      stripe_subscription_id: 'sub_churn',
      billing: { credits_balance: 10, credits_included: 50, currency: 'GBP' },
    })
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

  it('stores cancellation_details from subscription.updated (cancel-at-period-end)', async () => {
    const res = await postEvent(app, {
      id: 'evt_cancel_reason',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_churn', status: 'active', cancel_at_period_end: true, metadata: {},
          cancellation_details: { reason: 'too_expensive', feedback: 'Not using it enough' },
        },
      },
    })
    expect(res.statusCode).toBe(200)
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['churn_reason']).toBe('too_expensive')
    expect(tenant?.['billing']?.['churn_feedback']).toBe('Not using it enough')
    expect(tenant?.['billing']?.['cancel_at_period_end']).toBe(true)
  })

  it('captures the reason on subscription.deleted even if .updated never arrived', async () => {
    const res = await postEvent(app, {
      id: 'evt_deleted_reason',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_churn', status: 'canceled', metadata: {},
          cancellation_details: { reason: 'missing_features' },
        },
      },
    })
    expect(res.statusCode).toBe(200)
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['plan']).toBe('free')
    expect(tenant?.['billing']?.['churn_reason']).toBe('missing_features')
    expect(tenant?.['billing']?.['churned_at']).toBeInstanceOf(Date)
  })

  it('aggregates churn reasons on /operator/billing', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['super_admin'] })
    await db.collection('users').insertOne({
      id: 'operator-1', tenant_id: 'op-t', email: 'op@x.com', roles: ['admin'], status: 'active', created_at: new Date(),
    })

    await postEvent(app, {
      id: 'evt_deleted_reason2',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_churn', status: 'canceled', metadata: {}, cancellation_details: { reason: 'too_expensive' } } },
    })

    const opApp = Fastify()
    opApp.addHook('onRequest', async (request) => {
      request.authContext = { user_id: 'operator-1', tenant_id: 'op-t', roles: ['admin'] }
    })
    await registerOperatorRoutes(opApp, db)
    await opApp.ready()

    const res = await opApp.inject({ method: 'GET', url: '/operator/billing' })
    expect(res.statusCode).toBe(200)
    expect(res.json().churn_by_reason).toEqual({ too_expensive: 1 })
    expect(res.json().recent_churned[0].tenant_id).toBe(TENANT_ID)
    expect(res.json().recent_churned[0].reason).toBe('too_expensive')
    await opApp.close()
  })
})
