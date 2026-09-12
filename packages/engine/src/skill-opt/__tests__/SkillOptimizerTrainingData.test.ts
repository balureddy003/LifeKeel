/**
 * SkillOptimizer — detector training data pipeline tests.
 *
 * Verifies the fix for the broken training data path: SkillOptimizer
 * previously read from `attribution_events` (which was never populated),
 * so detector optimization always skipped due to insufficient data.
 * Now it reads from `action_receipts` (populated by routes/insights.ts
 * on every approve/dismiss) joined with `insights` (for feature_snapshot
 * and reasoning text).
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
      // Basic query filter: supports { tenant_id, detector_id, id: {$in}, ... }
      find: (query: Record<string, unknown> = {}) => cursor(filterDocs(docs, query)),
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

/** Minimal query filter supporting the fields used by loadTrajectories. */
function filterDocs(docs: Record<string, unknown>[], query: Record<string, unknown>): Record<string, unknown>[] {
  return docs.filter(doc => {
    for (const [key, value] of Object.entries(query)) {
      if (key === 'started_at' || key === 'executed_at' || key === 'created_at') {
        // Date comparison: { $gte: Date } — skip for test simplicity
        continue
      }
      if (value && typeof value === 'object' && '$in' in value) {
        const arr = (value as { $in: unknown[] }).$in
        if (!arr.includes(doc[key])) return false
        continue
      }
      if (value && typeof value === 'object' && '$ne' in value) {
        if (doc[key] === (value as { $ne: unknown }).$ne) return false
        continue
      }
      if (doc[key] !== value) return false
    }
    return true
  })
}

// Simulate the docs that routes/insights.ts writes when a user
// approves or dismisses an insight from a detector.
function makeTrainingData(tenantId: string, detectorId: string, opts: {
  approved: number
  dismissed: number
  withFeatureSnapshot?: boolean
  withInsightScore?: boolean
  learningSuppressed?: boolean
}) {
  const receipts: Record<string, unknown>[] = []
  const insights: Record<string, unknown>[] = []

  for (let i = 0; i < opts.approved; i++) {
    const insightId = `ins-ok-${i}`
    receipts.push({
      tenant_id: tenantId,
      detector_id: detectorId,
      insight_id: insightId,
      outcome: 'approved',
      executed_at: new Date(Date.now() - i * 1000),
      learning_suppressed: opts.learningSuppressed ?? false,
      metadata: opts.withInsightScore ? { insight_score: 0.8 } : undefined,
    })
    insights.push({
      id: insightId,
      tenant_id: tenantId,
      hypothesis: `Good insight ${i}`,
      reasoning: `This insight was approved ${i}`,
      feature_snapshot: opts.withFeatureSnapshot ? { industry: 'retail', amount: 5000 + i } : { i },
    })
  }

  for (let i = 0; i < opts.dismissed; i++) {
    const insightId = `ins-bad-${i}`
    receipts.push({
      tenant_id: tenantId,
      detector_id: detectorId,
      insight_id: insightId,
      outcome: 'dismissed',
      executed_at: new Date(Date.now() - i * 1000),
      learning_suppressed: opts.learningSuppressed ?? false,
      metadata: opts.withInsightScore ? { insight_score: 0.9 } : undefined,
    })
    insights.push({
      id: insightId,
      tenant_id: tenantId,
      hypothesis: `Bad insight ${i}`,
      reasoning: `This insight was dismissed ${i}`,
      feature_snapshot: opts.withFeatureSnapshot ? { industry: 'tech', amount: 1000 + i } : { i },
    })
  }

  return { action_receipts: receipts, insights }
}

// LLM mock that records nothing — just returns empty strings.
function silentLlm(): () => Promise<string> {
  return async () => ''
}

