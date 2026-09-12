import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, type Db } from 'mongodb'
import { OutcomeCredits, type KpiLike } from '../outcome-credits.js'
import { redeemPromoCode } from '../promo-codes.js'
import { checkInviteCode, consumeInviteCode, validateAndConsumeInviteCode, seedInviteCodes } from '../../invite-codes.js'

const TENANT_ID = 'billing-test-tenant'

async function seedTenant(db: Db, balance = 10) {
  await db.collection('tenants').updateOne(
    { tenant_id: TENANT_ID },
    {
      $set: {
        tenant_id: TENANT_ID,
        plan: 'free',
        billing: {
          credits_balance: balance,
          credits_included: 10,
          credits_used_this_period: 0,
          outcome_price: 0,
          currency: 'GBP',
        },
        created_at: new Date(),
        updated_at: new Date(),
      },
    },
    { upsert: true },
  )
}

describe('Outcome Pass billing', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    const uri = mongod.getUri()
    process.env['MONGODB_URL'] = uri
    process.env['MONGODB_DB'] = 'billing_test'
    client = new MongoClient(uri)
    await client.connect()
    db = client.db('billing_test')
  })

  afterEach(async () => {
    await client.close()
    await mongod.stop()
  })

  it('redeems a promo code and adds credits', async () => {
    await seedTenant(db, 10)
    await db.collection('promo_codes').insertOne({
      code: 'FRIENDS25',
      grant_credits: 25,
      max_uses: 10,
      used_count: 0,
      active: true,
      created_at: new Date(),
    })

    const result = await redeemPromoCode(db, TENANT_ID, 'FRIENDS25')

    expect(result.ok).toBe(true)
    expect(result.grant_credits).toBe(25)
    expect(result.new_balance).toBe(35)
  })

  it('consumes an invite code and grants credits', async () => {
    process.env['INVITE_CODE_REQUIRED'] = 'true'
    await seedInviteCodes(db, [{ code: 'EARLY', grant_credits: 15, max_uses: 1 }])

    const result = await validateAndConsumeInviteCode(db, 'EARLY')

    expect(result.ok).toBe(true)
    expect(result.grant_credits).toBe(15)

    const second = await validateAndConsumeInviteCode(db, 'EARLY')
    expect(second.ok).toBe(false)

    process.env['INVITE_CODE_REQUIRED'] = 'false'
  })

  it('measures an outcome when a goal KPI moves far enough', async () => {
    await seedTenant(db, 10)
    const goalId = 'goal-1'
    const momentId = 'vm-1'

    await db.collection('verified_moments').insertOne({
      id: momentId,
      tenant_id: TENANT_ID,
      goal_id: goalId,
      kpi_metric: 'portfolio_concentration_max_pct',
      insight_id: 'insight-1',
      status: 'approved',
      hypothesis: 'reduce_concentration',
      confidence: 0.85,
      signal_ids: [],
      reasoning: 'Test reasoning',
      created_at: new Date(),
    })

    const service = new OutcomeCredits(db)
    const kpi: KpiLike = {
      metric: 'portfolio_concentration_max_pct',
      label: 'Concentration',
      unit: '%',
      target: 10,
      start_value: 12,
      direction: 'decrease',
    }

    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId,
      kpi,
      currentValue: 11,
    })

    expect(event).not.toBeNull()
    expect(event?.credits_consumed).toBe(1)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(9)
    expect(tenant?.['billing']?.['credits_used_this_period']).toBe(1)

    const moment = await db.collection('verified_moments').findOne({ id: momentId })
    expect(moment?.['status']).toBe('outcome_measured')
  })

  it('redeems a promo code only once per tenant', async () => {
    await seedTenant(db, 10)
    await db.collection('promo_codes').insertOne({
      code: 'FRIENDS25',
      grant_credits: 25,
      max_uses: 10,
      used_count: 0,
      active: true,
      created_at: new Date(),
    })

    const first = await redeemPromoCode(db, TENANT_ID, 'FRIENDS25')
    expect(first.ok).toBe(true)
    expect(first.new_balance).toBe(35)

    const second = await redeemPromoCode(db, TENANT_ID, 'FRIENDS25')
    expect(second.ok).toBe(false)

    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
    expect(tenant?.['billing']?.['credits_balance']).toBe(35)
    expect(tenant?.['billing']?.['credits_used_this_period']).toBe(0)

    const promo = await db.collection('promo_codes').findOne({ code: 'FRIENDS25' })
    expect(promo?.['used_count']).toBe(1)
  })

  it('computes real monetary value for currency-denominated KPIs', async () => {
    await seedTenant(db, 10)
    const goalId = 'goal-currency'
    const momentId = 'vm-currency'

    await db.collection('verified_moments').insertOne({
      id: momentId,
      tenant_id: TENANT_ID,
      goal_id: goalId,
      kpi_metric: 'net_pnl_gbp',
      insight_id: 'insight-2',
      status: 'approved',
      hypothesis: 'increase_pnl',
      confidence: 0.85,
      signal_ids: [],
      reasoning: 'Test reasoning',
      created_at: new Date(),
    })

    const service = new OutcomeCredits(db)
    const kpi: KpiLike = {
      metric: 'net_pnl_gbp',
      label: 'Net P&L',
      unit: 'GBP',
      target: 2000,
      start_value: 1000,
      direction: 'increase',
    }

    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId,
      kpi,
      currentValue: 1500,
    })

    expect(event).not.toBeNull()
    const moment = await db.collection('verified_moments').findOne({ id: momentId })
    expect(moment?.['outcome']?.['value_minor_units']).toBe(50_000)
  })

  it('handles minor_currency units without inflating the value', async () => {
    await seedTenant(db, 10)
    const goalId = 'goal-minor-currency'
    const momentId = 'vm-minor-currency'

    await db.collection('verified_moments').insertOne({
      id: momentId,
      tenant_id: TENANT_ID,
      goal_id: goalId,
      kpi_metric: 'portfolio_value_minor',
      insight_id: 'insight-3',
      status: 'approved',
      hypothesis: 'increase_portfolio_value',
      confidence: 0.85,
      signal_ids: [],
      reasoning: 'Test reasoning',
      created_at: new Date(),
    })

    const service = new OutcomeCredits(db)
    const kpi: KpiLike = {
      metric: 'portfolio_value_minor',
      label: 'Portfolio value',
      unit: 'minor_currency',
      target: 100_000,
      start_value: 50_000,
      direction: 'increase',
    }

    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId,
      kpi,
      currentValue: 80_000,
    })

    expect(event).not.toBeNull()
    const moment = await db.collection('verified_moments').findOne({ id: momentId })
    expect(moment?.['outcome']?.['value_minor_units']).toBe(30_000)
  })

  it('does not consume invite code during validation', async () => {
    process.env['INVITE_CODE_REQUIRED'] = 'true'
    await seedInviteCodes(db, [{ code: 'EARLY', grant_credits: 15, max_uses: 1 }])

    const check = await checkInviteCode(db, 'EARLY')
    expect(check.ok).toBe(true)
    expect(check.grant_credits).toBe(15)

    const docBefore = await db.collection('invite_codes').findOne({ code: 'EARLY' })
    expect(docBefore?.['used_count']).toBe(0)

    const consumed = await consumeInviteCode(db, 'EARLY')
    expect(consumed.ok).toBe(true)

    const docAfter = await db.collection('invite_codes').findOne({ code: 'EARLY' })
    expect(docAfter?.['used_count']).toBe(1)

    process.env['INVITE_CODE_REQUIRED'] = 'false'
  })
})
