import { describe, expect, it } from 'vitest'
import { chipsFor } from '../memberChips'
import type { FinancialProfile, FinancialProfilePolicy } from '../api'

// UAT P8: production showed the organizer's Protection chip "on file" and
// Income chip "on file" on a profile that had never meaningfully been
// filled in. Two causes: 'employed' is the wizard's untouched default so
// `status !== 'unemployed'` always passed, and `covered` counted any
// household policy (car/home/travel) toward personal protection.

function makeProfile(overrides: Partial<FinancialProfile> = {}): FinancialProfile {
  return {
    household: {
      employment_status: 'employed',
      monthly_salary_minor: 0,
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
  }
}

function makePolicy(overrides: Partial<FinancialProfilePolicy> = {}): FinancialProfilePolicy {
  return {
    type: 'life',
    provider: 'Aviva',
    coverage_amount_minor: 10_000_00,
    monthly_premium_minor: 2_000,
    ...overrides,
  }
}

function chip(memberId: string, role: string, profile: FinancialProfile | null, label: string) {
  return chipsFor(memberId, role, 'Alex', profile).find((c) => c.label === label)
}

describe('chipsFor — UAT P8 honest "on file" signals', () => {
  it('returns no chips when there is no profile', () => {
    expect(chipsFor('m1', 'organizer', 'Alex', null)).toEqual([])
  })

  it('does not mark Income on file for a default untouched profile', () => {
    // 'employed' + salary 0 is exactly what the wizard writes on a
    // step-1 autosave before the user answers anything.
    const c = chip('m1', 'organizer', makeProfile(), 'Income')
    expect(c?.onFile).toBe(false)
  })

  it('marks Income on file once a real salary exists', () => {
    const profile = makeProfile()
    profile.household.monthly_salary_minor = 5_000_00
    expect(chip('m1', 'organizer', profile, 'Income')?.onFile).toBe(true)
  })

  it('marks Income on file for a deliberately non-employed status', () => {
    const profile = makeProfile()
    profile.household.employment_status = 'self_employed'
    expect(chip('m1', 'organizer', profile, 'Income')?.onFile).toBe(true)
  })

  it('does not mark Protection on file for a household (car) policy', () => {
    const profile = makeProfile({ policies: [makePolicy({ type: 'car' })] })
    expect(chip('m1', 'organizer', profile, 'Protection')?.onFile).toBe(false)
  })

  it('marks Protection on file for an unattributed life policy', () => {
    const profile = makeProfile({ policies: [makePolicy({ type: 'life' })] })
    expect(chip('m1', 'organizer', profile, 'Protection')?.onFile).toBe(true)
  })

  it('marks Protection on file for declared life cover even without a policy', () => {
    const profile = makeProfile()
    profile.household.life_cover_minor = 300_000_00
    expect(chip('m1', 'organizer', profile, 'Protection')?.onFile).toBe(true)
  })

  it('does not mark a member Protection chip for a policy attributed to someone else', () => {
    const profile = makeProfile({
      policies: [makePolicy({ type: 'life', member_id: 'other-member' })],
    })
    profile.household.members.push({
      member_id: 'm2',
      employment_status: 'employed',
      monthly_salary_minor: 0,
      income_protection_monthly_minor: 0,
    })
    expect(chip('m2', 'parent', profile, 'Protection')?.onFile).toBe(false)
  })

  it('does not mark Income on file for a member entry on untouched defaults', () => {
    const profile = makeProfile()
    profile.household.members.push({
      member_id: 'm2',
      employment_status: 'employed',
      monthly_salary_minor: 0,
      income_protection_monthly_minor: 0,
    })
    expect(chip('m2', 'parent', profile, 'Income')?.onFile).toBe(false)
  })

  it('still counts household policies toward a child being covered', () => {
    const profile = makeProfile({ policies: [makePolicy({ type: 'home' })] })
    expect(chip('c1', 'child', profile, 'Covered by policies')?.onFile).toBe(true)
  })
})
