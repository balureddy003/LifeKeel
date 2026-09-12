/**
 * Tests for revenue generation features:
 * - Credit pack purchase (checkout + webhook)
 * - Default outcome_price per plan
 * - Low-credit alert deduplication
 * - Free tier monthly credit refill
 * - Plan-based charge cooldown (7 days for paid vs 30 for free)
 * - Lower progress threshold (10% vs 25%)
 * - Value-based credit pricing
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, type Db } from 'mongodb'
import { OutcomeCredits, type KpiLike } from '../outcome-credits.js'
import {
  CREDIT_PACKS,
  getCreditPack,
  PLAN_OUTCOME_PRICES,
  PLAN_CHARGE_COOLDOWN_DAYS,
  MIN_PROGRESS_THRESHOLD,
  FREE_TIER_MONTHLY_REFILL,
  createPlanBilling,
} from '../billing-constants.js'
import { refillFreeTierCredits } from '../../jobs/billing-cron.js'
import { checkAndSendLowCreditAlert, LOW_CREDIT_THRESHOLD } from '../low-credit-alerts.js'

const TENANT_ID = 'revenue-test-tenant'

async function seedTenant(db: Db, opts: {
  balance?: number
  plan?: string
  outcomePrice?: number
  trialExpired?: boolean
  activeVertical?: string
  contactEmail?: string
  stripeSubscriptionId?: string
  freeRefillAt?: Date
  billingPeriodStart?: Date
  lowCreditAlertSentAt?: Date
  zeroCreditAlertSentAt?: Date
} = {}) {
  await db.collection('tenants').updateOne(
    { tenant_id: TENANT_ID },
    {
      $set: {
        tenant_id: TENANT_ID,
        plan: opts.plan ?? 'free',
        status: 'active',
        active_vertical: opts.activeVertical ?? 'business',
        contact_email: opts.contactEmail ?? 'test@example.com',
        billing: {
          credits_balance: opts.balance ?? 10,
          credits_included: 10,
          credits_used_this_period: 0,
          outcome_price: opts.outcomePrice ?? 0,
          currency: 'GBP',
          trial_expired: opts.trialExpired ?? false,
          billing_period_start: opts.billingPeriodStart ?? new Date(),
          ...(opts.freeRefillAt && { free_refill_at: opts.freeRefillAt }),
          ...(opts.lowCreditAlertSentAt && { low_credit_alert_sent_at: opts.lowCreditAlertSentAt }),
          ...(opts.zeroCreditAlertSentAt && { zero_credit_alert_sent_at: opts.zeroCreditAlertSentAt }),
        },
        ...(opts.stripeSubscriptionId && { stripe_subscription_id: opts.stripeSubscriptionId }),
        created_at: new Date(),
        updated_at: new Date(),
      },
    },
    { upsert: true },
  )
}

async function seedVerifiedMoment(db: Db, momentId: string, goalId: string, kpiMetric: string) {
  await db.collection('verified_moments').insertOne({
    id: momentId,
    tenant_id: TENANT_ID,
    goal_id: goalId,
    kpi_metric: kpiMetric,
    insight_id: `insight-${momentId}`,
    status: 'approved',
    hypothesis: 'test',
    confidence: 0.85,
    signal_ids: [],
    reasoning: 'Test reasoning',
    created_at: new Date(),
  })
}

const CURRENCY_KPI: KpiLike = {
  metric: 'portfolio_value_gbp',
  label: 'Portfolio Value',
  unit: 'GBP',
  target: 100000,
  start_value: 50000,
  direction: 'increase',
}

const PERCENT_KPI: KpiLike = {
  metric: 'portfolio_concentration_max_pct',
  label: 'Concentration',
  unit: '%',
  target: 10,
  start_value: 12,
  direction: 'decrease',
}

describe('Revenue generation features', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    const uri = mongod.getUri()
    process.env['MONGODB_URL'] = uri
    process.env['MONGODB_DB'] = 'revenue_test'
    process.env['BILLING_V2_ENABLED'] = 'true'
    // Don't set SENDGRID_API_KEY — we don't want to send real emails in tests
    delete process.env['SENDGRID_API_KEY']
    client = new MongoClient(uri)
    await client.connect()
    db = client.db('revenue_test')
  })

  afterEach(async () => {
    await client.close()
    await mongod.stop()
  })

  // ── Credit packs ─────────────────────────────────────────────────────────────

  it('CREDIT_PACKS has at least 4 packs with increasing credits', () => {
    expect(CREDIT_PACKS.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < CREDIT_PACKS.length; i++) {
      expect(CREDIT_PACKS[i]!.credits).toBeGreaterThan(CREDIT_PACKS[i - 1]!.credits)
    }
  })

  it('getCreditPack returns the correct pack by ID', () => {
    const pack = getCreditPack('pack_25')
    expect(pack).toBeDefined()
    expect(pack!.credits).toBe(25)
    expect(pack!.price_minor).toBe(500)
  })

  it('getCreditPack returns undefined for invalid ID', () => {
    expect(getCreditPack('invalid')).toBeUndefined()
  })

  // ── Default outcome_price per plan ───────────────────────────────────────────

  it('PLAN_OUTCOME_PRICES has non-zero prices for paid plans', () => {
    expect(PLAN_OUTCOME_PRICES['starter']).toBeGreaterThan(0)
    expect(PLAN_OUTCOME_PRICES['growth']).toBeGreaterThan(0)
    expect(PLAN_OUTCOME_PRICES['free']).toBe(0)
  })

  it('createPlanBilling sets the default outcome_price for the plan', () => {
    const starterBilling = createPlanBilling('starter', 'GBP')
    expect(starterBilling.outcome_price).toBe(PLAN_OUTCOME_PRICES['starter'])

    const growthBilling = createPlanBilling('growth', 'GBP')
    expect(growthBilling.outcome_price).toBe(PLAN_OUTCOME_PRICES['growth'])

    const freeBilling = createPlanBilling('free', 'GBP')
    expect(freeBilling.outcome_price).toBe(0)
  })

  // ── Plan-based charge cooldown ───────────────────────────────────────────────

  it('PLAN_CHARGE_COOLDOWN_DAYS is 30 for free and 7 for paid plans', () => {
    expect(PLAN_CHARGE_COOLDOWN_DAYS['free']).toBe(30)
    expect(PLAN_CHARGE_COOLDOWN_DAYS['starter']).toBe(7)
    expect(PLAN_CHARGE_COOLDOWN_DAYS['growth']).toBe(7)
    expect(PLAN_CHARGE_COOLDOWN_DAYS['enterprise']).toBe(7)
  })

  it('free tenant is blocked by 30-day cooldown after first charge', async () => {
    await seedTenant(db, { balance: 10, plan: 'free' })
    await seedVerifiedMoment(db, 'vm-cooldown-free-1', 'goal-1', PERCENT_KPI.metric)

    const service = new OutcomeCredits(db)
    const event1 = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: PERCENT_KPI,
      currentValue: 11,
    })
    expect(event1).not.toBeNull()

    // Second moment for same goal+KPI — should be blocked by cooldown
    await seedVerifiedMoment(db, 'vm-cooldown-free-2', 'goal-1', PERCENT_KPI.metric)
    const event2 = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: PERCENT_KPI,
      currentValue: 10.5,
    })
    expect(event2).toBeNull() // Blocked by 30-day cooldown
  })

  it('paid tenant can charge again after 7-day cooldown (simulated)', async () => {
    await seedTenant(db, { balance: 10, plan: 'starter' })
    await seedVerifiedMoment(db, 'vm-cooldown-paid-1', 'goal-1', PERCENT_KPI.metric)

    const service = new OutcomeCredits(db)
    const event1 = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: PERCENT_KPI,
      currentValue: 11,
    })
    expect(event1).not.toBeNull()

    // Insert a charge 8 days ago to simulate the cooldown having passed
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000)
    await db.collection('outcome_events').insertOne({
      id: 'oe_old_paid',
      tenant_id: TENANT_ID,
      goal_id: 'goal-2',
      kpi_metric: PERCENT_KPI.metric,
      verified_moment_id: 'vm_old_paid',
      credits_consumed: 1,
      currency: 'GBP',
      measured_at: eightDaysAgo,
      source: 'test',
    })

    // New charge for goal-2 should succeed (8 days > 7 day cooldown)
    await seedVerifiedMoment(db, 'vm-cooldown-paid-2', 'goal-2', PERCENT_KPI.metric)
    const event2 = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-2',
      kpi: PERCENT_KPI,
      currentValue: 11,
    })
    expect(event2).not.toBeNull() // Not blocked — 8 days > 7 day cooldown
  })

  // ── Lower progress threshold (10%) ───────────────────────────────────────────

  it('MIN_PROGRESS_THRESHOLD is 0.10 (10%)', () => {
    expect(MIN_PROGRESS_THRESHOLD).toBe(0.10)
  })

  it('charges at 15% progress (above 10% threshold)', async () => {
    await seedTenant(db, { balance: 10, plan: 'free' })
    await seedVerifiedMoment(db, 'vm-progress-15', 'goal-1', PERCENT_KPI.metric)

    // PERCENT_KPI: start=12, target=10, direction=decrease
    // 15% progress: value = 12 - 0.15 * (12-10) = 12 - 0.3 = 11.7
    const service = new OutcomeCredits(db)
    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: PERCENT_KPI,
      currentValue: 11.7,
    })
    expect(event).not.toBeNull() // 15% > 10% threshold
  })

  it('does not charge at 5% progress (below 10% threshold)', async () => {
    await seedTenant(db, { balance: 10, plan: 'free' })
    await seedVerifiedMoment(db, 'vm-progress-5', 'goal-1', PERCENT_KPI.metric)

    // 5% progress: value = 12 - 0.05 * (12-10) = 12 - 0.1 = 11.9
    const service = new OutcomeCredits(db)
    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: PERCENT_KPI,
      currentValue: 11.9,
    })
    expect(event).toBeNull() // 5% < 10% threshold
  })

  // ── Value-based credit pricing ───────────────────────────────────────────────

  it('charges 1 credit for small currency outcome (< £5,000)', async () => {
    await seedTenant(db, { balance: 10, plan: 'growth' })
    await seedVerifiedMoment(db, 'vm-small-value', 'goal-1', CURRENCY_KPI.metric)

    // CURRENCY_KPI: start=50000, target=100000, direction=increase
    // currentValue=56000 → delta=6000 → £6,000 → progress=12% (> 10% threshold)
    // £6,000 / £5,000 = 1.2 → rounded to 1 credit
    const service = new OutcomeCredits(db)
    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: CURRENCY_KPI,
      currentValue: 56000,
    })
    expect(event).not.toBeNull()
    expect(event!.credits_consumed).toBe(1)
  })

  it('charges multiple credits for large currency outcome (>= £5,000 per credit)', async () => {
    await seedTenant(db, { balance: 20, plan: 'growth' })
    await seedVerifiedMoment(db, 'vm-large-value', 'goal-1', CURRENCY_KPI.metric)

    // CURRENCY_KPI: start=50000, target=100000, direction=increase
    // currentValue=75000 → delta=25000 → £25,000 → 5 credits
    const service = new OutcomeCredits(db)
    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: CURRENCY_KPI,
      currentValue: 75000,
    })
    expect(event).not.toBeNull()
    expect(event!.credits_consumed).toBe(5) // £25,000 / £5,000 = 5 credits
  })

  it('caps value-based credits at 10', async () => {
    await seedTenant(db, { balance: 50, plan: 'growth' })
    await seedVerifiedMoment(db, 'vm-huge-value', 'goal-1', CURRENCY_KPI.metric)

    // CURRENCY_KPI: start=50000, target=100000, direction=increase
    // currentValue=150000 → delta=100000 → £100,000 → would be 20 credits, capped at 10
    const service = new OutcomeCredits(db)
    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: CURRENCY_KPI,
      currentValue: 150000,
    })
    expect(event).not.toBeNull()
    expect(event!.credits_consumed).toBe(10) // Capped at 10
  })

  it('charges 1 credit for non-currency KPI regardless of value', async () => {
    await seedTenant(db, { balance: 10, plan: 'growth' })
    await seedVerifiedMoment(db, 'vm-percent-value', 'goal-1', PERCENT_KPI.metric)

    const service = new OutcomeCredits(db)
    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: PERCENT_KPI,
      currentValue: 10, // 100% progress
    })
    expect(event).not.toBeNull()
    expect(event!.credits_consumed).toBe(1) // Non-currency = flat 1 credit
  })

  // ── Free tier monthly credit refill ──────────────────────────────────────────

  it('FREE_TIER_MONTHLY_REFILL is 5', () => {
    expect(FREE_TIER_MONTHLY_REFILL).toBe(5)
  })

  it('refills free tier credits for expired trial tenants', async () => {
    await seedTenant(db, {
      balance: 0,
      plan: 'free',
      trialExpired: true,
      freeRefillAt: new Date(Date.now() - 86_400_000), // 1 day ago — due for refill
    })

    const result = await refillFreeTierCredits(db)

    expect(result.refilled).toBe(1)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(5) // Refilled to 5
    expect(tenant?.['billing']?.['free_refill_at']).toBeInstanceOf(Date)
  })

  it('does not refill if balance is already at or above refill amount', async () => {
    await seedTenant(db, {
      balance: 5,
      plan: 'free',
      trialExpired: true,
      freeRefillAt: new Date(Date.now() - 86_400_000),
    })

    const result = await refillFreeTierCredits(db)

    expect(result.refilled).toBe(0)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(5) // Unchanged
  })

  it('does not refill for non-free plans', async () => {
    await seedTenant(db, {
      balance: 0,
      plan: 'starter',
      trialExpired: true,
      freeRefillAt: new Date(Date.now() - 86_400_000),
    })

    const result = await refillFreeTierCredits(db)

    expect(result.refilled).toBe(0)
  })

  it('does not refill for tenants with active Stripe subscription', async () => {
    await seedTenant(db, {
      balance: 0,
      plan: 'free',
      trialExpired: true,
      stripeSubscriptionId: 'sub_123',
      freeRefillAt: new Date(Date.now() - 86_400_000),
    })

    const result = await refillFreeTierCredits(db)

    expect(result.refilled).toBe(0)
  })

  it('does not refill if free_refill_at is in the future', async () => {
    await seedTenant(db, {
      balance: 0,
      plan: 'free',
      trialExpired: true,
      freeRefillAt: new Date(Date.now() + 7 * 86_400_000), // 7 days in future
    })

    const result = await refillFreeTierCredits(db)

    expect(result.refilled).toBe(0)
  })

  it('records a ledger entry for free tier refill', async () => {
    await seedTenant(db, {
      balance: 0,
      plan: 'free',
      trialExpired: true,
      freeRefillAt: new Date(Date.now() - 86_400_000),
    })

    await refillFreeTierCredits(db)

    const ledgerEntries = await db.collection('credit_ledger').find({
      tenant_id: TENANT_ID,
      type: 'cycle_reset',
      reference: 'free_refill',
    }).toArray()

    expect(ledgerEntries.length).toBe(1)
    expect(ledgerEntries[0]!.amount).toBe(5)
  })

  // ── Low-credit alerts ────────────────────────────────────────────────────────

  it('LOW_CREDIT_THRESHOLD is 3', () => {
    expect(LOW_CREDIT_THRESHOLD).toBe(3)
  })

  it('sends low-credit alert when balance drops to threshold', async () => {
    await seedTenant(db, {
      balance: LOW_CREDIT_THRESHOLD,
      plan: 'free',
      contactEmail: 'test@example.com',
    })

    const result = await checkAndSendLowCreditAlert(db, TENANT_ID)

    expect(result.alert_sent).toBe('low')

    // Verify the alert timestamp was recorded
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['low_credit_alert_sent_at']).toBeInstanceOf(Date)
  })

  it('sends zero-credit alert when balance is 0', async () => {
    await seedTenant(db, {
      balance: 0,
      plan: 'free',
      contactEmail: 'test@example.com',
    })

    const result = await checkAndSendLowCreditAlert(db, TENANT_ID)

    expect(result.alert_sent).toBe('zero')

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['zero_credit_alert_sent_at']).toBeInstanceOf(Date)
  })

  it('does not send low-credit alert twice in the same billing cycle', async () => {
    const periodStart = new Date()
    await seedTenant(db, {
      balance: LOW_CREDIT_THRESHOLD,
      plan: 'free',
      contactEmail: 'test@example.com',
      billingPeriodStart: periodStart,
      lowCreditAlertSentAt: new Date(periodStart.getTime() + 1000), // Already sent this cycle
    })

    const result = await checkAndSendLowCreditAlert(db, TENANT_ID)

    expect(result.alert_sent).toBeNull() // Already sent
  })

  it('does not send zero-credit alert twice in the same billing cycle', async () => {
    const periodStart = new Date()
    await seedTenant(db, {
      balance: 0,
      plan: 'free',
      contactEmail: 'test@example.com',
      billingPeriodStart: periodStart,
      zeroCreditAlertSentAt: new Date(periodStart.getTime() + 1000),
    })

    const result = await checkAndSendLowCreditAlert(db, TENANT_ID)

    expect(result.alert_sent).toBeNull() // Already sent
  })

  it('does not send alert for unlimited (enterprise) plan', async () => {
    await db.collection('tenants').updateOne(
      { tenant_id: TENANT_ID },
      {
        $set: {
          tenant_id: TENANT_ID,
          plan: 'enterprise',
          status: 'active',
          billing: {
            credits_balance: Number.MAX_SAFE_INTEGER,
            credits_included: -1,
            outcome_price: 0,
            currency: 'GBP',
          },
        },
      },
      { upsert: true },
    )

    const result = await checkAndSendLowCreditAlert(db, TENANT_ID)

    expect(result.alert_sent).toBeNull()
  })

  it('does not send alert when balance is above threshold', async () => {
    await seedTenant(db, {
      balance: 10,
      plan: 'free',
      contactEmail: 'test@example.com',
    })

    const result = await checkAndSendLowCreditAlert(db, TENANT_ID)

    expect(result.alert_sent).toBeNull()
  })

  it('sends low-credit alert again in a new billing cycle', async () => {
    const oldPeriodStart = new Date(Date.now() - 35 * 86_400_000) // 35 days ago
    const newPeriodStart = new Date() // Current cycle
    await seedTenant(db, {
      balance: LOW_CREDIT_THRESHOLD,
      plan: 'free',
      contactEmail: 'test@example.com',
      billingPeriodStart: newPeriodStart,
      lowCreditAlertSentAt: new Date(oldPeriodStart.getTime() + 1000), // Sent in old cycle
    })

    const result = await checkAndSendLowCreditAlert(db, TENANT_ID)

    expect(result.alert_sent).toBe('low') // New cycle — alert again
  })

  // ── Integration: measureAndCharge triggers low-credit alert ──────────────────

  it('measureAndCharge triggers low-credit alert when balance drops to threshold', async () => {
    // Start with 4 credits (threshold is 3, so after 1 charge we'll be at 3)
    await seedTenant(db, { balance: 4, plan: 'free' })
    await seedVerifiedMoment(db, 'vm-alert-trigger', 'goal-1', PERCENT_KPI.metric)

    const service = new OutcomeCredits(db)
    await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: PERCENT_KPI,
      currentValue: 11,
    })

    // Balance should be 3 (4 - 1), which is at the threshold
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(3)
    expect(tenant?.['billing']?.['low_credit_alert_sent_at']).toBeInstanceOf(Date)
  })
})
