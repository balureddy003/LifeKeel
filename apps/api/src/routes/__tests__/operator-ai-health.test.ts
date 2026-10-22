import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'

import { registerOperatorRoutes } from '../operator.js'
import { initTaskGateway, taskLlm } from '../../ai/task-gateway.js'
import { invalidatePlatformConfigCache } from '../../operator/platform-config.js'
import { TaskDisabledError } from '@lifekeel/platform'

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
  // getPlatformConfig caches 10s process-wide — the drop leaves stale flags.
  invalidatePlatformConfigCache()
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
    await db
      .collection<{ _id: string; day: string; route: string; count: number; updated_at: Date }>(
        'assistant_answer_routes',
      )
      .insertMany([
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

  it('excludes disabled-refusals from failures and reports them separately', async () => {
    const now = new Date()
    await db.collection('ai_task_calls').insertMany([
      {
        task_id: 'assistant.answer.v1',
        model: 'm',
        ok: false,
        latency_ms: 0,
        outcome: 'disabled',
        processor: 'ollama',
        created_at: now,
      },
      {
        task_id: 'assistant.answer.v1',
        model: 'm',
        ok: false,
        latency_ms: 100,
        outcome: null,
        processor: 'ollama',
        created_at: now,
      },
      {
        task_id: 'assistant.answer.v1',
        model: 'm',
        ok: true,
        latency_ms: 100,
        processor: 'ollama',
        created_at: now,
      },
    ])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/operator/ai-health' })
    const task = (res.json().tasks as Record<string, unknown>[]).find(
      (t) => t['task_id'] === 'assistant.answer.v1',
    )!
    expect(task['calls']).toBe(3)
    expect(task['failures']).toBe(1)
    expect(task['disabled_refusals']).toBe(1)
    expect(task['failure_rate']).toBeCloseTo(1 / 3)
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

describe('POST /operator/ai-tasks/:taskId/state (PRD-217)', () => {
  const disabledTasks = async () =>
    (
      (await db.collection('platform_config').findOne({ key: 'global' })) as {
        ai_disabled_tasks?: string[]
      } | null
    )?.ai_disabled_tasks ?? []

  it('disables a task — audited, and the gateway refuses calls with TaskDisabledError', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/operator/ai-tasks/assistant.answer.v1/state',
      payload: { enabled: false, reason: 'provider incident — force fallback' },
    })
    expect(res.statusCode).toBe(200)
    expect(await disabledTasks()).toContain('assistant.answer.v1')

    const audit = await db
      .collection('operator_audit_log')
      .findOne({ action: 'operator.ai_task.disable' })
    expect(audit).toMatchObject({ target_id: 'assistant.answer.v1' })

    const health = await app.inject({ method: 'GET', url: '/operator/ai-health' })
    const task = (health.json().tasks as Record<string, unknown>[]).find(
      (t) => t['task_id'] === 'assistant.answer.v1',
    )!
    expect(task['disabled']).toBe(true)
    expect(health.json().disabled_tasks).toContain('assistant.answer.v1')

    // End-to-end: a governed call is refused before any provider contact.
    await expect(taskLlm('assistant.answer.v1', 'tenant-x')('s', 'p')).rejects.toBeInstanceOf(
      TaskDisabledError,
    )
    // The onCall telemetry row is fire-and-forget — poll briefly for it.
    let refusal = null
    for (let i = 0; i < 20 && !refusal; i++) {
      refusal = await db
        .collection('ai_task_calls')
        .findOne({ task_id: 'assistant.answer.v1', outcome: 'disabled' })
      if (!refusal) await new Promise((r) => setTimeout(r, 25))
    }
    expect(refusal).toBeTruthy()
    await app.close()
  })

  it('re-enables a disabled task', async () => {
    const app = await buildApp()
    await app.inject({
      method: 'POST',
      url: '/operator/ai-tasks/assistant.answer.v1/state',
      payload: { enabled: false, reason: 'incident' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/operator/ai-tasks/assistant.answer.v1/state',
      payload: { enabled: true, reason: 'provider recovered' },
    })
    expect(res.statusCode).toBe(200)
    expect(await disabledTasks()).not.toContain('assistant.answer.v1')
    await app.close()
  })

  it('rejects unknown tasks and no-op writes', async () => {
    const app = await buildApp()
    const unknown = await app.inject({
      method: 'POST',
      url: '/operator/ai-tasks/nope.v9/state',
      payload: { enabled: false, reason: 'test unknown' },
    })
    expect(unknown.statusCode).toBe(404)
    const noop = await app.inject({
      method: 'POST',
      url: '/operator/ai-tasks/assistant.answer.v1/state',
      payload: { enabled: true, reason: 'already on' },
    })
    expect(noop.statusCode).toBe(409)
    const badReason = await app.inject({
      method: 'POST',
      url: '/operator/ai-tasks/assistant.answer.v1/state',
      payload: { enabled: false, reason: 'x' },
    })
    expect(badReason.statusCode).toBe(400)
    await app.close()
  })

  it('lifekeel_infra_required tasks need a second operator — pending → confirm → execute', async () => {
    await db
      .collection('platform_operators')
      .insertOne({ user_id: 'operator-2', status: 'active', roles: ['operations'] })
    const requester = await buildApp('operator-1')
    const pending = await requester.inject({
      method: 'POST',
      url: '/operator/ai-tasks/assistant.answer.sensitive.v1/state',
      payload: { enabled: false, reason: 'quarantine task — needs eyes' },
    })
    expect(pending.statusCode).toBe(202)
    expect(pending.json().approval_required).toBe(true)
    const approvalId = pending.json().approval_id as string
    // The mutation has NOT happened yet.
    expect(await disabledTasks()).toEqual([])

    const confirmer = await buildApp('operator-2')
    const confirm = await confirmer.inject({
      method: 'POST',
      url: `/operator/dual-approvals/${approvalId}/confirm`,
      payload: { reason: 'looks right' },
    })
    expect(confirm.statusCode).toBe(200)

    // Requester retries — their confirmed approval is spent automatically.
    const retried = await requester.inject({
      method: 'POST',
      url: '/operator/ai-tasks/assistant.answer.sensitive.v1/state',
      payload: { enabled: false, reason: 'quarantine task — needs eyes' },
    })
    expect(retried.statusCode).toBe(200)
    expect(await disabledTasks()).toContain('assistant.answer.sensitive.v1')
    await requester.close()
    await confirmer.close()
  })

  it('denies operators without operations.manage', async () => {
    const app = await buildApp('user-2')
    const res = await app.inject({
      method: 'POST',
      url: '/operator/ai-tasks/assistant.answer.v1/state',
      payload: { enabled: false, reason: 'should not work' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})
