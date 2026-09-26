/**
 * Deterministic "what if" scenario math for Ask Oak — see docs/plan
 * (Digital Twin gap audit, Phase 2): the assistant had no way to answer a
 * hypothetical ("what if Sudha returns to work and we save £500/month
 * more?") beyond either declining or an LLM inventing a plausible-looking
 * but ungrounded number, which is unacceptable for a financial app.
 *
 * Every number here is plain arithmetic on data already in the profile —
 * no LLM involved. The assistant route computes a ScenarioResult with
 * these functions, then asks the LLM only to narrate the numbers, never
 * to calculate them.
 */

export interface ScenarioProfileInput {
  /** Current total household monthly income (org member + any linked earners), minor units. */
  monthlyIncomeMinor: number
  /** Current monthly living expenses, minor units. */
  monthlyExpensesMinor: number
  /** Current emergency savings balance, minor units. */
  emergencySavingsMinor: number
  educationFunds: Array<{
    childName: string
    currentSavingsMinor: number
    targetSavingsMinor: number
    yearsRemaining: number
  }>
}

export interface ScenarioChange {
  /** Change in total monthly household income, minor units — negative for a job loss, positive for a partner returning to work. */
  monthlyIncomeDeltaMinor?: number
  /** New amount being set aside each month, minor units — reduces disposable surplus, optionally directed at one child's education fund. */
  monthlyExtraSavingsMinor?: number
  /** Which education fund (by childName, case-insensitive) the extra savings is directed at, if any. */
  targetChildName?: string
}

export interface EducationFundProjection {
  childName: string
  yearsRemaining: number
  /** Months to reach the target at the current pace — null if the fund isn't being actively topped up by this scenario, so pace can't be projected. */
  projectedMonthsToTarget: number | null
  /** Whether the projected pace reaches the target within yearsRemaining — null if projectedMonthsToTarget is null. */
  onTrack: boolean | null
}

export interface ScenarioResult {
  currentMonthlyIncomeMinor: number
  projectedMonthlyIncomeMinor: number
  currentMonthlySurplusMinor: number
  projectedMonthlySurplusMinor: number
  /**
   * Months the emergency fund covers if the monthly shortfall (expenses
   * minus income) continues — null when income covers expenses, since
   * savings aren't being drawn down at all in that case.
   */
  currentRunwayMonths: number | null
  projectedRunwayMonths: number | null
  educationFundProjection: EducationFundProjection | null
}

function runwayMonths(incomeMinor: number, expensesMinor: number, savingsMinor: number): number | null {
  const shortfall = expensesMinor - incomeMinor
  if (shortfall <= 0) return null
  if (savingsMinor <= 0) return 0
  return Math.round((savingsMinor / shortfall) * 10) / 10
}

export function calculateScenario(profile: ScenarioProfileInput, change: ScenarioChange): ScenarioResult {
  const incomeDelta = change.monthlyIncomeDeltaMinor ?? 0
  const extraSavings = change.monthlyExtraSavingsMinor ?? 0

  const currentMonthlyIncomeMinor = profile.monthlyIncomeMinor
  const projectedMonthlyIncomeMinor = currentMonthlyIncomeMinor + incomeDelta

  const currentMonthlySurplusMinor = currentMonthlyIncomeMinor - profile.monthlyExpensesMinor
  const projectedMonthlySurplusMinor = projectedMonthlyIncomeMinor - profile.monthlyExpensesMinor - extraSavings

  const currentRunwayMonths = runwayMonths(currentMonthlyIncomeMinor, profile.monthlyExpensesMinor, profile.emergencySavingsMinor)
  const projectedRunwayMonths = runwayMonths(projectedMonthlyIncomeMinor, profile.monthlyExpensesMinor, profile.emergencySavingsMinor)

  let educationFundProjection: EducationFundProjection | null = null
  if (change.targetChildName) {
    const fund = profile.educationFunds.find(
      (f) => f.childName.toLowerCase() === change.targetChildName!.toLowerCase(),
    )
    if (fund) {
      const remainingMinor = fund.targetSavingsMinor - fund.currentSavingsMinor
      const projectedMonthsToTarget = extraSavings > 0
        ? (remainingMinor <= 0 ? 0 : Math.ceil(remainingMinor / extraSavings))
        : null
      educationFundProjection = {
        childName: fund.childName,
        yearsRemaining: fund.yearsRemaining,
        projectedMonthsToTarget,
        onTrack: projectedMonthsToTarget === null ? null : projectedMonthsToTarget <= fund.yearsRemaining * 12,
      }
    }
  }

  return {
    currentMonthlyIncomeMinor,
    projectedMonthlyIncomeMinor,
    currentMonthlySurplusMinor,
    projectedMonthlySurplusMinor,
    currentRunwayMonths,
    projectedRunwayMonths,
    educationFundProjection,
  }
}
