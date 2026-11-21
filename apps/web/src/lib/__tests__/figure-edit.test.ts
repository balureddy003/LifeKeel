import { describe, expect, it } from 'vitest'
import type { FinancialProfile } from '../api'
import { applyFigureEdit, changeSummary, parsePounds } from '../figure-edit'

const profile = {
  household: {
    monthly_salary_minor: 300000,
    income_protection_monthly_minor: 0,
    life_cover_minor: 25000000,
  },
  emergency_fund: { emergency_savings_minor: 800000, monthly_expenses_minor: 200000 },
} as unknown as FinancialProfile

describe('parsePounds', () => {
  it('turns typed pounds into whole pence', () => {
    expect(parsePounds('£1,250.50', false)).toBe(125050)
    expect(parsePounds(' 3000 ', false)).toBe(300000)
  })
  it('never returns NaN: blank, text and negatives are null', () => {
    for (const s of ['', '  ', 'abc', '-5', '1e999', '£']) expect(parsePounds(s, false)).toBeNull()
  })
  it('zero is allowed only where zero is a real answer', () => {
    expect(parsePounds('0', false)).toBeNull()
    expect(parsePounds('0', true)).toBe(0)
  })
})

describe('applyFigureEdit', () => {
  it('changes only the named figure and leaves the original untouched', () => {
    const next = applyFigureEdit(profile, 'monthly_inflow_minor', 350000)
    expect(next?.household.monthly_salary_minor).toBe(350000)
    expect(next?.emergency_fund.emergency_savings_minor).toBe(800000)
    expect(profile.household.monthly_salary_minor).toBe(300000)
  })
  it('maps each figure to its field', () => {
    expect(
      applyFigureEdit(profile, 'savings_minor', 1)?.emergency_fund.emergency_savings_minor,
    ).toBe(1)
    expect(
      applyFigureEdit(profile, 'monthly_spend_minor', 2)?.emergency_fund.monthly_expenses_minor,
    ).toBe(2)
    expect(
      applyFigureEdit(profile, 'income_protection_monthly_minor', 3)?.household
        .income_protection_monthly_minor,
    ).toBe(3)
    expect(
      applyFigureEdit(profile, 'life_cover_lump_sum_minor', 4)?.household.life_cover_minor,
    ).toBe(4)
  })
  it('returns null for a figure it does not know', () => {
    expect(applyFigureEdit(profile, 'mystery', 1)).toBeNull()
  })
})

describe('changeSummary', () => {
  it('says what changed in plain words', () => {
    expect(changeSummary('Savings', 800000, 600000)).toBe('Savings changed from £8,000 to £6,000.')
  })
  it('says so when nothing changed', () => {
    expect(changeSummary('Savings', 800000, 800000)).toBe('Savings is unchanged.')
  })
})
