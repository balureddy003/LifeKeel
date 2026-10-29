import { describe, expect, it } from 'vitest'
import { runwayPoints } from '../RunwayChart'

const result = (timeline: unknown[], income = 500_000, surplus = 200_000) => ({
  currentMonthlyIncomeMinor: income,
  currentMonthlySurplusMinor: surplus,
  timeline,
})
const point = (atMonth: number, inc: number, exp: number, savings: number) => ({
  atMonth,
  monthlyIncomeMinor: inc,
  monthlyExpensesMinor: exp,
  savingsMinor: savings,
})

describe('runwayPoints', () => {
  it('finds the month savings reach zero after the last change', () => {
    // £5,000 in, £3,000 out, £9,000 saved; at month 1 income drops to £2,000.
    const out = runwayPoints(result([point(1, 200_000, 300_000, 1_100_000)]), 900_000)!
    expect(out.zeroAt).toBeCloseTo(12, 5)
    expect(out.pts[0]).toEqual({ t: 0, s: 900_000 })
    expect(out.pts.at(-1)).toEqual({ t: out.zeroAt, s: 0 })
  })

  it('has no zero point when income covers spending', () => {
    const out = runwayPoints(result([point(1, 400_000, 300_000, 1_100_000)]), 900_000)!
    expect(out.zeroAt).toBeNull()
    expect(out.pts.at(-1)!.s).toBeGreaterThan(1_100_000)
  })

  it('draws a one-off cash jump as a vertical step', () => {
    const out = runwayPoints(result([point(2, 500_000, 300_000, 3_300_000)]), 900_000)!
    const atTwo = out.pts.filter((p) => p.t === 2)
    expect(atTwo.map((p) => p.s)).toEqual([1_300_000, 3_300_000])
  })

  it('records a zero reached in the middle of a stage', () => {
    // Spending exceeds income from the start; the fund is gone before month 3.
    const out = runwayPoints(result([point(3, 100_000, 300_000, 0)], 100_000, -200_000), 400_000)!
    expect(out.zeroAt).toBeCloseTo(2, 5)
  })

  it('stops at ten years for a tiny shortfall instead of drawing 40,000 years', () => {
    const out = runwayPoints(result([point(1, 299_999, 300_000, 500_000)], 300_000, 0), 500_000)!
    expect(out.zeroAt).toBeNull()
    expect(Math.max(...out.pts.map((p) => p.t))).toBeLessThanOrEqual(120)
  })

  it('draws nothing without a timeline', () => {
    expect(runwayPoints({ timeline: null }, 100)).toBeNull()
    expect(runwayPoints(null, 100)).toBeNull()
  })
})
