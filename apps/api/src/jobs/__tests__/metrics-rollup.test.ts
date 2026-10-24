import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { isRollupReady, readDailyRollup, runMetricsRollup } from '../metrics-rollup.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('metrics-rollup')
})

beforeEach(async () => {
  await db.dropDatabase()
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('metrics daily rollup', () => {
  it('aggregates growth events, signups, leads and logins into daily docs', async () => {
    const today = new Date()
    await db.collection('growth_events').insertMany([
      { event: 'landing_view', created_at: today },
      { event: 'landing_view', created_at: today },
      { event: 'signup_completed', created_at: today },
    ])
    await db
      .collection('users')
      .insertOne({ id: 'u1', tenant_id: 't1', created_at: today, attribution: { utm_source: 'x' } })
    await db
      .collection('leads')
      .insertOne({ id: 'l1', email: 'a@b.c', created_at: today, source: 'quiz' })
    await db
      .collection('login_events')
      .insertOne({ user_id: 'u1', success: true, created_at: today })

    const summary = await runMetricsRollup(db, today)
    expect(summary.rolled_days).toBe(90) // first run backfills
    expect(await isRollupReady(db)).toBe(true)

    const rows = await readDailyRollup(db, 'growth_event', 30)
    expect(rows).toContainEqual({
      day: today.toISOString().slice(0, 10),
      dim: 'landing_view',
      count: 2,
    })
    expect(rows).toContainEqual({
      day: today.toISOString().slice(0, 10),
      dim: 'signup_completed',
      count: 1,
    })

    const signups = await readDailyRollup(db, 'signup', 30)
    expect(signups).toContainEqual({ day: today.toISOString().slice(0, 10), dim: 'x', count: 1 })

    const leads = await readDailyRollup(db, 'lead', 30)
    expect(leads).toContainEqual({ day: today.toISOString().slice(0, 10), dim: 'quiz', count: 1 })
  })

  it('re-runs only today and yesterday after backfill, and recounts stale days', async () => {
    const now = new Date()
    await runMetricsRollup(db, now)
    const second = await runMetricsRollup(db, now)
    expect(second.rolled_days).toBe(2)

    // A late-arriving event for yesterday lands on the next run.
    const yesterday = new Date(now.getTime() - 20 * 60 * 60 * 1000)
    await db
      .collection('growth_events')
      .insertOne({ event: 'quiz_completed', created_at: yesterday })
    await runMetricsRollup(db, now)
    const rows = await readDailyRollup(db, 'growth_event', 3)
    expect(rows).toContainEqual({
      day: yesterday.toISOString().slice(0, 10),
      dim: 'quiz_completed',
      count: 1,
    })
  })

  it('rolls up visits per utm_content token, bucketing free text as other', async () => {
    const today = new Date()
    await db.collection('growth_events').insertMany([
      { event: 'landing_view', meta: { utm_content: 'p1234abc' }, created_at: today },
      { event: 'blog_view', meta: { utm_content: 'p1234abc' }, created_at: today },
      { event: 'landing_view', meta: { utm_content: 'free text here' }, created_at: today },
      { event: 'landing_view', meta: {}, created_at: today },
      { event: 'signup_completed', meta: { utm_content: 'p1234abc' }, created_at: today }, // not a visit
    ])
    await runMetricsRollup(db, today)
    const rows = await readDailyRollup(db, 'visit_content', 30)
    const day = today.toISOString().slice(0, 10)
    expect(rows).toContainEqual({ day, dim: 'p1234abc', count: 2 })
    expect(rows).toContainEqual({ day, dim: 'other', count: 1 })
    expect(rows).toContainEqual({ day, dim: 'none', count: 1 })
    expect(rows.find((r) => r.dim === 'p1234abc')!.count).toBe(2) // signup excluded
  })

  it('reports not-ready before the first run', async () => {
    expect(await isRollupReady(db)).toBe(false)
  })
})
