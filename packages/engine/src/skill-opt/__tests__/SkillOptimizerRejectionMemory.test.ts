/**
 * SkillOptimizer — rejection-memory regression tests (PP3 gap fix)
 *
 * Verifies the "meta-skill memory" claim is actually end-to-end:
 *  1. A direction rejected in one iteration is injected as a "DO NOT repeat"
 *     constraint into the NEXT iteration's proposal prompt (active intra-run).
 *  2. Rejected edits persisted as dedicated `{ edits }` documents are read back
 *     by loadRejectedHistory on a later run (cross-run persistence round-trip) —
 *     the path that was previously dead because the reader only looked at
 *     run-result `iterations[].rejected_edits`.
 */

import { describe, it, expect } from 'vitest'
import { SkillOptimizer, type EditProposal } from '../SkillOptimizer.js'

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
      // skill_templates: no pre-existing optimized prompt → fall back to default
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

// 10 attribution events: 8 approved (rollout, score 1), 2 rejected (held-out, score 0).
// → baseline 0.8, held-out gate score 0 → every candidate is rejected.
// Build action_receipts + insights docs that simulate the training data
// produced when a user approves/dismisses insights from a detector.
// 8 approved receipts (score 1) + 2 dismissed receipts (score 0) → baseline 0.8.
function attributionEvents(tenantId: string, detectorId: string) {
  const receipts: Record<string, unknown>[] = []
  const insights: Record<string, unknown>[] = []
  for (let i = 0; i < 8; i++) {
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
  for (let i = 0; i < 2; i++) {
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

// LLM mock that branches on the system prompt and records proposal prompts.
function makeLlm(proposePrompts: string[]) {
  return async (system: string, prompt: string): Promise<string> => {
    if (system.includes('expert prompt engineer analyzing')) return 'analysis: outputs were too vague'
    if (system.includes('prompt engineering optimizer')) {
      proposePrompts.push(prompt)
      const edit = {
        type: 'add',
        location: 'end of prompt',
        original: '',
        proposed: 'Always output strict JSON.',
        rationale: 'enforce strict JSON output',
      }
      return JSON.stringify({ edits: [edit] })
    }
    if (system.includes('You are a text editor')) return 'CANDIDATE PROMPT'
    return ''
  }
}

const HEADER = 'Previously rejected edit directions (DO NOT repeat these)'

describe('SkillOptimizer rejection memory (PP3)', () => {
  it('injects an edit rejected in iteration 1 as an active constraint in iteration 2', async () => {
    const proposePrompts: string[] = []
    const db = makeDb(attributionEvents('t1', 'churn_detector'))
    const opt = new SkillOptimizer(db, makeLlm(proposePrompts))

    await opt.run({ target: 'detector', target_id: 'churn_detector', tenant_id: 't1', iterations: 2 })

    expect(proposePrompts).toHaveLength(2)
    // Iteration 1 starts with empty memory.
    expect(proposePrompts[0]).not.toContain(HEADER)
    // Iteration 2 must carry the iteration-1 rejection as an active constraint.
    expect(proposePrompts[1]).toContain(HEADER)
    expect(proposePrompts[1]).toContain('enforce strict JSON output')
  })

  it('reads back rejected edits persisted as dedicated documents (cross-run round-trip)', async () => {
    const proposePrompts: string[] = []
    const seeded: EditProposal = {
      type: 'add',
      location: 'top of prompt',
      original: '',
      proposed: 'Be verbose.',
      rationale: 'preseeded bad direction',
      char_delta: 11,
    }
    const db = makeDb({
      ...attributionEvents('t1', 'churn_detector'),
      // Shape written by recordRejectedEdits — previously never read back.
      skill_rejection_memory: [{
        type: 'rejected_edits',
        target_id: 'churn_detector',
        tenant_id: 't1',
        edits: [seeded],
        improvement: -0.3,
        recorded_at: new Date(),
      }],
    })
    const opt = new SkillOptimizer(db, makeLlm(proposePrompts))

    await opt.run({ target: 'detector', target_id: 'churn_detector', tenant_id: 't1', iterations: 1 })

    expect(proposePrompts).toHaveLength(1)
    expect(proposePrompts[0]).toContain(HEADER)
    expect(proposePrompts[0]).toContain('preseeded bad direction')
  })
})
