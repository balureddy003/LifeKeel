import { describe, it, expect } from 'vitest'
import { EVENT_RATES, RATE_GAPS, ratesVersion, type EventRate } from '../event-rates.js'

// Intent 94, R10. Owner decision 2026-11-14: ONS and DWP are both approved sources. Every row cites its
// source, series, period and release date, or it is absent. Population rates only: never an individual's
// health or job. Figures are read from the source page, never guessed.

/** The data-file rule, as a function so a bad row can be shown to fail it (intent 97, slice 6). */
function rateRowProblems(r: Partial<EventRate>): string[] {
  const problems: string[] = []
  if (!['ONS', 'DWP'].includes(r.source as string)) problems.push('source')
  if (!r.series || r.series.length <= 3) problems.push('series')
  if (!r.period || r.period.length <= 3) problems.push('period')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.releaseDate ?? '')) problems.push('releaseDate')
  if (!/^https:\/\/www\.(ons\.gov|gov)\.uk\//.test(r.url ?? '')) problems.push('url')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.fetchedOn ?? '')) problems.push('fetchedOn')
  if (!Number.isFinite(r.value) || (r.value ?? -1) < 0) problems.push('value')
  return problems
}

describe('event rates data', () => {
  it('every row names an approved source, a series, a period, a release date and a page', () => {
    expect(EVENT_RATES.length).toBeGreaterThan(0)
    for (const r of EVENT_RATES as readonly EventRate[]) {
      expect(rateRowProblems(r)).toEqual([])
    }
  })

  it('a row without a source fails the data-file check', () => {
    const noSource = { ...EVENT_RATES[0]!, source: undefined } as unknown as Partial<EventRate>
    expect(rateRowProblems(noSource)).toContain('source')
    const invented = { ...EVENT_RATES[0]!, source: 'WHO' } as unknown as Partial<EventRate>
    expect(rateRowProblems(invented)).toContain('source')
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

// Intent 97, slice 6: the rate set is versioned like the figures — any row
// change is a new version an estimate can cite, and updating rates stays a
// reviewed PR to this data file.
describe('ratesVersion', () => {
  it('is stable for the same rows and changes when any row changes', () => {
    const v = ratesVersion()
    expect(v).toMatch(/^[0-9a-f]{16}$/)
    expect(ratesVersion(EVENT_RATES)).toBe(v)

    const first = EVENT_RATES[0]!
    // Any field on any row is part of the version — a new figure, a new
    // period, a corrected source date all count.
    for (const changed of [
      { ...first, value: first.value + 0.1 },
      { ...first, period: '2026 SEP-NOV' },
      { ...first, releaseDate: '2026-11-10' },
      { ...first, fetchedOn: '2026-11-15' },
      { ...first, series: `${first.series} (revised)` },
    ]) {
      expect(ratesVersion([changed, ...EVENT_RATES.slice(1)])).not.toBe(v)
    }
    // A row added or removed is a new version too.
    const extra = { ...first, id: 'extra_rate' }
    expect(ratesVersion([...EVENT_RATES, extra])).not.toBe(v)
    expect(ratesVersion(EVENT_RATES.slice(1))).not.toBe(v)
  })

  it('is order-insensitive — the same set in a different order is the same version', () => {
    if (EVENT_RATES.length < 2) return
    expect(ratesVersion([...EVENT_RATES].reverse())).toBe(ratesVersion())
  })
})
