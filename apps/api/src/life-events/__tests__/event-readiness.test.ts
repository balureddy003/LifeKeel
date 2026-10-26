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
    const sixMonths = computeEventReadiness(
      'job-loss',
      makeProfile({
        emergency_fund: {
          emergency_savings_minor: 1_800_000,
          monthly_expenses_minor: 300_000,
          has_high_interest_debt: false,
          high_interest_debt_balance_minor: 0,
        },
      }),
    )
    expect(sixMonths.hasLiveData).toBe(true)
    expect(sixMonths.stability).toBeLessThanOrEqual(98)
    expect(sixMonths.explanation).toContain('6 months')

    const noRunway = computeEventReadiness(
      'job-loss',
      makeProfile({
        emergency_fund: {
          emergency_savings_minor: 0,
          monthly_expenses_minor: 300_000,
          has_high_interest_debt: false,
          high_interest_debt_balance_minor: 0,
        },
      }),
    )
    expect(noRunway.stability).toBeGreaterThanOrEqual(5)
    expect(noRunway.stability).toBeLessThan(sixMonths.stability)
  })

  it('job-loss: honest "no data" when monthly expenses were never entered, not a fabricated number', () => {
    const result = computeEventReadiness('job-loss', makeProfile())
    expect(result.hasLiveData).toBe(false)
  })

  it('bereavement and medical: reflect the same life-cover-vs-need formula protection-gap.yaml uses', () => {
    const wellCovered = computeEventReadiness(
      'bereavement',
      makeProfile({
        household: {
          employment_status: 'employed',
          monthly_salary_minor: 400000,
          annual_living_expenses_minor: 250000,
          mortgage_outstanding_minor: 20_000_000,
          life_cover_minor: 40_000_000,
          income_protection_monthly_minor: 0,
          monthly_debt_payments_minor: 0,
          members: [],
        },
      }),
    )
    expect(wellCovered.hasLiveData).toBe(true)
    expect(wellCovered.stability).toBeGreaterThan(50)
    expect(wellCovered.explanation).toContain('£400,000') // life cover, 40,000,000 minor units

    const underCovered = computeEventReadiness(
      'medical',
      makeProfile({
        household: {
          employment_status: 'employed',
          monthly_salary_minor: 400000,
          annual_living_expenses_minor: 250000,
          mortgage_outstanding_minor: 20_000_000,
          life_cover_minor: 0,
          income_protection_monthly_minor: 0,
          monthly_debt_payments_minor: 0,
          members: [],
        },
      }),
    )
    expect(underCovered.stability).toBeLessThan(wellCovered.stability)
  })

  it('bereavement: nothing to replace on file reads as reassuring, not as a fabricated gap', () => {
    const result = computeEventReadiness('bereavement', makeProfile())
    expect(result.hasLiveData).toBe(true)
    expect(result.stability).toBe(95)
  })

  it('car/property/travel: real policy on file raises the score and names the real provider', () => {
    const withCar = computeEventReadiness(
      'car',
      makeProfile({
        policies: [
          {
            type: 'car',
            provider: 'Direct Line',
            coverage_amount_minor: 500000,
            monthly_premium_minor: 4000,
          },
        ],
      }),
    )
    expect(withCar.hasLiveData).toBe(true)
    expect(withCar.explanation).toContain('Direct Line')

    const withHome = computeEventReadiness(
      'property',
      makeProfile({
        policies: [
          {
            type: 'home',
            provider: 'Aviva',
            coverage_amount_minor: 30_000_000,
            monthly_premium_minor: 3000,
          },
        ],
      }),
    )
    expect(withHome.explanation).toContain('Aviva')
  })

  it('car/property/travel: no matching policy on file is honest "no data", never a guessed number', () => {
    expect(computeEventReadiness('car', makeProfile()).hasLiveData).toBe(false)
    expect(computeEventReadiness('property', makeProfile()).hasLiveData).toBe(false)
    expect(computeEventReadiness('travel', makeProfile()).hasLiveData).toBe(false)
  })

  it('university: saved-vs-target ratio — a real number, never the insight confidence', () => {
    const funded = computeEventReadiness(
      'university',
      makeProfile({
        education_funds: [
          {
            child_name: 'Maya',
            child_age: 10,
            current_savings_minor: 4_000_000,
            target_savings_minor: 8_000_000,
            years_remaining: 8,
          },
        ],
      }),
    )
    expect(funded.hasLiveData).toBe(true)
    expect(funded.stability).toBeGreaterThan(40)
    expect(funded.stability).toBeLessThan(60)
    expect(funded.explanation).toContain('Maya')

    // Nothing saved against a real target is a LOW score — the exact
    // inversion UAT D5/D6 caught when the frontend mapped the detector's
    // 0.85 gap-confidence onto "readiness".
    const nothingSaved = computeEventReadiness(
      'university',
      makeProfile({
        education_funds: [
          {
            child_name: 'Maya',
            child_age: 10,
            current_savings_minor: 0,
            target_savings_minor: 8_000_000,
            years_remaining: 8,
          },
        ],
      }),
    )
    expect(nothingSaved.stability).toBeLessThan(20)

    // No fund targets on file is honest no-data, not a fabricated number.
    expect(computeEventReadiness('university', makeProfile()).hasLiveData).toBe(false)
  })

  it('retirement: achievable-vs-target income from the same projectRetirement the score uses', () => {
    const onTrack = computeEventReadiness(
      'retirement',
      makeProfile({
        retirement: {
          current_age: 30,
          target_retirement_age: 65,
          pension_balance_minor: 20_000_000,
          monthly_contribution_minor: 60_000,
          target_retirement_income_minor: 2_000_000,
          expected_annual_growth_pct: 5,
        },
      }),
    )
    expect(onTrack.hasLiveData).toBe(true)
    expect(onTrack.explanation).toContain('target')

    // No target income on file is honest no-data.
    expect(computeEventReadiness('retirement', makeProfile()).hasLiveData).toBe(false)
  })

  it('new-child/marriage: not attempted — no defensible formula exists, so callers fall back to their own sample', () => {
    for (const id of ['new-child', 'marriage']) {
      expect(computeEventReadiness(id, makeProfile()).hasLiveData).toBe(false)
    }
  })
})

