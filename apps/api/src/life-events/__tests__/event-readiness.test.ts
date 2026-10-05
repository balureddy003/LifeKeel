import { describe, it, expect } from 'vitest'
import { computeEventReadiness } from '../event-readiness.js'
import type { FinancialProfile } from '../../routes/family-financial-profile.js'

function makeProfile(overrides: Partial<FinancialProfile> = {}): FinancialProfile {
  return {
    household: {
      employment_status: 'employed',
      monthly_salary_minor: 400000,
      annual_living_expenses_minor: 0,
      mortgage_outstanding_minor: 0,
      life_cover_minor: 0,
      income_protection_monthly_minor: 0,
      monthly_debt_payments_minor: 0,
      members: [],
    },
    emergency_fund: {
      emergency_savings_minor: 0,
      monthly_expenses_minor: 0,
      has_high_interest_debt: false,
      high_interest_debt_balance_minor: 0,
    },
    retirement: {
      current_age: 30,
      target_retirement_age: 65,
      pension_balance_minor: 0,
      monthly_contribution_minor: 0,
      target_retirement_income_minor: 0,
      expected_annual_growth_pct: 5,
    },
    education_funds: [],
    policies: [],
    ...overrides,
  } as FinancialProfile
}

describe('computeEventReadiness', () => {
  it('job-loss: reflects real emergency-fund runway, capped never at 0 or 100', () => {
    const sixMonths = computeEventReadiness('job-loss', makeProfile({
      emergency_fund: { emergency_savings_minor: 1_800_000, monthly_expenses_minor: 300_000, has_high_interest_debt: false, high_interest_debt_balance_minor: 0 },
    }))
    expect(sixMonths.hasLiveData).toBe(true)
    expect(sixMonths.stability).toBeLessThanOrEqual(98)
    expect(sixMonths.explanation).toContain('6 months')

    const noRunway = computeEventReadiness('job-loss', makeProfile({
      emergency_fund: { emergency_savings_minor: 0, monthly_expenses_minor: 300_000, has_high_interest_debt: false, high_interest_debt_balance_minor: 0 },
    }))
    expect(noRunway.stability).toBeGreaterThanOrEqual(5)
    expect(noRunway.stability).toBeLessThan(sixMonths.stability)
  })

  it('job-loss: honest "no data" when monthly expenses were never entered, not a fabricated number', () => {
    const result = computeEventReadiness('job-loss', makeProfile())
    expect(result.hasLiveData).toBe(false)
  })

  it('bereavement and medical: reflect the same life-cover-vs-need formula protection-gap.yaml uses', () => {
    const wellCovered = computeEventReadiness('bereavement', makeProfile({
      household: { employment_status: 'employed', monthly_salary_minor: 400000, annual_living_expenses_minor: 250000, mortgage_outstanding_minor: 20_000_000, life_cover_minor: 40_000_000, income_protection_monthly_minor: 0, monthly_debt_payments_minor: 0, members: [] },
    }))
    expect(wellCovered.hasLiveData).toBe(true)
    expect(wellCovered.stability).toBeGreaterThan(50)
    expect(wellCovered.explanation).toContain('£400,000.00') // life cover, 40,000,000 minor units

    const underCovered = computeEventReadiness('medical', makeProfile({
      household: { employment_status: 'employed', monthly_salary_minor: 400000, annual_living_expenses_minor: 250000, mortgage_outstanding_minor: 20_000_000, life_cover_minor: 0, income_protection_monthly_minor: 0, monthly_debt_payments_minor: 0, members: [] },
    }))
    expect(underCovered.stability).toBeLessThan(wellCovered.stability)
  })

  it('bereavement: nothing to replace on file reads as reassuring, not as a fabricated gap', () => {
    const result = computeEventReadiness('bereavement', makeProfile())
    expect(result.hasLiveData).toBe(true)
    expect(result.stability).toBe(95)
  })

  it('car/property/travel: real policy on file raises the score and names the real provider', () => {
    const withCar = computeEventReadiness('car', makeProfile({
      policies: [{ type: 'car', provider: 'Direct Line', coverage_amount_minor: 500000, monthly_premium_minor: 4000 }],
    }))
    expect(withCar.hasLiveData).toBe(true)
    expect(withCar.explanation).toContain('Direct Line')

    const withHome = computeEventReadiness('property', makeProfile({
      policies: [{ type: 'home', provider: 'Aviva', coverage_amount_minor: 30_000_000, monthly_premium_minor: 3000 }],
    }))
    expect(withHome.explanation).toContain('Aviva')
  })

  it('car/property/travel: no matching policy on file is honest "no data", never a guessed number', () => {
    expect(computeEventReadiness('car', makeProfile()).hasLiveData).toBe(false)
    expect(computeEventReadiness('property', makeProfile()).hasLiveData).toBe(false)
    expect(computeEventReadiness('travel', makeProfile()).hasLiveData).toBe(false)
  })

  it('university/retirement/new-child/marriage: not attempted — no detector or formula exists, so callers fall back to their own sample', () => {
    for (const id of ['university', 'retirement', 'new-child', 'marriage']) {
      expect(computeEventReadiness(id, makeProfile()).hasLiveData).toBe(false)
    }
  })
})
