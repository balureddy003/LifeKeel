/**
 * Subscription lifecycle sync — exercises the real POST /billing/webhook
 * handler with validly-signed events (same pattern as
 * billing-webhook-idempotency.test.ts) for the cases that keep tenant
 * state aligned with Stripe between checkout and churn:
 *
 * - customer.subscription.updated  — dunning state (unpaid/past_due) and
 *   recovery back to active
 * - customer.subscription.deleted  — downgrade to free, clears
 *   stripe_subscription_id so the free-tier refill cron sees the tenant
 *   again, marks the trial over
 * - invoice.payment_succeeded      — tops up to the plan amount on
 *   subscription_cycle (pack/promo credits survive) and ignores
 *   non-subscription invoices
 * - invoice.payment_failed         — same billing_reason scoping
 * - checkout.session.completed     — plan grant tops up, never reduces,
 *   and the ledger records the real delta
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, type Db } from 'mongodb'
import { registerBillingRoutes } from '../billing.js'

const WEBHOOK_SECRET = 'whsec_test_secret_for_lifecycle'
const TENANT_ID = 'tenant-webhook-lifecycle-test'

function signStripePayload(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const signedPayload = `${timestamp}.${payload}`
  const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')
  return `t=${timestamp},v1=${signature}`
}

async function postEvent(app: ReturnType<typeof Fastify>, event: Record<string, unknown>) {
  const payload = JSON.stringify(event)
  const signature = signStripePayload(payload, WEBHOOK_SECRET)
  return app.inject({
    method: 'POST',
    url: '/billing/webhook',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    payload,
  })
}

describe('Stripe subscription lifecycle sync', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db
  let app: ReturnType<typeof Fastify>
  let savedSecretKey: string | undefined
  let savedWebhookSecret: string | undefined
  let savedBillingV2: string | undefined

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
    db = client.db('webhook_lifecycle_test')

    savedSecretKey = process.env['STRIPE_SECRET_KEY']
    savedWebhookSecret = process.env['STRIPE_WEBHOOK_SECRET']
    savedBillingV2 = process.env['BILLING_V2_ENABLED']
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_dummy_key_for_unit_tests'
    process.env['STRIPE_WEBHOOK_SECRET'] = WEBHOOK_SECRET
    // recordLedgerEntry no-ops unless billing v2 is on — these tests assert
    // on ledger deltas, so the flag must be set.
    process.env['BILLING_V2_ENABLED'] = 'true'

    app = Fastify()
    registerBillingRoutes(app, db)
    await app.ready()
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
    if (savedBillingV2 === undefined) delete process.env['BILLING_V2_ENABLED']
    else process.env['BILLING_V2_ENABLED'] = savedBillingV2
  })

  async function seedSubscriber(overrides: Record<string, unknown> = {}) {
    await db.collection('tenants').insertOne({
      tenant_id: TENANT_ID,
      plan: 'starter',
      status: 'active',
      stripe_customer_id: 'cus_lifecycle',
      stripe_subscription_id: 'sub_lifecycle',
      billing: { credits_balance: 10, credits_included: 50, credits_used_this_period: 0, currency: 'GBP' },
      ...overrides,
    })
  }

  it('customer.subscription.deleted downgrades to free, clears the subscription id, and ends the trial', async () => {
    await seedSubscriber()

    const res = await postEvent(app, {
      id: 'evt_sub_deleted',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_lifecycle', status: 'canceled', metadata: {} } },
    })
    expect(res.statusCode).toBe(200)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['plan']).toBe('free')
    expect(tenant?.['status']).toBe('active')
    expect(tenant?.['billing']?.['trial_expired']).toBe(true)
    // The stored subscription id must be gone — refillFreeTierCredits and
    // resetBillingCycles both filter on stripe_subscription_id being absent.
    expect(tenant?.['stripe_subscription_id']).toBeUndefined()
    // The customer id stays so a re-checkout reuses it.
    expect(tenant?.['stripe_customer_id']).toBe('cus_lifecycle')
  })

  it('customer.subscription.deleted resolves the tenant via subscription metadata when the stored id is missing', async () => {
    await seedSubscriber()
    await db.collection('tenants').updateOne(
      { tenant_id: TENANT_ID },
      { $unset: { stripe_subscription_id: '' } },
    )

    const res = await postEvent(app, {
      id: 'evt_sub_deleted_meta',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_lifecycle', status: 'canceled', metadata: { tenant_id: TENANT_ID } } },
    })
    expect(res.statusCode).toBe(200)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['plan']).toBe('free')
  })

  it('customer.subscription.updated marks an unpaid subscription past_due and starts the grace clock', async () => {
    await seedSubscriber()

    const res = await postEvent(app, {
      id: 'evt_sub_unpaid',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_lifecycle', status: 'unpaid', metadata: {} } },
    })
    expect(res.statusCode).toBe(200)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['status']).toBe('past_due')
    expect(tenant?.['billing']?.['payment_failed_at']).toBeInstanceOf(Date)
  })

  it('customer.subscription.updated recovers a past_due tenant back to active', async () => {
    await seedSubscriber({ status: 'past_due' })
    await db.collection('tenants').updateOne(
      { tenant_id: TENANT_ID },
      { $set: { 'billing.payment_failed_at': new Date() } },
    )

    const res = await postEvent(app, {
      id: 'evt_sub_recovered',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_lifecycle', status: 'active', metadata: {} } },
    })
    expect(res.statusCode).toBe(200)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['status']).toBe('active')
    expect(tenant?.['billing']?.['payment_failed_at']).toBeNull()
  })

  it('invoice.payment_succeeded tops up to the plan amount — pack credits survive the renewal', async () => {
    // Tenant holds 80 credits (50 plan grant + a 30-credit pack); a renewal
    // must not wipe the paid-for pack balance.
    await seedSubscriber()
    await db.collection('tenants').updateOne(
      { tenant_id: TENANT_ID },
      { $set: { 'billing.credits_balance': 80 } },
    )

    const res = await postEvent(app, {
      id: 'evt_invoice_cycle',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_cycle',
          customer: 'cus_lifecycle',
          billing_reason: 'subscription_cycle',
        },
      },
    })
    expect(res.statusCode).toBe(200)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(80)
    // The balance didn't move, so no ledger entry is written — a zero or
    // nominal-grant entry would false-flag the daily ledger reconciliation.
    const ledger = await db.collection('credit_ledger')
      .find({ tenant_id: TENANT_ID, type: 'plan_grant' })
      .toArray()
    expect(ledger).toHaveLength(0)
  })

  it('invoice.payment_succeeded tops a depleted balance back up to the plan amount', async () => {
    await seedSubscriber()
    await db.collection('tenants').updateOne(
      { tenant_id: TENANT_ID },
      { $set: { 'billing.credits_balance': 3 } },
    )

    const res = await postEvent(app, {
      id: 'evt_invoice_cycle_topup',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_cycle_topup',
          customer: 'cus_lifecycle',
          billing_reason: 'subscription_cycle',
        },
      },
    })
    expect(res.statusCode).toBe(200)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(50)
    const ledger = await db.collection('credit_ledger')
      .findOne({ tenant_id: TENANT_ID, type: 'plan_grant' })
    expect(ledger?.['amount']).toBe(47)
  })

  it('invoice.payment_succeeded ignores a non-subscription invoice (manual one-off)', async () => {
    await seedSubscriber()

    const res = await postEvent(app, {
      id: 'evt_invoice_manual',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_manual',
          customer: 'cus_lifecycle',
          billing_reason: 'manual',
        },
      },
    })
    expect(res.statusCode).toBe(200)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(10)
    expect(tenant?.['billing']?.['billing_period_start']).toBeUndefined()
  })

  it('invoice.payment_failed ignores a non-subscription invoice — tenant stays active', async () => {
    await seedSubscriber()

    const res = await postEvent(app, {
      id: 'evt_invoice_failed_manual',
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_failed_manual',
          customer: 'cus_lifecycle',
          billing_reason: 'manual',
        },
      },
    })
    expect(res.statusCode).toBe(200)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['status']).toBe('active')
    expect(tenant?.['billing']?.['payment_failed_at']).toBeUndefined()
  })

  it('checkout.session.completed tops up the balance and records the real ledger delta', async () => {
    // Free tenant holding 20 credits (trial remainder + promo) upgrades.
    await db.collection('tenants').insertOne({
      tenant_id: TENANT_ID,
      plan: 'free',
      status: 'active',
      billing: { credits_balance: 20, credits_included: 10, credits_used_this_period: 0, currency: 'GBP' },
    })

    const res = await postEvent(app, {
      id: 'evt_checkout_upgrade',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_upgrade',
          customer: 'cus_new',
          subscription: 'sub_new',
          metadata: { tenant_id: TENANT_ID, plan: 'starter' },
        },
      },
    })
    expect(res.statusCode).toBe(200)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['plan']).toBe('starter')
    expect(tenant?.['stripe_subscription_id']).toBe('sub_new')
    expect(tenant?.['billing']?.['credits_balance']).toBe(50)

    const ledger = await db.collection('credit_ledger')
      .findOne({ tenant_id: TENANT_ID, type: 'plan_grant' })
    // Delta semantics: 20 → 50 moved the balance by 30, not the nominal 50.
    expect(ledger?.['amount']).toBe(30)
  })
})
