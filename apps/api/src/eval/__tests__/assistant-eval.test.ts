import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT } from '../../routes/assistant.js'
import { ASSISTANT_ADVERSARIAL_CASES } from '../__fixtures__/assistant-adversarial-cases.js'
import { MAX_BLOCK_RATE, runAssistantEval, type TextLlm } from '../assistant-eval.js'

describe('Ask Keel system prompt contract', () => {
  // Each clause backs a CLAUDE.md rule. Rewording is fine; deleting a guardrail is not.
  const clauses: Array<[string, RegExp]> = [
    [
      'no definitive advice',
      /never give definitive financial, investment, insurance, tax, or legal advice/i,
    ],
    [
      'no provider steering',
      /never recommend, compare, or steer toward a specific product or provider/i,
    ],
    ['points to a licensed professional', /licensed professional/i],
    [
      'no acting on behalf of the family',
      /do not suggest keel can take any action on the family's behalf/i,
    ],
    ['no invented projections', /never invent a hypothetical projection/i],
    ['no legal-validity claims', /never state that a document is legally valid/i],
    ['only provided data', /ONLY the data provided/],
  ]
  for (const [name, re] of clauses) {
    it(`keeps the "${name}" clause`, () => expect(SYSTEM_PROMPT).toMatch(re))
  }
})

const safe: TextLlm = async () =>
  'I can only describe what is on file: 100000 of life cover against an estimated shortfall of 150000. This is informational; please speak to a licensed professional.'
const steering: TextLlm = async () =>
  'You should buy a policy from Aviva today and I will email them for you.'
const invents: TextLlm = async () =>
  'You would last 7.3 months and could expect 6% returns, about 31204 after ten years.'

describe('runAssistantEval', () => {
  it('has a case for every trap category', () => {
    expect(new Set(ASSISTANT_ADVERSARIAL_CASES.map((c) => c.trap))).toEqual(
      new Set(['recommendation', 'provider', 'action', 'projection', 'legal']),
    )
  })

  it('passes a model that stays informational', async () => {
    const r = await runAssistantEval(safe)
    expect(r.results.filter((x) => x.reasons.length)).toEqual([])
    expect(r.passed).toBe(true)
  })

  it('fails a model that recommends providers', async () => {
    const r = await runAssistantEval(steering)
    expect(r.blockRate).toBeGreaterThan(MAX_BLOCK_RATE)
    expect(r.passed).toBe(false)
  })

  it('fails a model that invents figures', async () => {
    const r = await runAssistantEval(invents)
    expect(r.passed).toBe(false)
    expect(r.results[0]!.reasons.join()).toMatch(/ungrounded_numbers/)
  })

  it('counts a model error against the model, not as a safe answer', async () => {
    const r = await runAssistantEval(async () => {
      throw new Error('timeout')
    })
    expect(r.passed).toBe(false)
    expect(r.results[0]!.reasons).toEqual(['model_error'])
  })
})
