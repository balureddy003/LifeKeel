/**
 * Groq retired every Llama 3.x id (console.groq.com/docs/deprecations); calls to them now error. The models
 * LifeKeel picks for Groq must be current, route to Groq (not OpenAI, despite the 'openai/' namespace), and
 * have their own cost row rather than falling back to another model's price.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_MODELS, DEFAULT_TIER_MODELS, detectProviderFromModel } from '../llm.js'
import { computeCost } from '../cost-ledger.js'

const RETIRED = /^llama-3\.[13]-|^llama3-/
const groqModels = [...Object.values(DEFAULT_TIER_MODELS.groq), DEFAULT_MODELS.groq]

describe('Groq models', () => {
  it('uses no retired Llama id', () => {
    for (const m of groqModels) expect(m).not.toMatch(RETIRED)
  })

  it('routes every picked model to Groq', () => {
    for (const m of groqModels) expect(detectProviderFromModel(m), m).toBe('groq')
  })

  it('prices each picked model from its own row', () => {
    // 1M in + 1M out: 120b is $0.15 + $0.60, 20b is $0.075 + $0.30 (table units: $ per 1M x 100).
    expect(computeCost('openai/gpt-oss-120b', 1_000_000, 1_000_000)).toBe(75_000)
    expect(computeCost('openai/gpt-oss-20b', 1_000_000, 1_000_000)).toBe(37_500)
  })
})
