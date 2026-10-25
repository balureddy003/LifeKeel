/**
 * readiness/score.ts — composite readiness subscores (PRD-114). Pure
 * functions over a FinancialProfile + vault doc types; the properties that
 * matter are: absent data → null (never a false 0), detector-threshold
 * alignment, and composite renormalization when components drop out.
 */

import { describe, expect, it } from 'vitest'
import { computeMemberReadiness, computeReadiness, ESTATE_EXPECTED_DOC_TYPES } from '../score.js'
import type { FinancialProfile } from '../../routes/family-financial-profile.js'

const base: FinancialProfile = {
  household: {
    employment_status: 'employed',
    monthly_salary_minor: 400_000,
    annual_living_expenses_minor: 3_000_000, // £30k/yr → £2.5k/mo
    mortgage_outstanding_minor: 0,
    life_cover_minor: 0,
    income_protection_monthly_minor: 0,
    monthly_debt_payments_minor: 0,
    members: [],
  },
  emergency_fund: {
    emergency_savings_minor: 1_500_000, // £15k → 6 months
    monthly_expenses_minor: 250_000,
    has_high_interest_debt: false,
    high_interest_debt_balance_minor: 0,
  },
  retirement: {
    current_age: 40,
    target_retirement_age: 65,
    pension_balance_minor: 10_000_000, // £100k
    monthly_contribution_minor: 50_000, // £500/mo → ~£624k corpus over 25y at 5%
    target_retirement_income_minor: 2_000_000, // £20k/yr → £500k corpus target (achievable ~£24.9k)
    expected_annual_growth_pct: 5,
  },
  education_funds: [],
  policies: [],
}

