/**
 * Load test — verifies that measureAndCharge is safe under true concurrency.
 *
 * Unlike the unit tests which use Promise.all on a single MongoDB connection
 * (which processes operations sequentially), this test creates multiple
 * MongoDB clients with separate connection pools to simulate real parallelism.
 *
 * The test verifies:
 * 1. Two concurrent charges for the same verified moment only succeed once
 * 2. Multiple concurrent charges for different moments all succeed
 * 3. Credits are never over-deducted (balance never goes negative)
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, type Db } from 'mongodb'
import { OutcomeCredits, type KpiLike } from '../outcome-credits.js'

const TENANT_ID = 'load-test-tenant'

const TEST_KPI: KpiLike = {
  metric: 'portfolio_concentration_max_pct',
  label: 'Concentration',
  unit: '%',
  target: 10,
  start_value: 12,
  direction: 'decrease',
}

async function seedTenant(db: Db, balance: number) {
  await db.collection('tenants').updateOne(
    { tenant_id: TENANT_ID },
    {
      $set: {
        tenant_id: TENANT_ID,
        plan: 'free',
        billing: {
          credits_balance: balance,
          credits_included: balance,
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

async function seedVerifiedMoment(db: Db, momentId: string, goalId: string) {
  await db.collection('verified_moments').insertOne({
    id: momentId,
    tenant_id: TENANT_ID,
    goal_id: goalId,
    kpi_metric: TEST_KPI.metric,
    insight_id: `insight-${momentId}`,
    status: 'approved',
    hypothesis: 'test',
    confidence: 0.85,
    signal_ids: [],
    reasoning: 'Test reasoning',
    created_at: new Date(),
  })
}

describe('measureAndCharge load test — true concurrency', () => {
  let mongod: MongoMemoryServer
  let mainClient: MongoClient
  let db: Db

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    const uri = mongod.getUri()
    process.env['MONGODB_URL'] = uri
    process.env['MONGODB_DB'] = 'load_test'
    mainClient = new MongoClient(uri)
    await mainClient.connect()
    db = mainClient.db('load_test')
  })

  afterEach(async () => {
    await mainClient.close()
    await mongod.stop()
  })

  it('two concurrent charges for the same moment only succeed once (multi-client)', async () => {
    await seedTenant(db, 10)
    await seedVerifiedMoment(db, 'vm-concurrent-1', 'goal-1')

    // Create two separate clients to simulate true parallelism
    const uri = mongod.getUri()
    const client1 = new MongoClient(uri)
    const client2 = new MongoClient(uri)
    await client1.connect()
    await client2.connect()

    const db1 = client1.db('load_test')
    const db2 = client2.db('load_test')

    const service1 = new OutcomeCredits(db1)
    const service2 = new OutcomeCredits(db2)

    try {
      // Fire both charges simultaneously
      const [result1, result2] = await Promise.all([
        service1.measureAndCharge({
          tenantId: TENANT_ID,
          goalId: 'goal-1',
          kpi: TEST_KPI,
          currentValue: 11,
        }),
        service2.measureAndCharge({
          tenantId: TENANT_ID,
          goalId: 'goal-1',
          kpi: TEST_KPI,
          currentValue: 11,
        }),
      ])

      // Exactly one should succeed
      const successes = [result1, result2].filter(r => r !== null)
      expect(successes.length).toBe(1)

      // Balance should be 9 (10 - 1), not 8
      const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
      expect(tenant?.['billing']?.['credits_balance']).toBe(9)
    } finally {
      await client1.close()
      await client2.close()
    }
  })

  it('multiple concurrent charges for different moments all succeed', async () => {
    await seedTenant(db, 10)

    // Seed 5 different verified moments for different goals
    for (let i = 0; i < 5; i++) {
      await seedVerifiedMoment(db, `vm-parallel-${i}`, `goal-parallel-${i}`)
    }

    const uri = mongod.getUri()
    const clients: MongoClient[] = []
    const services: OutcomeCredits[] = []

    try {
      // Create 5 separate clients
      for (let i = 0; i < 5; i++) {
        const c = new MongoClient(uri)
        await c.connect()
        clients.push(c)
        services.push(new OutcomeCredits(c.db('load_test')))
      }

      // Fire all 5 charges simultaneously
      const results = await Promise.all(
        services.map((s, i) =>
          s.measureAndCharge({
            tenantId: TENANT_ID,
            goalId: `goal-parallel-${i}`,
            kpi: TEST_KPI,
            currentValue: 11,
          }),
        ),
      )

      // All 5 should succeed (different moments, different goals)
      const successes = results.filter(r => r !== null)
      expect(successes.length).toBe(5)

      // Balance should be 5 (10 - 5)
      const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
      expect(tenant?.['billing']?.['credits_balance']).toBe(5)
    } finally {
      await Promise.all(clients.map(c => c.close()))
    }
  })

  it('credits never go negative under concurrent charges with insufficient balance', async () => {
    // Start with 2 credits but try to charge 5 times concurrently
    await seedTenant(db, 2)

    for (let i = 0; i < 5; i++) {
      await seedVerifiedMoment(db, `vm-negative-${i}`, `goal-negative-${i}`)
    }

    const uri = mongod.getUri()
    const clients: MongoClient[] = []
    const services: OutcomeCredits[] = []

    try {
      for (let i = 0; i < 5; i++) {
        const c = new MongoClient(uri)
        await c.connect()
        clients.push(c)
        services.push(new OutcomeCredits(c.db('load_test')))
      }

      const results = await Promise.all(
        services.map((s, i) =>
          s.measureAndCharge({
            tenantId: TENANT_ID,
            goalId: `goal-negative-${i}`,
            kpi: TEST_KPI,
            currentValue: 11,
          }),
        ),
      )

      // Only 2 should succeed (we had 2 credits)
      const successes = results.filter(r => r !== null)
      expect(successes.length).toBe(2)

      // Balance should be 0, not negative
      const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
      expect(tenant?.['billing']?.['credits_balance']).toBe(0)
      expect(tenant?.['billing']?.['credits_balance']).toBeGreaterThanOrEqual(0)
    } finally {
      await Promise.all(clients.map(c => c.close()))
    }
  })

  it('10 concurrent promo code redemptions of different codes all succeed (no lost updates)', async () => {
    await seedTenant(db, 0)

    // Seed 10 different promo codes
    for (let i = 0; i < 10; i++) {
      await db.collection('promo_codes').insertOne({
        code: `LOAD10_${i}`,
        grant_credits: 10,
        max_uses: 100,
        used_count: 0,
        active: true,
        created_at: new Date(),
      })
    }

    const uri = mongod.getUri()
    const { redeemPromoCode } = await import('../promo-codes.js')
    const clients: MongoClient[] = []

    try {
      for (let i = 0; i < 10; i++) {
        const c = new MongoClient(uri)
        await c.connect()
        clients.push(c)
      }

      const results = await Promise.all(
        clients.map((c, i) =>
          redeemPromoCode(c.db('load_test'), TENANT_ID, `LOAD10_${i}`),
        ),
      )

      // All 10 should succeed
      const successes = results.filter(r => r.ok)
      expect(successes.length).toBe(10)

      // Balance should be 100 (10 codes × 10 credits each)
      const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT_ID })
      expect(tenant?.['billing']?.['credits_balance']).toBe(100)
    } finally {
      await Promise.all(clients.map(c => c.close()))
    }
  })
})
