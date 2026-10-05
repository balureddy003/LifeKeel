import { describe, expect, it, vi } from 'vitest'
import { MoveJudge, type Insight } from '@lifekeel/engine'
import type { DecisionFn } from '@lifekeel/platform'
import {
  checklistToScores,
  createLocalJudgeEvaluator,
  LocalJudgeUncertainError,
  type LocalJudgeChecklist,
} from '../local-judge.js'

const good: LocalJudgeChecklist = {
  coherent: true,
  grounded: true,
  actionable: true,
  gives_advice_or_names_provider: false,
  contains_pii_or_credentials: false,
  uncertain: false,
  feedback: '',
}

function insight(reasoning: string): Insight {
  return {
    id: 'm1',
    tenant_id: 't1',
    hypothesis: 'h',
    category: 'risk',
    urgency: 'high',
    estimated_impact_low: 1,
    estimated_impact_high: 2,
    reasoning,
    actions: ['Review your policy'],
    confidence_breakdown: { or_score: 0.8, combined_score: 0.82, model_version: 't', evidence_refs: [] },
    detector_id: 'd',
    rule_id: 'r',
    state: 'identified',
    created_at: new Date(),
    derived_from_signals: [],
  }
}

const decideWith = (value: LocalJudgeChecklist): DecisionFn =>
  (async () => ({ value, model: 'local', latency_ms: 1 })) as unknown as DecisionFn

describe('checklistToScores', () => {
  it('maps a clean checklist to scores that pass MoveJudge.decide', () => {
    expect(checklistToScores(good)).toMatchObject({ coherence: 5, groundedness: 5, actionability: 5, safety: 5 })
  })

  it('maps advice or PII to safety 1', () => {
    expect(checklistToScores({ ...good, gives_advice_or_names_provider: true }).safety).toBe(1)
    expect(checklistToScores({ ...good, contains_pii_or_credentials: true }).safety).toBe(1)
  })

  it('throws when the model is uncertain', () => {
    expect(() => checklistToScores({ ...good, uncertain: true })).toThrow(LocalJudgeUncertainError)
  })
})

describe('local judge through MoveJudge', () => {
  // Short reasoning makes the deterministic guard ask for a model opinion.
  const ambiguous = insight('Too short')

  it('passes when the local model approves', async () => {
    const judge = new MoveJudge(createLocalJudgeEvaluator(decideWith(good)), { useGuard: true })
    expect((await judge.evaluate({ insight: ambiguous, evidence: {} })).decision).toBe('pass')
  })

  it('rewrites an ungrounded move', async () => {
    const judge = new MoveJudge(createLocalJudgeEvaluator(decideWith({ ...good, grounded: false })), { useGuard: true })
    expect((await judge.evaluate({ insight: ambiguous, evidence: {} })).decision).toBe('rewrite')
  })

  it('blocks and queues for review when uncertain, with no cloud fallback', async () => {
    const judge = new MoveJudge(createLocalJudgeEvaluator(decideWith({ ...good, uncertain: true })), { useGuard: true })
    expect(await judge.evaluate({ insight: ambiguous, evidence: {} })).toMatchObject({
      decision: 'block',
      judge_skipped: true,
      skip_reason: 'judge_failure',
    })
  })

  it('blocks when the local model is unreachable', async () => {
    const down = vi.fn(async () => { throw new Error('connection refused') }) as unknown as DecisionFn
    const judge = new MoveJudge(createLocalJudgeEvaluator(down), { useGuard: true })
    expect((await judge.evaluate({ insight: ambiguous, evidence: {} })).decision).toBe('block')
  })

  it('never calls the model for clean template copy', async () => {
    const decide = vi.fn() as unknown as DecisionFn
    const judge = new MoveJudge(createLocalJudgeEvaluator(decide), { useGuard: true })
    const clean = insight('Your listed cover appears below the estimated household need. This is an informational estimate.')
    expect((await judge.evaluate({ insight: clean, evidence: {} })).decision).toBe('pass')
    expect(decide).not.toHaveBeenCalled()
  })
})
