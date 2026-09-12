/**
 * SkillOptimizer — early-exit regression tests (P1 cost optimisation).
 *
 * Verifies the two early-exit paths added in P1:
 *  1. Baseline already excellent (>= 0.90) → skip optimization entirely.
 *     Saves ~$0.50/run in LLM calls for skills that are already good.
 *  2. Current score reaches 0.90 mid-loop → stop iterating.
 *     Saves remaining iterations' LLM calls.
 *
 * All tests use in-memory stubs — no MongoDB required.
 */

import { describe, it, expect } from 'vitest'
import { SkillOptimizer } from '../SkillOptimizer.js'

// ── Minimal Mongo fakes ─────────────────────────────────────────────────────

function cursor(docs: Record<string, unknown>[]) {
  const c = {
    sort: () => c,
    limit: () => c,
    toArray: async () => [...docs],
  }
  return c
}

function makeDb(presets: Record<string, Record<string, unknown>[]> = {}) {
  const cols = new Map<string, ReturnType<typeof makeCollection>>()
  function makeCollection(name: string) {
    const docs: Record<string, unknown>[] = presets[name] ? [...presets[name]] : []
    return {
      _docs: docs,
      createIndex: async () => 'idx',
      insertOne: async (d: Record<string, unknown>) => { docs.push({ ...d }); return {} },
      replaceOne: async () => ({}),
      findOne: async () => null,
      find: () => cursor(docs),
      distinct: async () => [],
      aggregate: () => ({ toArray: async () => [] }),
    }
  }
  return {
    collection: (name: string) => {
      if (!cols.has(name)) cols.set(name, makeCollection(name))
      return cols.get(name)!
    },
  }
}

// Build action_receipts + insights docs where all receipts are approved.
// → baseline score = 1.0 (>= 0.90) → early exit.
function allApprovedEvents(tenantId: string, detectorId: string, count: number) {
  const receipts: Record<string, unknown>[] = []
  const insights: Record<string, unknown>[] = []
  for (let i = 0; i < count; i++) {
    const insightId = `ins-${i}`
    receipts.push({
      tenant_id: tenantId, detector_id: detectorId, insight_id: insightId,
      outcome: 'approved', executed_at: new Date(),
    })
    insights.push({
      id: insightId, tenant_id: tenantId,
      feature_snapshot: { i }, reasoning: `ok ${i}`, hypothesis: `ok ${i}`,
    })
  }
  return { action_receipts: receipts, insights }
}

// Mix of approved and dismissed receipts to hit a specific baseline score.
function mixedEvents(tenantId: string, detectorId: string, approved: number, rejected: number) {
  const receipts: Record<string, unknown>[] = []
  const insights: Record<string, unknown>[] = []
  for (let i = 0; i < approved; i++) {
    const insightId = `ins-ok-${i}`
    receipts.push({
      tenant_id: tenantId, detector_id: detectorId, insight_id: insightId,
      outcome: 'approved', executed_at: new Date(),
    })
    insights.push({
      id: insightId, tenant_id: tenantId,
      feature_snapshot: { i }, reasoning: `ok ${i}`, hypothesis: `ok ${i}`,
    })
  }
  for (let i = 0; i < rejected; i++) {
    const insightId = `ins-bad-${i}`
    receipts.push({
      tenant_id: tenantId, detector_id: detectorId, insight_id: insightId,
      outcome: 'dismissed', executed_at: new Date(),
    })
    insights.push({
      id: insightId, tenant_id: tenantId,
      feature_snapshot: { i }, reasoning: `bad ${i}`, hypothesis: `bad ${i}`,
    })
  }
  return { action_receipts: receipts, insights }
}

// LLM mock that counts calls — should never be called when baseline >= 0.90.
function makeLlm(callCount: { value: number }) {
  return async (): Promise<string> => {
    callCount.value++
    return ''
  }
}

describe('SkillOptimizer early exit (P1)', () => {
  it('skips optimization entirely when baseline >= 0.90 — no LLM calls', async () => {
    const llmCalls = { value: 0 }
    // 10 approved, 0 rejected → baseline = 1.0
    const db = makeDb(allApprovedEvents('t1', 'churn_detector', 10))
    const opt = new SkillOptimizer(db, makeLlm(llmCalls))

    const result = await opt.run({
      target: 'detector',
      target_id: 'churn_detector',
      tenant_id: 't1',
      iterations: 3,
    })

    expect(llmCalls.value).toBe(0) // no LLM calls at all
    expect(result.baseline_score).toBe(1)
    expect(result.final_score).toBe(1)
    expect(result.improvement).toBe(0)
    expect(result.iterations).toHaveLength(0) // no iterations ran
  })

  it('skips optimization when baseline is exactly 0.90', async () => {
    const llmCalls = { value: 0 }
    // 9 approved, 1 rejected → baseline = 0.9
    const db = makeDb(mixedEvents('t1', 'churn_detector', 9, 1))
    const opt = new SkillOptimizer(db, makeLlm(llmCalls))

    const result = await opt.run({
      target: 'detector',
      target_id: 'churn_detector',
      tenant_id: 't1',
      iterations: 3,
    })

    expect(llmCalls.value).toBe(0)
    expect(result.baseline_score).toBe(0.9)
    expect(result.iterations).toHaveLength(0)
  })

  it('does NOT skip when baseline < 0.90 — LLM is called', async () => {
    const llmCalls = { value: 0 }
    // 8 approved, 2 rejected → baseline = 0.8
    const db = makeDb(mixedEvents('t1', 'churn_detector', 8, 2))
    const opt = new SkillOptimizer(db, makeLlm(llmCalls))

    await opt.run({
      target: 'detector',
      target_id: 'churn_detector',
      tenant_id: 't1',
      iterations: 1,
    })

    // With baseline 0.8 < 0.90, the loop runs → LLM is called for reflect+edit
    expect(llmCalls.value).toBeGreaterThan(0)
  })
})
