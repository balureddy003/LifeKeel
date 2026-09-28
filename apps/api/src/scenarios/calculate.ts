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
  /**
   * PRD-115: months until the income change takes effect ("a job
   * transition in 6 months"). Until then the household lives under the
   * current regime — a positive surplus accrues to the emergency fund, a
   * negative one drains it — and the projected runway is then measured
   * from the balance at that point, not today's. 0/undefined = instant
   * (the pre-PRD-115 behavior). The extra-savings habit is treated as
   * starting now, not at the horizon — it's the family's decision today,
   * unlike the income event they're bracing for.
   */
  monthsUntilChange?: number
  /**
   * PRD-132: multi-step timeline — ordered regime changes the flat
   * fields above can't express ("income stops now, returns in 12
   * months", "expenses rise for a year then settle"). When present and
   * non-empty, `monthlyIncomeDeltaMinor`/`monthsUntilChange` are ignored
   * — they're the one-step shorthand for this. `monthlyExtraSavingsMinor`
   * still applies throughout: it's the family's decision today, not part
   * of the event being modelled.
   */
  steps?: ScenarioStep[]
}

/**
 * PRD-132: one regime change in a multi-step scenario. Deltas are
 * cumulative — each step shifts the running monthly income/expenses, so
 * a "returns to work" step carries +X to undo an earlier −X. Two steps
 * at the same month are summed into one.
 */
export interface ScenarioStep {
  /** Month the change takes effect, 0 = now. */
  atMonth: number
  monthlyIncomeDeltaMinor?: number
  monthlyExpenseDeltaMinor?: number
}

/** The state of the world at one step boundary. */
export interface ScenarioTimelinePoint {
  atMonth: number
  monthlyIncomeMinor: number
  monthlyExpensesMinor: number
  /** Emergency-fund balance as this step takes effect (floored at 0). */
  savingsMinor: number
  /** Runway from this point under the post-step regime — null when the
   *  regime is self-funding (income covers expenses + extra savings). */
  runwayMonths: number | null
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
  /**
   * PRD-115: the emergency-fund balance at the moment the income change
   * takes effect — today's balance grown (or drained) by the current
   * monthly surplus over monthsUntilChange. Equals emergencySavingsMinor
   * when the horizon is 0. Runway is measured from this, not from today's
   * balance, which is the whole point of the horizon: "in 6 months you'd
   * have saved up to £X, which then covers Y months."
   */
  savingsAtChangeMinor: number
  monthsUntilChange: number
  /**
   * PRD-132: one point per timeline step, in order — null for single-
   * step scenarios. `savingsAtChangeMinor`/`projectedRunwayMonths` below
   * always describe the *final* regime so existing consumers still read
   * the right "where does this end up" answer off a multi-step input.
   */
  timeline: ScenarioTimelinePoint[] | null
  /**
   * PRD-132: the month the emergency fund hits zero during the timeline,
   * if it does — a mid-segment depletion the endpoint runway would hide
   * ("income returns at month 12, but the fund ran out at month 7").
   * null when the fund survives every segment.
   */
  fundDepletedAtMonth: number | null
  educationFundProjection: EducationFundProjection | null
}

function runwayMonths(incomeMinor: number, expensesMinor: number, savingsMinor: number): number | null {
  const shortfall = expensesMinor - incomeMinor
  if (shortfall <= 0) return null
  if (savingsMinor <= 0) return 0
  return Math.round((savingsMinor / shortfall) * 10) / 10
}

