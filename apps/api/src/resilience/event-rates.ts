import { createHash } from 'node:crypto'

/**
 * Population event rates for the resilience engine (intent 94, R10). Owner decision 2026-11-14: ONS and DWP are
 * both approved sources. Each row below was read from the source page on the date given and cites the series,
 * period and release date. A row without a verified source is absent, never estimated; what is missing is listed
 * in RATE_GAPS. These are rates for a whole population. They are never used to say anything about one person's
 * health or job, and nothing here is advice.
 */
export interface EventRate {
  id: string
  source: 'ONS' | 'DWP'
  series: string
  population: string
  value: number
  unit: string
  period: string
  releaseDate: string
  url: string
  /** The day the figure was read from the page. Re-read before it is shown anywhere. */
  fetchedOn: string
}

export const EVENT_RATES: readonly EventRate[] = [
  {
    id: 'redundancy_rate_per_1000',
    source: 'ONS',
    series: 'LFS: ILO redundancy rate: UK: All: SA',
    population: 'UK employees',
    value: 3.8,
    unit: 'per 1,000 employees',
    period: '2026 JUN-AUG',
    releaseDate: '2026-10-20',
    url: 'https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/redundancies',
    fetchedOn: '2026-11-14',
  },
  {
    id: 'sickness_absence_rate_percent',
    source: 'ONS',
    series: 'Sickness absence in the UK labour market: 2025',
    population: 'UK people aged 16 and over in employment',
    value: 2.0,
    unit: 'percent of working hours lost to sickness or injury',
    period: '2025',
    releaseDate: '2026-05-01',
    url: 'https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/labourproductivity/articles/sicknessabsenceinthelabourmarket/latest',
    fetchedOn: '2026-11-14',
  },
]

/**
 * A hash of the exact rate rows, in id order so row order never matters —
 * same style as `figuresVersion`. Any change to any row is a new version,
 * which is what an estimate cites as its "rates version" (intent 97, slice
 * 6). Updating rates is a reviewed PR to this file; nothing edits them at
 * runtime.
 */
export function ratesVersion(rates: readonly EventRate[] = EVENT_RATES): string {
  return createHash('sha256')
    .update(
      [...rates]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((r) =>
          [
            r.id,
            r.source,
            r.series,
            r.population,
            r.value,
            r.unit,
            r.period,
            r.releaseDate,
            r.url,
            r.fetchedOn,
          ].join('='),
        )
        .join(';'),
    )
    .digest('hex')
    .slice(0, 16)
}

export interface RateGap {
  event: string
  reason: string
}

export const RATE_GAPS: readonly RateGap[] = [
  {
    event: 'redundancy_duration',
    reason:
      'How long a redundancy lasts was not read from an ONS or DWP page; no figure is stored until it is.',
  },
  {
    event: 'long_term_sickness_duration',
    reason:
      'Duration of long-term sickness absence was not read from an ONS or DWP page; no figure is stored until it is.',
  },
  {
    event: 'dwp_benefit_offsets',
    reason:
      'No DWP table was read, so what state benefits would pay after a shock is not modelled (also needs B7).',
  },
]
