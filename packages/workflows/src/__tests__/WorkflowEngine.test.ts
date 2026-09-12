/**
 * WorkflowEngine integration tests
 *
 * Tests: run lifecycle, multi-tenant isolation, attribution wiring,
 *        sequential + conditional execution, human-approval interrupt.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorkflowEngine } from '../engine/WorkflowEngine.js'
import { NodeExecutor, InterruptSignal } from '../nodes/NodeExecutor.js'
import type { WorkflowDef, EventPayload } from '../types.js'
import type { Db, Collection } from 'mongodb'

// ─── Stubs ────────────────────────────────────────────────────────────────────

function makeCollection(name: string) {
  const docs: Record<string, unknown>[] = []
  return {
    _name: name,
    _docs: docs,
    createIndex: vi.fn(async () => 'index_name'),
    insertOne: vi.fn(async (doc: Record<string, unknown>) => { docs.push({ ...doc }) }),
    updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
      const d = docs.find(d => d['id'] === filter['id'] || d['run_id'] === filter['run_id'])
      if (d && update['$set']) Object.assign(d, update['$set'])
    }),
    findOne: vi.fn(async (filter: Record<string, unknown>) =>
      docs.find(d => d['id'] === filter['id']) ?? null
    ),
    find: vi.fn(() => ({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: async () => [...docs],
    })),
    aggregate: vi.fn(() => ({ toArray: async () => [] })),
  }
}

function makeDb(): { db: Db; runs: ReturnType<typeof makeCollection>; approvals: ReturnType<typeof makeCollection>; attributions: ReturnType<typeof makeCollection> } {
  const runs = makeCollection('workflow_runs')
  const approvals = makeCollection('workflow_approvals')
  const attributions = makeCollection('workflow_attributions')
  const db = {
    collection: vi.fn((name: string) => {
      if (name === 'workflow_runs') return runs
      if (name === 'workflow_approvals') return approvals
      if (name === 'workflow_attributions') return attributions
      return makeCollection(name)
    }),
  } as unknown as Db
  return { db, runs, approvals, attributions }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const simpleWorkflow: WorkflowDef = {
  id: 'test-wf-1',
  name: 'Simple Test Workflow',
  version: '1.0.0',
  enabled: true,
  trigger: { event_type: 'test.event' },
  state: { counter: 0 },
  nodes: [
    { id: 'n_trigger', type: 'trigger', label: 'Trigger', config: {} },
    { id: 'n_set', type: 'set_variable', label: 'Set Var', config: { key: 'processed', value: 'true' } },
  ],
  edges: [{ from: 'n_trigger', to: 'n_set' }],
} as WorkflowDef

const testEvent: EventPayload = {
  id: 'evt-001',
  event_type: 'test.event',
  tenant_id: 'tenant-test',
  data: { amount: 500, customer: 'ACME' },
  created_at: new Date(),
}

// ─────────────────────────────────────────────────────────────────────────────

describe('WorkflowEngine', () => {
  let db: Db
  let runs: ReturnType<typeof makeCollection>
  let attributions: ReturnType<typeof makeCollection>
  let engine: WorkflowEngine

  beforeEach(() => {
    const mocks = makeDb()
    db = mocks.db
    runs = mocks.runs
    attributions = mocks.attributions

    engine = new WorkflowEngine({
      db,
      llmFn: vi.fn(async () => 'mocked LLM response'),
      notifyFn: vi.fn(async () => {}),
      sseBroadcast: vi.fn(),
    })
  })

  it('start() inserts a run record with correct tenant_id', async () => {
    const run = await engine.start(simpleWorkflow, testEvent, 'tenant-A')
    expect(run.tenant_id).toBe('tenant-A')
    expect(run.workflow_id).toBe('test-wf-1')
    expect(run.status).toBe('running')
    expect(runs.insertOne).toHaveBeenCalledOnce()
    const [insertedDoc] = runs.insertOne.mock.calls[0] as [Record<string, unknown>]
    expect(insertedDoc['tenant_id']).toBe('tenant-A')
  })

  it('start() calls attribution.initRun (non-blocking)', async () => {
    await engine.start(simpleWorkflow, testEvent, 'tenant-A')
    // Give async attribution a tick to settle
    await new Promise(r => setTimeout(r, 20))
    // attributions.updateOne should have been called with the correct tenant
    const calls = attributions.updateOne.mock.calls as unknown as [unknown, Record<string, Record<string, unknown>>][]
    expect(calls.length).toBeGreaterThanOrEqual(1)
    const [, update] = calls[0]!
    // tenant_id lives in $set per the upsert pattern
    expect(update['$set']?.['tenant_id']).toBe('tenant-A')
  })

  it('records the completion outcome as converted for a workflow with no approval gate', async () => {
    // Regression test: execute() used to hardcode 'pending' as the
    // attribution outcome for every completed run regardless of what
    // actually happened, so /attribution never showed a single converted
    // or dismissed run — everything sat as "pending" forever.
    const run = await engine.start(simpleWorkflow, testEvent, 'tenant-A')
    await new Promise(resolve => setTimeout(resolve, 20))
    const calls = attributions.updateOne.mock.calls as unknown as [Record<string, unknown>, { $set?: Record<string, unknown> }][]
    const completionCall = calls.find(([filter, update]) => filter['run_id'] === run.id && update.$set?.['outcome'] === 'converted')
    expect(completionCall).toBeDefined()
  })

  it('records the completion outcome as dismissed when the resolved action is a dismiss/reject', async () => {
    const approvalWorkflow: WorkflowDef = {
      id: 'test-wf-approval',
      name: 'Approval Test Workflow',
      version: '1.0.0',
      enabled: true,
      trigger: { event_type: 'test.event' },
      state: {},
      nodes: [
        { id: 'n_trigger', type: 'trigger', label: 'Trigger', config: {} },
        {
          id: 'n_approve',
          type: 'human_approval',
          label: 'Approval',
          config: {
            title: 'Needs approval',
            timeout: '24h',
            timeout_action: 'escalate',
            display: [],
            actions: [{ id: 'approve', label: 'Approve', style: 'primary' }, { id: 'dismiss', label: 'Dismiss', style: 'danger' }],
          },
        },
      ],
      edges: [{ from: 'n_trigger', to: 'n_approve' }],
    } as WorkflowDef

    const run = await engine.start(approvalWorkflow, testEvent, 'tenant-A')
    await new Promise(resolve => setTimeout(resolve, 20)) // settle to waiting_approval

    await engine.resume(approvalWorkflow, run.id, 'n_approve', 'dismiss', 'tenant-A')
    await new Promise(resolve => setTimeout(resolve, 20)) // settle to completed

    const calls = attributions.updateOne.mock.calls as unknown as [Record<string, unknown>, { $set?: Record<string, unknown> }][]
    const completionCall = calls.find(([filter, update]) => filter['run_id'] === run.id && update.$set?.['outcome'] === 'dismissed')
    expect(completionCall).toBeDefined()
  })

  it('multi-tenant isolation — run from tenant-A is not visible to tenant-B query', async () => {
    await engine.start(simpleWorkflow, { ...testEvent, tenant_id: 'tenant-A' }, 'tenant-A')
    await engine.start(simpleWorkflow, { ...testEvent, tenant_id: 'tenant-B' }, 'tenant-B')

    const runsByA = await engine.getRunsByTenant('tenant-A')
    const runsByB = await engine.getRunsByTenant('tenant-B')

    // Both should be present in the stub (stub doesn't filter, engine does via find filter)
    // Verify the inserted docs have correct tenant_id
    const insertedTenants = (runs.insertOne.mock.calls as [Record<string, unknown>][])
      .map(([doc]) => doc['tenant_id'])
    expect(insertedTenants).toContain('tenant-A')
    expect(insertedTenants).toContain('tenant-B')

    // Verify getRunsByTenant passes the correct filter
    const findCalls = runs.find.mock.calls as unknown as [Record<string, unknown>][]
    expect(findCalls.some(([f]) => f['tenant_id'] === 'tenant-A')).toBe(true)
    expect(findCalls.some(([f]) => f['tenant_id'] === 'tenant-B')).toBe(true)
  })

  it('event data is injected into initial state as event_ prefixed keys', async () => {
    const run = await engine.start(simpleWorkflow, testEvent, 'tenant-A')
    expect(run.state['event_amount']).toBe(500)
    expect(run.state['event_customer']).toBe('ACME')
  })

  it('getRun returns null for unknown run id', async () => {
    const result = await engine.getRun('nonexistent-id')
    expect(result).toBeNull()
  })

  it('resume() throws when run is not in waiting_approval state', async () => {
    // Insert a run in 'running' state
    runs._docs.push({ id: 'run-x', status: 'running', tenant_id: 'tenant-A', state: {} })
    await expect(
      engine.resume(simpleWorkflow, 'run-x', 'n1', 'approve', 'tenant-A')
    ).rejects.toThrow(/not waiting for approval/)
  })

  it('max_auto_approve_per_day cap causes third auto-approval to become dismiss', async () => {
    // Create a workflow with human_approval node that has max_auto_approve_per_day
    const workflowWithCap: WorkflowDef = {
      id: 'test-cap',
      name: 'Test Cap',
      version: '1.0.0',
      enabled: true,
      trigger: { detector: 'test', condition: 'true' },
      state: {},
      nodes: [
        { id: 'n1', type: 'trigger', label: 'Trigger', config: {} },
        { 
          id: 'n2', 
          type: 'human_approval', 
          label: 'Approval',
          config: {
            title: 'Needs approval',
            timeout: '24h',
            timeout_action: 'auto_approve',
            max_auto_approve_per_day: 2,
            display: [],
            actions: [{ id: 'approve', label: 'Approve', style: 'primary' }]
          }
        },
      ],
      edges: [{ from: 'n1', to: 'n2' }],
    }

    // Simulate auto-approvals exceeding the cap
    const counterKey = '__auto_approve_count_test-cap_' + new Date().toDateString()
    const execCtx = {
      runId: 'run-1',
      tenantId: 'tenant-A',
      workflowId: 'test-cap',
      workflowName: 'Test Cap',
      triggerEvent: {
        id: 'evt-test',
        tenant_id: 'tenant-A',
        event_type: 'test.event',
        data: {},
        created_at: new Date(),
      },
      nodeOutputs: {
        [counterKey]: 2, // Already at cap
      },
      pendingApproval: { nodeId: 'n2', action: 'auto_approve' },
      fetchFn: vi.fn(),
      llmFn: vi.fn(),
      notifyFn: vi.fn(),
    }

    const executor = new NodeExecutor(execCtx)
    const result = await executor.execute(workflowWithCap.nodes[1]!, {
      __run_id: 'run-1',
      __tenant_id: 'tenant-A',
      __workflow_id: 'test-cap',
      __current_node: 'n2',
    })

    // Should fall back to auto_dismiss when cap is exceeded
    expect(result.__outcome).toBe('auto_dismiss')
  })

  it('conditioned fan-out only runs the branch whose edge condition is true', async () => {
    // Regression test: buildExecutionOrder's topology-only BFS puts both
    // targets of a conditioned fan-out (two edges from one node, each with a
    // different condition, to two different nodes) in the same execution
    // wave — isParallel becomes true, and the parallel branch used to run
    // every node in the wave via Promise.allSettled without ever checking
    // shouldRunNode(), ignoring the conditions entirely.
    const fanOutWorkflow: WorkflowDef = {
      id: 'test-fanout',
      name: 'Fan-out Test',
      version: '1.0.0',
      enabled: true,
      trigger: { event_type: 'test.event' },
      state: {},
      nodes: [
        { id: 'n1', type: 'trigger', label: 'Trigger', config: {} },
        { id: 'n2a', type: 'transform', label: 'Branch A', config: { mappings: { ran_a: 'true' } } },
        { id: 'n2b', type: 'transform', label: 'Branch B', config: { mappings: { ran_b: 'true' } } },
      ],
      edges: [
        { from: 'n1', to: 'n2a', condition: 'event_choice == "a"' },
        { from: 'n1', to: 'n2b', condition: 'event_choice == "b"' },
      ],
    } as WorkflowDef

    const run = await engine.start(fanOutWorkflow, {
      id: 'evt-fanout',
      event_type: 'test.event',
      tenant_id: 'tenant-A',
      data: { choice: 'a' },
      created_at: new Date(),
    }, 'tenant-A')

    // start() fires execute() without awaiting it (so the caller gets the
    // run record back immediately), and execute() works off a local shallow
    // copy of state — the returned `run` object is never mutated. The final
    // state only lands in the DB via updateRun() at the end of the run, so
    // wait for that background chain to settle and read it back from there.
    await new Promise(resolve => setTimeout(resolve, 20))
    const finalRun = runs._docs.find(d => d['id'] === run.id) as { state: Record<string, unknown> }

    expect(finalRun.state['ran_a']).toBe('true')
    expect(finalRun.state['ran_b']).toBeUndefined()
  })
})

// ─── Autonomous trading: auto_approve_condition + trade_intent ────────────────
// See the "Autonomous trade execution" plan — human_approval's
// auto_approve_condition bypasses the InterruptSignal entirely when the
// tenant has opted in, and trade_intent is a pure pass-through unless the
// upstream node set __outcome to an auto-execution outcome.

function makeApprovalNode(config: Record<string, unknown> = {}) {
  return {
    id: 'human_review',
    type: 'human_approval' as const,
    label: 'Review',
    config: {
      title: 'Needs approval',
      timeout: '24h',
      timeout_action: 'escalate',
      display: [],
      actions: [{ id: 'approve', label: 'Approve', style: 'primary' as const }],
      ...config,
    },
  }
}

function makeExecCtx(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-1',
    tenantId: 'tenant-A',
    workflowId: 'wf-1',
    workflowName: 'Test',
    triggerEvent: {
      id: 'evt-1',
      tenant_id: 'tenant-A',
      event_type: 'detector_signal',
      detector_id: 'trading_concentration_risk',
      data: { ticker: 'AAPL', auto_trading_enabled: true },
      created_at: new Date(),
    },
    nodeOutputs: {},
    fetchFn: vi.fn(),
    llmFn: vi.fn(),
    notifyFn: vi.fn(),
    ...overrides,
  }
}

function makeState(fields: Record<string, unknown> = {}) {
  return {
    __run_id: 'run-1',
    __tenant_id: 'tenant-A',
    __workflow_id: 'wf-1',
    __current_node: 'human_review',
    ...fields,
  }
}

describe('human_approval — auto_approve_condition', () => {
  it('bypasses the approval gate and sets __outcome when the condition is true', async () => {
    const node = makeApprovalNode({ auto_approve_condition: 'event_auto_trading_enabled', auto_approve_outcome: 'auto_execute' })
    const executor = new NodeExecutor(makeExecCtx() as never)
    const result = await executor.execute(node, makeState({ event_auto_trading_enabled: true }) as never)
    expect(result.__outcome).toBe('auto_execute')
  })

  it('defaults auto_approve_outcome to "auto_execute" when not specified', async () => {
    const node = makeApprovalNode({ auto_approve_condition: 'event_auto_trading_enabled' })
    const executor = new NodeExecutor(makeExecCtx() as never)
    const result = await executor.execute(node, makeState({ event_auto_trading_enabled: true }) as never)
    expect(result.__outcome).toBe('auto_execute')
  })

  it('still suspends for human approval when the condition is false', async () => {
    const node = makeApprovalNode({ auto_approve_condition: 'event_auto_trading_enabled' })
    const executor = new NodeExecutor(makeExecCtx() as never)
    await expect(executor.execute(node, makeState({ event_auto_trading_enabled: false }) as never)).rejects.toBeInstanceOf(InterruptSignal)
  })

  it('falls back to human approval when the condition expression fails to evaluate (unknown property)', async () => {
    const node = makeApprovalNode({ auto_approve_condition: 'event_auto_trading_enabled' })
    const executor = new NodeExecutor(makeExecCtx() as never)
    // No auto_trading_enabled key in state at all — filtrex returns the
    // internal UnknownPropertyError as a truthy non-boolean value instead of
    // throwing; the === true check in NodeExecutor must treat that as false.
    await expect(executor.execute(node, makeState() as never)).rejects.toBeInstanceOf(InterruptSignal)
  })

  it('behaves exactly as before when auto_approve_condition is absent (suspends for approval)', async () => {
    const node = makeApprovalNode()
    const executor = new NodeExecutor(makeExecCtx() as never)
    await expect(executor.execute(node, makeState() as never)).rejects.toBeInstanceOf(InterruptSignal)
  })
})

describe('trade_intent node', () => {
  const tradeIntentNode = { id: 'trade_intent', type: 'trade_intent' as const, label: 'Create pending trade', config: {} }

  it('is a no-op when __outcome is not an execution outcome (auto_execute or propose_trim)', async () => {
    const createPendingTradeFn = vi.fn()
    const executor = new NodeExecutor(makeExecCtx({ createPendingTradeFn }) as never)
    const result = await executor.execute(tradeIntentNode, makeState({ __outcome: 'log_reviewed' }) as never)
    expect(result).toEqual({})
    expect(createPendingTradeFn).not.toHaveBeenCalled()
  })

  it('gap #8: calls createPendingTradeFn with origin="manual" when __outcome is propose_trim', async () => {
    // Gap #8 (TRADING_ENGINE_GAPS.md): the manual approval path was a dead
    // end — clicking 'Propose trim to target weight' (action id: propose_trim)
    // only sent a Slack notification, never created a trade. Now
    // runTradeIntent also fires on propose_trim, with origin='manual' to
    // distinguish it from the autonomous bypass (origin='auto').
    const createPendingTradeFn = vi.fn(async () => ({ created: true, tradeId: 'trade-manual-1' }))
    const executor = new NodeExecutor(makeExecCtx({ createPendingTradeFn }) as never)
    const result = await executor.execute(tradeIntentNode, makeState({ __outcome: 'propose_trim' }) as never)
    expect(createPendingTradeFn).toHaveBeenCalledWith({
      tenantId: 'tenant-A',
      detectorId: 'trading_concentration_risk',
      eventData: { ticker: 'AAPL', auto_trading_enabled: true },
      origin: 'manual',
      sourceEventId: 'evt-1',
      sourceInsightId: undefined,
      goalId: undefined,
    })
    expect(result.__trade_intent_created).toBe(true)
    expect(result.__trade_intent_id).toBe('trade-manual-1')
  })

  it('is a no-op when no createPendingTradeFn is injected, even if __outcome is auto_execute', async () => {
    const executor = new NodeExecutor(makeExecCtx() as never)
    const result = await executor.execute(tradeIntentNode, makeState({ __outcome: 'auto_execute' }) as never)
    expect(result).toEqual({})
  })

  it('calls createPendingTradeFn with tenant/detector/event data when __outcome is auto_execute', async () => {
    const createPendingTradeFn = vi.fn(async () => ({ created: true, tradeId: 'trade-123' }))
    const executor = new NodeExecutor(makeExecCtx({ createPendingTradeFn }) as never)
    const result = await executor.execute(tradeIntentNode, makeState({ __outcome: 'auto_execute' }) as never)
    expect(createPendingTradeFn).toHaveBeenCalledWith({
      tenantId: 'tenant-A',
      detectorId: 'trading_concentration_risk',
      eventData: { ticker: 'AAPL', auto_trading_enabled: true },
      origin: 'auto',
      // gap #25: the triggering event id is threaded through so the trade
      // record can be linked back to the detector event that caused it.
      sourceEventId: 'evt-1',
      sourceInsightId: undefined,
      goalId: undefined,
    })
    expect(result.__trade_intent_created).toBe(true)
    expect(result.__trade_intent_id).toBe('trade-123')
  })

  it('threads sourceInsightId through when the trigger event carries one (gap #25)', async () => {
    const createPendingTradeFn = vi.fn(async () => ({ created: true, tradeId: 'trade-456' }))
    const executor = new NodeExecutor(makeExecCtx({
      createPendingTradeFn,
      triggerEvent: {
        id: 'evt-2',
        tenant_id: 'tenant-A',
        event_type: 'detector_signal',
        detector_id: 'trading_price_drop_alert',
        insight_id: 'insight-abc',
        data: { ticker: 'TSLA', auto_trading_enabled: true },
        created_at: new Date(),
      },
    }) as never)
    await executor.execute(tradeIntentNode, makeState({ __outcome: 'auto_execute' }) as never)
    expect(createPendingTradeFn).toHaveBeenCalledWith({
      tenantId: 'tenant-A',
      detectorId: 'trading_price_drop_alert',
      eventData: { ticker: 'TSLA', auto_trading_enabled: true },
      origin: 'auto',
      sourceEventId: 'evt-2',
      sourceInsightId: 'insight-abc',
      goalId: undefined,
    })
  })

  it('reports failure without throwing when createPendingTradeFn rejects', async () => {
    const createPendingTradeFn = vi.fn(async () => { throw new Error('db unavailable') })
    const executor = new NodeExecutor(makeExecCtx({ createPendingTradeFn }) as never)
    const result = await executor.execute(tradeIntentNode, makeState({ __outcome: 'auto_execute' }) as never)
    expect(result.__trade_intent_created).toBe(false)
    expect(String(result.__trade_intent_error)).toContain('db unavailable')
  })

  it('gap #32: threads goal_id from trigger event data into createPendingTradeFn', async () => {
    const createPendingTradeFn = vi.fn(async () => ({ created: true, tradeId: 'trade-goal-1' }))
    const executor = new NodeExecutor(makeExecCtx({
      createPendingTradeFn,
      triggerEvent: {
        id: 'evt-3',
        tenant_id: 'tenant-A',
        event_type: 'detector_signal',
        detector_id: 'trading_concentration_risk',
        insight_id: 'insight-xyz',
        data: { ticker: 'MSFT', auto_trading_enabled: true, goal_id: 'goal-42' },
        created_at: new Date(),
      },
    }) as never)
    await executor.execute(tradeIntentNode, makeState({ __outcome: 'auto_execute' }) as never)
    expect(createPendingTradeFn).toHaveBeenCalledWith({
      tenantId: 'tenant-A',
      detectorId: 'trading_concentration_risk',
      eventData: { ticker: 'MSFT', auto_trading_enabled: true, goal_id: 'goal-42' },
      origin: 'auto',
      sourceEventId: 'evt-3',
      sourceInsightId: 'insight-xyz',
      goalId: 'goal-42',
    })
  })
})
