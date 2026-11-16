/**
 * Slice-8 fixture evaluation: scores the deterministic anomaly baseline
 * (median/MAD) against the synthetic multi-month series in
 * fixtures/anomaly/monthly-series.json — the same fixture a future CatBoost
 * helper must beat before it can ship (intent 97 slice 8).
 *
 * Metrics: recall = planted anomalies flagged / planted; false-flag rate =
 * unplanted cells flagged / unplanted cells. A flag only counts as a true
 * positive when the direction also matches — flagging a spike as a drop is
 * not catching it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { flagUnusualTotals, type AnomalyMetric, type MonthTotal } from '../anomaly-flag.js'

interface Fixture {
  households: {
    id: string
    months: { period: string; money_in_minor: number; money_out_minor: number }[]
  }[]
  expected_flags: {
    household: string
    period: string
    metric: AnomalyMetric
    direction: 'high' | 'low'
  }[]
}

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, '../../../../../fixtures/anomaly/monthly-series.json'), 'utf8'),
) as Fixture

describe('anomaly baseline fixture evaluation (intent 97, slice 8)', () => {
  const flagged = new Map<string, 'high' | 'low'>()
  let evaluated = 0

  for (const hh of FIXTURE.households) {
    for (const metric of ['money_in', 'money_out'] as const) {
      const totals: MonthTotal[] = hh.months.map((m) => ({
        period: m.period,
        amountMinor: metric === 'money_in' ? m.money_in_minor : m.money_out_minor,
      }))
      for (const f of flagUnusualTotals(totals, { metric })) {
        flagged.set(`${hh.id}|${f.period}|${metric}`, f.direction)
      }
      evaluated += totals.length
    }
  }

  const expected = new Map(
    FIXTURE.expected_flags.map((f) => [`${f.household}|${f.period}|${f.metric}`, f.direction]),
  )

  it('fixture has planted anomalies and enough cells to score', () => {
    expect(FIXTURE.expected_flags.length).toBeGreaterThanOrEqual(10)
    expect(evaluated).toBe(FIXTURE.households.length * 14 * 2)
  })

  it('meets the baseline floors — the number CatBoost must beat', () => {
    let tp = 0
    let fp = 0
    let fn = 0
    for (const [key, direction] of expected) {
      if (flagged.get(key) === direction) tp++
      else fn++
    }
    for (const [key, direction] of flagged) {
      if (expected.get(key) !== direction) fp++
    }
    const recall = tp / expected.size
    const fpr = fp / (evaluated - expected.size)
    console.log(
      `baseline: recall=${recall.toFixed(3)} (${tp}/${expected.size}), ` +
        `false-flag rate=${fpr.toFixed(4)} (${fp}/${evaluated - expected.size})`,
    )
    // Floors are deliberately loose: this pins that the baseline is not
    // degenerate, not that it is good. CatBoost must beat recall at the same
    // false-flag rate by the owner-set margin to ship at all.
    expect(recall).toBeGreaterThanOrEqual(0.6)
    expect(fpr).toBeLessThanOrEqual(0.1)
  })

  it('flags carry no amounts — period, metric, direction, score only', () => {
    for (const hh of FIXTURE.households.slice(0, 3)) {
      for (const metric of ['money_in', 'money_out'] as const) {
        const totals: MonthTotal[] = hh.months.map((m) => ({
          period: m.period,
          amountMinor: metric === 'money_in' ? m.money_in_minor : m.money_out_minor,
        }))
        for (const f of flagUnusualTotals(totals, { metric })) {
          expect(Object.keys(f).sort()).toEqual(['direction', 'metric', 'period', 'score'])
        }
      }
    }
  })
})
