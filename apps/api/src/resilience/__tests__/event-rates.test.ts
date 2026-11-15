import { describe, it, expect } from 'vitest'
import { EVENT_RATES, RATE_GAPS, type EventRate } from '../event-rates.js'

// Intent 94, R10. Owner decision 2026-11-14: ONS and DWP are both approved sources. Every row cites its
// source, series, period and release date, or it is absent. Population rates only: never an individual's
// health or job. Figures are read from the source page, never guessed.
describe('event rates data', () => {
  it('every row names an approved source, a series, a period, a release date and a page', () => {
    expect(EVENT_RATES.length).toBeGreaterThan(0)
    for (const r of EVENT_RATES as readonly EventRate[]) {
      expect(['ONS', 'DWP']).toContain(r.source)
      expect(r.series.length).toBeGreaterThan(3)
      expect(r.period.length).toBeGreaterThan(3)
      expect(r.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(r.url).toMatch(/^https:\/\/www\.(ons\.gov|gov)\.uk\//)
      expect(r.fetchedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isFinite(r.value)).toBe(true)
      expect(r.value).toBeGreaterThanOrEqual(0)
    }
  })

  it('every row is a population rate for a whole population, never an individual', () => {
    for (const r of EVENT_RATES) expect(r.population).toMatch(/UK|employees|employment/i)
  })

  it('ids are unique', () => {
    const ids = EVENT_RATES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('known rows: redundancy rate and sickness absence rate, as read from ONS on 2026-11-14', () => {
    const red = EVENT_RATES.find((r) => r.id === 'redundancy_rate_per_1000')
    expect(red?.value).toBe(3.8)
    expect(red?.period).toBe('2026 JUN-AUG')
    const sick = EVENT_RATES.find((r) => r.id === 'sickness_absence_rate_percent')
    expect(sick?.value).toBe(2.0)
    expect(sick?.period).toBe('2025')
  })

  it('what is missing is listed as a gap with a reason, not filled in', () => {
    const ids = RATE_GAPS.map((g) => g.event)
    expect(ids).toEqual(
      expect.arrayContaining(['redundancy_duration', 'long_term_sickness_duration']),
    )
    for (const g of RATE_GAPS) {
      expect(g.reason.length).toBeGreaterThan(10)
      expect(EVENT_RATES.find((r) => r.id.startsWith(g.event))).toBeUndefined()
    }
  })
})