describe('SkillOptimizer detector training data pipeline', () => {
  it('loads trajectories from action_receipts joined with insights', async () => {
    const data = makeTrainingData('t1', 'churn_detector', { approved: 8, dismissed: 2 })
    const db = makeDb(data)
    const opt = new SkillOptimizer(db, silentLlm())

    const result = await opt.run({
      target: 'detector',
      target_id: 'churn_detector',
      tenant_id: 't1',
      iterations: 1,
    })

    // 8 approved + 2 dismissed = 10 trajectories → baseline 0.8
    expect(result.baseline_score).toBe(0.8)
  })

  it('maps approved → score 1, dismissed → score 0', async () => {
    const data = makeTrainingData('t1', 'det', { approved: 9, dismissed: 1 })
    const db = makeDb(data)
    const opt = new SkillOptimizer(db, silentLlm())

    const result = await opt.run({
      target: 'detector',
      target_id: 'det',
      tenant_id: 't1',
      iterations: 1,
    })

    // 9/10 = 0.9 → early exit (baseline >= 0.90)
    expect(result.baseline_score).toBe(0.9)
    expect(result.iterations).toHaveLength(0)
  })

  it('treats auto_approved as a positive signal (score 1)', async () => {
    const receipts: Record<string, unknown>[] = []
    const insights: Record<string, unknown>[] = []
    for (let i = 0; i < 10; i++) {
      const id = `ins-${i}`
      receipts.push({
        tenant_id: 't1', detector_id: 'det', insight_id: id,
        outcome: 'auto_approved', executed_at: new Date(),
      })
      insights.push({ id, tenant_id: 't1', feature_snapshot: { i }, reasoning: `auto ${i}` })
    }
    const db = makeDb({ action_receipts: receipts, insights })
    const opt = new SkillOptimizer(db, silentLlm())

    const result = await opt.run({
      target: 'detector', target_id: 'det', tenant_id: 't1', iterations: 1,
    })

    // All 10 auto_approved → baseline 1.0 → early exit
    expect(result.baseline_score).toBe(1)
  })

  it('skips receipts where learning_suppressed is true', async () => {
    const data = makeTrainingData('t1', 'det', {
      approved: 5, dismissed: 5, learningSuppressed: true,
    })
    const db = makeDb(data)
    const opt = new SkillOptimizer(db, silentLlm())

    const result = await opt.run({
      target: 'detector', target_id: 'det', tenant_id: 't1', iterations: 1,
    })

    // All receipts have learning_suppressed=true → filtered out → 0 trajectories
    // → "Insufficient trajectories — skipping"
    expect(result.baseline_score).toBe(0)
    expect(result.iterations).toHaveLength(0)
    expect(result.persisted_to).toBe('skipped:insufficient_data')
  })

  it('returns insufficient data when action_receipts is empty', async () => {
    const db = makeDb({ action_receipts: [], insights: [] })
    const opt = new SkillOptimizer(db, silentLlm())

    const result = await opt.run({
      target: 'detector', target_id: 'det', tenant_id: 't1', iterations: 1,
    })

    expect(result.baseline_score).toBe(0)
    expect(result.persisted_to).toBe('skipped:insufficient_data')
  })

  it('handles receipts without insight_id gracefully', async () => {
    const receipts: Record<string, unknown>[] = []
    for (let i = 0; i < 10; i++) {
      receipts.push({
        tenant_id: 't1', detector_id: 'det',
        // No insight_id — should still work, just with empty feature_snapshot
        outcome: 'approved', executed_at: new Date(),
      })
    }
    const db = makeDb({ action_receipts: receipts, insights: [] })
    const opt = new SkillOptimizer(db, silentLlm())

    const result = await opt.run({
      target: 'detector', target_id: 'det', tenant_id: 't1', iterations: 1,
    })

    // 10 approved receipts without insight_id → still score 1 each → baseline 1.0
    expect(result.baseline_score).toBe(1)
  })

  it('isolates tenants — only loads receipts for the specified tenant', async () => {
    const t1Data = makeTrainingData('t1', 'det', { approved: 8, dismissed: 2 })
    const t2Data = makeTrainingData('t2', 'det', { approved: 10, dismissed: 0 })
    const db = makeDb({
      action_receipts: [...t1Data.action_receipts, ...t2Data.action_receipts],
      insights: [...t1Data.insights, ...t2Data.insights],
    })
    const opt = new SkillOptimizer(db, silentLlm())

    const result = await opt.run({
      target: 'detector', target_id: 'det', tenant_id: 't1', iterations: 1,
    })

    // t1 has 8 approved + 2 dismissed = 0.8 baseline (not 1.0 from t2's data)
    expect(result.baseline_score).toBe(0.8)
  })
})