describe('computeReadiness', () => {
  it('scores a fully-covered family high across all components', () => {
    const profile: FinancialProfile = {
      ...base,
      household: {
        ...base.household,
        life_cover_minor: 20_000_000,
        income_protection_monthly_minor: 20_000,
      },
      education_funds: [
        {
          child_name: 'A',
          child_age: 10,
          current_savings_minor: 500_000,
          target_savings_minor: 500_000,
          years_remaining: 8,
        },
      ],
      policies: [
        { type: 'health', provider: 'X', coverage_amount_minor: 0, monthly_premium_minor: 0 },
      ],
    }
    const result = computeReadiness(profile, [...ESTATE_EXPECTED_DOC_TYPES])
    expect(result.components).toHaveLength(5)
    for (const c of result.components) expect(c.score).toBe(100)
    expect(result.score).toBe(100)
  })

  it('returns score: null when nothing is scorable', () => {
    const empty: FinancialProfile = {
      ...base,
      household: {
        ...base.household,
        employment_status: 'retired',
        monthly_salary_minor: 0,
        annual_living_expenses_minor: 0,
        members: [],
      },
      emergency_fund: { ...base.emergency_fund, monthly_expenses_minor: 0 },
      retirement: { ...base.retirement, target_retirement_income_minor: 0 },
    }
    const result = computeReadiness(empty, null)
    expect(result.score).toBeNull()
    expect(result.components.every((c) => c.score === null)).toBe(true)
    expect(result.components.find((c) => c.key === 'estate')?.gated).toBe(true)
  })

  it('emergency fund falls back to annual living expenses when monthly is absent', () => {
    const p: FinancialProfile = {
      ...base,
      emergency_fund: {
        ...base.emergency_fund,
        monthly_expenses_minor: 0,
        emergency_savings_minor: 750_000,
      },
    }
    const c = computeReadiness(p, []).components.find((c) => c.key === 'emergency_fund')!
    // £7.5k vs £2.5k/mo → 3 months → 50
    expect(c.score).toBe(50)
  })

  it('protection scores partial per-earner income protection', () => {
    const p: FinancialProfile = {
      ...base,
      household: {
        ...base.household,
        income_protection_monthly_minor: 20_000, // primary covered
        monthly_debt_payments_minor: 0,
        members: [
          {
            member_id: 'm2',
            employment_status: 'employed',
            monthly_salary_minor: 200_000,
            income_protection_monthly_minor: 0,
          },
        ],
      },
      // no dependents → life cover and health checks don't apply;
      // income protection is the only applicable check (1 of 2 covered → 50)
    }
    const c = computeReadiness(p, []).components.find((c) => c.key === 'protection')!
    expect(c.score).toBe(50)
    expect(c.detail).toContain('income protection')
  })

  it('an unattributed income_protection policy covers the primary earner', () => {
    const p: FinancialProfile = {
      ...base,
      policies: [
        {
          type: 'income_protection',
          provider: 'X',
          coverage_amount_minor: 0,
          monthly_premium_minor: 0,
        },
      ],
    }
    const c = computeReadiness(p, []).components.find((c) => c.key === 'protection')!
    expect(c.score).toBe(100)
  })

  it('estate component is gated (excluded) for non-adults', () => {
    const result = computeReadiness(base, null)
    const estate = result.components.find((c) => c.key === 'estate')!
    expect(estate.gated).toBe(true)
    expect(estate.score).toBeNull()
    // Composite renormalizes without it — still a number
    expect(result.score).not.toBeNull()
  })

  it('estate scores on will + power_of_attorney only', () => {
    const willOnly = computeReadiness(base, ['will']).components.find((c) => c.key === 'estate')!
    expect(willOnly.score).toBe(50)
    expect(willOnly.detail).toContain('power of attorney')
    const other = computeReadiness(base, ['other', 'insurance_policy']).components.find(
      (c) => c.key === 'estate',
    )!
    expect(other.score).toBe(0)
  })

  it('education excludes funds with unset targets instead of scoring 0', () => {
    const p: FinancialProfile = {
      ...base,
      education_funds: [
        {
          child_name: 'A',
          child_age: 8,
          current_savings_minor: 50_000,
          target_savings_minor: 50,
          years_remaining: 10,
        }, // unset
        {
          child_name: 'B',
          child_age: 5,
          current_savings_minor: 100_000,
          target_savings_minor: 200_000,
          years_remaining: 13,
        },
      ],
    }
    const c = computeReadiness(p, []).components.find((c) => c.key === 'education')!
    expect(c.score).toBe(50) // only B's 50% counts
  })

  it('a null component drops out of the composite rather than scoring 0', () => {
    const p: FinancialProfile = { ...base, education_funds: [] } // education → null
    const withEstate = computeReadiness(p, [...ESTATE_EXPECTED_DOC_TYPES])
    const estate = withEstate.components.find((c) => c.key === 'estate')!
    expect(estate.score).toBe(100)
    // Composite = weighted mean of the four scored components
    const scored = withEstate.components.filter((c) => c.score !== null)
    const wSum = scored.reduce((s, c) => s + c.weight, 0)
    const expected = Math.round(scored.reduce((s, c) => s + (c.score! * c.weight) / wSum, 0))
    expect(withEstate.score).toBe(expected)
  })
})

