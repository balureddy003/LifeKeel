/**
 * Maps the stored family financial profile into the scenario
 * calculator's minimal input shape — null when there's not enough on
 * file to project anything (no income and no expenses at all), so
 * callers (/assistant/simulate, /family/scenarios/*) can decline
 * honestly instead of running the math on all-zero data and presenting
 * it as real.
 *
 * Extracted from assistant.ts for PRD-115's saved-scenario routes.
 * Takes a structural subset of the profile document rather than the
 * route-owned FinancialProfileDoc so it can live outside routes/.
 */
import type { ScenarioProfileInput } from './calculate.js'

interface ScenarioProfileDoc {
  household?: {
    monthly_salary_minor?: number
    annual_living_expenses_minor?: number
    members?: Array<{ member_id?: string; monthly_salary_minor?: number }>
  }
  emergency_fund?: {
    emergency_savings_minor?: number
    monthly_expenses_minor?: number
  }
  education_funds?: Array<{
    child_name?: string
    current_savings_minor?: number
    target_savings_minor?: number
    years_remaining?: number
    member_id?: string
  }>
}

// G7: when present, the projection runs on one roster member's slice —
// their income and the education funds naming them as beneficiary.
// isOrganizer selects which income field the member maps to: the
// organizer's salary is the top-level household field, every other
// earner's lives in household.members[] keyed by member_id.
export interface MemberScope {
  member_id: string
  is_organizer: boolean
}

export function toScenarioProfileInput(
  profile: ScenarioProfileDoc | null,
  memberScope?: MemberScope,
): ScenarioProfileInput | null {
  const h = profile?.household
  const ef = profile?.emergency_fund
  if (!h && !ef) return null

  const monthlyIncomeMinor = memberScope
    ? memberScope.is_organizer
      ? h?.monthly_salary_minor ?? 0
      : h?.members?.find((m) => m.member_id === memberScope.member_id)?.monthly_salary_minor ?? 0
    : (h?.monthly_salary_minor ?? 0) +
      (h?.members ?? []).reduce((sum, m) => sum + (m.monthly_salary_minor ?? 0), 0)
  const monthlyExpensesMinor =
    ef?.monthly_expenses_minor ?? Math.round((h?.annual_living_expenses_minor ?? 0) / 12)
  if (monthlyIncomeMinor === 0 && monthlyExpensesMinor === 0) return null

  let funds = (profile?.education_funds ?? []).filter((f) => !!f.child_name)
  // Funds belong to the child they name, not the adult paying in — only
  // filter when the scoped member is actually a beneficiary (child
  // scope). An adult's "what happens to my income" still needs every
  // fund's timeline; the income slice is what changed.
  const memberFunds = memberScope ? funds.filter((f) => f.member_id === memberScope.member_id) : []
  if (memberScope && memberFunds.length > 0) funds = memberFunds

  return {
    monthlyIncomeMinor,
    monthlyExpensesMinor,
    emergencySavingsMinor: ef?.emergency_savings_minor ?? 0,
    educationFunds: funds.map((f) => ({
      childName: f.child_name!,
      currentSavingsMinor: f.current_savings_minor ?? 0,
      targetSavingsMinor: f.target_savings_minor ?? 0,
      yearsRemaining: f.years_remaining ?? 0,
    })),
  }
}
