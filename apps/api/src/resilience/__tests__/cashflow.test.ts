import { describe, it, expect } from 'vitest'
import { flatTimeline, simulate, runwayMonths, NO_END } from '../cashflow.js'

// Intent 94, R1. Layer 1: known answers. Layer 2: invariants. Figures are minor units, whole months.
describe('cash-flow model', () => {
  it('known answer: 6,000 saved, 2,000 spend, no inflow lasts 3 whole months', () => {
    expect(
      runwayMonths({ savingsMinor: 600000, monthlySpendMinor: 200000, monthlyInflowMinor: 0 }),
    ).toBe(3)
  })

  it('known answer: inflow covering part of the spend stretches the runway', () => {
    // gap 1,500 a month: 6,000 lasts 4 months
    expect(
      runwayMonths({ savingsMinor: 600000, monthlySpendMinor: 200000, monthlyInflowMinor: 50000 }),
    ).toBe(4)
  })

  it('inflow that covers the spend gives no end, never a number', () => {
    expect(
      runwayMonths({ savingsMinor: 0, monthlySpendMinor: 200000, monthlyInflowMinor: 200000 }),
    ).toBe(NO_END)
    expect(
      runwayMonths({ savingsMinor: 0, monthlySpendMinor: 200000, monthlyInflowMinor: 250000 }),
    ).toBe(NO_END)
  })

  it('no savings and a gap runs out in month 0', () => {
    expect(
      runwayMonths({ savingsMinor: 0, monthlySpendMinor: 200000, monthlyInflowMinor: 0 }),
    ).toBe(0)
  })

  it('a timeline can change month by month (a rise in spend from month 2)', () => {
    const t = flatTimeline(6, 0, 100000).map((m, i) => (i >= 2 ? { ...m, spendMinor: 300000 } : m))
    // 4,000 saved: months 0,1 cost 1,000 each (2,000 left), month 2 costs 3,000 (short) -> 2 months covered
    expect(simulate(400000, t).monthsCovered).toBe(2)
  })

  it('the balance is reported month by month and never rounds', () => {
    const r = simulate(500000, flatTimeline(3, 0, 100000))
    expect(r.balanceByMonthMinor).toEqual([400000, 300000, 200000])
    expect(Number.isInteger(r.monthsCovered)).toBe(true)
  })

  it('with no inflow the runway is savings divided by spend, rounded down', () => {
    for (const savings of [0, 150000, 600000, 2500000]) {
      for (const spend of [100000, 200000, 350000]) {
        expect(
          runwayMonths({ savingsMinor: savings, monthlySpendMinor: spend, monthlyInflowMinor: 0 }),
        ).toBe(Math.floor(savings / spend))
      }
    }
  })

  it('invariants: more savings or inflow never shorten the runway; more spend never lengthens it', () => {
    for (const s of [0, 100000, 600000, 2000000]) {
      for (const spend of [100000, 200000, 350000]) {
        for (const inflow of [0, 50000, 150000]) {
          const base = runwayMonths({
            savingsMinor: s,
            monthlySpendMinor: spend,
            monthlyInflowMinor: inflow,
          })
          expect(
            runwayMonths({
              savingsMinor: s + 100000,
              monthlySpendMinor: spend,
              monthlyInflowMinor: inflow,
            }),
          ).toBeGreaterThanOrEqual(base)
          expect(
            runwayMonths({
              savingsMinor: s,
              monthlySpendMinor: spend,
              monthlyInflowMinor: inflow + 10000,
            }),
          ).toBeGreaterThanOrEqual(base)
          expect(
            runwayMonths({
              savingsMinor: s,
              monthlySpendMinor: spend + 10000,
              monthlyInflowMinor: inflow,
            }),
          ).toBeLessThanOrEqual(base)
        }
      }
    }
  })

  it('rejects negative or fractional money instead of guessing', () => {
    expect(() =>
      runwayMonths({ savingsMinor: -1, monthlySpendMinor: 1, monthlyInflowMinor: 0 }),
    ).toThrow()
    expect(() =>
      runwayMonths({ savingsMinor: 1.5, monthlySpendMinor: 1, monthlyInflowMinor: 0 }),
    ).toThrow()
  })
})