describe('persona calibration bands (intent 20)', () => {
  // Anchors from the 2026-10-24 QA personas. These tests exist to make any
  // future weight/threshold change deliberate — they pin the *shape* of the
  // curve (a stage-appropriate profile scores high; a genuinely stressed one
  // low), not cosmetic point values.
  const youngCouple: FinancialProfile = {
    household: {
      employment_status: 'employed',
      monthly_salary_minor: 350_000,
      annual_living_expenses_minor: 2_640_000,
      mortgage_outstanding_minor: 18_000_000,
      life_cover_minor: 20_000_000,
      income_protection_monthly_minor: 150_000,
      monthly_debt_payments_minor: 20_000,
      members: [
        {
          member_id: 'm2',
          employment_status: 'employed',
          monthly_salary_minor: 280_000,
          income_protection_monthly_minor: 140_000,
        },
      ],
    },
    emergency_fund: {
      emergency_savings_minor: 800_000, // £8k vs £2.2k/mo → 3.6 months
      monthly_expenses_minor: 220_000,
      has_high_interest_debt: false,
      high_interest_debt_balance_minor: 0,
    },
    retirement: {
      current_age: 32,
      target_retirement_age: 65,
      pension_balance_minor: 1_500_000,
      monthly_contribution_minor: 30_000,
      target_retirement_income_minor: 1_800_000,
      expected_annual_growth_pct: 5,
    },
    education_funds: [],
    policies: [
      { type: 'health', provider: 'X', coverage_amount_minor: 0, monthly_premium_minor: 4_000 },
    ],
  }

  const highDebtSelfEmployed: FinancialProfile = {
    household: {
      employment_status: 'self_employed',
      monthly_salary_minor: 650_000,
      annual_living_expenses_minor: 3_600_000,
      mortgage_outstanding_minor: 0,
      life_cover_minor: 0,
      income_protection_monthly_minor: 0,
      monthly_debt_payments_minor: 85_000, // ~13% of income
      members: [],
    },
    emergency_fund: {
      emergency_savings_minor: 120_000, // £1.2k vs £3k/mo → 0.4 months
      monthly_expenses_minor: 300_000,
      has_high_interest_debt: true,
      high_interest_debt_balance_minor: 900_000,
    },
    retirement: {
      current_age: 38,
      target_retirement_age: 65,
      pension_balance_minor: 2_000_000,
      monthly_contribution_minor: 20_000,
      target_retirement_income_minor: 2_400_000,
      expected_annual_growth_pct: 5,
    },
    education_funds: [
      {
        child_name: 'A',
        child_age: 8,
        current_savings_minor: 50_000,
        target_savings_minor: 1_500_000,
        years_remaining: 10,
      },
    ],
    policies: [],
  }

  it('a young couple with a mortgage and some cover scores in the healthy band', () => {
    const r = computeReadiness(youngCouple, ['will'])
    expect(r.score).not.toBeNull()
    expect(r.score!).toBeGreaterThanOrEqual(55)
    expect(r.score!).toBeLessThanOrEqual(85)
  })

  it('a high-debt low-savings household scores punitively but not at zero', () => {
    const r = computeReadiness(highDebtSelfEmployed, ['will'])
    expect(r.score).not.toBeNull()
    expect(r.score!).toBeGreaterThanOrEqual(5)
    expect(r.score!).toBeLessThanOrEqual(30)
    // And the punishment is explainable: the weakest components are the
    // ones the numbers actually show (emergency fund, protection).
    const byKey = Object.fromEntries(r.components.map((c) => [c.key, c.score]))
    expect(byKey['protection']).toBe(0)
    expect(byKey['emergency_fund']!).toBeLessThanOrEqual(15)
  })
})

