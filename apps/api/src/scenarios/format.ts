/**
 * Scenario narration text — moved out of routes/assistant.ts so the
 * verified-answer resolver (PRD-212) can reuse it without a circular import.
 * The LLM narrates these numbers; the verified path serves them directly.
 */

import type { ScenarioResult, ScenarioTimelinePoint } from './calculate.js'

function toMajor(minor: number | undefined): string {
  return typeof minor === 'number' ? (minor / 100).toFixed(2) : 'not provided'
}

export function formatScenarioResult(result: ScenarioResult): string {
  const lines = [
    `Current total household monthly income: £${toMajor(result.currentMonthlyIncomeMinor)}.`,
    `Projected monthly income under this scenario: £${toMajor(result.projectedMonthlyIncomeMinor)}.`,
    `Current monthly surplus (income minus expenses): £${toMajor(result.currentMonthlySurplusMinor)}.`,
    `Projected monthly surplus under this scenario: £${toMajor(result.projectedMonthlySurplusMinor)}.`,
    result.currentRunwayMonths === null
      ? 'Current emergency-fund runway: not applicable — income currently covers expenses.'
      : `Current emergency-fund runway: ${result.currentRunwayMonths} months.`,
    result.projectedRunwayMonths === null
      ? 'Projected emergency-fund runway under this scenario: not applicable — income would cover expenses.'
      : `Projected emergency-fund runway under this scenario: ${result.projectedRunwayMonths} months.`,
    // PRD-115: say when the change lands so the LLM narrates "in 6 months
    // you'd have X" instead of implying today's balance carries it.
    result.monthsUntilChange > 0
      ? `Timing: this change takes effect in ${result.monthsUntilChange} months — by then the emergency fund would have reached £${toMajor(result.savingsAtChangeMinor)}, and the projected runway above is measured from that balance.`
      : 'Timing: this change takes effect immediately.',
  ]
  if (result.educationFundProjection) {
    const p = result.educationFundProjection
    lines.push(
      p.projectedMonthsToTarget === null
        ? `${p.childName}'s education fund: no new monthly saving directed at it in this scenario, so no projection.`
        : `${p.childName}'s education fund at this new saving rate: reaches its target in ${p.projectedMonthsToTarget} months, ` +
            `versus ${p.yearsRemaining * 12} months remaining — ${p.onTrack ? 'on track' : 'not on track'} at this pace.`,
    )
  }
  if (result.timeline && result.timeline.length > 0) {
    lines.push('This is a multi-step scenario — the regime changes over time:')
    lines.push(formatTimeline(result))
  }
  return lines.join('\n')
}

/**
 * PRD-132/G14: describe each regime boundary in the raw-numbers fallback
 * ("months 1–3: income −£2,400/mo, runway 4.1 mo; from month 4: …") — the
 * same narration the LLM prompt hands it, since the fallback IS this text.
 */
function formatTimeline(result: ScenarioResult): string {
  const timeline = result.timeline!
  const segments: string[] = []
  let prevIncome = result.currentMonthlyIncomeMinor
  let prevExpenses =
    result.currentMonthlySurplusMinor !== undefined
      ? result.currentMonthlyIncomeMinor - result.currentMonthlySurplusMinor
      : 0
  timeline.forEach((t: ScenarioTimelinePoint, i: number) => {
    const next = timeline[i + 1]
    const start = t.atMonth === 0 ? 1 : t.atMonth
    const range =
      next && next.atMonth - 1 >= start
        ? `months ${start}–${next.atMonth - 1}`
        : t.atMonth === 0
          ? 'from now'
          : `from month ${t.atMonth}`
    const dIncome = t.monthlyIncomeMinor - prevIncome
    const dExpenses = t.monthlyExpensesMinor - prevExpenses
    const changes: string[] = []
    if (dIncome !== 0)
      changes.push(`income ${dIncome < 0 ? '−' : '+'}£${toMajor(Math.abs(dIncome))}/mo`)
    if (dExpenses !== 0)
      changes.push(`expenses ${dExpenses < 0 ? '−' : '+'}£${toMajor(Math.abs(dExpenses))}/mo`)
    const runway = t.runwayMonths === null ? 'self-funding' : `runway ${t.runwayMonths} mo`
    segments.push(`${range}: ${changes.length > 0 ? changes.join(', ') + ', ' : ''}${runway}`)
    prevIncome = t.monthlyIncomeMinor
    prevExpenses = t.monthlyExpensesMinor
  })
  if (result.fundDepletedAtMonth !== null) {
    segments.push(`the emergency fund runs out in month ${result.fundDepletedAtMonth}`)
  }
  return segments.join('; ')
}
