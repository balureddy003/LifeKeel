import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  checkPlanSpendBudget,
  platformUnitEconomics,
  recordSpend,
  spendCost,
  spendEventsCol,
  tenantSpendMicrodollars,
} from '../spend-ledger.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('spend-ledger-test')
})

beforeEach(async () => {
  for (const name of await db.listCollections().toArray()) {
    await db.collection(name.name).deleteMany({})
  }
  delete process.env['LIFEKEEL_PLAN_SPEND_BUDGET_JSON']
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('recordSpend + tenantSpendMicrodollars', () => {
  it('unions spend_events with llm_usage for one tenant total', async () => {
    await recordSpend(db, {
      tenant_id: 't1',
      service: 'messaging',
      provider: 'twilio',
      unit: 'sms',
      units: 1,
      cost_microdollars: spendCost('twilio', 'sms'),
    })
    await db.collection('llm_usage').insertOne({
      tenant_id: 't1',
      model: 'gpt-4o-mini',
      provider: 'openai',
      input_tokens: 1000,
      output_tokens: 100,
      cost_microdollars: 21,
      latency_ms: 100,
      created_at: new Date(),
    })
    // Another tenant's spend must not leak in.
    await recordSpend(db, {
      tenant_id: 't2',
      service: 'messaging',
      provider: 'twilio',
      unit: 'sms',
      units: 5,
      cost_microdollars: 50000,
    })

    expect(await tenantSpendMicrodollars(db, 't1')).toBe(spendCost('twilio', 'sms') + 21)
    const event = await spendEventsCol(db).findOne({ tenant_id: 't1' })
    expect(event!['estimated']).toBe(true)
  })
})

describe('checkPlanSpendBudget — plan cap at the spend gateway', () => {
  const batchPolicy = { budget_class: 'batch' } as never
  const interactivePolicy = { budget_class: 'interactive' } as never

  async function seedTenant(plan: string) {
    await db.collection('tenants').insertOne({ tenant_id: 't1', plan })
  }

  it('allows spend under the plan cap', async () => {
    await seedTenant('free')
    await recordSpend(db, {
      tenant_id: 't1',
      service: 'messaging',
      provider: 'twilio',
      unit: 'sms',
      units: 1,
      cost_microdollars: 1000,
    })
    const d = await checkPlanSpendBudget(db, 't1', batchPolicy)
    expect(d.allowed).toBe(true)
    expect(d.limit_microdollars).toBe(1_000_000) // free = $1
  })

  it('denies batch-class tasks once the plan cap is crossed', async () => {
    await seedTenant('free')
    await recordSpend(db, {
      tenant_id: 't1',
      service: 'messaging',
      provider: 'twilio',
      unit: 'sms',
      units: 200,
      cost_microdollars: 1_500_000, // $1.50 > $1 free cap
    })
    const d = await checkPlanSpendBudget(db, 't1', batchPolicy)
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('plan_spend_budget_exceeded')
    expect(
      await db
        .collection('system_events')
        .countDocuments({ tenant_id: 't1', type: 'plan_spend_budget_exceeded' }),
    ).toBe(1)
  })

  it('never hard-stops interactive tasks on platform cost for paid plans', async () => {
    await seedTenant('plus')
    await recordSpend(db, {
      tenant_id: 't1',
      service: 'messaging',
      provider: 'twilio',
      unit: 'sms',
      units: 200,
      cost_microdollars: 1_500_000_000,
    })
    const d = await checkPlanSpendBudget(db, 't1', interactivePolicy)
    expect(d.allowed).toBe(true)
    expect(d.threshold_reached).toBe(true)
  })

  it('hard-stops free-tier interactive tasks once the cap is crossed (Intent 76)', async () => {
    await seedTenant('free')
    await recordSpend(db, {
      tenant_id: 't1',
      service: 'messaging',
      provider: 'twilio',
      unit: 'sms',
      units: 200,
      cost_microdollars: 1_500_000,
    })
    // A free tenant over the cap must not be able to run an interactive
    // model/OCR call — that is the unbounded free-tier spend Intent 76
    // closes. The old `budget_class !== 'batch'` exemption no longer
    // applies to plan === 'free'.
    const d = await checkPlanSpendBudget(db, 't1', interactivePolicy)
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('plan_spend_budget_exceeded')
    // And below the cap an interactive call is still allowed.
    const d2 = await checkPlanSpendBudget(db, 't2-under', interactivePolicy)
    expect(d2.allowed).toBe(true)
  })

  it('unlimited plan has no cap', async () => {
    await seedTenant('unlimited')
    await recordSpend(db, {
      tenant_id: 't1',
      service: 'messaging',
      provider: 'twilio',
      unit: 'sms',
      units: 1000,
      cost_microdollars: 999_000_000,
    })
    const d = await checkPlanSpendBudget(db, 't1', batchPolicy)
    expect(d.allowed).toBe(true)
    expect(d.limit_microdollars).toBeNull()
  })
})

describe('platformUnitEconomics', () => {
  it('rolls services up, counts active families, ranks top tenants', async () => {
    await db.collection('users').insertMany([
      { id: 'u1', tenant_id: 't1', status: 'active' },
      { id: 'u2', tenant_id: 't2', status: 'active' },
    ])
    await db.collection('login_events').insertMany([
      { user_id: 'u1', success: true, created_at: new Date() },
      { user_id: 'u2', success: true, created_at: new Date() },
      // A failed login must not make a family "active".
      { user_id: 'u2', success: false, created_at: new Date() },
    ])
    await recordSpend(db, {
      tenant_id: 't1',
      service: 'messaging',
      provider: 'twilio',
      unit: 'sms',
      units: 1,
      cost_microdollars: 100,
    })
    await db.collection('llm_usage').insertOne({
      tenant_id: 't2',
      model: 'm',
      provider: 'p',
      input_tokens: 1,
      output_tokens: 1,
      cost_microdollars: 300,
      latency_ms: 1,
      created_at: new Date(),
    })

    const econ = await platformUnitEconomics(db, 30)
    expect(econ.total_spend_microdollars).toBe(400)
    expect(econ.by_service['messaging']).toBe(100)
    expect(econ.by_service['ai']).toBe(300)
    expect(econ.active_families).toBe(2)
    expect(econ.cost_per_active_family_microdollars).toBe(200)
    expect(econ.top_tenants[0]).toEqual({ tenant_id: 't2', microdollars: 300 })
  })
})
