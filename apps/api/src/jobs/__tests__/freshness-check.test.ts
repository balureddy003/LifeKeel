/**
 * PRD-145 daily job against a real MongoDB: states stored by name only, `since`
 * survives a change inside a pause, recovery stamps resolved_at and the pause
 * length, and the run is recorded.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { runFreshnessCheck } from '../freshness-check.js'
import { registerFamilyFreshnessRoutes } from '../../routes/family-freshness.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

const T = 't1'
const DAY = 86_400_000
const day = (iso: string) => new Date(`${iso}T06:45:00Z`)

const profileDoc = (over: Record<string, unknown> = {}, touched = day('2026-10-01')) => ({
  tenant_id: T,
  household: {
    employment_status: 'employed',
    monthly_salary_minor: 400000,
    annual_living_expenses_minor: 250000,
    mortgage_outstanding_minor: 0,
    life_cover_minor: 0,
    income_protection_monthly_minor: 0,
    members: [],
  },
  emergency_fund: {
    emergency_savings_minor: 900000,
    monthly_expenses_minor: 300000,
    has_high_interest_debt: false,
    high_interest_debt_balance_minor: 0,
  },
  retirement: {
    current_age: 40,
    target_retirement_age: 65,
    pension_balance_minor: 0,
    monthly_contribution_minor: 0,
    target_retirement_income_minor: 3_000_000,
    expected_annual_growth_pct: 5,
  },
  education_funds: [],
  policies: [],
  updated_at: touched,
  ...over,
})

const row = (id: string) =>
  db.collection('freshness_state').findOne({ tenant_id: T, detector_id: id })

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('freshness-test')
})
beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  await db.collection('family_groups').insertOne({
    tenant_id: T,
    members: [
      {
        id: 'm1',
        user_id: 'u1',
        name: 'A',
        email: 'a@x.test',
        role: 'organizer',
        status: 'active',
      },
    ],
  })
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('runFreshnessCheck', () => {
  it('stores a state per detector without any values and records the run', async () => {
    await db.collection('family_financial_profile').insertOne(profileDoc())
    const s = await runFreshnessCheck(db, { now: day('2026-10-20') })
    expect(s).toMatchObject({ tenants: 1, paused_checks: 0, failed: 0 })
    expect(await db.collection('freshness_state').countDocuments({ tenant_id: T })).toBe(9)
    expect((await row('family_protection_gap'))?.['state']).toBe('running')
    expect(JSON.stringify(await db.collection('freshness_state').find({}).toArray())).not.toContain(
      '400000',
    )
    expect(await db.collection('job_runs').countDocuments({ job: 'freshness-check' })).toBe(1)
  })

  it('keeps `since` across days, then stamps resolved_at and the pause length on recovery', async () => {
    await db
      .collection('family_financial_profile')
      .insertOne(
        profileDoc({ emergency_fund: { emergency_savings_minor: 1, monthly_expenses_minor: 0 } }),
      )
    await runFreshnessCheck(db, { now: day('2026-10-20') })
    const first = await row('family_emergency_fund_adequacy')
    expect(first?.['state']).toBe('paused_missing')

    await runFreshnessCheck(db, { now: day('2026-10-25') })
    expect((await row('family_emergency_fund_adequacy'))?.['since']).toEqual(first?.['since'])

    await db.collection('family_financial_profile').updateOne(
      { tenant_id: T },
      {
        $set: { 'emergency_fund.monthly_expenses_minor': 300000, updated_at: day('2026-10-26') },
      },
    )
    await runFreshnessCheck(db, { now: day('2026-10-27') })
    const after = await row('family_emergency_fund_adequacy')
    expect(after?.['state']).toBe('running')
    expect(after?.['resolved_at']).toEqual(day('2026-10-27'))
    expect(after?.['last_pause_ms']).toBe(7 * DAY)
  })

  it('a pause that turns from missing to stale keeps its original start', async () => {
    await db
      .collection('family_financial_profile')
      .insertOne(
        profileDoc(
          { emergency_fund: { emergency_savings_minor: 1, monthly_expenses_minor: 0 } },
          day('2026-01-01'),
        ),
      )
    await runFreshnessCheck(db, { now: day('2026-10-20') })
    const first = await row('family_emergency_fund_adequacy')
    await db
      .collection('family_financial_profile')
      .updateOne({ tenant_id: T }, { $set: { 'emergency_fund.monthly_expenses_minor': 300000 } })
    await runFreshnessCheck(db, { now: day('2026-10-21') })
    const after = await row('family_emergency_fund_adequacy')
    expect(after?.['state']).toBe('paused_stale')
    expect(after?.['since']).toEqual(first?.['since'])
    expect(after?.['resolved_at']).toBeUndefined()
  })

  it('a family with no profile pauses its checks instead of being skipped', async () => {
    const s = await runFreshnessCheck(db, { now: day('2026-10-20') })
    expect(s.paused_checks).toBe(8)
    expect((await row('family_estate_readiness'))?.['state']).toBe('running')
  })
})

describe('GET /family/freshness', () => {
  const appFor = async (userId: string) => {
    const app = Fastify()
    app.addHook('onRequest', async (req) => {
      ;(req as unknown as { authContext: unknown }).authContext = { tenant_id: T, user_id: userId }
    })
    registerFamilyFreshnessRoutes(app, db)
    await app.ready()
    return app
  }

  it('returns names and states to an adult, hides not-applicable checks', async () => {
    await db.collection('family_financial_profile').insertOne(profileDoc())
    await runFreshnessCheck(db, { now: day('2026-10-20') })
    const res = await (await appFor('u1')).inject({ method: 'GET', url: '/family/freshness' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.share_running).toBe(1)
    expect(body.detectors.map((d: { detector_id: string }) => d.detector_id)).not.toContain(
      'family_policy_review',
    )
    expect(JSON.stringify(body)).not.toContain('tenant_id')
  })

  it('refuses a non-adult', async () => {
    const res = await (await appFor('stranger')).inject({ method: 'GET', url: '/family/freshness' })
    expect(res.statusCode).toBe(403)
  })
})