describe('computeMemberReadiness (PRD-118)', () => {
  it('scores the organizer from the household-level earner fields', () => {
    const profile: FinancialProfile = {
      ...base,
      household: {
        ...base.household,
        life_cover_minor: 20_000_000,
        income_protection_monthly_minor: 20_000,
      },
    }
    const result = computeMemberReadiness(
      profile,
      {
        memberId: 'org-1',
        role: 'organizer',
        age: 40,
        earner: {
          employment_status: 'employed',
          monthly_salary_minor: 400_000,
          income_protection_monthly_minor: 20_000,
        },
        policies: [],
        educationFunds: [],
      },
      [...ESTATE_EXPECTED_DOC_TYPES],
    )
    // Protection (IP + life cover met), retirement (on track), estate (both docs)
    expect(result.score).toBe(100)
    expect(result.components.map((c) => c.key)).toEqual(['protection', 'retirement', 'estate'])
  })

  it('an uncovered second earner drags their own protection to 0', () => {
    const result = computeMemberReadiness(
      base,
      {
        memberId: 'm2',
        role: 'adult',
        age: 35,
        earner: {
          employment_status: 'employed',
          monthly_salary_minor: 200_000,
          income_protection_monthly_minor: 0,
        },
        policies: [],
        educationFunds: [],
      },
      ['will'],
    )
    const protection = result.components.find((c) => c.key === 'protection')!
    // need > 0 (5× annual expenses) and employed → income protection +
    // life cover both apply, neither met for this member.
    expect(protection.score).toBe(0)
    expect(protection.detail).toContain('income protection')
    const retirement = result.components.find((c) => c.key === 'retirement')!
    expect(retirement.score).toBeNull() // honest null — not the organizer's number
    // Composite = (0×40 + 50×10) / 50 = 10
    expect(result.score).toBe(10)
  })

  it('a child twin is scored on education alone', () => {
    const result = computeMemberReadiness(
      base,
      {
        memberId: 'kid-1',
        role: 'child',
        age: 10,
        earner: null,
        policies: [],
        educationFunds: [{ current_savings_minor: 50_000, target_savings_minor: 100_000 }],
      },
      null,
    )
    expect(result.components.map((c) => c.key)).toEqual(['education'])
    expect(result.score).toBe(50)
  })

  it('a child with no fund gets an honest null, not a 0', () => {
    const result = computeMemberReadiness(
      base,
      { memberId: 'kid-2', role: 'child', age: 8, earner: null, policies: [], educationFunds: [] },
      null,
    )
    expect(result.score).toBeNull()
    expect(result.components.find((c) => c.key === 'education')?.detail).toContain(
      'No education fund',
    )
  })

  it('estate component is gated when the viewer is not an adult', () => {
    const result = computeMemberReadiness(
      base,
      {
        memberId: 'org-1',
        role: 'organizer',
        age: 40,
        earner: {
          employment_status: 'employed',
          monthly_salary_minor: 400_000,
          income_protection_monthly_minor: 20_000,
        },
        policies: [],
        educationFunds: [],
      },
      null,
    )
    const estate = result.components.find((c) => c.key === 'estate')!
    expect(estate.gated).toBe(true)
    expect(estate.score).toBeNull()
  })

  it("scores a second earner's retirement from their own pension (PRD-119)", () => {
    const earner = {
      employment_status: 'employed',
      monthly_salary_minor: 200_000, // 1/3 of household earned income
      income_protection_monthly_minor: 0,
      pension_balance_minor: 1_000_000,
      monthly_pension_contribution_minor: 5_000,
    }
    const slice = {
      memberId: 'm2',
      role: 'adult',
      age: 35,
      earner,
      policies: [],
      educationFunds: [],
    }
    const result = computeMemberReadiness(base, slice, [])
    const retirement = result.components.find((c) => c.key === 'retirement')!
    // Member target = 1/3 of household £20k → £6.67k/yr; their pension
    // projection determines the score — must be a real number.
    expect(retirement.score).not.toBeNull()
    expect(retirement.detail).toContain('household retirement target')

    // Monotonic: a bigger contribution can't score lower.
    const better = computeMemberReadiness(
      base,
      { ...slice, earner: { ...earner, monthly_pension_contribution_minor: 50_000 } },
      [],
    )
    expect(better.components.find((c) => c.key === 'retirement')!.score!).toBeGreaterThanOrEqual(
      retirement.score!,
    )
  })

  it('member pension without a date of birth stays unscored', () => {
    const result = computeMemberReadiness(
      base,
      {
        memberId: 'm2',
        role: 'adult',
        age: null,
        earner: {
          employment_status: 'employed',
          monthly_salary_minor: 200_000,
          income_protection_monthly_minor: 0,
          pension_balance_minor: 1_000_000,
          monthly_pension_contribution_minor: 5_000,
        },
        policies: [],
        educationFunds: [],
      },
      [],
    )
    const retirement = result.components.find((c) => c.key === 'retirement')!
    expect(retirement.score).toBeNull()
    expect(retirement.detail).toContain('date of birth')
  })

  it('member with no pension data keeps the honest null', () => {
    const result = computeMemberReadiness(
      base,
      {
        memberId: 'm2',
        role: 'adult',
        age: 35,
        earner: {
          employment_status: 'employed',
          monthly_salary_minor: 200_000,
          income_protection_monthly_minor: 0,
        },
        policies: [],
        educationFunds: [],
      },
      [],
    )
    const retirement = result.components.find((c) => c.key === 'retirement')!
    expect(retirement.score).toBeNull()
    expect(retirement.detail).toContain('No pension figures')
  })
})
