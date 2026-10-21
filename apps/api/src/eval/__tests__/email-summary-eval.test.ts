import { describe, expect, it } from 'vitest'
import type { DecisionFn } from '@lifekeel/platform'
import { LABELLED_EMAILS } from '../../email/__fixtures__/labelled-emails.js'
import { formatEmailSummaryReport, runEmailSummaryEval } from '../email-summary-eval.js'

type Req = { prompt: string }
const wrap = (value: unknown) => ({ value, model: 'stub', latency_ms: 1 })
const emailFor = (req: Req) => LABELLED_EMAILS.find((x) => req.prompt.includes(x.subject))!

const verdict = (summary: string, policy: Record<string, unknown> | null) => ({
  is_financial: true,
  summary,
  action_label: 'Review cover',
  action_type: 'review',
  priority: 'medium',
  policy,
})

const policyOf = (e: ReturnType<typeof emailFor>) =>
  e.policy
    ? {
        provider: e.policy.provider,
        type: e.policy.type,
        renewal_date: e.policy.renewalDate,
        monthly_premium: e.policy.monthlyPremium,
      }
    : null

const correct: DecisionFn = (async (req: Req) => {
  const e = emailFor(req)
  return wrap(verdict('Your policy has an update; review the details in the email.', policyOf(e)))
}) as unknown as DecisionFn

describe('runEmailSummaryEval', () => {
  it('passes a model with safe summaries and correct policy fields', async () => {
    const r = await runEmailSummaryEval(correct, 'stub-correct')
    expect(r.gates.filter((g) => !g.passed)).toEqual([])
    expect(r.passed).toBe(true)
    expect(formatEmailSummaryReport(r)).toMatch(/RESULT: model meets/)
  })

  it('rejects summaries that give advice, name a provider or invent a figure', async () => {
    const bad: DecisionFn = (async (req: Req) => {
      const e = emailFor(req)
      return wrap(verdict('You should switch to Aviva and save £98,765 a year.', policyOf(e)))
    }) as unknown as DecisionFn
    const r = await runEmailSummaryEval(bad, 'stub-bad')
    expect(r.passed).toBe(false)
    expect(r.unsafe.length).toBeGreaterThan(0)
  })

  it('rejects missing summaries and wrong policy fields', async () => {
    const lazy: DecisionFn = (async () =>
      wrap(verdict('', { provider: 'Nobody', type: 'other' }))) as unknown as DecisionFn
    const r = await runEmailSummaryEval(lazy, 'stub-lazy')
    expect(r.passed).toBe(false)
    expect(r.missingSummary.length).toBeGreaterThan(0)
    expect(r.fieldsRight).toBeLessThan(r.fieldsLabelled)
  })
})
