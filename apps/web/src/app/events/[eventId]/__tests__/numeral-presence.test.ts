import { describe, expect, it } from 'vitest'
import { SCENARIO_TEMPLATES, runwayPhrase, type Selections } from '../ScenarioCard'
import type { ScenarioResult } from '@/lib/api'

// Intent 65 (IP claim 1 exhibit): every numeral a narration renders must
// come from the solver's ScenarioResult payload — nothing may be invented.
const RESULT: ScenarioResult = {
  currentMonthlyIncomeMinor: 500_000,
  projectedMonthlyIncomeMinor: 200_000,
  currentMonthlySurplusMinor: 150_000,
  projectedMonthlySurplusMinor: 50_000,
  currentRunwayMonths: 6,
  projectedRunwayMonths: 12.5,
  savingsAtChangeMinor: 750_000,
  monthsUntilChange: 6,
  timeline: [
    {
      atMonth: 0,
      monthlyIncomeMinor: 200_000,
      monthlyExpensesMinor: 150_000,
      savingsMinor: 900_000,
      runwayMonths: 12.5,
    },
  ],
  projectedRunwayStartMonth: null,
  fundDepletedAtMonth: null,
  educationFundProjection: null,
} as ScenarioResult

/** Every number the narration could legitimately show, derived only from
 *  the solver payload: formatted £ amounts and runway phrases. */
function permittedNumerals(r: ScenarioResult): Set<string> {
  const gbp = (m: number) =>
    `${m < 0 ? '-' : ''}£${Math.round(Math.abs(m) / 100).toLocaleString('en-GB')}`
  const out = new Set<string>()
  for (const v of [
    r.currentMonthlyIncomeMinor,
    r.projectedMonthlyIncomeMinor,
    r.currentMonthlySurplusMinor,
    r.projectedMonthlySurplusMinor,
    r.savingsAtChangeMinor,
    ...(r.timeline ?? []).flatMap((t) => [
      t.monthlyIncomeMinor,
      t.monthlyExpensesMinor,
      t.savingsMinor,
    ]),
  ])
    out.add(gbp(v))
  for (const v of [
    r.currentRunwayMonths,
    r.projectedRunwayMonths,
    r.monthsUntilChange,
    ...(r.timeline ?? []).map((t) => t.runwayMonths),
    ...(r.timeline ?? []).map((t) => t.atMonth),
  ]) {
    if (v === null) continue
    out.add(runwayPhrase(v))
    out.add(String(Math.round(v)))
    out.add(String(v))
  }
  return out
}

/** Extract money + count tokens from narration text. */
function numeralsIn(text: string): string[] {
  return (
    text.match(
      /-?£[\d,]+|(?:about |over |more than )?\d+(?:\.\d+)? ?(?:months?|years?)|less than a month|more than five years/g,
    ) ?? []
  )
}

const BASE_SEL: Selections = {
  earner: null,
  amountMinor: 100_000,
  horizonMonths: 6,
  childName: 'Leo',
}

describe('intent 65: scenario narrations only speak solver numbers', () => {
  for (const [eventId, t] of Object.entries(SCENARIO_TEMPLATES)) {
    it(`${eventId}: every rendered numeral is in the payload`, () => {
      const text = t.narrate(RESULT, BASE_SEL)
      const allowed = permittedNumerals(RESULT)
      for (const token of numeralsIn(text)) {
        const stripped = token.replace(/^(about |over |more than )/, '').trim()
        expect(
          [...allowed].some((a) => token.includes(a) || a.includes(token) || a.includes(stripped)),
          `unexplained numeral "${token}" in "${eventId}" narration: ${text}`,
        ).toBe(true)
      }
    })
  }
})
