import { describe, expect, it, vi } from 'vitest'
import type { DecisionFn } from '@lifekeel/platform'
import { classifyEmail, type EmailFunnelStage } from '../classify.js'
import { LABELLED_EMAILS } from '../__fixtures__/labelled-emails.js'

const fetched = (e: (typeof LABELLED_EMAILS)[number]) => ({
  uid: 1,
  messageId: e.name,
  from: e.from,
  subject: e.subject,
  date: new Date('2026-10-01'),
  textSnippet: e.textSnippet,
  attachments: [],
})

const never = async () => {
  throw new Error('no cloud')
}
const verdict = {
  is_financial: false,
  summary: '',
  action_label: '',
  action_type: 'info',
  priority: 'low',
  policy: null,
}

describe('email cascade funnel', () => {
  it('reports exactly one stage per email, and model_call matches real model calls', async () => {
    const decide = vi.fn(async () => ({ value: verdict, model: 'stub', latency_ms: 1 }))
    const counts: Record<EmailFunnelStage, number> = {
      rule_hit: 0,
      prefilter_skip: 0,
      encoder_skip: 0,
      relevance_no: 0,
      model_call: 0,
    }
    for (const e of LABELLED_EMAILS) {
      const seen: EmailFunnelStage[] = []
      await classifyEmail(never, fetched(e), {
        decide: decide as unknown as DecisionFn,
        prefilter: true,
        onStage: (s) => seen.push(s),
      })
      expect(seen, e.name).toHaveLength(1)
      counts[seen[0]!] += 1
    }
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(LABELLED_EMAILS.length)
    expect(counts.model_call).toBe(decide.mock.calls.length)
    expect(counts.rule_hit).toBe(2) // will-reminder, lpa-review-reminder
    // The free stages must be doing real work. No ratio is asserted: these fixtures are
    // deliberately policy-heavy, so the share reaching the model here says nothing about a
    // real inbox (measure that with lifekeel_email_funnel_total).
    expect(counts.prefilter_skip).toBeGreaterThanOrEqual(5)
    expect(counts.model_call).toBeLessThan(LABELLED_EMAILS.length)
  })

  it('counts an encoder gate skip as free, and a fall-back to the model as a model call', async () => {
    const decide = vi.fn(async () => ({ value: verdict, model: 'stub', latency_ms: 1 }))
    const e = LABELLED_EMAILS.find((x) => x.name === 'newsletter-sipp-promo')!
    const run = async (classify: () => Promise<{ relevant: boolean }>) => {
      const seen: EmailFunnelStage[] = []
      await classifyEmail(never, fetched(e), {
        decide: decide as unknown as DecisionFn,
        encoder: { classify: classify as never, mode: 'gate' },
        onStage: (s) => seen.push(s),
      })
      return seen
    }
    expect(await run(async () => ({ relevant: false }))).toEqual(['encoder_skip'])
    expect(decide).not.toHaveBeenCalled()
    expect(
      await run(async () => {
        throw new Error('encoder down')
      }),
    ).toEqual(['model_call'])
    expect(decide).toHaveBeenCalledTimes(1)
  })

  it('a throwing onStage never changes the result', async () => {
    const e = LABELLED_EMAILS.find((x) => x.name === 'will-reminder')!
    const r = await classifyEmail(never, fetched(e), {
      onStage: () => {
        throw new Error('metrics down')
      },
    })
    expect(r.isFinancial).toBe(true)
  })
})
