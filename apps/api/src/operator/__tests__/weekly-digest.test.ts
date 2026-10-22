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
      {
        id: 'u2',
        created_at: new Date(now - 3 * 24 * 3600_000),
        attribution: { utm_medium: 'social', utm_content: 'ready-check' },
      },
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
    await db
      .collection('marketing_posts')
      .insertOne({ id: 'p1', state: 'published', published_at: new Date(now - 48 * 3600_000) })

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

  it('reports the AI gateway week — calls, failures, escape rate, spend, guards, disabled tasks', async () => {
    const now = Date.now()
    await db.collection('ai_task_calls').insertMany([
      {
        task_id: 'assistant.answer.v1',
        ok: true,
        latency_ms: 100,
        created_at: new Date(now - 24 * 3600_000),
      },
      {
        task_id: 'assistant.answer.v1',
        ok: false,
        latency_ms: 30_000,
        created_at: new Date(now - 24 * 3600_000),
      },
      // Operator-refused calls are not failures.
      {
        task_id: 'assistant.answer.v1',
        ok: false,
        outcome: 'disabled',
        latency_ms: 0,
        created_at: new Date(now - 24 * 3600_000),
      },
    ])
    await db.collection('llm_usage').insertMany([
      {
        workflow_id: 'assistant.answer.v1',
        cost_microdollars: 300_000,
        created_at: new Date(now - 24 * 3600_000),
      },
      {
        workflow_id: 'assistant.answer.v1',
        cost_microdollars: 200_000,
        created_at: new Date(now - 10 * 24 * 3600_000),
      },
    ])
    const today = new Date(now).toISOString().slice(0, 10)
    await db
      .collection<{ _id: string; day: string; route: string; count: number; updated_at: Date }>(
        'assistant_answer_routes',
      )
      .insertMany([
        {
          _id: `${today}|verified`,
          day: today,
          route: 'verified',
          count: 3,
          updated_at: new Date(now),
        },
        {
          _id: `${today}|generated`,
          day: today,
          route: 'generated',
          count: 1,
          updated_at: new Date(now),
        },
      ])
    await db.collection('llm_guard_events').insertOne({
      type: 'pii_redaction',
      action: 'redacted',
      persisted_at: new Date(now - 24 * 3600_000),
    })
    await db.collection('platform_config').insertOne({
      key: 'global',
      ai_disabled_tasks: ['assistant.answer.sensitive.v1'],
    })

    const digest = await runWeeklyDigest(db)
    const ai = digest.ai!
    expect(ai.calls_7d).toBe(3)
    expect(ai.failures_7d).toBe(1)
    expect(ai.generation_escape_rate).toBe(0.25)
    expect(ai.spend_usd_7d).toBeCloseTo(0.3)
    expect(ai.spend_usd_prev_7d).toBeCloseTo(0.2)
    expect(ai.top_guard_reason).toBe('pii_redaction')
    expect(ai.disabled_tasks).toBe(1)
  })

  it('still writes a digest on an empty week (and never throws on Slack failure)', async () => {
    const digest = await runWeeklyDigest(db)
    expect(digest.signups_7d).toBe(0)
    expect(digest.top_content).toBeUndefined()
    expect(await db.collection('operator_digests').countDocuments()).toBe(1)
  })
})