describe('missing_inputs + annual fallback (intent 21)', () => {
  it('job-loss names monthly expenses when absent', () => {
    const r = computeEventReadiness('job-loss', makeProfile())
    expect(r.hasLiveData).toBe(false)
    expect(r.missing_inputs).toContain('monthly expenses (or annual living expenses)')
  })

  it('job-loss computes real runway from annual living expenses when monthly is absent', () => {
    const r = computeEventReadiness(
      'job-loss',
      makeProfile({
        household: {
          employment_status: 'employed',
          monthly_salary_minor: 400000,
          annual_living_expenses_minor: 3_600_000, // -> £3k/mo
          mortgage_outstanding_minor: 0,
          life_cover_minor: 0,
          income_protection_monthly_minor: 0,
          monthly_debt_payments_minor: 0,
          members: [],
        },
        emergency_fund: {
          emergency_savings_minor: 900_000, // £9k -> 3 months
          monthly_expenses_minor: 0,
          has_high_interest_debt: false,
          high_interest_debt_balance_minor: 0,
        },
      }),
    )
    expect(r.hasLiveData).toBe(true)
    expect(r.stability).toBe(50) // 3/6 months
    expect(r.explanation).toContain('3 months')
  })

  it('policy events name the missing policy type', () => {
    const r = computeEventReadiness('car', makeProfile())
    expect(r.hasLiveData).toBe(false)
    expect(r.missing_inputs).toEqual(['a car insurance policy on file'])
  })

  it('university names the missing education fund target', () => {
    const r = computeEventReadiness('university', makeProfile())
    expect(r.hasLiveData).toBe(false)
    expect(r.missing_inputs).toEqual(['an education fund with a savings target'])
  })

  it('retirement names the missing target income', () => {
    const r = computeEventReadiness('retirement', makeProfile())
    expect(r.hasLiveData).toBe(false)
    expect(r.missing_inputs).toEqual(['a target retirement income'])
  })

  it('an event id with no formula stays a plain no-data result', () => {
    const r = computeEventReadiness('new-child', makeProfile())
    expect(r.hasLiveData).toBe(false)
    expect(r.missing_inputs).toBeUndefined()
  })
})
