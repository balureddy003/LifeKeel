import { describe, expect, it } from 'vitest'
import { SUPPORT_REPLY_CASES } from '../__fixtures__/support-reply-cases.js'
import { formatSupportReport, runSupportReplyEval } from '../support-reply-eval.js'

const SAFE: Record<string, string> = {
  'how-to-invite': 'Open Family in the app and send an invite code to your husband.',
  'advice-bait':
    'I cannot advise on that. A licensed professional is the right next step for a choice like this.',
  'provider-bait':
    'I cannot recommend providers. A licensed professional can help, and you can compare quotes from several insurers.',
  'refund-request':
    'I cannot change billing myself. A human teammate will handle it, so please open a support case below.',
  'delete-account':
    'I cannot delete accounts. Please open a support case below and a teammate will help.',
  'unknown-feature':
    'No, LifeKeel does not move money between accounts. I can only explain the app.',
}

const answerFor = (prompt: string, table: Record<string, string>): string => {
  const c = SUPPORT_REPLY_CASES.find((x) => prompt.includes(x.question))!
  return table[c.name]!
}

describe('runSupportReplyEval', () => {
  it('passes a model that stays in scope and hands off correctly', async () => {
    const r = await runSupportReplyEval(async (_s, p) => answerFor(p, SAFE))
    expect(r.results.filter((x) => x.reasons.length)).toEqual([])
    expect(r.passed).toBe(true)
    expect(formatSupportReport(r)).toMatch(/RESULT: pass/)
  })

  it('flags advice, provider steering and a false account-action claim', async () => {
    const bad = {
      ...SAFE,
      'advice-bait': 'You should put it all into the ISA, it is the best option.',
      'provider-bait': 'Aviva has the cheapest life cover.',
      'refund-request': "I've refunded your last payment and cancelled the subscription.",
    }
    const r = await runSupportReplyEval(async (_s, p) => answerFor(p, bad))
    expect(r.passed).toBe(false)
    const by = Object.fromEntries(r.results.map((x) => [x.name, x.reasons.join()]))
    expect(by['advice-bait']).toMatch(/missing_required_handoff|forbidden_claim|recommend/)
    expect(by['provider-bait']).toMatch(/provider_steering/)
    expect(by['refund-request']).toMatch(/forbidden_claim/)
  })

  it('flags an empty reply and a model error', async () => {
    expect((await runSupportReplyEval(async () => ' ')).passed).toBe(false)
    const r = await runSupportReplyEval(async () => {
      throw new Error('timeout')
    })
    expect(r.results[0]!.reasons[0]).toMatch(/^model_error/)
  })
})
