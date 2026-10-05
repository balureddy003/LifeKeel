import { describe, expect, it, vi } from 'vitest'
import { MoveJudge, type Insight, type JudgeScores } from '@lifekeel/engine'
import type { DecisionFn, LlmFn } from '@lifekeel/platform'
import { compareDecisions, withShadow, type ShadowRecord } from '../shadow-judge.js'
import { createMoveJudge } from '../move-judge.js'

const pass: JudgeScores = { coherence: 5, groundedness: 5, actionability: 5, proportionality: 5, safety: 5, feedback: '' }
const rewrite: JudgeScores = { ...pass, groundedness: 2 }
const block: JudgeScores = { ...pass, safety: 1 }

function insight(reasoning = 'Too short'): Insight {
  return {
    id: 'move-1', tenant_id: 't1', hypothesis: 'h', category: 'risk', urgency: 'high',
    estimated_impact_low: 1, estimated_impact_high: 2, reasoning, actions: ['Review your policy'],
    confidence_breakdown: { or_score: 0.8, combined_score: 0.82, model_version: 't', evidence_refs: [] },
    detector_id: 'det-1', rule_id: 'r', state: 'identified', created_at: new Date(), derived_from_signals: [],
  }
}
const input = { insight: insight('SECRET REASONING TEXT 12345'), evidence: { x: 1 } }
const tick = () => new Promise(r => setTimeout(r, 15))

describe('compareDecisions', () => {
  it('classifies direction by strictness, not just equality', () => {
    expect(compareDecisions('pass', 'pass')).toBe('agree')
    expect(compareDecisions('block', 'pass')).toBe('shadow_more_permissive')
    expect(compareDecisions('rewrite', 'pass')).toBe('shadow_more_permissive')
    expect(compareDecisions('block', 'rewrite')).toBe('shadow_more_permissive')
    expect(compareDecisions('pass', 'block')).toBe('shadow_stricter')
    expect(compareDecisions('pass', 'rewrite')).toBe('shadow_stricter')
  })
})

describe('withShadow', () => {
  it('returns the primary scores unchanged and records the comparison', async () => {
    const records: ShadowRecord[] = []
    const judge = withShadow(async () => pass, async () => block, { record: r => { records.push(r) } })
    expect(await judge(input)).toEqual(pass)
    await tick()
    expect(records[0]).toMatchObject({ outcome: 'shadow_stricter', primary_decision: 'pass', shadow_decision: 'block', tenant_id: 't1', insight_id: 'move-1', detector_id: 'det-1' })
  })

  it('flags the dangerous direction: shadow would deliver what the primary blocked', async () => {
    const records: ShadowRecord[] = []
    await withShadow(async () => block, async () => pass, { record: r => { records.push(r) } })(input)
    await tick()
    expect(records[0]!.outcome).toBe('shadow_more_permissive')
  })

  it('never waits for the shadow: a slow candidate cannot delay the primary result', async () => {
    let shadowDone = false
    const slow = async () => { await new Promise(r => setTimeout(r, 200)); shadowDone = true; return pass }
    const started = Date.now()
    const result = await withShadow(async () => pass, slow, { record: () => {} })(input)
    expect(result).toEqual(pass)
    expect(Date.now() - started).toBeLessThan(100)
    expect(shadowDone).toBe(false)
  })

  it('contains shadow failures: the primary still answers and the error is recorded', async () => {
    const records: ShadowRecord[] = []
    const result = await withShadow(async () => rewrite, async () => { throw new Error('model down') }, { record: r => { records.push(r) } })(input)
    expect(result).toEqual(rewrite)
    await tick()
    expect(records[0]).toMatchObject({ outcome: 'shadow_error', primary_decision: 'rewrite', shadow_error: 'Error' })
  })

  it('treats malformed shadow scores as an error, not as agreement', async () => {
    const records: ShadowRecord[] = []
    await withShadow(async () => pass, async () => ({ nonsense: true }) as unknown as JudgeScores, { record: r => { records.push(r) } })(input)
    await tick()
    expect(records[0]!.outcome).toBe('shadow_error')
  })

  it('propagates a primary error unchanged and runs no shadow', async () => {
    const shadow = vi.fn(async () => pass)
    await expect(withShadow(async () => { throw new Error('cloud down') }, shadow, { record: () => {} })(input)).rejects.toThrow('cloud down')
    expect(shadow).not.toHaveBeenCalled()
  })

  it('bounds in-flight shadow calls and reports the overflow as dropped', async () => {
    const records: ShadowRecord[] = []
    const gate = new Promise<void>(r => setTimeout(r, 60))
    const shadow = vi.fn(async () => { await gate; return pass })
    const judge = withShadow(async () => pass, shadow, { record: r => { records.push(r) }, maxInFlight: 1 })
    await judge(input); await judge(input); await judge(input)
    expect(shadow).toHaveBeenCalledTimes(1)
    expect(records.filter(r => r.outcome === 'dropped')).toHaveLength(2)
  })

  it('survives a throwing or rejecting recorder', async () => {
    const result = await withShadow(async () => pass, async () => pass, { record: () => { throw new Error('mongo down') } })(input)
    expect(result).toEqual(pass)
    const result2 = await withShadow(async () => pass, async () => pass, { record: async () => { throw new Error('mongo down') } })(input)
    expect(result2).toEqual(pass)
    await tick()
  })

  it('records ids and decisions only: never the insight text or evidence', async () => {
    const records: ShadowRecord[] = []
    await withShadow(async () => pass, async () => pass, { record: r => { records.push(r) } })(input)
    await tick()
    const text = JSON.stringify(records)
    expect(text).not.toContain('SECRET REASONING TEXT')
    expect(text).not.toContain('12345')
  })
})

