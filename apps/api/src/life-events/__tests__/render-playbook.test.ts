import { describe, it, expect } from 'vitest'
import { renderPlaybook } from '../render-playbook.js'
import type { FinancialProfile } from '../../routes/family-financial-profile.js'

function makeProfile(overrides: Partial<FinancialProfile> = {}): FinancialProfile {
  return {
    household: {
      employment_status: 'employed',
      monthly_salary_minor: 400000,
      annual_living_expenses_minor: 3600000,
      mortgage_outstanding_minor: 0,
      life_cover_minor: 10_000_000,
      income_protection_monthly_minor: 400000,
      members: [],
    },
    emergency_fund: {
      emergency_savings_minor: 900000,
      monthly_expenses_minor: 300000,
      has_high_interest_debt: false,
      high_interest_debt_balance_minor: 0,
    },
    retirement: {
      current_age: 30,
      target_retirement_age: 65,
      pension_balance_minor: 5_000_000,
      monthly_contribution_minor: 50000,
      target_retirement_income_minor: 3_000_000,
      expected_annual_growth_pct: 5,
    },
    education_funds: [],
    policies: [],
    ...overrides,
  } as FinancialProfile
}

describe('PRD-108: renderPlaybook', () => {
  it('loads all 3 in-scope playbooks with their steps intact', () => {
    for (const eventType of ['job_loss', 'bereavement', 'disability'] as const) {
      const playbook = renderPlaybook(eventType, makeProfile())
      expect(playbook.event_type).toBe(eventType)
      expect(playbook.steps.length).toBeGreaterThan(0)
      expect(playbook.steps.every((s) => s.body.length > 0)).toBe(true)
    }
  })

  it('job-loss runway reflects a real emergency_fund ÷ monthly_expenses computation, not a static string', () => {
    const withThreeMonths = renderPlaybook('job_loss', makeProfile({
      emergency_fund: { emergency_savings_minor: 900000, monthly_expenses_minor: 300000, has_high_interest_debt: false, high_interest_debt_balance_minor: 0 },
    }))
    const withOneMonth = renderPlaybook('job_loss', makeProfile({
      emergency_fund: { emergency_savings_minor: 300000, monthly_expenses_minor: 300000, has_high_interest_debt: false, high_interest_debt_balance_minor: 0 },
    }))
    const runway3 = withThreeMonths.steps.find((s) => s.id === 'runway')!.body
    const runway1 = withOneMonth.steps.find((s) => s.id === 'runway')!.body
    expect(runway3).toContain('3 months')
    expect(runway1).toContain('1 month')
    expect(runway3).not.toBe(runway1)
  })

  it('job-loss mortgage step reflects a real outstanding balance when one is on file, and an honest absence otherwise', () => {
    const withMortgage = renderPlaybook('job_loss', makeProfile({
      household: { employment_status: 'employed', monthly_salary_minor: 400000, annual_living_expenses_minor: 3600000, mortgage_outstanding_minor: 25_000_000, life_cover_minor: 10_000_000, income_protection_monthly_minor: 400000, members: [] },
    }))
    const withoutMortgage = renderPlaybook('job_loss', makeProfile())

    const stepWith = withMortgage.steps.find((s) => s.id === 'notify_mortgage_lender')!.body
    const stepWithout = withoutMortgage.steps.find((s) => s.id === 'notify_mortgage_lender')!.body
    expect(stepWith).toContain('£250000.00') // 25,000,000 minor units
    expect(stepWithout).toMatch(/don't have a mortgage on file/i)
  })

  it("bereavement's notify_insurers step lists every policy by provider and type", () => {
    const playbook = renderPlaybook('bereavement', makeProfile({
      policies: [
        { type: 'life', provider: 'Aviva', coverage_amount_minor: 10_000_000, monthly_premium_minor: 2000 },
        { type: 'home', provider: 'Direct Line', coverage_amount_minor: 2_000_000, monthly_premium_minor: 500 },
      ],
    }))
    const body = playbook.steps.find((s) => s.id === 'notify_insurers')!.body
    expect(body).toContain('Aviva')
    expect(body).toContain('Direct Line')
  })

  it("disability's check_cover branches correctly on income_protection and critical_illness cover", () => {
    const covered = renderPlaybook('disability', makeProfile({
      policies: [{ type: 'critical_illness', provider: 'Bupa', coverage_amount_minor: 5_000_000, monthly_premium_minor: 1500 }],
    }))
    const uncovered = renderPlaybook('disability', makeProfile({
      household: { employment_status: 'employed', monthly_salary_minor: 400000, annual_living_expenses_minor: 3600000, mortgage_outstanding_minor: 0, life_cover_minor: 10_000_000, income_protection_monthly_minor: 0, members: [] },
    }))
    expect(covered.steps.find((s) => s.id === 'check_cover')!.body).toMatch(/how to claim/i)
    expect(uncovered.steps.find((s) => s.id === 'check_cover')!.body).toMatch(/why that matters/i)
  })

  it('resolves affectedMemberId against household.members[] rather than only the household total', () => {
    const playbook = renderPlaybook('disability', makeProfile({
      household: {
        employment_status: 'employed',
        monthly_salary_minor: 400000,
        annual_living_expenses_minor: 3600000,
        mortgage_outstanding_minor: 0,
        life_cover_minor: 10_000_000,
        income_protection_monthly_minor: 0,
        members: [{ member_id: 'member-1', employment_status: 'employed', monthly_salary_minor: 300000, income_protection_monthly_minor: 300000 }],
      },
    }), 'member-1')
    expect(playbook.steps.find((s) => s.id === 'check_cover')!.body).toMatch(/how to claim/i)
  })

  it('falls back to household-level fields when affectedMemberId does not match any roster member', () => {
    const playbook = renderPlaybook('disability', makeProfile({
      household: { employment_status: 'employed', monthly_salary_minor: 400000, annual_living_expenses_minor: 3600000, mortgage_outstanding_minor: 0, life_cover_minor: 10_000_000, income_protection_monthly_minor: 0, members: [] },
    }), 'no-such-member')
    expect(playbook.steps.find((s) => s.id === 'check_cover')!.body).toMatch(/why that matters/i)
  })
})
