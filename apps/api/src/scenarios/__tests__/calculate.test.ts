import { describe, expect, it } from 'vitest'
import { calculateScenario, type ScenarioProfileInput } from '../calculate.js'

const baseProfile: ScenarioProfileInput = {
  monthlyIncomeMinor: 500_000, // £5,000
  monthlyExpensesMinor: 300_000, // £3,000
  emergencySavingsMinor: 900_000, // £9,000
  educationFunds: [
    { childName: 'Nihaan', currentSavingsMinor: 200_000, targetSavingsMinor: 2_000_000, yearsRemaining: 10 },
  ],
}

describe('calculateScenario', () => {
  it('reports no runway risk when income already covers expenses and nothing changes', () => {
    const result = calculateScenario(baseProfile, {})
    expect(result.currentMonthlySurplusMinor).toBe(200_000)
    expect(result.currentRunwayMonths).toBeNull()
    expect(result.projectedMonthlySurplusMinor).toBe(200_000)
    expect(result.projectedRunwayMonths).toBeNull()
  })

  it('computes a real runway figure for a full job-loss scenario', () => {
    const result = calculateScenario(baseProfile, { monthlyIncomeDeltaMinor: -500_000 })
    expect(result.projectedMonthlyIncomeMinor).toBe(0)
    // £9,000 saved / £3,000 shortfall = 3 months
    expect(result.projectedRunwayMonths).toBe(3)
    expect(result.projectedMonthlySurplusMinor).toBe(-300_000)
  })

  it('handles a partial income increase plus new monthly savings (the motivating example)', () => {
    // Sudha resumes work (+£2,000/mo) and the family sets aside £500/mo for Nihaan.
    const result = calculateScenario(baseProfile, {
      monthlyIncomeDeltaMinor: 200_000,
      monthlyExtraSavingsMinor: 50_000,
      targetChildName: 'nihaan', // case-insensitive match
    })
    expect(result.projectedMonthlyIncomeMinor).toBe(700_000)
    expect(result.projectedMonthlySurplusMinor).toBe(700_000 - 300_000 - 50_000)
    expect(result.projectedRunwayMonths).toBeNull() // income still covers expenses
    expect(result.educationFundProjection).not.toBeNull()
    // (2,000,000 - 200,000) / 50,000 = 36 months = 3 years, well within 10
    expect(result.educationFundProjection?.projectedMonthsToTarget).toBe(36)
    expect(result.educationFundProjection?.onTrack).toBe(true)
  })

  it('flags an education fund as off track when the pace would miss the target date', () => {
    const result = calculateScenario(baseProfile, {
      monthlyExtraSavingsMinor: 5_000, // only £50/mo
      targetChildName: 'Nihaan',
    })
    // (2,000,000 - 200,000) / 5,000 = 360 months = 30 years > 10 years remaining
    expect(result.educationFundProjection?.projectedMonthsToTarget).toBe(360)
    expect(result.educationFundProjection?.onTrack).toBe(false)
  })

  it('returns a null education projection when no extra savings is directed at any child', () => {
    const result = calculateScenario(baseProfile, { targetChildName: 'Nihaan' })
    expect(result.educationFundProjection?.projectedMonthsToTarget).toBeNull()
    expect(result.educationFundProjection?.onTrack).toBeNull()
  })

  it('returns no education projection for a child not on file, rather than guessing', () => {
    const result = calculateScenario(baseProfile, { monthlyExtraSavingsMinor: 50_000, targetChildName: 'Tanvi' })
    expect(result.educationFundProjection).toBeNull()
  })

  it('treats a fund already at or past its target as needing zero more months', () => {
    const result = calculateScenario(
      { ...baseProfile, educationFunds: [{ childName: 'Nihaan', currentSavingsMinor: 2_000_000, targetSavingsMinor: 2_000_000, yearsRemaining: 10 }] },
      { monthlyExtraSavingsMinor: 10_000, targetChildName: 'Nihaan' },
    )
    expect(result.educationFundProjection?.projectedMonthsToTarget).toBe(0)
    expect(result.educationFundProjection?.onTrack).toBe(true)
  })

  it('caps runway at 0 rather than negative when savings are already exhausted', () => {
    const result = calculateScenario({ ...baseProfile, emergencySavingsMinor: 0 }, { monthlyIncomeDeltaMinor: -500_000 })
    expect(result.projectedRunwayMonths).toBe(0)
  })

  // PRD-115 — monthsUntilChange: the horizon grows (or drains) the fund
  // under today's numbers first, then runway is measured from there.
  it('grows the fund by the current surplus over the horizon before the change hits', () => {
    const result = calculateScenario(baseProfile, {
      monthlyIncomeDeltaMinor: -500_000,
      monthsUntilChange: 6,
    })
    // £9,000 + £2,000/mo surplus × 6 = £21,000 at change; then 21/3 = 7 months
    expect(result.savingsAtChangeMinor).toBe(2_100_000)
    expect(result.projectedRunwayMonths).toBe(7)
    expect(result.monthsUntilChange).toBe(6)
  })

  it('drains the fund over the horizon when the household is already underwater', () => {
    const underwater: ScenarioProfileInput = {
      ...baseProfile,
      monthlyIncomeMinor: 200_000, // £2,000 in, £3,000 out → −£1,000/mo
    }
    const result = calculateScenario(underwater, {
      monthlyIncomeDeltaMinor: -200_000,
      monthsUntilChange: 6,
    })
    // £9,000 − £1,000 × 6 = £3,000 left at change; then £3,000/£3,000 = 1 month
    expect(result.savingsAtChangeMinor).toBe(300_000)
    expect(result.projectedRunwayMonths).toBe(1)
  })

  it('floors savingsAtChange at 0 — a horizon drain can exhaust but never go negative', () => {
    const underwater: ScenarioProfileInput = {
      ...baseProfile,
      monthlyIncomeMinor: 100_000, // −£2,000/mo
    }
    const result = calculateScenario(underwater, {
      monthlyIncomeDeltaMinor: -100_000,
      monthsUntilChange: 12,
    })
    // £9,000 − £2,000 × 12 = −£15,000 → clamped to 0
    expect(result.savingsAtChangeMinor).toBe(0)
    expect(result.projectedRunwayMonths).toBe(0)
  })

  it('treats a missing or zero horizon as an instant change — today’s balance', () => {
    for (const monthsUntilChange of [undefined, 0]) {
      const result = calculateScenario(baseProfile, { monthlyIncomeDeltaMinor: -500_000, monthsUntilChange })
      expect(result.savingsAtChangeMinor).toBe(900_000)
      expect(result.projectedRunwayMonths).toBe(3)
    }
  })

  // PRD-132 — multi-step timelines: ordered regime changes the flat
  // income-delta shorthand can't express.
  it('projects a dip-and-recover timeline — income stops now, returns at month 12', () => {
    // Disability-style: earner income (-£2,000 of the £5,000) stops now,
    // returns in a year. Surplus goes +£2,000 → 0 → +£2,000.
    const result = calculateScenario(baseProfile, {
      steps: [
        { atMonth: 0, monthlyIncomeDeltaMinor: -200_000 },
        { atMonth: 12, monthlyIncomeDeltaMinor: 200_000 },
      ],
    })
    expect(result.timeline).toHaveLength(2)
    // Month 0: regime is £3,000 in vs £3,000 out — no burn, no runway risk.
    expect(result.timeline![0]).toMatchObject({
      atMonth: 0,
      monthlyIncomeMinor: 300_000,
      savingsMinor: 900_000,
      runwayMonths: null,
    })
    // Month 12: income restored — 12 months at net-zero, fund unchanged.
    expect(result.timeline![1]).toMatchObject({
      atMonth: 12,
      monthlyIncomeMinor: 500_000,
      savingsMinor: 900_000,
      runwayMonths: null,
    })
    expect(result.fundDepletedAtMonth).toBeNull()
    // Endpoint fields describe the final regime for existing consumers.
    expect(result.projectedMonthlyIncomeMinor).toBe(500_000)
    expect(result.savingsAtChangeMinor).toBe(900_000)
    expect(result.monthsUntilChange).toBe(12)
  })

  it('records the mid-segment month the fund runs out, even when income later returns', () => {
    // Full job loss at 0 (-£5,000 → £3,000/mo burn), income returns at
    // month 12 — but £9,000 only covers 3 months of burn.
    const result = calculateScenario(baseProfile, {
      steps: [
        { atMonth: 0, monthlyIncomeDeltaMinor: -500_000 },
        { atMonth: 12, monthlyIncomeDeltaMinor: 500_000 },
      ],
    })
    expect(result.fundDepletedAtMonth).toBe(3)
    // The fund is already empty by month 12 even though income recovers.
    expect(result.timeline![1]!.savingsMinor).toBe(0)
  })

  it('lets a step raise expenses, not just income — a cost spike that settles', () => {
    // Medical-style: +£1,000/mo costs now, back to normal at month 12.
    // Surplus £2,000 → £1,000 during the spike → £2,000 after.
    const result = calculateScenario(baseProfile, {
      steps: [
        { atMonth: 0, monthlyExpenseDeltaMinor: 100_000 },
        { atMonth: 12, monthlyExpenseDeltaMinor: -100_000 },
      ],
    })
    // Still accreting, just slower: £9,000 + £1,000 × 12 = £21,000.
    expect(result.timeline![1]!.savingsMinor).toBe(2_100_000)
    expect(result.timeline![1]!.monthlyExpensesMinor).toBe(300_000)
    expect(result.fundDepletedAtMonth).toBeNull()
  })

  it('normalizes unsorted input and merges same-month steps', () => {
    const result = calculateScenario(baseProfile, {
      steps: [
        { atMonth: 6, monthlyIncomeDeltaMinor: -300_000 },
        { atMonth: 0, monthlyIncomeDeltaMinor: -100_000 },
        { atMonth: 6, monthlyExpenseDeltaMinor: 50_000 },
      ],
    })
    expect(result.timeline!.map((p) => p.atMonth)).toEqual([0, 6])
    // Same-month deltas summed: income −£3,000 (now £1,000), expenses +£500.
    expect(result.timeline![1]!.monthlyIncomeMinor).toBe(100_000)
    expect(result.timeline![1]!.monthlyExpensesMinor).toBe(350_000)
  })

  it('takes precedence over the flat income-delta/horizon shorthand', () => {
    const result = calculateScenario(baseProfile, {
      monthlyIncomeDeltaMinor: -999_999,
      monthsUntilChange: 99,
      steps: [{ atMonth: 0, monthlyIncomeDeltaMinor: -500_000 }],
    })
    expect(result.timeline).toHaveLength(1)
    expect(result.projectedMonthlyIncomeMinor).toBe(0)
    expect(result.monthsUntilChange).toBe(0)
  })

  it('keeps single-step results honest: timeline and depletion are null', () => {
    const result = calculateScenario(baseProfile, { monthlyIncomeDeltaMinor: -500_000 })
    expect(result.timeline).toBeNull()
    expect(result.fundDepletedAtMonth).toBeNull()
  })
})
