/**
 * OCR-to-Financial-Profile suggestion mapping — covers the money-string
 * parser and the category → profile-field rules that previously left
 * extracted document fields sitting inert (never surfaced to the Financial
 * Profile form).
 */

import { describe, expect, it } from 'vitest'
import {
  parseMoneyToMinorUnits,
  mapExtractedFieldsToProfileSuggestions,
  isApplicableProfilePath,
} from '../ocr/profile-mapping.js'

describe('parseMoneyToMinorUnits', () => {
  it('parses a dollar-formatted amount', () => {
    expect(parseMoneyToMinorUnits('$450,000.00')).toBe(45_000_000)
  })

  it('parses a pound-formatted amount', () => {
    expect(parseMoneyToMinorUnits('£1,140')).toBe(114_000)
  })

  it('parses a bare number', () => {
    expect(parseMoneyToMinorUnits('1140')).toBe(114_000)
  })

  it('returns null for undefined input', () => {
    expect(parseMoneyToMinorUnits(undefined)).toBeNull()
  })

  it('returns null for unparsable text', () => {
    expect(parseMoneyToMinorUnits('N/A')).toBeNull()
  })

  it('returns null for a zero amount', () => {
    expect(parseMoneyToMinorUnits('$0')).toBeNull()
  })
})

describe('mapExtractedFieldsToProfileSuggestions', () => {
  it('suggests life_cover_minor for an insurance document with a coverage_amount', () => {
    const suggestions = mapExtractedFieldsToProfileSuggestions('insurance', {
      provider: 'Northfield Mutual',
      coverage_amount: '$450,000.00',
    })
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({
      path: 'household.life_cover_minor',
      valueMinor: 45_000_000,
      sourceField: 'coverage_amount',
    })
  })

  it('suggests pension_balance_minor for a pension document', () => {
    const suggestions = mapExtractedFieldsToProfileSuggestions('pension', {
      fund_value: '£82,500',
    })
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]?.path).toBe('retirement.pension_balance_minor')
    expect(suggestions[0]?.valueMinor).toBe(8_250_000)
  })

  it('suggests mortgage_outstanding_minor for a mortgage document', () => {
    const suggestions = mapExtractedFieldsToProfileSuggestions('mortgage', {
      outstanding_balance: '$212,000',
    })
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]?.path).toBe('household.mortgage_outstanding_minor')
  })

  it('suggests monthly_salary_minor for a payslip/income document', () => {
    const suggestions = mapExtractedFieldsToProfileSuggestions('income', {
      net_pay: '£3,850',
    })
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]?.path).toBe('household.monthly_salary_minor')
  })

  it('returns no suggestions for categories with no mapping rule (investment, tax, will, other)', () => {
    expect(mapExtractedFieldsToProfileSuggestions('investment', { balance: '$10,000' })).toHaveLength(0)
    expect(mapExtractedFieldsToProfileSuggestions('other', { amount: '$500' })).toHaveLength(0)
  })

  it('returns no suggestions when no matching field is present', () => {
    expect(mapExtractedFieldsToProfileSuggestions('insurance', { provider: 'Acme' })).toHaveLength(0)
  })

  it('returns no suggestions when the matching field is unparsable', () => {
    expect(mapExtractedFieldsToProfileSuggestions('insurance', { coverage_amount: 'See attached schedule' })).toHaveLength(0)
  })
})

describe('isApplicableProfilePath', () => {
  it('accepts the whitelisted paths', () => {
    expect(isApplicableProfilePath('household.life_cover_minor')).toBe(true)
    expect(isApplicableProfilePath('retirement.pension_balance_minor')).toBe(true)
    // household.monthly_salary_minor: added alongside the 'income' OCR
    // category (payslips/P60s) — see profile-mapping.ts's rules array.
    expect(isApplicableProfilePath('household.monthly_salary_minor')).toBe(true)
  })

  it('rejects arbitrary paths', () => {
    // A real FinancialProfile field, deliberately not on the OCR-suggestion
    // whitelist (no document type maps to it) — the meaningful "arbitrary"
    // case is a plausible-looking path that's still rejected, not a
    // nonsense one.
    expect(isApplicableProfilePath('household.annual_living_expenses_minor')).toBe(false)
    expect(isApplicableProfilePath('__proto__.polluted')).toBe(false)
    expect(isApplicableProfilePath('tenant_id')).toBe(false)
  })
})
