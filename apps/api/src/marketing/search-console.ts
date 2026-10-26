/**
 * Google Search Console, read-only (intent 47): clicks, impressions, click-through rate and average
 * position by query, page or date. Uses searchAnalytics.query, which only reads. Search data lags by about
 * two to three days, so callers ask for `final` data and end the range a few days back.
 */
import { GoogleReadError, googleErrorFrom } from './google-read.js'

export interface SearchRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export type SearchDimension = 'query' | 'page' | 'date'

export interface SearchQueryOptions {
  token: () => Promise<string>
  siteUrl: string
  startDate: string
  endDate: string
  dimensions: SearchDimension[]
  /** Rows per request; Google allows up to 25,000. */
  pageSize?: number
  /** A hard stop on total rows, so a huge property cannot run away. */
  maxRows?: number
  fetchImpl?: typeof fetch
}

export const SEARCH_PAGE_SIZE = 25_000
export const SEARCH_MAX_ROWS = 50_000

export async function querySearchAnalytics(opts: SearchQueryOptions): Promise<SearchRow[]> {
  const doFetch = opts.fetchImpl ?? fetch
  const pageSize = Math.min(opts.pageSize ?? SEARCH_PAGE_SIZE, SEARCH_PAGE_SIZE)
  const maxRows = opts.maxRows ?? SEARCH_MAX_ROWS
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(opts.siteUrl)}/searchAnalytics/query`
  const rows: SearchRow[] = []
  for (let startRow = 0; rows.length < maxRows; startRow += pageSize) {
    let res: Response
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await opts.token()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate: opts.startDate,
          endDate: opts.endDate,
          dimensions: opts.dimensions,
          rowLimit: Math.min(pageSize, maxRows - rows.length),
          startRow,
          dataState: 'final',
        }),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (err) {
      if (err instanceof GoogleReadError) throw err
      throw new GoogleReadError(
        'failed',
        `Search Console request failed: ${(err as Error).message}`,
      )
    }
    if (!res.ok) throw await googleErrorFrom(res, 'Search Console query')
    const body = (await res.json()) as { rows?: SearchRow[] }
    const got = body.rows ?? []
    rows.push(...got)
    if (got.length < pageSize) break
  }
  return rows
}
