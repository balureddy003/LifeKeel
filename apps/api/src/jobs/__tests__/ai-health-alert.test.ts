import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { runAiHealthAlert } from '../ai-health-alert.js'
import { sendOpsAlert } from '../../operator/ops-alerts.js'

vi.mock('../../operator/ops-alerts.js', () => ({
  sendOpsAlert: vi.fn(async () => {}),
}))

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

interface FunnelDoc {
  _id: string
  day: string
  task_id: string
  stage: string
  count: number
  updated_at: Date
}

const calls = (n: number) => Array.from({ length: n }, (_, i) => i)

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('ai-health-alert')
})

beforeEach(async () => {
  await db.dropDatabase()
  vi.mocked(sendOpsAlert).mockClear()
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('runAiHealthAlert (PRD-217)', () => {
  it('fires a critical alert when a task fails ≥80% over ≥5 calls in the last hour', async () => {
    const now = new Date()
    await db.collection('ai_task_calls').insertMany([
      // 5 failing calls — the October incident shape.
      ...calls(5).map(() => ({
        task_id: 'assistant.answer.v1',
        model: 'qwen2.5:7b',
        ok: false,
        latency_ms: 30_000,
        processor: 'ollama',
        created_at: now,
      })),
      // A healthy task in the same window.
      {
        task_id: 'email.policy_summary.v1',
        model: 'm',
        ok: true,
        latency_ms: 100,
        processor: 'anthropic',
        created_at: now,
      },
    ])
    const result = await runAiHealthAlert(db, now)
    expect(result.alerted).toEqual(['assistant.answer.v1'])
    expect(sendOpsAlert).toHaveBeenCalledOnce()
    const arg = vi.mocked(sendOpsAlert).mock.calls[0]![0]
    expect(arg.severity).toBe('critical')
    expect(arg.title).toContain('assistant.answer.v1')
    expect(arg.fingerprint).toContain(
      `ai-task-failing:assistant.answer.v1:${now.toISOString().slice(0, 13)}`,
    )
  })

  it('stays silent below the volume floor, below the share, and for old calls', async () => {
    const now = new Date()
    const old = new Date(now.getTime() - 2 * 60 * 60 * 1000)
    await db.collection('ai_task_calls').insertMany([
      // Only 4 calls — under the 5-call floor even at 100% failure.
      ...calls(4).map(() => ({
        task_id: 'a.v1',
        model: 'm',
        ok: false,
        latency_ms: 1,
        processor: 'x',
        created_at: now,
      })),
      // 4/6 = 67% — under the 80% share.
      ...calls(4).map(() => ({
        task_id: 'b.v1',
        model: 'm',
        ok: false,
        latency_ms: 1,
        processor: 'x',
        created_at: now,
      })),
      ...calls(2).map(() => ({
        task_id: 'b.v1',
        model: 'm',
        ok: true,
        latency_ms: 1,
        processor: 'x',
        created_at: now,
      })),
      // Out of the window entirely.
      ...calls(6).map(() => ({
        task_id: 'c.v1',
        model: 'm',
        ok: false,
        latency_ms: 1,
        processor: 'x',
        created_at: old,
      })),
    ])
    const result = await runAiHealthAlert(db, now)
    expect(result.alerted).toEqual([])
    expect(sendOpsAlert).not.toHaveBeenCalled()
  })

  it('ignores operator-disabled refusals — a deliberate switch is not an outage', async () => {
    const now = new Date()
    await db.collection('ai_task_calls').insertMany(
      calls(6).map(() => ({
        task_id: 'assistant.answer.v1',
        model: 'm',
        ok: false,
        latency_ms: 0,
        outcome: 'disabled',
        processor: 'ollama',
        created_at: now,
      })),
    )
    const result = await runAiHealthAlert(db, now)
    expect(result.checked_tasks).toBe(0)
    expect(sendOpsAlert).not.toHaveBeenCalled()
  })

  it('warns on a cascade regression — high model share while the encoder gate is on', async () => {
    const now = new Date()
    process.env['EMAIL_ENCODER_MODE'] = 'gate'
    try {
      const today = now.toISOString().slice(0, 10)
      await db.collection<FunnelDoc>('ai_cascade_funnel').insertMany([
        // 9 of 10 emails reaching the model — the encoder stopped gating.
        {
          _id: `${today}|email.policy_relevance.v1|model_call`,
          day: today,
          task_id: 'email.policy_relevance.v1',
          stage: 'model_call',
          count: 9,
          updated_at: now,
        },
        {
          _id: `${today}|email.policy_relevance.v1|encoder_skip`,
          day: today,
          task_id: 'email.policy_relevance.v1',
          stage: 'encoder_skip',
          count: 1,
          updated_at: now,
        },
      ])
      const result = await runAiHealthAlert(db, now)
      expect(result.alerted).toEqual(['cascade:email.policy_relevance.v1'])
      const arg = vi.mocked(sendOpsAlert).mock.calls[0]![0]
      expect(arg.severity).toBe('warning')
      expect(arg.title).toContain('generator share 90%')
      expect(arg.fingerprint).toBe(`ai-cascade-regression:email.policy_relevance.v1:${today}`)
    } finally {
      delete process.env['EMAIL_ENCODER_MODE']
    }
  })

  it('skips the cascade check when the encoder is not gating or volume is too small', async () => {
    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const funnelDoc = (count: number): FunnelDoc => ({
      _id: `${today}|email.policy_relevance.v1|model_call`,
      day: today,
      task_id: 'email.policy_relevance.v1',
      stage: 'model_call',
      count,
      updated_at: now,
    })

    // No gate mode → a 100% model share is expected behaviour, not regression.
    delete process.env['EMAIL_ENCODER_MODE']
    await db.collection<FunnelDoc>('ai_cascade_funnel').insertOne(funnelDoc(50))
    await runAiHealthAlert(db, now)
    expect(sendOpsAlert).not.toHaveBeenCalled()

    // Gate on but under the event floor — too early to call a regression.
    process.env['EMAIL_ENCODER_MODE'] = 'gate'
    try {
      await db.collection<FunnelDoc>('ai_cascade_funnel').deleteMany({})
      await db.collection<FunnelDoc>('ai_cascade_funnel').insertOne(funnelDoc(9))
      const result = await runAiHealthAlert(db, now)
      expect(result.alerted).toEqual([])
      expect(sendOpsAlert).not.toHaveBeenCalled()
    } finally {
      delete process.env['EMAIL_ENCODER_MODE']
    }
  })
})
