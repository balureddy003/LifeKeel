/**
 * computeProductSlis — the ratios behind the lifekeel_*_rate gauges.
 * Denominators of zero must not produce NaN/Infinity on the wire.
 */
import { describe, expect, it } from 'vitest'
import { computeProductSlis } from '../metrics.js'

const ev = (dim: string, count: number) => ({ day: '2026-11-10', dim, count })

describe('computeProductSlis', () => {
  it('computes the brief funnel ratios over summed rollup rows', () => {
    const sli = computeProductSlis(
      [
        ev('brief_link_fetched', 100),
        ev('brief_confirmed_open', 60),
        ev('brief_gate_hit', 50),
        ev('brief_gate_converted', 10),
        ev('brief_created', 80),
        ev('brief_next_started', 20),
        ev('brief_update_started', 4),
      ],
      [ev('signup|organic|spring', 40), ev('first_insight|organic|spring', 10)],
    )
    expect(sli.confirmed_open_rate).toBeCloseTo(0.6)
    expect(sli.gate_conversion_rate).toBeCloseTo(0.2)
    expect(sli.return_rate).toBeCloseTo(0.3)
    expect(sli.cohort_first_insight_rate).toBeCloseTo(0.25)
  })

  it('sums funnel dims across source/campaign suffixes', () => {
    const sli = computeProductSlis(
      [],
      [ev('signup|organic|a', 10), ev('signup|paid|b', 10), ev('first_insight|organic|a', 5)],
    )
    expect(sli.cohort_first_insight_rate).toBeCloseTo(0.25)
  })

  it('returns 0, never NaN, on empty denominators', () => {
    const sli = computeProductSlis([], [])
    for (const v of Object.values(sli)) {
      expect(v).toBe(0)
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})
