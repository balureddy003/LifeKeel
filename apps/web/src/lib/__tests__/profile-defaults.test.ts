import { describe, expect, it } from 'vitest'
import { withProfileDefaults } from '../profile-defaults'
import { chipsFor } from '../memberChips'

// A household that only ever used the quick "Add a policy" form (or a document apply) has a stored
// profile holding just `policies`. Every screen reads household/retirement/emergency_fund, so the
// reader must see a whole profile, not a crash.
describe('withProfileDefaults', () => {
  const skeleton = {
    policies: [
      {
        id: 'pol_1',
        type: 'life',
        provider: 'Test Insurer',
        coverage_amount_minor: 25_000_000,
        monthly_premium_minor: 4200,
      },
    ],
  }

  it('fills every section a policies-only profile is missing', () => {
    const p = withProfileDefaults(skeleton as never)
    expect(p.household.monthly_salary_minor).toBe(0)
    expect(p.household.members).toEqual([])
    expect(p.household.employment_status).toBe('employed')
    expect(p.emergency_fund.monthly_expenses_minor).toBe(0)
    expect(p.retirement.current_age).toBe(30)
    expect(p.retirement.target_retirement_age).toBe(65)
    expect(p.retirement.expected_annual_growth_pct).toBe(5)
    expect(p.education_funds).toEqual([])
  })

  it('keeps the policies it was given', () => {
    expect(withProfileDefaults(skeleton as never).policies).toHaveLength(1)
  })

  it('never overwrites a figure the family entered', () => {
    const p = withProfileDefaults({
      ...skeleton,
      household: { monthly_salary_minor: 420_000, members: [{ member_id: 'm1' }] },
      retirement: { current_age: 41 },
    } as never)
    expect(p.household.monthly_salary_minor).toBe(420_000)
    expect(p.household.members).toHaveLength(1)
    expect(p.retirement.current_age).toBe(41)
    // a missing sibling in a present section still gets its default
    expect(p.retirement.target_retirement_age).toBe(65)
    expect(p.household.life_cover_minor).toBe(0)
  })

  it('makes the Family page chips work for a policies-only profile', () => {
    const p = withProfileDefaults(skeleton as never)
    expect(() => chipsFor('m1', 'organizer', 'Pass', p)).not.toThrow()
    expect(() => chipsFor('m2', 'adult', 'Tom', p)).not.toThrow()
  })
})
