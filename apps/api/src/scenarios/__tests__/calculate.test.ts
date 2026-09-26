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
})
