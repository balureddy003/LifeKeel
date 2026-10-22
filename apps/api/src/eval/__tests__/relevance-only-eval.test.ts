import { describe, expect, it } from 'vitest'
import {
  EMAIL_CLASSIFY_SYSTEM_PROMPT,
  EMAIL_RELEVANCE_SYSTEM_PROMPT,
} from '../../email/classify.js'
import { LABELLED_EMAILS } from '../../email/__fixtures__/labelled-emails.js'
import {
  formatRelevanceReport,
  runRelevanceOnlyEval,
  toFetchedEmail,
  type AskFn,
  type AskResult,
} from '../relevance-only-eval.js'

const result = (verdict: AskResult['verdict'], ms = 2000): AskResult => ({ verdict, ms })

/** Answers every email exactly as labelled. */
const correct: AskFn = async (e) => result(e.isFinancial ? 'yes' : 'no')

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

  it('builds the fetched-email shape the production call takes', () => {
    const f = toFetchedEmail(LABELLED_EMAILS[0]!)
    expect(f.subject).toBe(LABELLED_EMAILS[0]!.subject)
    expect(f.date).toBeInstanceOf(Date)
    expect(f.attachments).toEqual([])
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

  it('counts a failed call against the model instead of guessing a verdict', async () => {
    const r = await runRelevanceOnlyEval(async () => result('error'), 'stub-down')
    expect(r.passed).toBe(false)
    expect(r.errors.length).toBe(r.modelCalls)
  })

  it('reports latency percentiles', async () => {
    let i = 0
    const r = await runRelevanceOnlyEval(
      async (e) => ({ ...(await correct(e)), ms: ++i * 1000 }),
      'stub-timed',
    )
    expect(r.latencyMs.p50).toBeGreaterThan(0)
    expect(r.latencyMs.max).toBe(r.modelCalls * 1000)
  })
})
