import { describe, expect, it } from 'vitest'
import {
  EMAIL_CLASSIFY_SYSTEM_PROMPT,
  EMAIL_RELEVANCE_SYSTEM_PROMPT,
} from '../../email/classify.js'
import { LABELLED_EMAILS } from '../../email/__fixtures__/labelled-emails.js'
import {
  formatRelevanceReport,
  parseVerdict,
  relevanceUserMessage,
  runRelevanceOnlyEval,
  type AskFn,
  type AskResult,
} from '../relevance-only-eval.js'

const result = (verdict: AskResult['verdict'], ms = 2000): AskResult => ({
  verdict,
  raw: verdict,
  ms,
  promptTokens: 520,
  evalTokens: 1,
})

/** Answers every email exactly as labelled. */
const correct: AskFn = async (e) => result(e.isFinancial ? 'yes' : 'no')

describe('parseVerdict', () => {
  it.each([
    ['YES', 'yes'],
    ['No', 'no'],
    ['  "yes".', 'yes'],
    ['No, this is a receipt', 'no'],
    ['Yes\n', 'yes'],
  ])('reads %j as %s', (raw, want) => {
    expect(parseVerdict(raw)).toBe(want)
  })

  it.each(['', 'maybe', 'Not sure', 'yesterday', 'nope', 'The answer is yes'])(
    'treats %j as unparseable, not as a verdict',
    (raw) => {
      expect(parseVerdict(raw)).toBe('unparseable')
    },
  )
})

describe('the relevance prompt', () => {
  it('reuses the classifier rules and the untrusted-content warning, but not the field list or JSON', () => {
    expect(EMAIL_RELEVANCE_SYSTEM_PROMPT).toContain('NOT relevant')
    expect(EMAIL_RELEVANCE_SYSTEM_PROMPT).toContain('untrusted data')
    expect(EMAIL_RELEVANCE_SYSTEM_PROMPT).toContain('Answer with exactly one word')
    expect(EMAIL_RELEVANCE_SYSTEM_PROMPT).not.toContain('policy_number')
    expect(EMAIL_RELEVANCE_SYSTEM_PROMPT).not.toContain('Return ONLY a JSON object')
    expect(EMAIL_RELEVANCE_SYSTEM_PROMPT.length).toBeLessThan(
      EMAIL_CLASSIFY_SYSTEM_PROMPT.length * 0.8,
    )
  })

  it('frames the email in the same tags as the classifier', () => {
    const msg = relevanceUserMessage(LABELLED_EMAILS[0]!)
    expect(msg).toMatch(/^<email_from>.*<\/email_from>\n<email_subject>/)
  })
})

describe('runRelevanceOnlyEval', () => {
  it('passes a model that answers every email correctly, and counts rule-settled emails', async () => {
    const r = await runRelevanceOnlyEval(correct, 'stub')
    expect(r.gates.filter((g) => !g.passed)).toEqual([])
    expect(r.passed).toBe(true)
    expect(r.settledByRule.sort()).toEqual(['lpa-review-reminder', 'will-reminder'])
    // The model is not asked about emails the rule settled.
    expect(r.modelCalls).toBe(LABELLED_EMAILS.length - 2)
    expect(formatRelevanceReport(r)).toMatch(/RESULT: relevance-only meets the gates/)
  })

  it('rejects a yes-man and names the false positives, including the injection email', async () => {
    const r = await runRelevanceOnlyEval(async () => result('yes'), 'stub-yes')
    expect(r.passed).toBe(false)
    expect(r.falsePositives).toContain('prompt-injection')
    expect(r.falsePositives).toContain('will-writing-promo')
  })

  it('rejects a model that says no to everything, naming the missed policy emails', async () => {
    const r = await runRelevanceOnlyEval(async () => result('no'), 'stub-no')
    expect(r.passed).toBe(false)
    expect(r.missed).toContain('life-renewal')
    // The rule still surfaces will/LPA reminders even when the model says no.
    expect(r.missed).not.toContain('will-reminder')
  })

  it('counts an unparseable reply against the model instead of guessing a verdict', async () => {
    const r = await runRelevanceOnlyEval(async () => result('unparseable'), 'stub-vague')
    expect(r.passed).toBe(false)
    expect(r.unparseable.length).toBe(r.modelCalls)
  })

  it('reports latency percentiles and median tokens', async () => {
    let i = 0
    const r = await runRelevanceOnlyEval(
      async (e) => ({ ...(await correct(e)), ms: ++i * 1000 }),
      'stub-timed',
    )
    expect(r.latencyMs.p50).toBeGreaterThan(0)
    expect(r.latencyMs.max).toBe(r.modelCalls * 1000)
    expect(r.tokens).toEqual({ prompt: 520, output: 1 })
  })
})