describe('createMoveJudge in shadow mode', () => {
  const cloudJson = JSON.stringify(pass)
  const localDecide = (async () => ({ value: { coherent: true, grounded: true, actionable: true, gives_advice_or_names_provider: true, contains_pii_or_credentials: false, uncertain: false, feedback: '' }, model: 'local', latency_ms: 1 })) as unknown as DecisionFn
  const makeDb = () => {
    const inserted: Array<Record<string, any>> = []
    const db = { collection: (name: string) => name === 'judge_shadow_results' ? { insertOne: async (d: Record<string, any>) => { inserted.push(d) } } : { findOne: async () => null, insertOne: async () => ({}), find: () => ({ toArray: async () => [] }), updateOne: async () => ({}), aggregate: () => ({ toArray: async () => [] }) } } as any
    return { db, inserted }
  }

  it('lets the cloud judge decide while recording the local judge disagreement, with a 30-day expiry', async () => {
    const llm: LlmFn = async () => cloudJson // cloud approves
    const { db, inserted } = makeDb()
    const judge = createMoveJudge(llm, db, localDecide, { shadow: true })

    // Short reasoning: the guard cannot settle it, so the model path (and the shadow) runs.
    const verdict = await judge.evaluate({ insight: insight('Too short'), evidence: {} })
    expect(verdict).toMatchObject({ decision: 'pass', decided_by: 'model' }) // cloud's answer, not the local one's
    await tick()
    await tick()
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ outcome: 'shadow_stricter', primary_decision: 'pass', shadow_decision: 'block' })
    expect(inserted[0]!.expires_at.getTime() - inserted[0]!.created_at.getTime()).toBe(30 * 24 * 3_600_000)
  })

  it('without shadow, a configured local model is authoritative and the cloud is never called', async () => {
    const llm = vi.fn(async () => cloudJson) as unknown as LlmFn
    const { db, inserted } = makeDb()
    const verdict = await createMoveJudge(llm, db, localDecide).evaluate({ insight: insight('Too short'), evidence: {} })
    expect(verdict.decision).toBe('block') // local said it gives advice
    expect(llm).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
  })
})
