import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { runWeeklyDigest } from '../weekly-digest.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('digest-test')
})

beforeEach(async () => {
  for (const name of await db.listCollections().toArray()) {
    await db.collection(name.name).deleteMany({})
  }
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('runWeeklyDigest', () => {
  it('aggregates the week and persists a digest doc', async () => {
    const now = Date.now()
    await db.collection('users').insertMany([
      { id: 'u1', created_at: new Date(now - 2 * 24 * 3600_000) },
      { id: 'u2', created_at: new Date(now - 3 * 24 * 3600_000), attribution: { utm_medium: 'social', utm_content: 'ready-check' } },
      { id: 'u3', created_at: new Date(now - 10 * 24 * 3600_000) }, // previous week
    ])
    await db.collection('leads').insertMany([
      { id: 'l1', stage: 'new', created_at: new Date(now - 24 * 3600_000) },
      { id: 'l2', stage: 'contacted', created_at: new Date(now - 24 * 3600_000) },
    ])
    await db.collection('operator_alerts').insertMany([
      { dedup_key: 'a1', status: 'open' },
      { dedup_key: 'a2', status: 'resolved' },
    ])
    await db.collection('autopilot_actions').insertMany([
      { id: 'act1', status: 'executed', created_at: new Date(now - 24 * 3600_000) },
      { id: 'act2', status: 'proposed', created_at: new Date(now - 24 * 3600_000) },
    ])
    await db.collection('marketing_posts').insertOne({ id: 'p1', state: 'published', published_at: new Date(now - 48 * 3600_000) })

    const digest = await runWeeklyDigest(db)
    expect(digest.signups_7d).toBe(2)
    expect(digest.signups_prev_7d).toBe(1)
    expect(digest.leads_total_7d).toBe(2)
    expect(digest.leads_new).toBe(1)
    expect(digest.open_alerts).toBe(1)
    expect(digest.autopilot_executed_7d).toBe(1)
    expect(digest.autopilot_pending_proposals).toBe(1)
    expect(digest.marketing_published_7d).toBe(1)
    expect(digest.top_content).toEqual({ slug: 'ready-check', signups: 1 })

    const stored = await db.collection('operator_digests').findOne({ id: digest.id })
    expect(stored).toBeTruthy()
  })

  it('still writes a digest on an empty week (and never throws on Slack failure)', async () => {
    const digest = await runWeeklyDigest(db)
    expect(digest.signups_7d).toBe(0)
    expect(digest.top_content).toBeUndefined()
    expect(await db.collection('operator_digests').countDocuments()).toBe(1)
  })
})
