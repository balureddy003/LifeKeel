/**
 * Uses a real MongoDB (mongodb-memory-server) rather than a hand-rolled
 * mock, since atomicity of the underlying findOneAndUpdate/updateOne
 * preconditions is exactly the property under test — a mock would only
 * prove the code calls the right method, not that a crash mid-run or a
 * concurrent resume() actually can't double-execute a step. Same rationale
 * as apps/api/src/jobs/__tests__/cron-lock.test.ts.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { z } from 'zod'
import { defineWorkflow } from '../define-workflow.js'
import { WorkflowEngine } from '../workflow-engine.js'

const stateSchema = z.object({ amount: z.number().default(0), sent: z.boolean().default(false) })
type State = z.infer<typeof stateSchema>

const TENANT = 'tenant-1'

describe('WorkflowEngine', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
    db = client.db('workflow_engine_test')
  })

  afterEach(async () => {
    await client.close()
    await mongod.stop()
  })

  it('runs a plain linear workflow (no gate) straight to completion', async () => {
    const def = defineWorkflow<State>({
      id: 'w.plain',
      stateSchema,
      steps: [
        { id: 'a', kind: 'action', run: async ({ state }) => ({ state: { amount: state.amount + 1 } }) },
        { id: 'b', kind: 'action', run: async ({ state }) => ({ state: { amount: state.amount + 1 } }) },
      ],
    })
    const engine = new WorkflowEngine(db)
    const run = await engine.start(def, { tenantId: TENANT, initialState: { amount: 0 } })

    expect(run.status).toBe('completed')
    expect(run.state.amount).toBe(2)
  })

  it('pauses at an approval_gate and resumes only after approve()', async () => {
    const runCalls = vi.fn()
    const def = defineWorkflow<State>({
      id: 'w.gated',
      stateSchema,
      steps: [
        { id: 'prep', kind: 'action', run: async ({ state }) => ({ state: { amount: 10 } }) },
        { id: 'confirm', kind: 'approval_gate', describeForApproval: (s) => `send £${s.amount}` },
        {
          id: 'send',
          kind: 'action',
          sideEffect: true,
          run: async ({ state }) => {
            runCalls()
            return { state: { sent: true } }
          },
        },
      ],
    })
    const engine = new WorkflowEngine(db)
    const started = await engine.start(def, { tenantId: TENANT, initialState: { amount: 0 } })

    expect(started.status).toBe('awaiting_approval')
    expect(started.current_step_id).toBe('confirm')
    expect(runCalls).not.toHaveBeenCalled()

    // Resuming before approval is a no-op — still paused, side effect still not run.
    const stillPaused = await engine.resume(def, started.id, TENANT)
    expect(stillPaused.status).toBe('awaiting_approval')
    expect(runCalls).not.toHaveBeenCalled()

    await engine.approve(started.id, { tenantId: TENANT, approvedBy: 'user-1' })
    const finished = await engine.resume(def, started.id, TENANT)

    expect(finished.status).toBe('completed')
    expect(finished.state.sent).toBe(true)
    expect(runCalls).toHaveBeenCalledTimes(1)
  })

  it('reject() leaves the run in a terminal, non-resumable state', async () => {
    const runCalls = vi.fn()
    const def = defineWorkflow<State>({
      id: 'w.rejected',
      stateSchema,
      steps: [
        { id: 'confirm', kind: 'approval_gate', describeForApproval: () => 'approve?' },
        { id: 'send', kind: 'action', sideEffect: true, run: async () => { runCalls(); return { state: {} } } },
      ],
    })
    const engine = new WorkflowEngine(db)
    const started = await engine.start(def, { tenantId: TENANT, initialState: {} })

    await engine.reject(started.id, { tenantId: TENANT, rejectedBy: 'user-1', reason: 'not needed' })
    const after = await engine.getRun<State>(started.id, TENANT)
    expect(after!.status).toBe('rejected')

    // resume() on a rejected run is a no-op — never reaches the side-effect step.
    const resumed = await engine.resume(def, started.id, TENANT)
    expect(resumed.status).toBe('rejected')
    expect(runCalls).not.toHaveBeenCalled()
  })

  it('a failed step lands the run in "failed" and resume() retries only that step', async () => {
    let attempts = 0
    const def = defineWorkflow<State>({
      id: 'w.retry',
      stateSchema,
      steps: [
        {
          id: 'flaky',
          kind: 'action',
          run: async () => {
            attempts += 1
            if (attempts === 1) throw new Error('transient failure')
            return { state: { amount: 1 } }
          },
        },
      ],
    })
    const engine = new WorkflowEngine(db)
    const started = await engine.start(def, { tenantId: TENANT, initialState: {} })
    expect(started.status).toBe('failed')
    expect(started.error).toContain('transient failure')

    const retried = await engine.resume(def, started.id, TENANT)
    expect(retried.status).toBe('completed')
    expect(retried.state.amount).toBe(1)
    expect(attempts).toBe(2)
  })

  it('idempotency: rewinding current_step_id to an already-succeeded step never re-invokes it', async () => {
    const runCalls = vi.fn()
    const def = defineWorkflow<State>({
      id: 'w.crash-recovery',
      stateSchema,
      steps: [
        { id: 'first', kind: 'action', run: async () => { runCalls('first'); return { state: { amount: 1 } } } },
        { id: 'second', kind: 'action', run: async () => { runCalls('second'); return { state: { amount: 2 } } } },
      ],
    })
    const engine = new WorkflowEngine(db)
    const started = await engine.start(def, { tenantId: TENANT, initialState: {} })
    expect(started.status).toBe('completed')
    expect(runCalls).toHaveBeenCalledTimes(2)

    // Rewind as if the run doc's pointer never advanced past 'first', even
    // though both steps already have durable 'succeeded' step-run records —
    // the worst case for accidental double-execution.
    await db.collection('workflow_runs').updateOne(
      { id: started.id },
      { $set: { status: 'running', current_step_id: 'first' } },
    )
    runCalls.mockClear()
    const resumed = await engine.resume(def, started.id, TENANT)

    expect(resumed.status).toBe('completed')
    expect(resumed.state.amount).toBe(2)
    // Both steps already had a 'succeeded' step-run record — neither is re-invoked.
    expect(runCalls).not.toHaveBeenCalled()
  })

  it('a genuine crash (no step-run record yet for the current step) safely re-executes just that step', async () => {
    let attempts = 0
    const def = defineWorkflow<State>({
      id: 'w.genuine-crash',
      stateSchema,
      steps: [
        { id: 'first', kind: 'action', run: async () => ({ state: { amount: 1 } }) },
        {
          id: 'second',
          kind: 'action',
          run: async () => {
            attempts += 1
            return { state: { amount: 2 } }
          },
        },
      ],
    })
    const engine = new WorkflowEngine(db)
    const started = await engine.start(def, { tenantId: TENANT, initialState: {} })
    expect(started.status).toBe('completed')
    expect(attempts).toBe(1)

    // Simulate a crash that happened during 'second' on an earlier pass,
    // before its step-run record was ever written: current_step_id had
    // already durably advanced to 'second', but nothing recorded it yet.
    await db.collection('workflow_step_runs').deleteOne({ run_id: started.id, step_id: 'second' })
    await db.collection('workflow_runs').updateOne(
      { id: started.id },
      { $set: { status: 'running', current_step_id: 'second' } },
    )
    const resumed = await engine.resume(def, started.id, TENANT)

    expect(resumed.status).toBe('completed')
    expect(attempts).toBe(2) // re-executed exactly once, not skipped and not looping
  })

  it('a concurrent resume() race lets exactly one caller advance a given step', async () => {
    let attempts = 0
    const def = defineWorkflow<State>({
      id: 'w.race',
      stateSchema,
      steps: [
        {
          id: 'slow',
          kind: 'action',
          run: async () => {
            attempts += 1
            await new Promise((r) => setTimeout(r, 20))
            return { state: { amount: attempts } }
          },
        },
      ],
    })
    const engine = new WorkflowEngine(db)
    const started = await engine.start(def, { tenantId: TENANT, initialState: {} })
    expect(started.status).toBe('completed') // start() already ran it once

    // Force it back to 'running' at the same step to simulate two racing resumers.
    await db.collection('workflow_runs').updateOne({ id: started.id }, { $set: { status: 'running' } })
    const [r1, r2] = await Promise.all([
      engine.resume(def, started.id, TENANT),
      engine.resume(def, started.id, TENANT),
    ])
    expect([r1.status, r2.status]).toContain('completed')
  })
})
