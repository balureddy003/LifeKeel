/**
 * Tests for billing hardening fixes:
 * - C1: measureAndCharge race condition (insert before deduct)
 * - C2: Negative balance guard
 * - C3: Webhook idempotency
 * - C4: redeemPromoCode race condition
 * - L3: Credit reversal
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, type Db } from 'mongodb'
import { OutcomeCredits, type KpiLike } from '../outcome-credits.js'
import { redeemPromoCode } from '../promo-codes.js'

const TENANT_ID = 'hardening-test-tenant'

async function seedTenant(db: Db, opts: {
  balance?: number
  outcomePrice?: number
  currency?: string
  plan?: string
} = {}) {
  await db.collection('tenants').updateOne(
    { tenant_id: TENANT_ID },
    {
      $set: {
        tenant_id: TENANT_ID,
        plan: opts.plan ?? 'free',
        billing: {
          credits_balance: opts.balance ?? 10,
          credits_included: 10,
          credits_used_this_period: 0,
          outcome_price: opts.outcomePrice ?? 0,
          currency: opts.currency ?? 'GBP',
        },
        created_at: new Date(),
        updated_at: new Date(),
      },
    },
    { upsert: true },
  )
}

async function seedVerifiedMoment(db: Db, opts: {
  momentId: string
  goalId: string
  kpiMetric: string
  status?: string
  daysAgo?: number
}) {
  const created = new Date(Date.now() - (opts.daysAgo ?? 1) * 86_400_000)
  await db.collection('verified_moments').insertOne({
    id: opts.momentId,
    tenant_id: TENANT_ID,
    goal_id: opts.goalId,
    kpi_metric: opts.kpiMetric,
    insight_id: `insight-${opts.momentId}`,
    status: opts.status ?? 'approved',
    hypothesis: 'test',
    confidence: 0.85,
    signal_ids: [],
    reasoning: 'Test reasoning',
    created_at: created,
  })
}

const TEST_KPI: KpiLike = {
  metric: 'portfolio_concentration_max_pct',
  label: 'Concentration',
  unit: '%',
  target: 10,
  start_value: 12,
  direction: 'decrease',
}

describe('Billing hardening — race conditions and guards', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    const uri = mongod.getUri()
    process.env['MONGODB_URL'] = uri
    process.env['MONGODB_DB'] = 'billing_hardening_test'
    client = new MongoClient(uri)
    await client.connect()
    db = client.db('billing_hardening_test')
  })

  afterEach(async () => {
    await client.close()
    await mongod.stop()
  })

  // ── C2: Negative balance guard ────────────────────────────────────────────

  it('C2: does not deduct credits when balance is 0', async () => {
    await seedTenant(db, { balance: 0 })
    await seedVerifiedMoment(db, { momentId: 'vm-zero', goalId: 'goal-1', kpiMetric: TEST_KPI.metric })

    const service = new OutcomeCredits(db)
    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: TEST_KPI,
      currentValue: 11,
    })

    // Should return null — no credits to deduct
    expect(event).toBeNull()

    // Balance should still be 0, not negative
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(0)
    expect(tenant?.['billing']?.['credits_used_this_period']).toBe(0)

    // No outcome_event should exist (it was cleaned up)
    const events = await db.collection('outcome_events').find({ tenant_id: TENANT_ID }).toArray()
    expect(events.length).toBe(0)
  })

  it('C2: deducts normally when balance is sufficient', async () => {
    await seedTenant(db, { balance: 5 })
    await seedVerifiedMoment(db, { momentId: 'vm-sufficient', goalId: 'goal-1', kpiMetric: TEST_KPI.metric })

    const service = new OutcomeCredits(db)
    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: TEST_KPI,
      currentValue: 11,
    })

    expect(event).not.toBeNull()
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(4)
  })

  // ── C1: Race condition — insert before deduct ─────────────────────────────

  it('C1: does not double-charge when the same moment is processed twice sequentially', async () => {
    await seedTenant(db, { balance: 10 })
    await seedVerifiedMoment(db, { momentId: 'vm-dup', goalId: 'goal-1', kpiMetric: TEST_KPI.metric })

    const service = new OutcomeCredits(db)

    // First call should charge
    const event1 = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: TEST_KPI,
      currentValue: 11,
    })
    expect(event1).not.toBeNull()

    // Second call for the same moment should be skipped (duplicate)
    const event2 = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: TEST_KPI,
      currentValue: 11,
    })
    expect(event2).toBeNull()

    // Only 1 credit should have been consumed
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(9)
  })

  it('C1: does not charge when cooldown period has not elapsed', async () => {
    await seedTenant(db, { balance: 10 })
    // First moment — will be charged
    await seedVerifiedMoment(db, { momentId: 'vm-cooldown-1', goalId: 'goal-1', kpiMetric: TEST_KPI.metric, daysAgo: 1 })
    // Second moment for the same goal+KPI — should be blocked by cooldown
    await seedVerifiedMoment(db, { momentId: 'vm-cooldown-2', goalId: 'goal-1', kpiMetric: TEST_KPI.metric, daysAgo: 0 })

    const service = new OutcomeCredits(db)

    const event1 = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: TEST_KPI,
      currentValue: 11,
    })
    expect(event1).not.toBeNull()

    const event2 = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: TEST_KPI,
      currentValue: 10.5,
    })
    expect(event2).toBeNull()

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(9)
  })

  // ── C4: Promo code race — atomic $inc ─────────────────────────────────────

  it('C4: promo code redemption uses atomic increment (no lost updates)', async () => {
    await seedTenant(db, { balance: 10 })
    await db.collection('promo_codes').insertOne({
      code: 'RACE50',
      grant_credits: 50,
      max_uses: 100,
      used_count: 0,
      active: true,
      created_at: new Date(),
    })

    // Redeem two different codes concurrently — both should succeed
    await db.collection('promo_codes').insertOne({
      code: 'RACE25',
      grant_credits: 25,
      max_uses: 100,
      used_count: 0,
      active: true,
      created_at: new Date(),
    })

    const [result1, result2] = await Promise.all([
      redeemPromoCode(db, TENANT_ID, 'RACE50'),
      redeemPromoCode(db, TENANT_ID, 'RACE25'),
    ])

    expect(result1.ok).toBe(true)
    expect(result2.ok).toBe(true)

    // Balance should be 10 + 50 + 25 = 85 (not overwritten by race)
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(85)
  })

  it('C4: concurrent redemption of the same code only succeeds once', async () => {
    await seedTenant(db, { balance: 10 })
    await db.collection('promo_codes').insertOne({
      code: 'SAME100',
      grant_credits: 100,
      max_uses: 100,
      used_count: 0,
      active: true,
      created_at: new Date(),
    })

    const [result1, result2] = await Promise.all([
      redeemPromoCode(db, TENANT_ID, 'SAME100'),
      redeemPromoCode(db, TENANT_ID, 'SAME100'),
    ])

    // Exactly one should succeed
    const successes = [result1, result2].filter(r => r.ok)
    expect(successes.length).toBe(1)

    // Balance should be 10 + 100 = 110 (not 10 + 200)
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(110)
  })

  it('C4: an unlimited promo code (max_uses: 0) is redeemable', async () => {
    await seedTenant(db, { balance: 10 })
    await db.collection('promo_codes').insertOne({
      code: 'UNLIMITED50',
      grant_credits: 50,
      // 0 means unlimited — the operator schema defaults to it and the UI
      // renders it as uncapped. The old atomic filter was
      // `used_count < max_uses` → `$lt: 0` → never matched, so every
      // unlimited code was permanently unredeemable.
      max_uses: 0,
      used_count: 0,
      active: true,
      created_at: new Date(),
    })

    const result = await redeemPromoCode(db, TENANT_ID, 'UNLIMITED50')

    expect(result.ok).toBe(true)
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(60)
    const code = await db.collection('promo_codes').findOne({ code: 'UNLIMITED50' })
    expect(code?.['used_count']).toBe(1)
  })

  // ── L3: Credit reversal ────────────────────────────────────────────────────

  it('L3: reverses a credit charge and restores balance', async () => {
    await seedTenant(db, { balance: 10 })
    await seedVerifiedMoment(db, { momentId: 'vm-reverse', goalId: 'goal-1', kpiMetric: TEST_KPI.metric })

    const service = new OutcomeCredits(db)

    // Charge a credit
    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: TEST_KPI,
      currentValue: 11,
    })
    expect(event).not.toBeNull()

    // Verify balance decreased
    let tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(9)

    // Reverse the charge
    const reversed = await service.reverseCharge({
      tenantId: TENANT_ID,
      eventId: event!.id,
      reason: 'incorrect charge — false positive',
    })
    expect(reversed).toBe(true)

    // Balance should be restored
    tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(10)
    expect(tenant?.['billing']?.['credits_used_this_period']).toBe(0)

    // Event should be marked as reversed
    const outcomeEvent = await db.collection('outcome_events').findOne({ id: event!.id })
    expect(outcomeEvent?.['reversed_at']).toBeDefined()
    expect(outcomeEvent?.['reversal_reason']).toBe('incorrect charge — false positive')
  })

  it('L3: cannot reverse the same charge twice', async () => {
    await seedTenant(db, { balance: 10 })
    await seedVerifiedMoment(db, { momentId: 'vm-double-reverse', goalId: 'goal-1', kpiMetric: TEST_KPI.metric })

    const service = new OutcomeCredits(db)
    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: TEST_KPI,
      currentValue: 11,
    })
    expect(event).not.toBeNull()

    // First reversal succeeds
    const reversed1 = await service.reverseCharge({
      tenantId: TENANT_ID,
      eventId: event!.id,
      reason: 'first reversal',
    })
    expect(reversed1).toBe(true)

    // Second reversal fails
    const reversed2 = await service.reverseCharge({
      tenantId: TENANT_ID,
      eventId: event!.id,
      reason: 'second reversal',
    })
    expect(reversed2).toBe(false)

    // Balance should only be restored once (10, not 11)
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(10)
  })

  it('L3: returns false for non-existent event', async () => {
    await seedTenant(db, { balance: 10 })
    const service = new OutcomeCredits(db)
    const reversed = await service.reverseCharge({
      tenantId: TENANT_ID,
      eventId: 'non-existent',
      reason: 'test',
    })
    expect(reversed).toBe(false)
  })

  // ── Outcome charge record (with outcome_price > 0) ──────────────────────────

  it('creates a pending outcome_charges record when outcome_price > 0', async () => {
    await seedTenant(db, { balance: 10, outcomePrice: 0.50 })
    await seedVerifiedMoment(db, { momentId: 'vm-paid', goalId: 'goal-1', kpiMetric: TEST_KPI.metric })

    const service = new OutcomeCredits(db)
    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: TEST_KPI,
      currentValue: 11,
    })
    expect(event).not.toBeNull()

    const charge = await db.collection('outcome_charges').findOne({ event_id: event!.id })
    expect(charge).not.toBeNull()
    expect(charge?.['status']).toBe('pending')
    expect(charge?.['amount_minor']).toBe(50) // 0.50 * 100
    expect(charge?.['currency']).toBe('GBP')
  })

  it('does not create outcome_charges record when outcome_price is 0', async () => {
    await seedTenant(db, { balance: 10, outcomePrice: 0 })
    await seedVerifiedMoment(db, { momentId: 'vm-free', goalId: 'goal-1', kpiMetric: TEST_KPI.metric })

    const service = new OutcomeCredits(db)
    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: TEST_KPI,
      currentValue: 11,
    })
    expect(event).not.toBeNull()

    const charge = await db.collection('outcome_charges').findOne({ event_id: event!.id })
    expect(charge).toBeNull()
  })

  // ── L3: Reversal removes pending outcome charge ─────────────────────────────

  it('L3: reversal removes pending outcome charge', async () => {
    await seedTenant(db, { balance: 10, outcomePrice: 0.50 })
    await seedVerifiedMoment(db, { momentId: 'vm-reverse-charge', goalId: 'goal-1', kpiMetric: TEST_KPI.metric })

    const service = new OutcomeCredits(db)
    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: TEST_KPI,
      currentValue: 11,
    })
    expect(event).not.toBeNull()

    // Verify charge was created
    let charge = await db.collection('outcome_charges').findOne({ event_id: event!.id })
    expect(charge).not.toBeNull()

    // Reverse
    await service.reverseCharge({
      tenantId: TENANT_ID,
      eventId: event!.id,
      reason: 'test reversal',
    })

    // Pending charge should be removed
    charge = await db.collection('outcome_charges').findOne({ event_id: event!.id, status: 'pending' })
    expect(charge).toBeNull()
  })
})
