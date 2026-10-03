import { describe, expect, it } from 'vitest'
import { toScenarioProfileInput } from '../profile-input.js'

// Two-earner household: organizer earns £4,000/mo (top-level field),
// Priya earns £2,000/mo via household.members[]. Education funds: one
// linked to Sam's roster id, one unlinked.
const profile = {
  household: {
    monthly_salary_minor: 400_000,
    annual_living_expenses_minor: 360_000,
    members: [{ member_id: 'm_priya', monthly_salary_minor: 200_000 }],
  },
  emergency_fund: {
    emergency_savings_minor: 900_000,
    monthly_expenses_minor: 300_000,
  },
  education_funds: [
    { child_name: 'Sam', member_id: 'm_sam', current_savings_minor: 200_000, target_savings_minor: 2_000_000, years_remaining: 10 },
    { child_name: 'Unlinked', current_savings_minor: 50_000, target_savings_minor: 100_000, years_remaining: 5 },
  ],
}

describe('toScenarioProfileInput', () => {
  it('household scope sums every earner — unchanged from before member scope existed', () => {
    const input = toScenarioProfileInput(profile)!
    expect(input.monthlyIncomeMinor).toBe(600_000)
    expect(input.educationFunds).toHaveLength(2)
    expect(input.emergencySavingsMinor).toBe(900_000)
    expect(input.monthlyExpensesMinor).toBe(300_000)
  })

  it('member scope uses only that member\'s earner slice', () => {
    const input = toScenarioProfileInput(profile, { member_id: 'm_priya', is_organizer: false })!
    expect(input.monthlyIncomeMinor).toBe(200_000)
    // Shared pool + shared costs stay — they're joint by nature.
    expect(input.emergencySavingsMinor).toBe(900_000)
    expect(input.monthlyExpensesMinor).toBe(300_000)
  })

  it('organizer scope reads the top-level salary, not members[]', () => {
    const input = toScenarioProfileInput(profile, { member_id: 'm_org', is_organizer: true })!
    expect(input.monthlyIncomeMinor).toBe(400_000)
  })

  it('a member with no earner entry projects on zero income', () => {
    // A child or non-earning member: income 0 — expenses still on file, so
    // the projection is honest rather than null.
    const input = toScenarioProfileInput(profile, { member_id: 'm_sam', is_organizer: false })!
    expect(input.monthlyIncomeMinor).toBe(0)
  })

  it('member scope filters education funds to the member\'s own when linked', () => {
    const input = toScenarioProfileInput(profile, { member_id: 'm_sam', is_organizer: false })!
    expect(input.educationFunds.map((f) => f.childName)).toEqual(['Sam'])
  })

  it('member scope keeps all funds when the member is no fund\'s beneficiary', () => {
    // An adult scoping "my income" still needs every child's timeline —
    // the funds are household obligations, not the member's.
    const input = toScenarioProfileInput(profile, { member_id: 'm_priya', is_organizer: false })!
    expect(input.educationFunds).toHaveLength(2)
  })

  it('returns null when nothing is on file to project', () => {
    expect(toScenarioProfileInput(null)).toBeNull()
    expect(toScenarioProfileInput({})).toBeNull()
    expect(
      toScenarioProfileInput({
        household: { monthly_salary_minor: 0, annual_living_expenses_minor: 0 },
      }),
    ).toBeNull()
  })
})
