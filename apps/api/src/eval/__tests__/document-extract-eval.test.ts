import { describe, expect, it } from 'vitest'
import type { DecisionFn } from '@lifekeel/platform'
import { DOCUMENT_EXTRACT_CASES } from '../__fixtures__/document-extract-cases.js'
import { formatDocumentReport, runDocumentExtractEval } from '../document-extract-eval.js'

type Req = { prompt: string }
const wrap = (value: unknown) => ({ value, model: 'stub', latency_ms: 1 })
const caseFor = (req: Req) => DOCUMENT_EXTRACT_CASES.find((c) => req.prompt.includes(c.text))!

/** Answers every document exactly as labelled. */
const correct: DecisionFn = (async (req: Req) => {
  const c = caseFor(req)
  return wrap({ category: c.category, ...c.fields })
}) as unknown as DecisionFn

describe('runDocumentExtractEval gates', () => {
  it('passes a model that reads every document correctly', async () => {
    const r = await runDocumentExtractEval(correct, 'stub-correct')
    expect(r.gates.filter((g) => !g.passed)).toEqual([])
    expect(r.passed).toBe(true)
    expect(formatDocumentReport(r)).toMatch(/RESULT: model meets/)
  })

  it('rejects a model that follows the injected instruction and leaks the beneficiary', async () => {
    const leaky: DecisionFn = (async (req: Req) => {
      const c = caseFor(req)
      if (c.name === 'injection')
        return wrap({ category: 'will', policy_number: 'HACKED-999', provider: 'North Bank' })
      if (c.name === 'life-policy')
        return wrap({ category: c.category, ...c.fields, has_beneficiary: 'Priya Nair' })
      return wrap({ category: c.category, ...c.fields })
    }) as unknown as DecisionFn
    const r = await runDocumentExtractEval(leaky, 'stub-leaky')
    expect(r.passed).toBe(false)
    expect(r.forbiddenLeaks).toContain('injection.policy_number')
    expect(r.forbiddenLeaks).toContain('life-policy.has_beneficiary')
  })

  it('rejects invented values and guessed fields on an unrelated letter', async () => {
    const guesser: DecisionFn = (async (req: Req) => {
      const c = caseFor(req)
      if (c.name === 'unrelated-letter')
        return wrap({ category: 'other', provider: 'Village Hall Ltd' })
      return wrap({ category: c.category, ...c.fields, balance: '£999,999.00' })
    }) as unknown as DecisionFn
    const r = await runDocumentExtractEval(guesser, 'stub-guesser')
    expect(r.passed).toBe(false)
    expect(r.ungrounded).toContain('unrelated-letter.provider')
    expect(r.ungrounded).toContain('unrelated-letter.invented_fields')
  })

  it('counts a model error against the model', async () => {
    const down: DecisionFn = (async () => {
      throw new Error('timeout')
    }) as unknown as DecisionFn
    const r = await runDocumentExtractEval(down, 'stub-down')
    expect(r.passed).toBe(false)
    expect(r.failed).toHaveLength(DOCUMENT_EXTRACT_CASES.length)
  })
})
