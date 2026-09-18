/**
 * mapExtractedFieldsToPolicySuggestion — the missing link between OCR'd
 * insurance documents (extract.ts) and policies[] (family-financial-profile.ts).
 * See profile-mapping.ts's own module doc for why this exists: OCR already
 * extracts the right insurance fields, but nothing ever turned them into a
 * policies[]-shaped suggestion, so every policy had to be hand-typed
 * regardless of what was uploaded or scanned from email.
 */

import { describe, expect, it } from 'vitest'
import { mapExtractedFieldsToPolicySuggestion, mapExtractedFieldsToProfileSuggestions } from '../profile-mapping.js'

describe('mapExtractedFieldsToPolicySuggestion', () => {
  it('returns null for non-insurance categories', () => {
    expect(mapExtractedFieldsToPolicySuggestion('pension', { provider: 'Aviva' })).toBeNull()
    expect(mapExtractedFieldsToPolicySuggestion('mortgage', { provider: 'Nationwide' })).toBeNull()
    expect(mapExtractedFieldsToPolicySuggestion('other', {})).toBeNull()
  })

  it('returns null when no provider was extracted — the minimum confidence bar', () => {
    expect(
      mapExtractedFieldsToPolicySuggestion('insurance', {
        coverage_amount: '250000',
        policy_type: 'life',
      }),
    ).toBeNull()
  })

  it('builds a full suggestion from a well-extracted life insurance document', () => {
    const result = mapExtractedFieldsToPolicySuggestion('insurance', {
      provider: 'Legal & General',
      policy_type: 'life',
      policy_number: 'LG-99182734',
      coverage_amount: '£250,000',
      premium: '£24.50',
      renewal_date: '2027-03-01',
    })

    expect(result).toEqual({
      type: 'life',
      provider: 'Legal & General',
      coverageAmountMinor: 25_000_000,
      monthlyPremiumMinor: 2450,
      renewalDate: '2027-03-01',
      policyNumber: 'LG-99182734',
    })
  })

  it('maps a "car" policy_type from the OCR prompt straight through', () => {
    const result = mapExtractedFieldsToPolicySuggestion('insurance', {
      provider: 'Admiral',
      policy_type: 'car',
      premium: '85.00',
    })
    expect(result?.type).toBe('car')
    expect(result?.monthlyPremiumMinor).toBe(8500)
  })

  it('leaves type null when policy_type is missing or unrecognized, rather than guessing', () => {
    const missing = mapExtractedFieldsToPolicySuggestion('insurance', { provider: 'Aviva' })
    expect(missing?.type).toBeNull()

    const unrecognized = mapExtractedFieldsToPolicySuggestion('insurance', {
      provider: 'Aviva',
      policy_type: 'pet',
    })
    expect(unrecognized?.type).toBeNull()
  })

  it('never guess-parses a non-ISO renewal date — leaves it for the user to re-enter', () => {
    const result = mapExtractedFieldsToPolicySuggestion('insurance', {
      provider: 'Aviva',
      renewal_date: '15 March 2027',
    })
    expect(result?.renewalDate).toBeNull()
  })

  it('accepts a strict ISO renewal date unchanged', () => {
    const result = mapExtractedFieldsToPolicySuggestion('insurance', {
      provider: 'Aviva',
      maturity_date: '2028-11-30',
    })
    expect(result?.renewalDate).toBe('2028-11-30')
  })

  it('leaves coverage/premium null rather than zero when nothing was extracted', () => {
    const result = mapExtractedFieldsToPolicySuggestion('insurance', { provider: 'Aviva' })
    expect(result?.coverageAmountMinor).toBeNull()
    expect(result?.monthlyPremiumMinor).toBeNull()
  })

  it('falls back to account_number when policy_number is absent', () => {
    const result = mapExtractedFieldsToPolicySuggestion('insurance', {
      provider: 'Aviva',
      account_number: 'ACC-4471',
    })
    expect(result?.policyNumber).toBe('ACC-4471')
  })

  // Regression guard: the existing scalar-path mapping (unrelated household/
  // retirement fields) must keep working unchanged alongside the new policy path.
  it('does not change the existing scalar profile-suggestion behavior', () => {
    const result = mapExtractedFieldsToProfileSuggestions('insurance', {
      coverage_amount: '£250,000',
    })
    expect(result).toEqual([
      {
        path: 'household.life_cover_minor',
        label: 'Life insurance cover',
        valueMinor: 25_000_000,
        sourceField: 'coverage_amount',
        sourceValue: '£250,000',
      },
    ])
  })
})
