/**
 * Google Analytics 4 Data API, read-only (intent 47): sessions, engaged sessions and key events by
 * source/medium and landing page. Used only to cross-check the first-party funnel; GA4 is consent-gated on
 * the site, so it will count fewer visits than the first-party events do.
 */
import { GoogleReadError, googleErrorFrom } from './google-read.js'

export interface Ga4Row {
  dims: string[]
  metrics: number[]
}

export interface Ga4ReportOptions {
  token: () => Promise<string>
  /** The numeric GA4 property id, without the `properties/` prefix. */
  propertyId: string
  startDate: string
  endDate: string
  dimensions: string[]
  metrics: string[]
  pageSize?: number
  maxRows?: number
  fetchImpl?: typeof fetch
}

export const GA4_PAGE_SIZE = 10_000
export const GA4_MAX_ROWS = 50_000

export async function runGa4Report(opts: Ga4ReportOptions): Promise<Ga4Row[]> {
  const doFetch = opts.fetchImpl ?? fetch
  const pageSize = Math.min(opts.pageSize ?? GA4_PAGE_SIZE, GA4_PAGE_SIZE)
  const maxRows = opts.maxRows ?? GA4_MAX_ROWS
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(opts.propertyId)}:runReport`
  const rows: Ga4Row[] = []
  for (let offset = 0; rows.length < maxRows; offset += pageSize) {
    let res: Response
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await opts.token()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: opts.startDate, endDate: opts.endDate }],
          dimensions: opts.dimensions.map((name) => ({ name })),
          metrics: opts.metrics.map((name) => ({ name })),
          limit: Math.min(pageSize, maxRows - rows.length),
          offset,
        }),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (err) {
      if (err instanceof GoogleReadError) throw err
      throw new GoogleReadError('failed', `GA4 request failed: ${(err as Error).message}`)
    }
    if (!res.ok) throw await googleErrorFrom(res, 'GA4 report')
    const body = (await res.json()) as {
      rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[]
      rowCount?: number
    }
    const got = (body.rows ?? []).map((r) => ({
      dims: (r.dimensionValues ?? []).map((d) => d.value ?? ''),
      metrics: (r.metricValues ?? []).map((m) => Number(m.value ?? 0)),
    }))
    rows.push(...got)
    if (got.length < pageSize) break
  }
  return rows
}