export function calculateScenario(profile: ScenarioProfileInput, change: ScenarioChange): ScenarioResult {
  const extraSavings = change.monthlyExtraSavingsMinor ?? 0
  const steps = normalizeSteps(change.steps)

  // PRD-132: multi-step timeline — each step shifts the running regime;
  // the fund accrues or drains under whatever regime is in force between
  // boundaries, floored at 0. When the fund empties mid-segment we record
  // the month it ran out — an endpoint-only view would hide it.
  if (steps.length > 0) {
    let income = profile.monthlyIncomeMinor
    let expenses = profile.monthlyExpensesMinor
    let savings = profile.emergencySavingsMinor
    let prevMonth = 0
    let fundDepletedAtMonth: number | null = null
    const timeline: ScenarioTimelinePoint[] = []

    for (const step of steps) {
      const gap = step.atMonth - prevMonth
      const burn = income - expenses
      if (fundDepletedAtMonth === null && burn < 0 && savings > 0 && savings + burn * gap <= 0) {
        // Month the balance crosses zero inside the segment.
        fundDepletedAtMonth = prevMonth + Math.ceil(savings / -burn)
      }
      savings = Math.max(0, savings + burn * gap)
      income += step.monthlyIncomeDeltaMinor ?? 0
      expenses += step.monthlyExpenseDeltaMinor ?? 0
      prevMonth = step.atMonth
      timeline.push({
        atMonth: step.atMonth,
        monthlyIncomeMinor: income,
        monthlyExpensesMinor: expenses,
        savingsMinor: savings,
        runwayMonths: runwayMonths(income, expenses, savings),
      })
    }

    const last = timeline[timeline.length - 1]!
    const result = buildResult(profile, change, {
      projectedMonthlyIncomeMinor: last.monthlyIncomeMinor,
      projectedMonthlySurplusMinor: last.monthlyIncomeMinor - last.monthlyExpensesMinor - extraSavings,
      savingsAtChangeMinor: last.savingsMinor,
      monthsUntilChange: last.atMonth,
      projectedRunwayMonths: last.runwayMonths,
    })
    result.timeline = timeline
    result.fundDepletedAtMonth = fundDepletedAtMonth
    return result
  }

  const incomeDelta = change.monthlyIncomeDeltaMinor ?? 0
  const monthsUntilChange = Math.max(0, Math.floor(change.monthsUntilChange ?? 0))

  const currentMonthlySurplusMinor = profile.monthlyIncomeMinor - profile.monthlyExpensesMinor

  // The change hits at the end of the horizon; until then the household
  // lives under today's numbers. Floor at 0 — the fund can't go negative.
  const savingsAtChangeMinor = Math.max(
    0,
    profile.emergencySavingsMinor + currentMonthlySurplusMinor * monthsUntilChange,
  )

  const projectedMonthlyIncomeMinor = profile.monthlyIncomeMinor + incomeDelta
  const projectedRunwayMonths = runwayMonths(projectedMonthlyIncomeMinor, profile.monthlyExpensesMinor, savingsAtChangeMinor)

  return buildResult(profile, change, {
    projectedMonthlyIncomeMinor,
    projectedMonthlySurplusMinor: projectedMonthlyIncomeMinor - profile.monthlyExpensesMinor - extraSavings,
    savingsAtChangeMinor,
    monthsUntilChange,
    projectedRunwayMonths,
  })
}

/** Sort steps by month and merge same-month entries into summed deltas. */
function normalizeSteps(steps: ScenarioStep[] | undefined): ScenarioStep[] {
  if (!steps || steps.length === 0) return []
  const byMonth = new Map<number, ScenarioStep>()
  for (const s of steps) {
    const atMonth = Math.max(0, Math.floor(s.atMonth))
    const existing = byMonth.get(atMonth)
    if (existing) {
      existing.monthlyIncomeDeltaMinor = (existing.monthlyIncomeDeltaMinor ?? 0) + (s.monthlyIncomeDeltaMinor ?? 0)
      existing.monthlyExpenseDeltaMinor = (existing.monthlyExpenseDeltaMinor ?? 0) + (s.monthlyExpenseDeltaMinor ?? 0)
    } else {
      byMonth.set(atMonth, { ...s, atMonth })
    }
  }
  return [...byMonth.values()].sort((a, b) => a.atMonth - b.atMonth)
}

function buildResult(
  profile: ScenarioProfileInput,
  change: ScenarioChange,
  projected: {
    projectedMonthlyIncomeMinor: number
    projectedMonthlySurplusMinor: number
    savingsAtChangeMinor: number
    monthsUntilChange: number
    projectedRunwayMonths: number | null
  },
): ScenarioResult {
  const extraSavings = change.monthlyExtraSavingsMinor ?? 0
  const currentMonthlyIncomeMinor = profile.monthlyIncomeMinor
  const currentMonthlySurplusMinor = currentMonthlyIncomeMinor - profile.monthlyExpensesMinor
  const currentRunwayMonths = runwayMonths(currentMonthlyIncomeMinor, profile.monthlyExpensesMinor, profile.emergencySavingsMinor)

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
    currentMonthlySurplusMinor,
    currentRunwayMonths,
    ...projected,
    timeline: null,
    fundDepletedAtMonth: null,
    educationFundProjection,
  }
}
