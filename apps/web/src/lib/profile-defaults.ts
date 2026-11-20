import type { FinancialProfile } from './api'

/**
 * A stored profile can hold only part of the shape: a household that added a policy through the
 * quick form, or applied a single document field, has `policies` and nothing else until the wizard
 * is finished. Most screens read `household`, `retirement` and `emergency_fund` directly, so the
 * fetch fills the gaps once instead of every reader guarding itself.
 *
 * Only missing values are filled; anything the family entered is kept. The age and growth defaults
 * match the wizard's own starting values, so opening the wizard shows the same thing as before.
 */
export function withProfileDefaults(raw: Partial<FinancialProfile>): FinancialProfile {
  const household: Partial<FinancialProfile['household']> = raw.household ?? {}
  const emergency: Partial<FinancialProfile['emergency_fund']> = raw.emergency_fund ?? {}
  const retirement: Partial<FinancialProfile['retirement']> = raw.retirement ?? {}
  return {
    ...raw,
    household: {
      employment_status: 'employed',
      monthly_salary_minor: 0,
      annual_living_expenses_minor: 0,
      mortgage_outstanding_minor: 0,
      life_cover_minor: 0,
      income_protection_monthly_minor: 0,
      monthly_debt_payments_minor: 0,
      ...household,
      members: household.members ?? [],
    },
    emergency_fund: {
      emergency_savings_minor: 0,
      monthly_expenses_minor: 0,
      has_high_interest_debt: false,
      high_interest_debt_balance_minor: 0,
      ...emergency,
    },
    retirement: {
      current_age: 30,
      target_retirement_age: 65,
      pension_balance_minor: 0,
      monthly_contribution_minor: 0,
      target_retirement_income_minor: 0,
      expected_annual_growth_pct: 5,
      ...retirement,
    },
    education_funds: raw.education_funds ?? [],
    policies: raw.policies ?? [],
  }
}
