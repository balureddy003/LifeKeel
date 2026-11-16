import { describe, expect, it } from 'vitest'
import { flagUnusualTotals, type MonthTotal } from '../anomaly-flag.js'

const months = (values: number[]): MonthTotal[] =>
  values.map((amountMinor, i) => ({
    period: `2025-${String(i + 1).padStart(2, '0')}`,
    amountMinor,
  }))

describe('flagUnusualTotals (deterministic anomaly baseline, intent 97 slice 8)', () => {
  it('flags a planted high outlier and leaves normal months alone', () => {
    // ~£1,000/month typical, one £9,000 month.
    const series = months([100_000, 105_000, 98_000, 102_000, 101_000, 99_000, 900_000, 103_000])
    const flags = flagUnusualTotals(series, { metric: 'money_out' })
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatchObject({ period: '2025-07', metric: 'money_out', direction: 'high' })
    expect(flags[0]!.score).toBeGreaterThan(3.5)
  })

  it('flags a low outlier too', () => {
    const series = months([98_000, 101_000, 99_000, 102_000, 100_000, 103_000, 1_000, 100_000])
    const flags = flagUnusualTotals(series, { metric: 'money_in' })
    expect(flags.map((f) => f.direction)).toContain('low')
  })

  it('returns nothing for a steady series', () => {
    const series = months(Array(12).fill(100_000))
    expect(flagUnusualTotals(series, { metric: 'money_out' })).toEqual([])
  })

  it('returns nothing with too few points to bound a deviation', () => {
    expect(flagUnusualTotals(months([100, 5_000_000, 100]), { metric: 'money_out' })).toEqual([])
  })

  it('returns nothing when MAD is zero (cannot bound)', () => {
    // Mostly identical values with one different → MAD 0 → no flag rather than infinite score.
    const series = months([100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 100_000, 250_000])
    expect(flagUnusualTotals(series, { metric: 'money_out' })).toEqual([])
  })

  it('is deterministic and carries no amounts — period, metric, direction, score only', () => {
    const series = months([100_000, 105_000, 98_000, 102_000, 101_000, 99_000, 900_000, 103_000])
    const a = flagUnusualTotals(series, { metric: 'money_out' })
    const b = flagUnusualTotals(series, { metric: 'money_out' })
    expect(a).toEqual(b)
    for (const f of a) {
      expect(Object.keys(f).sort()).toEqual(['direction', 'metric', 'period', 'score'])
      expect(typeof f.score).toBe('number')
    }
  })
})
