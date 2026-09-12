import { describe, expect, it, vi } from 'vitest'
import { MoveJudge, type Insight, type JudgeScores } from '../index.js'

function insight(reasoning = 'This evidence-backed recommendation is sufficiently detailed to require evaluation.'): Insight {
  return {
    id: 'move-1',
    tenant_id: 'tenant-1',
    hypothesis: 'invoice_overdue',
    category: 'revenue',
    urgency: 'high',
    estimated_impact_low: 100,
    estimated_impact_high: 200,
    reasoning,
    actions: ['Contact the customer'],
    confidence_breakdown: {
      or_score: 0.8,
      combined_score: 0.82,
      model_version: 'test@1',
      evidence_refs: ['event-1'],
    },
    detector_id: 'test',
    rule_id: 'overdue',
    state: 'identified',
    created_at: new Date(),
    derived_from_signals: [],
  }
}

const pass: JudgeScores = {
  coherence: 5,
  groundedness: 5,
  actionability: 5,
  proportionality: 5,
  safety: 5,
  feedback: '',
}

describe('MoveJudge', () => {
  it('passes a move that meets every rubric threshold', async () => {
    const judge = new MoveJudge(async () => pass)
    expect((await judge.evaluate({ insight: insight(), evidence: {} })).decision).toBe('pass')
  })

  it('always blocks a safety failure', async () => {
    const judge = new MoveJudge(async () => ({ ...pass, safety: 4 }))
    expect((await judge.evaluate({ insight: insight(), evidence: {} })).decision).toBe('block')
  })

  it('requests a rewrite for low groundedness', async () => {
    const judge = new MoveJudge(async () => ({ ...pass, groundedness: 3 }))
    expect((await judge.evaluate({ insight: insight(), evidence: {} })).decision).toBe('rewrite')
  })

  it('fails open and marks a judge API failure as skipped', async () => {
    const judge = new MoveJudge(async () => { throw new Error('unavailable') })
    const verdict = await judge.evaluate({ insight: insight(), evidence: {} })
    expect(verdict).toMatchObject({ decision: 'skipped', judge_skipped: true, skip_reason: 'judge_failure' })
  })

  it('does not invoke the evaluator for trivial or duplicate reasoning', async () => {
    const evaluator = vi.fn(async () => pass)
    const judge = new MoveJudge(evaluator)
    await judge.evaluate({ insight: insight('Too short'), evidence: {} })
    await judge.evaluate({ insight: insight(), evidence: {} }, { duplicateReasoning: true })
    expect(evaluator).not.toHaveBeenCalled()
  })
})
