import { describe, it, expect } from 'vitest'
import { emergencyPolicies } from '../emergency-policies'
import type { FinancialProfilePolicy } from '../api'

const pol = (type: string, provider = 'P') =>
  ({ type, provider }) as unknown as FinancialProfilePolicy

describe('emergencyPolicies', () => {
  const all = [pol('life', 'A'), pol('critical_illness', 'B'), pol('income_protection', 'C')]
  it('a bereavement points at life cover', () => {
    expect(emergencyPolicies('bereavement', all).matches.map((p) => p.provider)).toEqual(['A'])
  })
  it('a medical emergency points at critical illness and income protection', () => {
    expect(
      emergencyPolicies('medical', all)
        .matches.map((p) => p.provider)
        .sort(),
    ).toEqual(['B', 'C'])
  })
  it('applies but is empty when nothing matches is on file', () => {
    expect(emergencyPolicies('medical', [pol('life')])).toEqual({ applies: true, matches: [] })
    expect(emergencyPolicies('bereavement', undefined)).toEqual({ applies: true, matches: [] })
  })
  it('does not apply to events none of these policies bear on', () => {
    expect(emergencyPolicies('car', all)).toEqual({ applies: false, matches: [] })
  })
  it('home damage points at the home policy on file (property had no emergency section before)', () => {
    const withHome = [...all, pol('home', 'H')]
    expect(emergencyPolicies('property', withHome).matches.map((p) => p.provider)).toEqual(['H'])
    expect(emergencyPolicies('property', all)).toEqual({ applies: true, matches: [] })
  })
})
