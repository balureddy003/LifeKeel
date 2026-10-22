import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'

import { registerOperatorRoutes } from '../operator.js'
import { initTaskGateway } from '../../ai/task-gateway.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

async function buildApp(userId = 'operator-1'): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    request.authContext = {
      user_id: userId,
      tenant_id: 'operator-tenant',
      roles: ['admin'],
      iat: Math.floor(Date.now() / 1000),
    }
  })
  await registerOperatorRoutes(app, db)
  await app.ready()
  return app
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('operator-ai-health')
  // The real registries from definitions/*.yaml — the endpoint merges live
  // policy + processor state with the recorded call outcomes.
  initTaskGateway(db)
})

beforeEach(async () => {
  await db.dropDatabase()
  await db.collection('users').insertOne({
    id: 'operator-1',
    tenant_id: 'operator-tenant',
    email: 'operator@example.com',
    name: 'Operator',
    roles: ['admin'],
    status: 'active',
    created_at: new Date(),
  })
  await db.collection('tenants').insertOne({
    tenant_id: 'operator-tenant',
    name: 'Operator',
    status: 'active',
    plan: 'free',
    created_at: new Date(),
  })
  await db
    .collection('platform_operators')
    .insertOne({ user_id: 'operator-1', status: 'active', roles: ['operations'] })
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('GET /operator/ai-health (PRD-217)', () => {
  it('rejects a caller with no operator record', async () => {
    const app = await buildApp('user-2')
    const res = await app.inject({ method: 'GET', url: '/operator/ai-health' })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('merges registry state with recorded call outcomes — tasks, processors, answer mix', async () => {
    const now = new Date()
    await db.collection('ai_task_calls').insertMany([
      {
        task_id: 'assistant.answer.v1',
        model: 'm',
        ok: true,
        latency_ms: 120,
        processor: 'ollama',
        created_at: now,
      },
      {
        task_id: 'assistant.answer.v1',
        model: 'm',
        ok: true,
        latency_ms: 300,
        processor: 'ollama',
        created_at: now,
      },
      {
        task_id: 'assistant.answer.v1',
        model: 'm',
        ok: false,
        latency_ms: 30_000,
        processor: 'ollama',
        created_at: now,
      },
    ])
    await db.collection('llm_usage').insertOne({
      tenant_id: 'family-1',
      workflow_id: 'assistant.answer.v1',
      model: 'm',
      provider: 'ollama',
      input_tokens: 10,
      output_tokens: 20,
      cost_microdollars: 150,
      latency_ms: 120,
      created_at: now,
    })
    const today = now.toISOString().slice(0, 10)
    await db.collection<{ _id: string }>('assistant_answer_routes').insertMany([
      { _id: `${today}|verified`, day: today, route: 'verified', count: 3, updated_at: now },
      { _id: `${today}|generated`, day: today, route: 'generated', count: 1, updated_at: now },
    ])
    await db.collection('llm_guard_events').insertOne({
      tenant_id: 'family-1',
      call_id: 'c1',
      type: 'pii_redaction',
      field_path: 'prompt',
      original_hash: 'x',
      action: 'redacted',
      timestamp: now,
      persisted_at: now,
    })

    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/operator/ai-health' })
    expect(res.statusCode).toBe(200)
    const body = res.json()

    const task = (body.tasks as Record<string, unknown>[]).find(
      (t) => t['task_id'] === 'assistant.answer.v1',
    )!
    expect(task).toBeDefined()
    expect(task['calls']).toBe(3)
    expect(task['failures']).toBe(1)
    expect(task['p50_ms']).toBe(300)
    expect(task['p95_ms']).toBe(30_000)
    expect(task['cost_microdollars']).toBe(150)
    expect(task['serving_processor']).toBeTruthy()
    expect(['closed', 'open', 'half-open']).toContain(task['breaker_state'])

    // The processor registry is the real YAML — hosted processors start
    // unreviewed, self-hosted approved-by-construction.
    const processors = body.processors as Record<string, unknown>[]
    expect(processors.length).toBeGreaterThan(0)
    const anthropic = processors.find((p) => p['id'] === 'anthropic')
    expect(anthropic).toBeDefined()
    expect(anthropic!['status']).toBe('unreviewed')
    expect(processors.find((p) => p['id'] === 'ollama')!['status']).toBe('self_hosted')

    // Escape rate: 1 generated of 4 recorded asks.
    const mix = body.assistant_answer_mix as Record<string, unknown>
    expect(mix['verified']).toBe(3)
    expect(mix['generated']).toBe(1)
    expect(mix['total']).toBe(4)
    expect(mix['generation_escape_rate']).toBe(0.25)

    const guards = body.guard_events as Record<string, unknown>[]
    expect(guards).toContainEqual(
      expect.objectContaining({ type: 'pii_redaction', action: 'redacted', count: 1 }),
    )

    // Metadata-only contract: nothing shaped like a prompt or completion
    // may appear anywhere in the payload.
    expect(JSON.stringify(body)).not.toMatch(/"prompt"|"completion"|"content"/)
    await app.close()
  })

  it('honours the days window — old calls are out of scope', async () => {
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
    await db.collection('ai_task_calls').insertOne({
      task_id: 'assistant.answer.v1',
      model: 'm',
      ok: true,
      latency_ms: 5,
      processor: 'ollama',
      created_at: old,
    })
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/operator/ai-health?days=7' })
    const task = (res.json().tasks as Record<string, unknown>[]).find(
      (t) => t['task_id'] === 'assistant.answer.v1',
    )!
    expect(task['calls']).toBe(0)
    await app.close()
  })
})
