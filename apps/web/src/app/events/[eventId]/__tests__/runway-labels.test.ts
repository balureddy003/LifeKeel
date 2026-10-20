import { describe, it, expect } from 'vitest'
import { runwayIfStoppedNow } from '../ScenarioCard'
import type { ScenarioResult } from '@/lib/api'

const base = {
  currentMonthlyIncomeMinor: 400_000,
  projectedMonthlyIncomeMinor: 0,
  currentMonthlySurplusMinor: 100_000, // spending 3,000 a month
  projectedMonthlySurplusMinor: -300_000,
  currentRunwayMonths: null,
  projectedRunwayMonths: 5.3,
  savingsAtChangeMinor: 1_600_000, // £10,000 today plus six months of £1,000 surplus
  monthsUntilChange: 6,
} as unknown as ScenarioResult

describe('runwayIfStoppedNow', () => {
  it("works today's savings and runway back from a horizon result", () => {
    expect(runwayIfStoppedNow(base, 400_000)).toEqual({ savingsMinor: 1_000_000, months: 3.3 })
  })
  it('has nothing to say for an immediate change or when income still covers spending', () => {
    expect(
      runwayIfStoppedNow({ ...base, monthsUntilChange: 0 } as ScenarioResult, 400_000),
    ).toBeNull()
    expect(runwayIfStoppedNow(base, 0)).toBeNull()
  })
  it('gives up when the fund was floored at zero and today cannot be recovered', () => {
    expect(
      runwayIfStoppedNow({ ...base, savingsAtChangeMinor: 0 } as ScenarioResult, 400_000),
    ).toBeNull()
  })
})
