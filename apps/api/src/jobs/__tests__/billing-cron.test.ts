/**
 * Tests for billing cron jobs:
 * - H3: settleOutcomeCharges — aggregates pending charges, creates Stripe items
 * - H5: expireTrials — downgrades tenants past trial_ends_at
 * - H6: recoverPastDueTenants — grace period → downgrade → suspend
 * - H4: resetBillingCycles — resets credits when billing_period_end has passed
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, type Db } from 'mongodb'
import {
  settleOutcomeCharges,
  expireTrials,
  recoverPastDueTenants,
  resetBillingCycles,
} from '../billing-cron.js'

const TENANT_ID = 'cron-test-tenant'
const TENANT_ID_2 = 'cron-test-tenant-2'

async function seedTenant(db: Db, tenantId: string, opts: {
  plan?: string
  status?: string
  balance?: number
  currency?: string
  trialEndsAt?: Date
  trialExpired?: boolean
  paymentFailedAt?: Date
  billingPeriodEnd?: Date
  stripeCustomerId?: string
  stripeSubscriptionId?: string
} = {}) {
  await db.collection('tenants').updateOne(
    { tenant_id: tenantId },
    {
      $set: {
        tenant_id: tenantId,
        name: tenantId,
        plan: opts.plan ?? 'free',
        status: opts.status ?? 'active',
        quotas: { events_per_month: 10_000, workflows_per_month: 3, detectors_max: 10, connectors_max: 1, users_max: 1, llm_tokens_per_month: 100_000 },
        billing: {
          credits_balance: opts.balance ?? 10,
          credits_included: 10,
          credits_used_this_period: 0,
          outcome_price: 0,
          currency: opts.currency ?? 'GBP',
          ...(opts.trialEndsAt && { trial_ends_at: opts.trialEndsAt }),
          ...(opts.trialExpired !== undefined && { trial_expired: opts.trialExpired }),
          ...(opts.paymentFailedAt && { payment_failed_at: opts.paymentFailedAt }),
          ...(opts.billingPeriodEnd && { billing_period_end: opts.billingPeriodEnd }),
        },
        ...(opts.stripeCustomerId && { stripe_customer_id: opts.stripeCustomerId }),
        ...(opts.stripeSubscriptionId && { stripe_subscription_id: opts.stripeSubscriptionId }),
        created_at: new Date(),
        updated_at: new Date(),
      },
    },
    { upsert: true },
  )
}

describe('Billing cron jobs', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    const uri = mongod.getUri()
    process.env['MONGODB_URL'] = uri
    process.env['MONGODB_DB'] = 'billing_cron_test'
    client = new MongoClient(uri)
    await client.connect()
    db = client.db('billing_cron_test')
  })

  afterEach(async () => {
    delete process.env['STRIPE_SECRET_KEY']
    await client.close()
    await mongod.stop()
  })

  // ── H3: settleOutcomeCharges ───────────────────────────────────────────────

  it('H3: marks pending charges as invoiced when no Stripe is configured', async () => {
    await seedTenant(db, TENANT_ID, { balance: 10 })

    await db.collection('outcome_charges').insertMany([
      { tenant_id: TENANT_ID, event_id: 'evt-1', amount_minor: 50, currency: 'GBP', status: 'pending', created_at: new Date() },
      { tenant_id: TENANT_ID, event_id: 'evt-2', amount_minor: 75, currency: 'GBP', status: 'pending', created_at: new Date() },
      { tenant_id: TENANT_ID, event_id: 'evt-3', amount_minor: 100, currency: 'GBP', status: 'invoiced', created_at: new Date() },
    ])

    const result = await settleOutcomeCharges(db)

    expect(result.tenants_processed).toBe(1)
    expect(result.charges_settled).toBe(2)

    const pending = await db.collection('outcome_charges').find({ tenant_id: TENANT_ID, status: 'pending' }).toArray()
    expect(pending.length).toBe(0)

    const invoiced = await db.collection('outcome_charges').find({ tenant_id: TENANT_ID, status: 'invoiced' }).toArray()
    expect(invoiced.length).toBe(3) // 2 newly invoiced + 1 already invoiced
  })

  it('H3: processes multiple tenants in one run', async () => {
    await seedTenant(db, TENANT_ID, { balance: 10 })
    await seedTenant(db, TENANT_ID_2, { balance: 10 })

    await db.collection('outcome_charges').insertMany([
      { tenant_id: TENANT_ID, event_id: 'evt-a', amount_minor: 50, currency: 'GBP', status: 'pending', created_at: new Date() },
      { tenant_id: TENANT_ID_2, event_id: 'evt-b', amount_minor: 100, currency: 'INR', status: 'pending', created_at: new Date() },
    ])

    const result = await settleOutcomeCharges(db)

    expect(result.tenants_processed).toBe(2)
    expect(result.charges_settled).toBe(2)
  })

  it('H3: does nothing when there are no pending charges', async () => {
    const result = await settleOutcomeCharges(db)
    expect(result.tenants_processed).toBe(0)
    expect(result.charges_settled).toBe(0)
  })

  // ── H5: expireTrials ───────────────────────────────────────────────────────

  it('H5: expires tenants whose trial_ends_at has passed', async () => {
    const pastDate = new Date(Date.now() - 5 * 86_400_000) // 5 days ago
    await seedTenant(db, TENANT_ID, { trialEndsAt: pastDate, balance: 5 })

    const result = await expireTrials(db)

    expect(result.expired).toBe(1)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['trial_expired']).toBe(true)
    expect(tenant?.['billing']?.['credits_balance']).toBe(0)
    expect(tenant?.['billing']?.['credits_included']).toBe(0)
  })

  it('H5: does not expire tenants whose trial is still active', async () => {
    const futureDate = new Date(Date.now() + 10 * 86_400_000) // 10 days from now
    await seedTenant(db, TENANT_ID, { trialEndsAt: futureDate, balance: 5 })

    const result = await expireTrials(db)

    expect(result.expired).toBe(0)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['trial_expired']).toBeFalsy()
    expect(tenant?.['billing']?.['credits_balance']).toBe(5)
  })

  it('H5: does not re-expire already expired tenants', async () => {
    const pastDate = new Date(Date.now() - 5 * 86_400_000)
    await seedTenant(db, TENANT_ID, { trialEndsAt: pastDate, trialExpired: true, balance: 0 })

    const result = await expireTrials(db)
    expect(result.expired).toBe(0)
  })

  // ── H6: recoverPastDueTenants ──────────────────────────────────────────────

  it('H6: downgrades tenant after grace period (7 days)', async () => {
    const failedAt = new Date(Date.now() - 8 * 86_400_000) // 8 days ago
    await seedTenant(db, TENANT_ID, {
      status: 'past_due',
      plan: 'growth',
      balance: 200,
      paymentFailedAt: failedAt,
    })

    const result = await recoverPastDueTenants(db)

    expect(result.downgraded).toBe(1)
    expect(result.suspended).toBe(0)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['plan']).toBe('free')
    expect(tenant?.['billing']?.['credits_balance']).toBe(10) // free plan credits
  })

  it('H6: suspends tenant after suspension period (14 days)', async () => {
    const failedAt = new Date(Date.now() - 15 * 86_400_000) // 15 days ago
    await seedTenant(db, TENANT_ID, {
      status: 'past_due',
      plan: 'growth',
      balance: 200,
      paymentFailedAt: failedAt,
    })

    const result = await recoverPastDueTenants(db)

    expect(result.downgraded).toBe(0)
    expect(result.suspended).toBe(1)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['status']).toBe('suspended')
    expect(tenant?.['plan']).toBe('free')
    expect(tenant?.['billing']?.['credits_balance']).toBe(0)
  })

  it('H6: does not act on past_due tenant within grace period', async () => {
    const failedAt = new Date(Date.now() - 3 * 86_400_000) // 3 days ago
    await seedTenant(db, TENANT_ID, {
      status: 'past_due',
      plan: 'growth',
      balance: 200,
      paymentFailedAt: failedAt,
    })

    const result = await recoverPastDueTenants(db)

    expect(result.downgraded).toBe(0)
    expect(result.suspended).toBe(0)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['plan']).toBe('growth') // unchanged
  })

  it('H6: does nothing when there are no past_due tenants', async () => {
    const result = await recoverPastDueTenants(db)
    expect(result.downgraded).toBe(0)
    expect(result.suspended).toBe(0)
  })

  // ── H4: resetBillingCycles ─────────────────────────────────────────────────

  it('H4: resets credits for tenants whose billing period has ended (no Stripe)', async () => {
    const pastPeriodEnd = new Date(Date.now() - 1 * 86_400_000) // 1 day ago
    await seedTenant(db, TENANT_ID, {
      plan: 'starter',
      balance: 3,
      billingPeriodEnd: pastPeriodEnd,
    })

    const result = await resetBillingCycles(db)

    expect(result.reset).toBe(1)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(50) // starter plan credits
    expect(tenant?.['billing']?.['credits_used_this_period']).toBe(0)
    expect(tenant?.['billing']?.['billing_period_start']).toBeDefined()
    expect(tenant?.['billing']?.['billing_period_end']).toBeDefined()
  })

  it('H4: does not reset tenants with active Stripe subscriptions', async () => {
    const pastPeriodEnd = new Date(Date.now() - 1 * 86_400_000)
    await seedTenant(db, TENANT_ID, {
      plan: 'starter',
      balance: 3,
      billingPeriodEnd: pastPeriodEnd,
      stripeSubscriptionId: 'sub_123',
    })

    const result = await resetBillingCycles(db)

    expect(result.reset).toBe(0)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(3) // unchanged
  })

  it('H4: does not reset tenants whose billing period has not ended', async () => {
    const futurePeriodEnd = new Date(Date.now() + 10 * 86_400_000)
    await seedTenant(db, TENANT_ID, {
      plan: 'starter',
      balance: 3,
      billingPeriodEnd: futurePeriodEnd,
    })

    const result = await resetBillingCycles(db)
    expect(result.reset).toBe(0)
  })

  it('H4: does nothing when there are no tenants to reset', async () => {
    const result = await resetBillingCycles(db)
    expect(result.reset).toBe(0)
  })
})
