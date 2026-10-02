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
    members?: Array<{ monthly_salary_minor?: number }>
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
  }>
}

export function toScenarioProfileInput(profile: ScenarioProfileDoc | null): ScenarioProfileInput | null {
  const h = profile?.household
  const ef = profile?.emergency_fund
  if (!h && !ef) return null

  const monthlyIncomeMinor =
    (h?.monthly_salary_minor ?? 0) +
    (h?.members ?? []).reduce((sum, m) => sum + (m.monthly_salary_minor ?? 0), 0)
  const monthlyExpensesMinor =
    ef?.monthly_expenses_minor ?? Math.round((h?.annual_living_expenses_minor ?? 0) / 12)
  if (monthlyIncomeMinor === 0 && monthlyExpensesMinor === 0) return null

  return {
    monthlyIncomeMinor,
    monthlyExpensesMinor,
    emergencySavingsMinor: ef?.emergency_savings_minor ?? 0,
    educationFunds: (profile?.education_funds ?? [])
      .filter((f) => !!f.child_name)
      .map((f) => ({
        childName: f.child_name!,
        currentSavingsMinor: f.current_savings_minor ?? 0,
        targetSavingsMinor: f.target_savings_minor ?? 0,
        yearsRemaining: f.years_remaining ?? 0,
      })),
  }
}
