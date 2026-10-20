/**
 * PRD-141 against a real MongoDB: definitions are computed as written, and any
 * cohort below MIN_COHORT is hidden rather than shown.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { METRIC_DEFINITIONS, MIN_COHORT, computeRetentionMetrics, quarterOf } from '../retention.js'

const NOW = new Date('2026-10-20T10:00:00Z')
let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('retention-test')
})
beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

const many = (n: number, make: (i: number) => Record<string, unknown>) =>
  Array.from({ length: n }, (_, i) => make(i))

describe('computeRetentionMetrics', () => {
  it('has an owner-written definition for every metric it returns', async () => {
    const m = await computeRetentionMetrics(db, NOW)
    for (const key of Object.keys(METRIC_DEFINITIONS))
      expect(m.definitions[key as keyof typeof METRIC_DEFINITIONS].length).toBeGreaterThan(40)
    expect(
      Object.keys(m)
        .filter((k) => k !== 'generated_at' && k !== 'min_cohort' && k !== 'definitions')
        .sort(),
    ).toEqual([
      'data_freshness',
      'digest_delivery',
      'digest_engagement',
      'notification_health',
      'perceived_protection',
      'received_value_retention',
    ])
  })

  it('reports scheduled versus delivered from the digest run records', async () => {
    await db.collection('job_runs').insertMany([
      { job: 'family-heartbeat-monthly', ran_at: new Date('2026-10-01'), sent: 8, failed: 2 },
      { job: 'family-heartbeat-monthly', ran_at: new Date('2026-09-01'), sent: 10, failed: 0 },
      { job: 'family-heartbeat-weekly', ran_at: new Date('2026-10-01'), sent: 99, failed: 99 },
      { job: 'family-heartbeat-monthly', ran_at: new Date('2026-01-01'), sent: 50, failed: 50 },
    ])
    const m = await computeRetentionMetrics(db, NOW)
    expect(m.digest_delivery).toEqual({ scheduled: 20, delivered: 18, rate: 0.9 })
  })

  it('hides every cohort-based figure below the minimum and shows it at the minimum', async () => {
    const small = MIN_COHORT - 1
    await db
      .collection('freshness_state')
      .insertMany(many(small, (i) => ({ tenant_id: `t${i}`, detector_id: 'd', state: 'running' })))
    await db
      .collection('delivery_preferences')
      .insertMany(many(small, (i) => ({ tenant_id: `t${i}`, digest_mode: true })))
    let m = await computeRetentionMetrics(db, NOW)
    expect(m.data_freshness).toEqual({ mean_share_running: null, families: null })
    expect(m.notification_health.digest_only_share).toBeNull()

    await db
      .collection('freshness_state')
      .insertOne({ tenant_id: 'tX', detector_id: 'd', state: 'paused_missing' })
    await db.collection('delivery_preferences').insertOne({ tenant_id: 'tX', digest_mode: false })
    m = await computeRetentionMetrics(db, NOW)
    expect(m.data_freshness.families).toBe(MIN_COHORT)
    expect(m.data_freshness.mean_share_running).toBe(0.9)
    expect(m.notification_health.digest_only_share).toBe(0.9)
  })

  it('computes click-through per 100 digests by variant, and unsubscribes per 100', async () => {
    await db.collection('heartbeat_sends').insertMany(
      many(20, (i) => ({
        member_id: `m${i}`,
        sent_at: new Date('2026-10-01'),
        variant: i < 10 ? 'all_clear' : 'note',
      })),
    )
    await db.collection('growth_events').insertMany([
      ...many(4, () => ({
        event: 'digest_click',
        meta: { v: 'all_clear' },
        created_at: new Date('2026-10-05'),
      })),
      ...many(1, () => ({
        event: 'digest_click',
        meta: { v: 'note' },
        created_at: new Date('2026-10-05'),
      })),
      ...many(2, () => ({ event: 'heartbeat_unsubscribed', created_at: new Date('2026-10-06') })),
    ])
    const m = await computeRetentionMetrics(db, NOW)
    expect(m.digest_engagement['all_clear']!.clicks_per_100).toBe(40)
    expect(m.digest_engagement['note']!.clicks_per_100).toBe(10)
    expect(m.digest_engagement['missed']!.clicks_per_100).toBeNull()
    expect(m.notification_health.unsubscribes_per_100_digests).toBe(10)
  })

  it('received-value retention counts clicks, confirmed reviews and resolved gaps for the right cohort', async () => {
    const created = new Date('2026-07-10')
    const ids = Array.from({ length: MIN_COHORT }, (_, i) => `c${i}`)
    await db.collection('tenants').insertMany([
      ...ids.map((tenant_id) => ({
        tenant_id,
        created_at: created,
        status: 'active',
        plan: 'free',
      })),
      { tenant_id: 'paid', created_at: created, status: 'active', plan: 'plus' },
      { tenant_id: 'gone', created_at: created, status: 'suspended', plan: 'free' },
      {
        tenant_id: 'other-month',
        created_at: new Date('2026-08-10'),
        status: 'active',
        plan: 'free',
      },
    ])
    await db
      .collection('value_events')
      .insertOne({ tenant_id: 'c0', kind: 'digest_click', at: new Date('2026-10-10') })
    await db
      .collection('family_financial_profile')
      .insertOne({ tenant_id: 'c1', reviewed_at: new Date('2026-10-12') })
    await db
      .collection('insights')
      .insertOne({ tenant_id: 'c2', resolved_at: new Date('2026-10-15') })
    await db
      .collection('value_events')
      .insertOne({ tenant_id: 'c3', kind: 'digest_click', at: new Date('2026-08-01') }) // too old
    await db
      .collection('value_events')
      .insertOne({ tenant_id: 'paid', kind: 'digest_click', at: new Date('2026-10-10') }) // not free tier
    const m = await computeRetentionMetrics(db, NOW)
    expect(m.received_value_retention.month_3.retained_share).toBe(0.3)
    expect(m.received_value_retention.month_6.retained_share).toBeNull() // empty cohort is hidden
  })

  it('perceived protection averages answers only, for the current quarter, above the minimum', async () => {
    const q = quarterOf(NOW)
    expect(q).toBe('2026-Q4')
    await db.collection('perceived_protection').insertMany([
      ...many(MIN_COHORT - 1, (i) => ({
        tenant_id: 't',
        user_id: `u${i}`,
        quarter: q,
        score: 4,
      })),
      { tenant_id: 't', user_id: 'skip', quarter: q, skipped: true },
      { tenant_id: 't', user_id: 'old', quarter: '2026-Q3', score: 1 },
    ])
    let m = await computeRetentionMetrics(db, NOW)
    expect(m.perceived_protection).toEqual({ quarter: q, mean: null, responses: null })
    await db
      .collection('perceived_protection')
      .insertOne({ tenant_id: 't', user_id: 'last', quarter: q, score: 5 })
    m = await computeRetentionMetrics(db, NOW)
    expect(m.perceived_protection).toEqual({ quarter: q, mean: 4.1, responses: MIN_COHORT })
  })
})
