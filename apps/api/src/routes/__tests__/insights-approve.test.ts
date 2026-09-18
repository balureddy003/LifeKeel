/**
 * POST /insights/:id/approve and POST /insights/:id/retry-execution.
 *
 * Durable propose→commit: approve durably records 'approved' before actions
 * execute, then a second atomic transition flips to 'completed' or
 * 'execution_failed' depending on whether execution actually succeeded —
 * unlike the old behavior, which marked 'completed' before execution ran and
 * silently swallowed any failure. retry-execution is the recovery path for
 * an insight stuck in 'execution_failed'.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerInsightRoutes } from '../insights.js'

const TENANT = 'tenant-approve-test'
const INSIGHT_ID = 'insight-1'

const executeMock = vi.fn()

vi.mock('../../actions/action-executor.js', () => ({
  // A regular function, not an arrow function — mockImplementation's target
  // gets invoked with `new`, and arrow functions can't be constructors.
  ActionExecutor: vi.fn().mockImplementation(function ActionExecutorMock() {
    return { execute: executeMock, getReceipts: vi.fn(async () => []) }
  }),
}))

vi.mock('@agentoak/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentoak/platform')>()
  return {
    ...actual,
    ApprovalSignalHealthMonitor: vi.fn().mockImplementation(function ApprovalSignalHealthMonitorMock() {
      return { shouldPauseLearning: vi.fn(async () => false) }
    }),
  }
})

vi.mock('../../verified-moments.js', () => ({
  recordMomentDecision: vi.fn(async () => {}),
}))

vi.mock('../../outcomes/causal-experiments.js', () => ({
  startGoalExperimentsForApproval: vi.fn(async () => []),
}))

vi.mock('../../db.js', () => ({
  getInsightsCollection: vi.fn(),
  getReceiptsCollection: vi.fn(),
}))

function makeInsightsCol(insight: Record<string, unknown>) {
  let state = insight['state']
  return {
    findOneAndUpdate: vi.fn(async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      if (filter['id'] !== insight['id'] || filter['tenant_id'] !== insight['tenant_id']) return null
      if (filter['state'] !== undefined && filter['state'] !== state) return null
      const set = (update['$set'] as Record<string, unknown>) ?? {}
      state = set['state'] ?? state
      return { ...insight, ...set, state }
    }),
  }
}

function makeDb() {
  const insightsColRaw = { countDocuments: vi.fn(async () => 0), find: () => ({ toArray: async () => [] }) }
  const tenantSettingsCol = { findOne: vi.fn(async () => null) }
  const tenantsCol = { findOne: vi.fn(async () => null) }
  const verifiedMomentsCol = { updateOne: vi.fn(async () => ({ acknowledged: true })) }
  return {
    collection: (name: string) => {
      switch (name) {
        case 'insights': return insightsColRaw
        case 'tenant_settings': return tenantSettingsCol
        case 'tenants': return tenantsCol
        case 'verified_moments': return verifiedMomentsCol
        default: return { findOne: vi.fn(async () => null), updateOne: vi.fn(async () => ({})), insertOne: vi.fn(async () => ({})) }
      }
    },
  } as any
}

async function buildApp(insight: Record<string, unknown>, opts: { withDb?: boolean } = {}) {
  const { getInsightsCollection, getReceiptsCollection } = await import('../../db.js')
  const col = makeInsightsCol(insight)
  vi.mocked(getInsightsCollection).mockResolvedValue(col as any)
  vi.mocked(getReceiptsCollection).mockResolvedValue({ insertOne: vi.fn(async () => ({})) } as any)

  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: 'user-1' }
  })
  await registerInsightRoutes(app, {} as any, undefined, opts.withDb ? makeDb() : undefined)
  return { app, col }
}

const BASE_INSIGHT = {
  id: INSIGHT_ID,
  tenant_id: TENANT,
  detector_id: 'family_protection_gap',
  hypothesis: 'h',
  reasoning: 'r',
  actions: ['Send an email reminder'],
  confidence_breakdown: { combined_score: 0.7 },
  state: 'identified',
}

describe('POST /insights/:id/approve', () => {
  beforeEach(() => {
    executeMock.mockReset()
  })

  it('with no configured executor (db-less deployment), completes immediately — matches prior behavior', async () => {
    const { app, col } = await buildApp({ ...BASE_INSIGHT })
    const res = await app.inject({ method: 'POST', url: `/insights/${INSIGHT_ID}/approve`, payload: {} })

    expect(res.statusCode).toBe(200)
    expect(res.json().insight.state).toBe('completed')
    // Two atomic transitions: identified -> approved -> completed.
    expect(col.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(col.findOneAndUpdate.mock.calls[0]![0]).toMatchObject({ state: 'identified' })
    expect(col.findOneAndUpdate.mock.calls[0]![1].$set).toMatchObject({ state: 'approved' })
    expect(col.findOneAndUpdate.mock.calls[1]![0]).toMatchObject({ state: 'approved' })
    expect(col.findOneAndUpdate.mock.calls[1]![1].$set).toMatchObject({ state: 'completed' })
  })

  it('all actions succeeding flips approved -> completed', async () => {
    executeMock.mockResolvedValue({
      insight_id: INSIGHT_ID,
      receipts: [{ id: 'r1', outcome: 'executed' }],
      succeeded: 1, failed: 0, skipped: 0,
    })
    const { app } = await buildApp({ ...BASE_INSIGHT }, { withDb: true })
    const res = await app.inject({ method: 'POST', url: `/insights/${INSIGHT_ID}/approve`, payload: {} })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.insight.state).toBe('completed')
    expect(body.message).toBe('Insight approved')
  })

  it('a failing action flips approved -> execution_failed instead of silently completing', async () => {
    executeMock.mockResolvedValue({
      insight_id: INSIGHT_ID,
      receipts: [{ id: 'r1', outcome: 'execution_failed', outcome_reason: 'SendGrid not connected' }],
      succeeded: 0, failed: 1, skipped: 0,
    })
    const { app } = await buildApp({ ...BASE_INSIGHT }, { withDb: true })
    const res = await app.inject({ method: 'POST', url: `/insights/${INSIGHT_ID}/approve`, payload: {} })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.insight.state).toBe('execution_failed')
    expect(body.message).toMatch(/failed to execute/i)
  })

  it('the executor throwing entirely also lands in execution_failed, not completed', async () => {
    executeMock.mockRejectedValue(new Error('boom'))
    const { app } = await buildApp({ ...BASE_INSIGHT }, { withDb: true })
    const res = await app.inject({ method: 'POST', url: `/insights/${INSIGHT_ID}/approve`, payload: {} })

    expect(res.statusCode).toBe(200)
    expect(res.json().insight.state).toBe('execution_failed')
  })

  it('attributes the approval to the approving user (approved_by / approved_at)', async () => {
    const { app, col } = await buildApp({ ...BASE_INSIGHT })
    const res = await app.inject({ method: 'POST', url: `/insights/${INSIGHT_ID}/approve`, payload: {} })

    expect(res.statusCode).toBe(200)
    const approveSet = col.findOneAndUpdate.mock.calls[0]![1].$set as Record<string, unknown>
    expect(approveSet['approved_by']).toBe('user-1')
    expect(approveSet['approved_at']).toBeInstanceOf(Date)
  })

  it('returns 404 when the insight is not in identified state', async () => {
    const { app } = await buildApp({ ...BASE_INSIGHT, state: 'completed' })
    const res = await app.inject({ method: 'POST', url: `/insights/${INSIGHT_ID}/approve`, payload: {} })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /insights/:id/retry-execution', () => {
  beforeEach(() => {
    executeMock.mockReset()
  })

  it('returns 404 when the insight is not in execution_failed state', async () => {
    const { app } = await buildApp({ ...BASE_INSIGHT, state: 'identified' }, { withDb: true })
    const res = await app.inject({ method: 'POST', url: `/insights/${INSIGHT_ID}/retry-execution` })
    expect(res.statusCode).toBe(404)
  })

  it('retries execution and flips to completed when the retry succeeds', async () => {
    executeMock.mockResolvedValue({
      insight_id: INSIGHT_ID,
      receipts: [{ id: 'r1', outcome: 'executed' }],
      succeeded: 1, failed: 0, skipped: 0,
    })
    const { app, col } = await buildApp({ ...BASE_INSIGHT, state: 'execution_failed' }, { withDb: true })
    const res = await app.inject({ method: 'POST', url: `/insights/${INSIGHT_ID}/retry-execution` })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.insight.state).toBe('completed')
    expect(body.message).toBe('All actions completed')
    // execution_failed -> approved -> completed
    expect(col.findOneAndUpdate.mock.calls[0]![0]).toMatchObject({ state: 'execution_failed' })
    expect(col.findOneAndUpdate.mock.calls[0]![1].$set).toMatchObject({ state: 'approved' })
  })

  it('stays execution_failed when the retry still fails', async () => {
    executeMock.mockResolvedValue({
      insight_id: INSIGHT_ID,
      receipts: [{ id: 'r1', outcome: 'execution_ambiguous' }],
      succeeded: 0, failed: 1, skipped: 0,
    })
    const { app } = await buildApp({ ...BASE_INSIGHT, state: 'execution_failed' }, { withDb: true })
    const res = await app.inject({ method: 'POST', url: `/insights/${INSIGHT_ID}/retry-execution` })

    expect(res.statusCode).toBe(200)
    expect(res.json().insight.state).toBe('execution_failed')
  })

  it('returns 501 when no executor is configured (db-less deployment)', async () => {
    const { app } = await buildApp({ ...BASE_INSIGHT, state: 'execution_failed' })
    const res = await app.inject({ method: 'POST', url: `/insights/${INSIGHT_ID}/retry-execution` })
    expect(res.statusCode).toBe(501)
  })
})
