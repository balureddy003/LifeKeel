/**
 * ConnectorSyncEngine
 *
 * Two jobs in one:
 *
 * 1. LIVE POLLING  — every N minutes, fetch the latest page of each resource
 *    for every connected connector per tenant, generate events, run detectors.
 *
 * 2. HISTORICAL BACKFILL — on first connect (or on-demand) walk ALL pages for
 *    a lookback window (default 180 days) and replay them through the engine.
 *    This answers "does this work on historical data?" — YES. Connect Xero today
 *    and Kairos will surface every overdue invoice from the last 6 months within
 *    minutes.
 *
 * Architecture
 * ────────────
 *  ConnectorSyncEngine
 *    ├── schedulePoll(db, engine, …)      — starts cron loop
 *    ├── runPoll(tenantId, connectorId)   — one poll cycle
 *    ├── backfill(tenantId, connectorId)  — full historical replay
 *    └── fetchAllPages(…)                — generic paginated HTTP fetcher
 *
 * Each connector resource is defined in its YAML with:
 *   resources:
 *     - name: Invoices
 *       path: /Invoices
 *       params: { Statuses: AUTHORISED,SUBMITTED }
 *       pagination: { type: page, param: page }
 *       date_filter_param: DateFrom     ← optional: enables incremental sync
 *
 * Token refresh is handled transparently — if a request returns 401,
 * refreshAccessToken() is called once and the request is retried.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ConnectorConfig } from './schemas.js'
import type { EventGenerator } from './event-generator.js'
import type { Engine, Insight } from '@agentoak/engine'
import { safeFetch } from './safe-fetch.js'
import { createLogger, buildGoalKpiTargets, buildGoalContext, decryptIfNeeded } from '@agentoak/platform'

const log = createLogger({ service: 'connector-sync', version: '0.0.0' })

/** Promisified execFile for CLI-based connector resources (e.g. yfinance). */
const execAsync = promisify(execFile)

// Injected MongoDB types (pipeline pkg has no direct mongodb dep)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { collection: (name: string) => any }

// Google connectors that can use shared credentials
const GOOGLE_CONNECTORS = ['google_calendar', 'gmail', 'google_drive', 'youtube', 'google_sheets', 'google_business']

function getGoogleClientId(connectorId: string): string {
  // Try connector-specific first for backward compatibility
  const specificId = process.env[`KAIROS_${connectorId.toUpperCase()}_CLIENT_ID`]
  if (specificId) return specificId
  
  // Fall back to shared Google credentials for Google services
  if (GOOGLE_CONNECTORS.includes(connectorId)) {
    return process.env['GOOGLE_CLIENT_ID'] ?? ''
  }
  
  return ''
}

function getGoogleClientSecret(connectorId: string): string {
  // Try connector-specific first for backward compatibility
  const specificSecret = process.env[`KAIROS_${connectorId.toUpperCase()}_CLIENT_SECRET`]
  if (specificSecret) return specificSecret
  
  // Fall back to shared Google credentials for Google services
  if (GOOGLE_CONNECTORS.includes(connectorId)) {
    return process.env['GOOGLE_CLIENT_SECRET'] ?? ''
  }
  
  return ''
}

/** Convert an Alpha Vantage TIME_SERIES_DAILY object into a flat record list. */
function transformAlphaVantageTimeSeriesDaily(
  body: Record<string, unknown>,
  symbol: string,
): Record<string, unknown>[] {
  const series = body['Time Series (Daily)'] as Record<string, Record<string, string>> | undefined
  if (!series || typeof series !== 'object' || Array.isArray(series)) return []
  return Object.entries(series)
    .map(([date, day]) => ({
      ticker: symbol,
      date,
      open: Number(day['1. open'] ?? 0),
      high: Number(day['2. high'] ?? 0),
      low: Number(day['3. low'] ?? 0),
      close: Number(day['4. close'] ?? 0),
      volume: Number(day['5. volume'] ?? 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Gap #6 (TRADING_ENGINE_GAPS.md): Convert an Alpha Vantage OVERVIEW response
 * into a flat company_fundamentals record. The OVERVIEW endpoint returns a
 * single object with ~60 fields; we extract the ones the scoring engine needs:
 * - GrossProfitTTM / TotalRevenueTTM → gross_profitability ratio
 * - Sector, Industry, AssetType → for asset-class awareness (gap #9)
 * - MarketCapitalization → for size-aware scoring (future)
 *
 * The gross_profitability is computed as GrossProfitTTM / TotalRevenueTTM,
 * which is exactly what computeQualityScore(grossProfitability) expects.
 * If either field is missing or revenue is 0, gross_profitability is left
 * undefined — the scoring engine falls back to a neutral 0.5 (same as the
 * old placeholder, but now explicitly "no data" rather than "fake data").
 */
export function transformAlphaVantageOverview(
  body: Record<string, unknown>,
  symbol: string,
): Record<string, unknown>[] {
  // Alpha Vantage returns "Symbol" matching the requested symbol, or "Note"
  // / "Error Message" on failure. An empty or error response produces no
  // records.
  const note = body['Note'] as string | undefined
  const errorMsg = body['Error Message'] as string | undefined
  if (note || errorMsg) return []

  const grossProfitTTM = Number(body['GrossProfitTTM'] ?? 0)
  const totalRevenueTTM = Number(body['TotalRevenueTTM'] ?? 0)
  const grossProfitability = (totalRevenueTTM > 0 && grossProfitTTM > 0)
    ? grossProfitTTM / totalRevenueTTM
    : undefined

  return [{
    ticker: String(body['Symbol'] ?? symbol),
    gross_profit_ttm: grossProfitTTM || undefined,
    total_revenue_ttm: totalRevenueTTM || undefined,
    gross_profitability: grossProfitability,
    sector: String(body['Sector'] ?? ''),
    industry: String(body['Industry'] ?? ''),
    asset_type: String(body['AssetType'] ?? ''),
    market_capitalization: Number(body['MarketCapitalization'] ?? 0) || undefined,
    name: String(body['Name'] ?? ''),
  }]
}

// ── yfinance transforms ────────────────────────────────────────────────────
// The yfinance Python bridge (scripts/fetch-yfinance.py) emits JSON in a
// normalized shape: { ticker, history: [{date, open, high, low, close,
// volume, dividends, splits}, ...] } for price history, and { ticker,
// income_statement: {...}, balance_sheet: {...}, ratios: {...} } for
// fundamentals. These transforms map that into the same record format the
// Alpha Vantage transforms produce, so the downstream signal pipeline
// (buildMarketDataFromSignals, computeQualityScore) works unchanged.

/** Transform yfinance daily history JSON into market_price records. */
export function transformYfinanceDailyHistory(
  body: Record<string, unknown>,
  symbol: string,
): Record<string, unknown>[] {
  const history = body['history'] as Record<string, unknown>[] | undefined
  if (!Array.isArray(history)) return []
  const ticker = String(body['ticker'] ?? symbol)
  return history.map((row) => ({
    ticker,
    date: String(row['date'] ?? ''),
    open: Number(row['open'] ?? 0),
    high: Number(row['high'] ?? 0),
    low: Number(row['low'] ?? 0),
    close: Number(row['close'] ?? 0),
    volume: Number(row['volume'] ?? 0),
    dividends: Number(row['dividends'] ?? 0),
    splits: Number(row['splits'] ?? 0),
  })).filter((r) => r.date !== '')
}

/** Transform yfinance fundamentals JSON into a company_fundamentals record. */
export function transformYfinanceFundamentals(
  body: Record<string, unknown>,
  symbol: string,
): Record<string, unknown>[] {
  const ratios = body['ratios'] as Record<string, unknown> | undefined
  if (!ratios || typeof ratios !== 'object') return []
  const grossProfitTTM = Number(ratios['gross_profit_ttm'] ?? 0)
  const totalRevenueTTM = Number(ratios['total_revenue_ttm'] ?? 0)
  const grossProfitability = (totalRevenueTTM > 0 && grossProfitTTM > 0)
    ? grossProfitTTM / totalRevenueTTM
    : undefined
  return [{
    ticker: String(body['ticker'] ?? symbol),
    gross_profit_ttm: grossProfitTTM || undefined,
    total_revenue_ttm: totalRevenueTTM || undefined,
    gross_profitability: grossProfitability,
    sector: String(ratios['sector'] ?? ''),
    industry: String(ratios['industry'] ?? ''),
    market_capitalization: Number(ratios['market_cap'] ?? 0) || undefined,
    name: String(body['name'] ?? ratios['name'] ?? ''),
  }]
}

// ── HF Data Library transforms ─────────────────────────────────────────────
// GET /bars/{ticker}/daily returns a JSON array of { date, open, high, low,
// close, volume } rows, or a paginated object { results: [...], count, next }.
// Both shapes are handled — the transform normalizes to market_price records.

/** Transform HF Data Library daily bars JSON into market_price records.
 *
 * The API returns { ticker, version, count, bars: [{ datetime, open, high,
 * low, close, volume }, ...] }. For the /daily endpoint, datetime is a date
 * string ("2024-01-02"); for the 1-minute endpoint, it includes time. We
 * slice to the first 10 chars to get the date regardless. */
export function transformHfDataDailyBars(
  body: Record<string, unknown>,
  symbol: string,
): Record<string, unknown>[] {
  const rows = (Array.isArray(body) ? body : body['bars']) as Record<string, unknown>[] | undefined
  if (!Array.isArray(rows)) return []
  return rows.map((row) => ({
    ticker: String(body['ticker'] ?? symbol),
    date: String(row['datetime'] ?? row['date'] ?? '').slice(0, 10),
    open: Number(row['open'] ?? 0),
    high: Number(row['high'] ?? 0),
    low: Number(row['low'] ?? 0),
    close: Number(row['close'] ?? 0),
    volume: Number(row['volume'] ?? 0),
  })).filter((r) => r.date !== '')
}

// ── Finnhub transforms ─────────────────────────────────────────────────────
// GET /quote returns { c, h, l, o, pc, t } — current price, day OHLC,
// previous close, and timestamp (unix seconds). Available on the free tier.
// GET /stock/candle (historical OHLCV) is PAID-ONLY and returns 403 on the
// free tier — kept for reference but not exposed as a resource.
// GET /stock/profile2 returns a single object with company info.

/** Transform Finnhub real-time quote into a market_price record. */
export function transformFinnhubRealtimeQuote(
  body: Record<string, unknown>,
  symbol: string,
): Record<string, unknown>[] {
  const current = Number(body['c'] ?? 0)
  if (current === 0) return [] // Finnhub returns all-zeros for invalid symbols
  const timestamp = Number(body['t'] ?? 0)
  const date = timestamp > 0
    ? new Date(timestamp * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)
  return [{
    ticker: symbol,
    date,
    open: Number(body['o'] ?? 0),
    high: Number(body['h'] ?? 0),
    low: Number(body['l'] ?? 0),
    close: current,
    previous_close: Number(body['pc'] ?? 0) || undefined,
  }]
}

/** Transform Finnhub daily candles (parallel arrays) into market_price records. */
export function transformFinnhubDailyCandles(
  body: Record<string, unknown>,
  symbol: string,
): Record<string, unknown>[] {
  const status = body['s'] as string | undefined
  if (status !== 'ok') return []
  const close = body['c'] as number[] | undefined
  const open = body['o'] as number[] | undefined
  const high = body['h'] as number[] | undefined
  const low = body['l'] as number[] | undefined
  const volume = body['v'] as number[] | undefined
  const timestamps = body['t'] as number[] | undefined
  if (!Array.isArray(close) || !Array.isArray(timestamps)) return []
  return timestamps.map((t, i) => ({
    ticker: symbol,
    date: new Date(t * 1000).toISOString().slice(0, 10),
    open: Number(open?.[i] ?? 0),
    high: Number(high?.[i] ?? 0),
    low: Number(low?.[i] ?? 0),
    close: Number(close[i] ?? 0),
    volume: Number(volume?.[i] ?? 0),
  }))
}

/** Transform Finnhub company profile into a company_fundamentals record. */
export function transformFinnhubCompanyProfile(
  body: Record<string, unknown>,
  symbol: string,
): Record<string, unknown>[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return []
  // Finnhub profile2 doesn't expose gross profit / revenue directly, but it
  // carries market cap, share outstanding, industry, and IPO date — enough
  // for asset-class awareness and size-aware scoring. gross_profitability
  // is left undefined so the engine falls back to a neutral 0.5.
  return [{
    ticker: String(body['ticker'] ?? symbol),
    name: String(body['name'] ?? ''),
    sector: String(body['ggroup'] ?? ''),
    industry: String(body['gind'] ?? ''),
    market_capitalization: Number(body['marketCapitalization'] ?? 0) || undefined,
    share_outstanding: Number(body['shareOutstanding'] ?? 0) || undefined,
    ipo_date: String(body['ipo'] ?? ''),
    country: String(body['country'] ?? ''),
    exchange: String(body['exchange'] ?? ''),
  }]
}

/**
 * Transform Finnhub /news-sentiment into a sentiment_score record (Phase 2).
 * Response shape: { symbol, buzz: {...}, companyNewsScore, sectorAverageBullishPercent,
 * sentiment: { bullishPercent, bearishPercent }, ... }. We store bullishPercent
 * directly as the [0,1] sentiment score the engine's sentimentWeight consumes.
 */
export function transformFinnhubNewsSentiment(
  body: Record<string, unknown>,
  symbol: string,
): Record<string, unknown>[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return []
  const sentiment = body['sentiment'] as Record<string, unknown> | undefined
  const bullishPercent = Number(sentiment?.['bullishPercent'])
  if (!Number.isFinite(bullishPercent)) return [] // no sentiment data for this symbol
  return [{
    ticker: symbol,
    date: new Date().toISOString().slice(0, 10),
    sentiment: bullishPercent,
    bearish_percent: Number(sentiment?.['bearishPercent'] ?? 0) || undefined,
    news_score: Number(body['companyNewsScore'] ?? 0) || undefined,
  }]
}

/**
 * Transform Finnhub /stock/metric into a company_fundamentals record carrying
 * the enhanced quality metrics (Phase 2): ROE, gross margin, debt/equity.
 * Response shape: { metric: { roeTTM, grossMarginTTM, totalDebt/totalEquityQuarterly, ... } }.
 */
export function transformFinnhubFinancialMetrics(
  body: Record<string, unknown>,
  symbol: string,
): Record<string, unknown>[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return []
  const metric = body['metric'] as Record<string, unknown> | undefined
  if (!metric) return []
  const roeRaw = Number(metric['roeTTM'])
  const marginRaw = Number(metric['grossMarginTTM'])
  const debtEquityRaw = Number(metric['totalDebt/totalEquityQuarterly'])
  // Finnhub returns ROE and margins as percents (e.g. 25.3 = 25.3%);
  // the engine expects fractions (0.253).
  return [{
    ticker: symbol,
    roe: Number.isFinite(roeRaw) ? roeRaw / 100 : undefined,
    gross_margin: Number.isFinite(marginRaw) ? marginRaw / 100 : undefined,
    debt_to_equity: Number.isFinite(debtEquityRaw) ? debtEquityRaw / 100 : undefined,
  }]
}

// ── Polygon.io transforms ──────────────────────────────────────────────────
// GET /v2/aggs/ticker/{symbol}/range/1/day/{from}/{to} returns
// { results: [{ o, h, l, c, v, t, n }, ...], status: "OK", ticker, count }.
// GET /v3/reference/tickers/{symbol} returns { results: { name, sector,
// industry, market_cap, ... }, status: "OK" }.

/** Transform Polygon.io daily aggregates into market_price records. */
export function transformPolygonDailyAggs(
  body: Record<string, unknown>,
  symbol: string,
): Record<string, unknown>[] {
  const status = body['status'] as string | undefined
  if (status !== 'OK') return []
  const results = body['results'] as Record<string, unknown>[] | undefined
  if (!Array.isArray(results)) return []
  return results.map((row) => ({
    ticker: String(body['ticker'] ?? symbol),
    date: new Date(Number(row['t'] ?? 0)).toISOString().slice(0, 10),
    open: Number(row['o'] ?? 0),
    high: Number(row['h'] ?? 0),
    low: Number(row['l'] ?? 0),
    close: Number(row['c'] ?? 0),
    volume: Number(row['v'] ?? 0),
    transaction_count: Number(row['n'] ?? 0),
  }))
}

/** Transform Polygon.io ticker details into a company_fundamentals record. */
export function transformPolygonTickerDetails(
  body: Record<string, unknown>,
  symbol: string,
): Record<string, unknown>[] {
  const status = body['status'] as string | undefined
  if (status !== 'OK') return []
  const results = body['results'] as Record<string, unknown> | undefined
  if (!results || typeof results !== 'object') return []
  return [{
    ticker: String(results['ticker'] ?? symbol),
    name: String(results['name'] ?? ''),
    sector: String(results['sic_sector'] ?? ''),
    industry: String(results['sic_industry'] ?? ''),
    market_capitalization: Number(results['market_cap'] ?? 0) || undefined,
    share_class: String(results['share_class'] ?? ''),
    type: String(results['type'] ?? ''),
    locale: String(results['locale'] ?? ''),
    primary_exchange: String(results['primary_exchange'] ?? ''),
  }]
}

// ── CBOE VIX transform (Phase 2) ────────────────────────────────────────────
// GET /VIX_History.csv returns a CSV body with header
// "Date,VIX Open,VIX High,VIX Low,VIX Close". The HTTP layer returns the
// decoded text in body['text']; we parse it here and emit one vix_index
// record per row. Only the most recent rows are kept by the caller (limit
// handled by the resource path), but we emit all parsed rows so the engine
// can upsert and let the index dedupe.

/** Transform CBOE VIX CSV history into vix_index records. */
export function transformCboeVixDaily(
  body: Record<string, unknown>,
  _symbol: string,
): Record<string, unknown>[] {
  const text = String(body['text'] ?? body['body'] ?? '')
  if (!text) return []
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  // Header: Date,VIX Open,VIX High,VIX Low,VIX Close
  const header = (lines[0] ?? '').split(',').map((h) => h.trim())
  const dateIdx = header.findIndex((h) => /^date$/i.test(h))
  const closeIdx = header.findIndex((h) => /vix close/i.test(h))
  if (dateIdx < 0 || closeIdx < 0) return []
  const records: Record<string, unknown>[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = (lines[i] ?? '').split(',').map((c) => c.trim())
    const dateStr = cols[dateIdx]
    const closeRaw = Number(cols[closeIdx])
    if (!dateStr || !Number.isFinite(closeRaw)) continue
    records.push({
      date: dateStr,
      vix_value: closeRaw,
    })
  }
  return records
}

// ── FRED transforms (Phase 2) ───────────────────────────────────────────────
// GET /series/observations?series_id=...&file_type=json&limit=1&sort_order=desc
// returns { observations: [{ date, value: "5.23" }, ...], ... }.
// FRED returns values as strings; "." means missing observation.

/** Transform a FRED series observations response into a single macro record. */
function transformFredSeries(
  body: Record<string, unknown>,
  valueField: string,
): Record<string, unknown>[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return []
  const observations = body['observations'] as Record<string, unknown>[] | undefined
  if (!Array.isArray(observations) || observations.length === 0) return []
  // sort_order=desc means observations[0] is the most recent; but defensively
  // pick the last finite value.
  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i]
    if (!obs) continue
    const dateStr = String(obs['date'] ?? '')
    const raw = obs['value']
    if (raw === '.' || raw === undefined || raw === null) continue
    const value = Number(raw)
    if (!Number.isFinite(value) || !dateStr) continue
    return [{ date: dateStr, [valueField]: value }]
  }
  return []
}

/** Transform FRED T10Y2Y (10Y-2Y yield curve spread) into a yield_curve_spread record. */
export function transformFredYieldCurve(
  body: Record<string, unknown>,
  _symbol: string,
): Record<string, unknown>[] {
  return transformFredSeries(body, 'yield_curve_spread')
}

/** Transform FRED BAMLH0A0HYM2 (high-yield credit spread) into a credit_spread record. */
export function transformFredCreditSpread(
  body: Record<string, unknown>,
  _symbol: string,
): Record<string, unknown>[] {
  return transformFredSeries(body, 'credit_spread')
}

/** Transform FRED DGS10 (10Y Treasury yield) into a treasury_yield record. */
export function transformFredTreasury10Y(
  body: Record<string, unknown>,
  _symbol: string,
): Record<string, unknown>[] {
  return transformFredSeries(body, 'treasury_yield_10y')
}

// ── Google Trends transform (Phase 3) ───────────────────────────────────────
// The /explore endpoint returns a JSON envelope. The exact shape of the
// alpha API is still settling; the well-known shape is:
//   { default: { timelineData: [{ time, formattedTime, value: [42], ... }] } }
// or a top-level { timeline: [...] }. We handle both and emit the latest
// weekly search-volume ratio in [0,100] (Google's normalized scale).

/** Transform Google Trends /explore response into an attention_signal record. */
export function transformGoogleTrendsSearchVolume(
  body: Record<string, unknown>,
  symbol: string,
): Record<string, unknown>[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return []
  // Resolve the timeline array across the known envelope shapes.
  const timeline =
    (body['timelineData'] as Record<string, unknown>[] | undefined) ??
    (body['timeline'] as Record<string, unknown>[] | undefined) ??
    ((body['default'] as Record<string, unknown> | undefined)?.['timelineData'] as
      | Record<string, unknown>[]
      | undefined)
  if (!Array.isArray(timeline) || timeline.length === 0) return []
  // Take the most recent point with a finite value.
  for (let i = timeline.length - 1; i >= 0; i--) {
    const point = timeline[i]
    if (!point) continue
    const valueArr = point['value']
    const raw = Array.isArray(valueArr) ? valueArr[0] : point['value']
    const value = Number(raw)
    if (!Number.isFinite(value)) continue
    return [{
      ticker: symbol,
      date: String(point['formattedTime'] ?? point['time'] ?? new Date().toISOString().slice(0, 10)),
      search_volume_ratio: value,
    }]
  }
  return []
}

export interface SyncCredentials {
  tenant_id: string
  connector_id: string
  auth_type: 'oauth2' | 'oauth2_kite' | 'api_key' | 'basic' | 'http_basic'
  access_token?: string
  refresh_token?: string
  token_expires_at?: Date
  api_key?: string
  api_key_header?: string
  api_key_prefix?: string
  username?: string
  password?: string
  extra?: Record<string, string>
}

export interface SyncState {
  tenant_id: string
  connector_id: string
  resource: string
  last_synced_at: Date | null
  last_cursor: string | null
  backfill_complete: boolean
  total_records_synced: number
  /** Set when the most recent sync fetched 0 records because the HTTP request
   * failed (bad credentials, connector down), not because the account is
   * genuinely empty. Cleared (null) on the next successful sync. */
  last_error?: { status: number; status_text: string; at: Date } | null
}

export interface SyncResult {
  tenant_id: string
  connector_id: string
  resource: string
  records_fetched: number
  events_generated: number
  insights_triggered: number
  backfill: boolean
  duration_ms: number
  error?: { status: number; status_text: string }
}

// Token exchange URLs per connector
const TOKEN_REFRESH_URLS: Record<string, string> = {
  xero: 'https://identity.xero.com/connect/token',
  hubspot: 'https://api.hubapi.com/oauth/v1/token',
  google_calendar: 'https://oauth2.googleapis.com/token',
  gmail: 'https://oauth2.googleapis.com/token',
  google_drive: 'https://oauth2.googleapis.com/token',
  youtube: 'https://oauth2.googleapis.com/token',
  google_sheets: 'https://oauth2.googleapis.com/token',
  shopify: '', // uses per-shop URL — handled separately
}

function assertExternalUrlAllowed(url: string, context: string): void {
  if (process.env['KAIROS_DEPLOYMENT_MODE'] !== 'airgap') return
  const parsed = new URL(url, 'http://localhost')
  const host = parsed.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return
  throw new Error(`External network access blocked in airgap mode for ${context}: ${url.slice(0, 80)}`)
}

export class ConnectorSyncEngine {
  private readonly db: Db
  private readonly eventGenerator: EventGenerator
  private readonly engine: Engine
  private readonly onInsightsGenerated: ((insights: Insight[], tenantId: string) => Promise<void>) | undefined
  private running = false
  // Set when fetchResourcePages hits a non-ok HTTP response — lets syncResource
  // distinguish "0 records because the request actually failed" (bad API key,
  // connector down) from "0 records because the account genuinely has none",
  // which previously looked identical in connector_sync_state.
  private lastFetchError: { status: number; statusText: string } | null = null

  /**
   * @param onInsightsGenerated Optional hook called after each batch of
   *   insights is persisted during a connector sync — e.g. wired to
   *   DeliveryRouter.deliver() in apps/api/src/server.ts so a Trading 212
   *   concentration-risk or rebalance insight reaches the tenant (WhatsApp/
   *   SMS/email, with a signed approve/dismiss link) without them having to
   *   poll the app. Deliberately a callback, not a direct dependency, so this
   *   package doesn't need to import apps/api's DeliveryRouter.
   */
  constructor(
    db: Db,
    eventGenerator: EventGenerator,
    engine: Engine,
    onInsightsGenerated?: (insights: Insight[], tenantId: string) => Promise<void>,
  ) {
    this.db = db
    this.eventGenerator = eventGenerator
    this.engine = engine
    this.onInsightsGenerated = onInsightsGenerated
  }

  // ─── Token Management ──────────────────────────────────────────────────────

  /** Refresh an OAuth access token using the stored refresh_token. */
  async refreshAccessToken(
    tenantId: string,
    connectorId: string,
    creds: SyncCredentials,
  ): Promise<string> {
    const tokenUrl = TOKEN_REFRESH_URLS[connectorId]
    if (!tokenUrl || !creds.refresh_token) {
      throw new Error(`Cannot refresh token for ${connectorId}: no refresh_token or URL`)
    }
    assertExternalUrlAllowed(tokenUrl, `${connectorId} token refresh`)

    const clientId = getGoogleClientId(connectorId)
    const clientSecret = getGoogleClientSecret(connectorId)

    const res = await safeFetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    })

    const data = await res.json() as {
      access_token: string
      refresh_token?: string
      expires_in?: number
      error?: string
    }

    if (!res.ok || data.error) {
      throw new Error(`Token refresh failed for ${connectorId}: ${data.error}`)
    }

    // Persist updated tokens
    const col = this.db.collection('connector_credentials')
    await col.updateOne(
      { tenant_id: tenantId, connector_id: connectorId },
      {
        $set: {
          access_token: data.access_token,
          ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
          ...(data.expires_in
            ? { token_expires_at: new Date(Date.now() + data.expires_in * 1000) }
            : {}),
          updated_at: new Date(),
        },
      },
    )

    return data.access_token
  }

  /** Check if a token is close to expiry (within 5 minutes). */
  isTokenExpiringSoon(creds: SyncCredentials): boolean {
    if (!creds.token_expires_at) return false
    return creds.token_expires_at.getTime() - Date.now() < 5 * 60 * 1000
  }

  // ─── HTTP Fetch with auto-retry on 401 / 429 ──────────────────────────────

  /** Parses a `Retry-After` header (seconds, or an HTTP-date) into a millisecond delay. */
  private parseRetryAfterMs(res: Response): number {
    const header = res.headers.get('retry-after')
    if (!header) return 2000
    const seconds = Number(header)
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
    const dateMs = Date.parse(header)
    return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 2000
  }

  private async fetchWithAuth(
    url: string,
    creds: SyncCredentials,
    tenantId: string,
    connectorId: string,
    auth?: ConnectorConfig['auth'],
  ): Promise<Response> {
    // Proactively refresh if near expiry
    if (creds.auth_type === 'oauth2' && this.isTokenExpiringSoon(creds)) {
      try {
        creds.access_token = await this.refreshAccessToken(tenantId, connectorId, creds)
      } catch {
        // continue with stale token — will 401 and retry below
      }
    }

    const headers = this.buildAuthHeaders(creds, auth)
    assertExternalUrlAllowed(url, `${connectorId} sync`)
    let res = await safeFetch(url, { headers })

    // If 401, refresh once and retry
    if (res.status === 401 && creds.auth_type === 'oauth2' && creds.refresh_token) {
      try {
        creds.access_token = await this.refreshAccessToken(tenantId, connectorId, creds)
        res = await safeFetch(url, { headers: this.buildAuthHeaders(creds, auth) })
      } catch {
        // token refresh failed — return original 401
      }
    }

    // Rate limited — most providers (Trading 212 included) send Retry-After.
    // Wait it out and retry once. Cap is 60s, not the earlier 15s: Trading
    // 212's own docs put its tightest per-endpoint window (instruments
    // metadata) at 1 req/50s, so a shorter cap meant the retry fired before
    // the window actually cleared and just collected a second 429. Only one
    // retry (not two) since at this cap a single retry can already block a
    // sync for up to a minute.
    if (res.status === 429) {
      const waitMs = Math.min(this.parseRetryAfterMs(res), 60_000)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      res = await safeFetch(url, { headers: this.buildAuthHeaders(creds, auth) })
    }

    return res
  }

  private buildAuthHeaders(creds: SyncCredentials, auth?: ConnectorConfig['auth']): Record<string, string> {
    // When the connector declares an api_key query parameter, do not also send
    // it as an Authorization header.
    if (auth?.param && creds.auth_type === 'api_key') {
      return {}
    }
    if (creds.auth_type === 'oauth2') {
      return { Authorization: `Bearer ${creds.access_token ?? ''}` }
    }
    // Kite Connect v3 — sign as `token api_key:access_token` + X-Kite-Version: 3
    if (creds.auth_type === 'oauth2_kite') {
      const apiKey = creds.extra?.api_key ?? ''
      return {
        Authorization: `token ${apiKey}:${creds.access_token ?? ''}`,
        'X-Kite-Version': '3',
      }
    }
    if (creds.auth_type === 'api_key') {
      const header = creds.api_key_header ?? 'Authorization'
      const prefix = creds.api_key_prefix ? `${creds.api_key_prefix} ` : ''
      return { [header]: `${prefix}${creds.api_key ?? ''}` }
    }
    if (creds.auth_type === 'basic' || creds.auth_type === 'http_basic') {
      const encoded = Buffer.from(`${creds.username}:${creds.password}`).toString('base64')
      return { Authorization: `Basic ${encoded}` }
    }
    return {}
  }

  /** Resolve tickers from the tenant's most recent portfolio_position signals.
   *
   * Trading 212 stores positions with suffixed tickers like "LIME_US_EQ" or
   * "DPW_US_EQ". Market-data providers (Finnhub, Polygon, yfinance, Alpha
   * Vantage) expect the raw ticker — "LIME", "DPW" — so we strip the
   * underscore-delimited exchange suffix. Cash positions ("CASH") are
   * excluded since they have no market price.
   *
   * Returns the most recent distinct set of tickers. If the tenant has no
   * portfolio positions yet, returns an empty array (the caller falls back
   * to [''] which produces no useful data but doesn't crash). */
  private async resolveSymbolsFromPortfolio(tenantId: string): Promise<string[]> {
    try {
      const docs = await this.db.collection('signals')
        .find({
          tenant_id: tenantId,
          signal_type: 'portfolio_position',
        })
        .sort({ created_at: -1 })
        .limit(50)
        .toArray()
      const tickers = new Set<string>()
      for (const doc of docs) {
        const data = doc.data as { ticker?: string } | undefined
        const ticker = data?.ticker
        if (!ticker || ticker.toUpperCase() === 'CASH') continue
        // Strip exchange suffix: "LIME_US_EQ" → "LIME", "BP.L" stays "BP.L"
        const raw = ticker.split('_')[0]
        if (raw) tickers.add(raw)
      }
      return [...tickers]
    } catch {
      return []
    }
  }

  // ─── Paginated Resource Fetcher ────────────────────────────────────────────

  /**
   * Fetch all records from a connector resource, walking pagination.
   *
   * Market-data connectors may declare a `symbols_param`; when provided, the
   * credential extra field `symbols` is split by comma and one request is issued
   * per symbol.
   *
   * @param connector  Connector definition (from YAML)
   * @param resource   Resource config (name, path, pagination config)
   * @param creds      Decrypted credentials
   * @param tenantId   Tenant ID
   * @param options    dateFrom for incremental sync; maxPages safety limit
   */
  async fetchAllPages(
    connector: ConnectorConfig,
    resource: NonNullable<ConnectorConfig['resources']>[number],
    creds: SyncCredentials,
    tenantId: string,
    options: {
      dateFrom?: Date
      maxPages?: number
    } = {},
  ): Promise<unknown[]> {
    let symbols = resource.symbols_param && creds.extra?.symbols
      ? creds.extra.symbols.split(',').map(s => s.trim()).filter(Boolean)
      : []

    // Auto-resolve symbols from the tenant's portfolio positions when the
    // connector declares a symbols_param but the user hasn't configured
    // extra.symbols. This unblocks market-data connectors (yfinance, finnhub,
    // polygon, hf-data, alpha-vantage) without requiring the user to manually
    // enter tickers in the Studio UI. Strips the _US_EQ / _GB_EQ suffix that
    // Trading 212 uses, since market-data providers expect raw tickers (e.g.
    // "LIME" not "LIME_US_EQ").
    if (symbols.length === 0 && resource.symbols_param) {
      symbols = await this.resolveSymbolsFromPortfolio(tenantId)
    }
    if (symbols.length === 0) symbols = ['']

    const allRecords: unknown[] = []
    for (const symbol of symbols) {
      const records = await this.fetchResourcePages(connector, resource, creds, tenantId, symbol, options)
      allRecords.push(...records)
    }
    return allRecords
  }

  /** Fetch one symbol (or a non-market-data resource) across all pages. */
  private async fetchResourcePages(
    connector: ConnectorConfig,
    resource: NonNullable<ConnectorConfig['resources']>[number],
    creds: SyncCredentials,
    tenantId: string,
    symbol: string,
    options: {
      dateFrom?: Date
      maxPages?: number
    } = {},
  ): Promise<unknown[]> {
    const maxPages = options.maxPages ?? 100
    const allRecords: unknown[] = []
    this.lastFetchError = null

    // Build base URL + static params from YAML
    // Per-tenant live mode is opt-in via credential extra.live_mode. When set,
    // use the connector's live_base_url if provided; otherwise fall back to base_url.
    const isLive = creds.extra?.['live_mode'] === 'true'
    const configuredBaseUrl = isLive && connector.live_base_url
      ? connector.live_base_url
      : connector.base_url
    const baseUrl = configuredBaseUrl.replace(/\/$/, '')
    const params = new URLSearchParams(resource.params ?? {})

    // Inject date filter for incremental sync if connector supports it
    const dateFilterParam = resource.date_filter_param
    if (options.dateFrom && dateFilterParam) {
      const dateStr = options.dateFrom.toISOString().substring(0, 10)
      params.set(dateFilterParam, dateStr)
    }

    // Inject api_key as a query parameter when the connector declares one
    if (connector.auth.param && creds.auth_type === 'api_key' && creds.api_key) {
      params.set(connector.auth.param, creds.api_key)
    }

    let page = 1
    let cursor: string | null = null
    let nextUrl: string | null = null
    let hasMore = true

    // CLI resources (e.g. yfinance) invoke a local Python bridge instead of
    // making HTTP requests. The bridge writes JSON to stdout, which we parse
    // and pass through the same record_transform pipeline as HTTP responses.
    // This keeps the connector YAML declarative while supporting providers
    // that have no official REST API. fetchAllPages already iterates over
    // symbols, so we handle one symbol per call here.
    if (resource.method === 'CLI') {
      const scriptPath = resource.path || 'scripts/fetch-yfinance.py'
      try {
        const { stdout } = await execAsync(scriptPath, [
          '--resource', resource.name,
          '--symbol', symbol,
          ...(options.dateFrom ? ['--from', options.dateFrom.toISOString().substring(0, 10)] : []),
        ])
        const body = JSON.parse(stdout) as Record<string, unknown>
        const transform = resource.record_transform
        if (transform === 'yfinance_daily_history') {
          allRecords.push(...transformYfinanceDailyHistory(body, symbol))
        } else if (transform === 'yfinance_fundamentals') {
          allRecords.push(...transformYfinanceFundamentals(body, symbol))
        }
      } catch (err) {
        this.lastFetchError = { status: 0, statusText: `CLI fetch failed: ${(err as Error).message}` }
      }
      return allRecords
    }

    while (hasMore && page <= maxPages) {
      let url: URL
      if (nextUrl) {
        url = new URL(nextUrl)
        nextUrl = null
      } else {
        // Replace path placeholders ({symbol}, {from}, {to}, {apikey}) with
        // actual values. Some connectors (HF Data, Polygon) embed the symbol
        // in the URL path rather than as a query parameter — e.g.
        // /bars/{symbol}/daily. Alpha Vantage embeds the API key as
        // {apikey} in the query string. Without this substitution, the
        // literal "{symbol}" is sent to the API, causing a 404.
        let path = resource.path ?? ''
        if (symbol) {
          path = path.replace(/\{symbol\}/g, encodeURIComponent(symbol))
        }
        if (creds.api_key) {
          path = path.replace(/\{apikey\}/g, encodeURIComponent(creds.api_key))
        }
        if (options.dateFrom) {
          path = path.replace(/\{from\}/g, options.dateFrom.toISOString().substring(0, 10))
        }
        // {to} defaults to today if not specified
        path = path.replace(/\{to\}/g, new Date().toISOString().substring(0, 10))

        url = new URL(`${baseUrl}${path}`)
        // Copy static params
        params.forEach((v, k) => url.searchParams.set(k, v))

        // Market-data symbol expansion (also sent as query param for
        // connectors that use symbols_param + path placeholder)
        if (resource.symbols_param && symbol) {
          url.searchParams.set(resource.symbols_param, symbol)
        }

        // Pagination params
        if (resource.pagination) {
          const pg = resource.pagination
          if (pg.type === 'page' && pg.param) {
            url.searchParams.set(pg.param, String(page))
          } else if (pg.type === 'cursor' && cursor && pg.param) {
            url.searchParams.set(pg.param, cursor)
          } else if (pg.type === 'offset' && pg.param) {
            url.searchParams.set(pg.param, String((page - 1) * 100))
          }
        }
      }

      // Add Xero-specific tenant header if needed
      if (connector.id === 'xero' && creds.extra?.['xero_tenant_id']) {
        const res = await this.fetchWithAuth(url.toString(), creds, tenantId, connector.id, connector.auth)
        // Hack: Xero needs Xero-tenant-id header
        const headers = {
          ...this.buildAuthHeaders(creds, connector.auth),
          'Xero-tenant-id': creds.extra['xero_tenant_id'],
        }
        const xeroRes = await safeFetch(url.toString(), { headers })
        if (!xeroRes.ok) {
          this.lastFetchError = { status: xeroRes.status, statusText: xeroRes.statusText }
          break
        }
        const body = await xeroRes.json() as Record<string, unknown>
        const key = resource.pagination?.response_key ?? resource.name
        const records = (body[key] as unknown[]) ?? []
        allRecords.push(...records)
        hasMore = records.length >= 100
        page++
        continue
      }

      const res = await this.fetchWithAuth(url.toString(), creds, tenantId, connector.id, connector.auth)
      if (!res.ok) {
        // 404 on a per-symbol market-data request means the ticker isn't in
        // this data source's universe (e.g. HF Data Library covers 1,391 US
        // large/mid-cap stocks — OTC tickers like DPW return 404). Skip the
        // ticker gracefully instead of failing the whole sync — other symbols
        // may still succeed, and other connectors (yfinance) cover the gap.
        if (res.status === 404 && resource.symbols_param && symbol) {
          hasMore = false
          break
        }
        this.lastFetchError = { status: res.status, statusText: res.statusText }
        break
      }

      // CBOE VIX serves a CSV file; everything else is JSON. Detect by
      // Content-Type so res.json() doesn't throw on the CSV endpoint.
      const contentType = res.headers.get('content-type') ?? ''
      let body: Record<string, unknown>
      if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
        body = { text: await res.text() }
      } else {
        body = await res.json() as Record<string, unknown>
      }

      // Named response transformers take precedence over generic extraction.
      // They are used for market-data providers that return objects rather
      // than record arrays.
      if (resource.record_transform === 'alpha_vantage_time_series_daily') {
        const records = transformAlphaVantageTimeSeriesDaily(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }

      // Gap #6: Alpha Vantage OVERVIEW — single object response transformed
      // into a company_fundamentals record.
      if (resource.record_transform === 'alpha_vantage_overview') {
        const records = transformAlphaVantageOverview(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }

      // yfinance: JSON emitted by the Python bridge (scripts/fetch-yfinance.py).
      // The bridge normalizes yfinance's pandas DataFrames into plain JSON
      // arrays before the sync engine sees them.
      if (resource.record_transform === 'yfinance_daily_history') {
        const records = transformYfinanceDailyHistory(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }
      if (resource.record_transform === 'yfinance_fundamentals') {
        const records = transformYfinanceFundamentals(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }

      // HF Data Library: daily bars (bare array or { results: [...] }).
      if (resource.record_transform === 'hf_data_daily_bars') {
        const records = transformHfDataDailyBars(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }

      // Finnhub: real-time quote (free tier), daily candles (paid), and company profile.
      if (resource.record_transform === 'finnhub_realtime_quote') {
        const records = transformFinnhubRealtimeQuote(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }
      if (resource.record_transform === 'finnhub_daily_candles') {
        const records = transformFinnhubDailyCandles(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }
      if (resource.record_transform === 'finnhub_company_profile') {
        const records = transformFinnhubCompanyProfile(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }
      if (resource.record_transform === 'finnhub_news_sentiment') {
        const records = transformFinnhubNewsSentiment(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }
      if (resource.record_transform === 'finnhub_financial_metrics') {
        const records = transformFinnhubFinancialMetrics(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }

      // CBOE VIX (Phase 2): CSV body decoded into body.text by the HTTP layer.
      if (resource.record_transform === 'cboe_vix_daily') {
        const records = transformCboeVixDaily(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }

      // FRED macro series (Phase 2): single most-recent observation per call.
      if (resource.record_transform === 'fred_yield_curve') {
        const records = transformFredYieldCurve(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }
      if (resource.record_transform === 'fred_credit_spread') {
        const records = transformFredCreditSpread(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }
      if (resource.record_transform === 'fred_treasury_10y') {
        const records = transformFredTreasury10Y(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }

      // Google Trends attention signal (Phase 3).
      if (resource.record_transform === 'google_trends_search_volume') {
        const records = transformGoogleTrendsSearchVolume(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }

      // Polygon.io: daily aggregates and ticker details.
      if (resource.record_transform === 'polygon_daily_aggs') {
        const records = transformPolygonDailyAggs(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }
      if (resource.record_transform === 'polygon_ticker_details') {
        const records = transformPolygonTickerDetails(body, symbol)
        allRecords.push(...records)
        hasMore = false
        continue
      }

      // Extract records from response
      const responseKey = resource.pagination?.response_key ?? resource.name
      let records: unknown[] = []

      if (resource.response_shape === 'object' && body && typeof body === 'object' && !Array.isArray(body)) {
        // Single-object endpoint (e.g., Trading 212 /equity/account)
        records = [body]
      } else if (Array.isArray(body)) {
        records = body
      } else if (responseKey && Array.isArray(body[responseKey])) {
        records = body[responseKey] as unknown[]
      } else {
        // Try common envelope patterns: data, items, results, records
        for (const key of ['data', 'items', 'results', 'records']) {
          if (Array.isArray(body[key])) {
            records = body[key] as unknown[]
            break
          }
        }
      }

      allRecords.push(...records)

      // Determine if there are more pages
      if (resource.pagination) {
        const pg = resource.pagination
        if (pg.type === 'page') {
          hasMore = records.length >= 100 // assume page size 100
        } else if (pg.type === 'cursor') {
          cursor = (body['next_cursor'] as string) ?? (body['cursor'] as string) ?? null
          hasMore = cursor !== null
        } else if (pg.type === 'link') {
          const nextLink = (body['nextPagePath'] as string) ?? (body['next'] as string) ?? null
          if (nextLink) {
            nextUrl = new URL(nextLink, url).toString()
          }
          hasMore = !!nextUrl
        } else {
          hasMore = records.length >= 100
        }
      } else {
        hasMore = false // single page
      }

      page++
    }

    return allRecords
  }

  // ─── Single Resource Sync ──────────────────────────────────────────────────

  /** Sync one resource for one tenant+connector. */
  async syncResource(
    connector: ConnectorConfig,
    resource: NonNullable<ConnectorConfig['resources']>[number],
    creds: SyncCredentials,
    tenantId: string,
    backfill: boolean,
  ): Promise<SyncResult> {
    const start = Date.now()
    const stateCol = this.db.collection('connector_sync_state')

    const state = await stateCol.findOne({
      tenant_id: tenantId,
      connector_id: connector.id,
      resource: resource.name,
    }) as SyncState | null

    // For incremental sync: use last sync time; for backfill: go back 180 days
    const dateFrom = backfill
      ? new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
      : state?.last_synced_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000)

    let records = await this.fetchAllPages(connector, resource, creds, tenantId, {
      dateFrom,
      maxPages: backfill ? 500 : 10, // backfill walks more pages
    })

    // Trading 212's /equity/metadata/instruments returns its ENTIRE tradable
    // catalog (tens of thousands of stocks/ETFs), not just the tenant's
    // holdings — running all of them through the per-record event/detector
    // pipeline below made this resource never finish. instrument_metadata is
    // only ever looked up by ticker for the tenant's own positions (see
    // apps/api/src/routes/portfolio.ts's metadataByTicker), so narrow to
    // just those tickers before generating any events. Portfolio syncs
    // before Instrument in the connector's resource order, so its positions
    // are already in `signals` by the time we get here.
    if (connector.id === 'trading-212' && resource.name === 'Instrument') {
      const heldTickers = new Set(
        (await this.db.collection('signals')
          .find({ tenant_id: tenantId, signal_type: 'portfolio_position' })
          .project({ 'data.ticker': 1 })
          .toArray())
          .map((doc: Record<string, unknown>) => (doc['data'] as Record<string, unknown> | undefined)?.['ticker'])
          .filter((t: unknown): t is string => typeof t === 'string'),
      )
      records = (records as Array<Record<string, unknown>>).filter(r => heldTickers.has(r['ticker'] as string))
    }

    // Computed once per resource sync (not per-record) — see events.ts's
    // buildContext for the real-time-ingestion equivalent of this same injection.
    // Gap #32: also fetches goal_id_by_metric so the detector can thread
    // goal_id into feature_snapshot.
    const goalCtx = await buildGoalContext(this.db, tenantId)
    const goalKpiTargets = goalCtx.targets
    const goalIdByMetric = Object.keys(goalCtx.goal_id_by_metric).length > 0
      ? goalCtx.goal_id_by_metric
      : undefined

    // Fetched once per resource sync, not per-record, so every position in
    // this batch (e.g. all of a "Portfolio" resource's holdings) is weighted
    // against the exact same total_value snapshot. Previously each record
    // re-queried "the latest portfolio_summary" independently, which could
    // drift mid-batch if a concurrent sync wrote a new summary in between —
    // that's why position weight_pct and cash_pct stopped summing to 100%.
    const sharedTotalValue = connector.id === 'trading-212'
      ? Number((await this.latestPortfolioSummaryWithField(tenantId, connector.id, 'total_value'))?.['total_value'] ?? 0)
      : undefined

    let eventsGenerated = 0
    let insightsTriggered = 0

    // Map each raw record to a Kairos event and run detectors
    for (const record of records) {
      try {
        const event = this.eventGenerator.generateFromWebhook({
          connector,
          tenant_id: tenantId,
          payload: record as Record<string, unknown>,
          source_event_type: resource.name.toLowerCase(),
        })

        if (!event) continue // deduplication skipped it
        eventsGenerated++

        if (connector.id === 'trading-212') {
          await this.enrichTradingSignal(
            event,
            tenantId,
            connector.id,
            sharedTotalValue,
            goalKpiTargets['portfolio_concentration_max_pct'],
          )
        }

        const signalsCol = this.db.collection('signals')
        await Promise.all([
          signalsCol.createIndex({ tenant_id: 1, signal_type: 1, created_at: -1 }),
          signalsCol.createIndex({ signal_hash: 1 }, { unique: true }),
        ]).catch(() => {})
        await signalsCol.updateOne(
          { signal_hash: event.event_hash },
          {
            $setOnInsert: {
              id: event.id,
              tenant_id: event.tenant_id,
              signal_type: event.event_type,
              source: connector.id,
              connector_id: connector.id,
              external_id: event.id,
              data: event.raw_data,
              signal_hash: event.event_hash,
              occurred_at: event.received_at,
              created_at: event.received_at,
              ingested_at: new Date(),
            },
          },
          { upsert: true },
        )

        // Map RawEvent → EvaluateInput (engine expects event_id + data)
        const evalInput = {
          event_type: event.event_type,
          tenant_id: event.tenant_id,
          event_id: event.id,
          data: event.raw_data,
          derived_from_signals: [event.id],
          goal_kpi_targets: goalKpiTargets,
          ...(goalIdByMetric && { goal_id_by_metric: goalIdByMetric }),
        }
        const result = await this.engine.evaluate(evalInput)
        insightsTriggered += result.insights.length

        // Persist insights
        if (result.insights.length > 0) {
          const insightsCol = this.db.collection('insights')
          // Detector.detectAll() mints a fresh id on every call, so upserting on
          // `{ id: insight.id }` can never match a prior doc — every backfill or
          // poll cycle re-firing the same still-open condition (e.g. the same
          // stock still over its concentration cap) created a fresh duplicate
          // insight instead of refreshing the existing one. Dedupe on the
          // natural identity — same tenant + detector + rule + ticker, still
          // open — the same fix applied in apps/api/src/routes/events.ts.
          const ops = result.insights.map(insight => {
            const ticker = (insight.feature_snapshot as Record<string, unknown> | undefined)?.['ticker']
            const dedupeFilter: Record<string, unknown> = {
              tenant_id: insight.tenant_id,
              detector_id: insight.detector_id,
              hypothesis: insight.hypothesis,
              ...(ticker !== undefined ? { 'feature_snapshot.ticker': ticker } : {}),
              state: { $nin: ['dismissed', 'completed', 'archived'] },
            }
            const { feature_snapshot, confidence_breakdown, evidence_trail, derived_from_signals, reasoning, estimated_impact_low, estimated_impact_high, ...firstSeenFields } = insight
            return {
              updateOne: {
                filter: dedupeFilter,
                update: {
                  $set: { feature_snapshot, confidence_breakdown, evidence_trail, derived_from_signals, reasoning, estimated_impact_low, estimated_impact_high },
                  $setOnInsert: { ...firstSeenFields, source: 'sync', backfill },
                },
                upsert: true,
              },
            }
          })
          const bulkResult = await insightsCol.bulkWrite(ops, { ordered: false })
          try {
            await this.ensureVerifiedMoments(result.insights)
          } catch (err) {
            // Verified-moments bookkeeping is best-effort — it must never take
            // down insight delivery / workflow-triggering below, which sit in
            // the same outer try/catch and were silently getting lost whenever
            // this failed (e.g. on a duplicate-key race under concurrent syncs).
            log.error({ tenant_id: tenantId, connector_id: connector.id, err }, 'ensureVerifiedMoments failed')
          }

          // Only genuinely new insights, not ones matched (and just
          // refreshed) by the dedupe filter above — otherwise a still-open
          // condition (e.g. the same stock still over its concentration cap)
          // re-notifies and re-triggers workflows on every single poll cycle
          // forever, instead of once when the condition first appears.
          const newlyInsertedIndexes = new Set(Object.keys(bulkResult.upsertedIds).map(Number))
          const newInsights = result.insights.filter((_, i) => newlyInsertedIndexes.has(i))

          // Notify the tenant for live syncs only — a 180-day backfill would
          // otherwise fire a flood of historical notifications on first connect.
          if (!backfill && newInsights.length > 0 && this.onInsightsGenerated) {
            try {
              await this.onInsightsGenerated(newInsights, tenantId)
            } catch (err) {
              log.error({ tenant_id: tenantId, connector_id: connector.id, err }, 'Insight delivery failed')
            }
          }
        }
      } catch {
        // skip malformed records
      }
    }

    // Stale position cleanup: when the Portfolio resource returns 0 positions
    // (the account is fully in cash, or all positions were sold), the sync
    // loop above writes no new portfolio_position signals — but the old ones
    // remain in the database. The momentum strategy then sees phantom positions,
    // generates SELL recommendations for them, and the broker rejects the
    // orders ("Selling more equities than owned"). Delete stale signals only
    // when the sync succeeded (no fetch error) and returned 0 records — a
    // failed fetch with 0 records means "we don't know", not "account is empty".
    if (connector.id === 'trading-212' && resource.name === 'Portfolio' && records.length === 0 && !this.lastFetchError) {
      try {
        const deleted = await this.db.collection('signals').deleteMany({
          tenant_id: tenantId,
          connector_id: connector.id,
          signal_type: 'portfolio_position',
        })
        if (deleted.deletedCount > 0) {
          log.info({ tenant_id: tenantId, connector_id: connector.id, deleted: deleted.deletedCount }, 'Cleaned up stale portfolio_position signals (broker returned 0 positions)')
        }
      } catch (err) {
        log.error({ tenant_id: tenantId, connector_id: connector.id, err }, 'Failed to clean up stale portfolio_position signals')
      }
    }

    // Update sync state. A resource that fetched 0 records because the HTTP
    // request itself failed (bad API key, connector down) looks identical to
    // one that fetched 0 records because the account genuinely has none —
    // record last_error so the UI can tell those apart instead of showing
    // "0 records" either way.
    const hadError = records.length === 0 && this.lastFetchError !== null
    await stateCol.updateOne(
      { tenant_id: tenantId, connector_id: connector.id, resource: resource.name },
      {
        $set: {
          last_synced_at: new Date(),
          backfill_complete: backfill || (state?.backfill_complete ?? false),
          ...(hadError
            ? { last_error: { status: this.lastFetchError!.status, status_text: this.lastFetchError!.statusText, at: new Date() } }
            : { last_error: null }),
        },
        $inc: { total_records_synced: records.length },
        $setOnInsert: { last_cursor: null },
      },
      { upsert: true },
    )

    return {
      tenant_id: tenantId,
      connector_id: connector.id,
      resource: resource.name,
      records_fetched: records.length,
      events_generated: eventsGenerated,
      insights_triggered: insightsTriggered,
      backfill,
      duration_ms: Date.now() - start,
      ...(hadError ? { error: { status: this.lastFetchError!.status, status_text: this.lastFetchError!.statusText } } : {}),
    }
  }

  /**
   * Trading 212's Account/Cash/Portfolio resources each sync as separate
   * events with only partial data — Account has total_value, Cash has cash,
   * Portfolio positions have neither. Detector conditions like
   * `data.cash > data.total_value * ...` (rebalance) and
   * `data.portfolio_weight_pct` (concentration) need fields that span
   * resources, so this backfills them from the tenant's most recently
   * synced signals before the event is evaluated/persisted.
   */
  /**
   * Looks up the most recently synced `portfolio_summary` doc that has the
   * given field. Exposed as its own method (not a local closure inside
   * enrichTradingSignal) so a caller processing many records in one sync
   * pass — see syncResource's `sharedTotalValue` prefetch — can fetch this
   * ONCE and hand the same snapshot to every record, instead of each record
   * re-querying "the latest" independently and risking a different answer
   * if a concurrent sync writes a new portfolio_summary mid-loop. That drift
   * is exactly what caused position weight_pct / cash_pct to be computed
   * against different total_value snapshots and stop summing to 100%.
   */
  private async latestPortfolioSummaryWithField(
    tenantId: string,
    connectorId: string,
    field: string,
  ): Promise<Record<string, unknown> | undefined> {
    const signalsCol = this.db.collection('signals')
    const docs = await signalsCol
      .find({ tenant_id: tenantId, connector_id: connectorId, signal_type: 'portfolio_summary', [`data.${field}`]: { $exists: true } })
      .sort({ created_at: -1 })
      .limit(1)
      .toArray()
    return docs[0]?.data as Record<string, unknown> | undefined
  }

  private async enrichTradingSignal(
    event: { event_type: string; raw_data: Record<string, unknown> },
    tenantId: string,
    connectorId: string,
    sharedTotalValue?: number,
    concentrationCapPct?: number,
  ): Promise<void> {
    const signalsCol = this.db.collection('signals')
    const data = event.raw_data

    const latestWithField = (field: string) =>
      this.latestPortfolioSummaryWithField(tenantId, connectorId, field)

    if (event.event_type === 'portfolio_summary') {
      if (data['total_value'] === undefined) {
        const acct = await latestWithField('total_value')
        if (acct) {
          data['total_value'] = acct['total_value']
          data['invested_value'] = acct['invested_value']
        }
      }
      if (data['cash'] === undefined) {
        const cashDoc = await latestWithField('cash')
        if (cashDoc) data['cash'] = cashDoc['cash']
      }

      const totalValue = Number(data['total_value'] ?? 0)
      const cash = Number(data['cash'] ?? 0)
      // `cash` is minor units (pence) per the connector's to_minor_units field
      // mapping — reasoning_template interpolation is a bare {{data.field}}
      // substitution with no currency formatting, so templates need an
      // already-formatted major-unit value to display, not the raw minor-unit
      // integer (e.g. "Cash is 39360 minor units" instead of "£393.60").
      data['cash_gbp'] = Number((cash / 100).toFixed(2))
      if (totalValue > 0) {
        data['cash_pct'] = Number(((cash / totalValue) * 100).toFixed(2))

        const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        const priorDocs = await signalsCol
          .find({ tenant_id: tenantId, connector_id: connectorId, signal_type: 'portfolio_summary', 'data.total_value': { $exists: true }, created_at: { $lte: monthAgo } })
          .sort({ created_at: -1 })
          .limit(1)
          .toArray()
        const priorValue = Number(priorDocs[0]?.data?.total_value ?? 0)
        if (priorValue > 0) {
          data['monthly_return_pct'] = Number((((totalValue - priorValue) / priorValue) * 100).toFixed(2))
        }

        const peakDocs = await signalsCol
          .find({ tenant_id: tenantId, connector_id: connectorId, signal_type: 'portfolio_summary', 'data.total_value': { $exists: true } })
          .sort({ 'data.total_value': -1 })
          .limit(1)
          .toArray()
        const peakValue = Math.max(Number(peakDocs[0]?.data?.total_value ?? 0), totalValue)
        if (peakValue > 0) {
          data['max_drawdown_pct'] = Number((((peakValue - totalValue) / peakValue) * 100).toFixed(2))
        }
      }
    }

    if (event.event_type === 'portfolio_position') {
      let totalValue = sharedTotalValue
      if (totalValue === undefined) {
        const acct = await latestWithField('total_value')
        totalValue = Number(acct?.['total_value'] ?? 0)
      }
      const quantity = Number(data['quantity'] ?? 0)
      const currentPrice = Number(data['current_price'] ?? 0)
      const positionValue = Math.round(quantity * currentPrice)
      data['position_value_minor'] = positionValue
      // Same minor-unit-to-display fix as cash_gbp above, for the price-drop
      // reasoning_template ("{{data.current_price}} vs your average of
      // {{data.avg_price}}") which was rendering raw pence as if it were pounds.
      data['current_price_gbp'] = Number((currentPrice / 100).toFixed(2))
      data['avg_price_gbp'] = Number((Number(data['avg_price'] ?? 0) / 100).toFixed(2))
      if (totalValue > 0) {
        data['portfolio_weight_pct'] = Number(((positionValue / totalValue) * 100).toFixed(2))

        // Concentration-risk detector's "Trim to cap" alternative interpolates
        // {{data.excess_shares}} — how many shares to sell to bring this
        // position back down to its goal's concentration cap (see
        // detectors/trading/concentration-risk.yaml, same cap value the
        // detector condition itself compares against:
        // context.goal_kpi_targets.portfolio_concentration_max_pct, default
        // 10). Without this field the template placeholder was rendering
        // unresolved/raw on screen.
        const capPct = concentrationCapPct ?? 10
        const capValue = totalValue * (capPct / 100)
        if (positionValue > capValue && currentPrice > 0) {
          const excessValue = positionValue - capValue
          data['excess_shares'] = Math.round((excessValue / currentPrice) * 100) / 100
        }
      }

      // Drop metrics for price-drop and concentration-risk detectors.
      // drop_pct is signed (negative = below avg), drop_from_avg_pct is the
      // absolute distance below average — used by suppress_if to skip shallow
      // dips that are already recovering (the LIME_US_EQ false-alarm pattern).
      const avgPrice = Number(data['avg_price'] ?? 0)
      if (avgPrice > 0) {
        const dropPct = ((currentPrice - avgPrice) / avgPrice) * 100
        data['drop_pct'] = Number(dropPct.toFixed(2))
        data['drop_from_avg_pct'] = Number(Math.abs(Math.min(0, dropPct)).toFixed(2))
      }

      // Recovery detection: compare current price to the previous sync's
      // current_price for the same ticker. If the price has risen since the
      // last sync, the position is recovering — suppress_if uses this to
      // avoid re-firing on temporary dips that are already bouncing back.
      const ticker = String(data['ticker'] ?? '')
      if (ticker) {
        try {
          const priorDocs = await this.db.collection('signals')
            .find({ tenant_id: tenantId, signal_type: 'portfolio_position', 'data.ticker': ticker })
            .sort({ created_at: -1 })
            .limit(2)
            .toArray()
          // [0] is the current (just-upserted) doc, [1] is the prior sync
          const priorPrice = Number((priorDocs[1]?.data as Record<string, unknown> | undefined)?.['current_price'] ?? 0)
          if (priorPrice > 0) {
            const recoveryPct = ((currentPrice - priorPrice) / priorPrice) * 100
            data['is_recovering'] = currentPrice > priorPrice ? 1 : 0
            data['recovery_pct'] = Number(recoveryPct.toFixed(2))
          } else {
            data['is_recovering'] = 0
            data['recovery_pct'] = 0
          }
        } catch {
          data['is_recovering'] = 0
          data['recovery_pct'] = 0
        }
      }
    }
  }

  private async ensureVerifiedMoments(insights: Insight[]): Promise<void> {
    if (insights.length === 0) return
    const col = this.db.collection('verified_moments')
    await Promise.all([
      col.createIndex({ tenant_id: 1, created_at: -1 }),
      col.createIndex({ tenant_id: 1, insight_id: 1 }, { unique: true }),
      col.createIndex({ tenant_id: 1, goal_id: 1, created_at: -1 }),
      col.createIndex({ tenant_id: 1, status: 1 }),
    ]).catch(() => {})

    const crypto = await import('node:crypto')
    const ops = insights.map((insight) => {
      const record = insight as unknown as Record<string, unknown>
      const features = (record['feature_snapshot'] as Record<string, unknown> | undefined) ?? {}
      const goalId = features['goal_id'] ?? record['goal_id']
      const metric = features['metric'] ?? record['metric']
      const signalIds = [...new Set([...(insight.derived_from_signals ?? []), ...insight.confidence_breakdown.evidence_refs])]
      const id = `vm_${crypto.createHash('sha256').update(`${insight.tenant_id}:${insight.id}`).digest('hex').slice(0, 24)}`
      return {
        updateOne: {
          filter: { tenant_id: insight.tenant_id, insight_id: insight.id },
          update: {
            $setOnInsert: {
              id,
              tenant_id: insight.tenant_id,
              insight_id: insight.id,
              detector_id: insight.detector_id,
              rule_id: insight.rule_id,
              status: 'verified',
              verification_method: 'deterministic_rule',
              confidence: insight.confidence_breakdown.or_score,
              hypothesis: insight.hypothesis,
              reasoning: insight.reasoning,
              actions: insight.actions,
              created_at: insight.created_at,
              ...(typeof goalId === 'string' ? { goal_id: goalId } : {}),
              ...(typeof metric === 'string' ? { kpi_metric: metric } : {}),
            },
            $set: {
              updated_at: new Date(),
              signal_ids: signalIds,
              evidence_refs: insight.confidence_breakdown.evidence_refs,
            },
          },
          upsert: true,
        },
      }
    })
    await col.bulkWrite(ops, { ordered: false })
  }

  // ─── Full Connector Sync ───────────────────────────────────────────────────

  /** Run a full sync (poll or backfill) for a tenant+connector across all resources. */
  // Credentials are stored encrypted at rest (connector-credentials.ts encrypts
  // api_key/access_token/refresh_token/password on save) — decrypt here, once,
  // so every downstream use (buildAuthHeaders, refreshAccessToken, query params)
  // gets plaintext. Previously this loaded the raw encrypted doc straight from
  // Mongo despite the comment claiming otherwise, so every basic/api_key/oauth2
  // sync sent ciphertext as the credential and failed with 401.
  private async loadDecryptedCredentials(
    connectorId: string,
    tenantId: string,
  ): Promise<SyncCredentials | null> {
    const credCol = this.db.collection('connector_credentials')
    const rawCreds = await credCol.findOne({
      tenant_id: tenantId,
      connector_id: connectorId,
    }) as SyncCredentials | null

    if (!rawCreds) return null

    if (rawCreds.api_key !== undefined) rawCreds.api_key = decryptIfNeeded(rawCreds.api_key) as string
    if (rawCreds.access_token !== undefined) rawCreds.access_token = decryptIfNeeded(rawCreds.access_token) as string
    if (rawCreds.refresh_token !== undefined) rawCreds.refresh_token = decryptIfNeeded(rawCreds.refresh_token) as string
    if (rawCreds.password !== undefined) rawCreds.password = decryptIfNeeded(rawCreds.password) as string

    return rawCreds
  }

  /**
   * Make one real, lightweight request against the connector's first resource
   * to verify stored credentials actually work — used by POST /connectors/:id/test.
   * Does not persist anything; purely a read-only probe.
   */
  async testConnection(
    connector: ConnectorConfig,
    tenantId: string,
  ): Promise<{ success: boolean; status?: number; message: string }> {
    const resource = connector.resources?.[0]
    if (!resource) {
      return { success: false, message: 'This connector has no readable resources to test.' }
    }

    const creds = await this.loadDecryptedCredentials(connector.id, tenantId)
    if (!creds) {
      return { success: false, message: 'No credentials stored for this connector yet.' }
    }

    this.lastFetchError = null
    try {
      await this.fetchAllPages(connector, resource, creds, tenantId, { maxPages: 1 })
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }

    if (this.lastFetchError) {
      const { status, statusText } = this.lastFetchError
      const hint = status === 401
        ? 'Credentials were rejected — check the API key/secret and that they match the environment (demo vs live).'
        : status === 429
          ? 'Rate limited by the provider — wait a moment and try again.'
          : statusText
      return { success: false, status, message: `Request to ${connector.name} failed (${status}${hint ? `: ${hint}` : ''})` }
    }

    return { success: true, message: `Connection to ${connector.name} verified successfully` }
  }

  async syncConnector(
    connector: ConnectorConfig,
    tenantId: string,
    backfill = false,
  ): Promise<SyncResult[]> {
    const resources = connector.resources ?? []
    if (resources.length === 0) return []

    const rawCreds = await this.loadDecryptedCredentials(connector.id, tenantId)
    if (!rawCreds) return []

    const results: SyncResult[] = []
    for (const [i, resource] of resources.entries()) {
      // Gap #6: skip cadence-limited resources on the regular 15-minute
      // poll cycle — fundamentals don't change daily, sentiment doesn't
      // change hourly. Only sync them if:
      // - this is a backfill (explicit full sync), or
      // - the last sync for this resource was longer ago than the cadence
      //   window (daily ≈ 20h, weekly ≈ 6.5d, quarterly ≈ 90d)
      // Review fix PR #220: generalized from quarterly-only to all cadences,
      // and the last-sync lookup now uses the resource's mapped signal type
      // instead of the hardcoded 'company_fundamentals'.
      const cadenceWindowMs: Record<string, number> = {
        daily: 20 * 60 * 60 * 1000,
        weekly: Math.floor(6.5 * 24 * 60 * 60 * 1000),
        quarterly: 90 * 24 * 60 * 60 * 1000,
      }
      const windowMs = resource.cadence ? cadenceWindowMs[resource.cadence] : undefined
      if (windowMs !== undefined && !backfill) {
        const signalType = connector.signal_type_map?.[resource.name.toLowerCase()] ?? 'company_fundamentals'
        const lastSync = await this.db.collection('signals').findOne(
          {
            tenant_id: tenantId,
            connector_id: connector.id,
            signal_type: signalType,
          },
          { sort: { created_at: -1 } },
        ).catch(() => null)
        if (lastSync) {
          const lastSyncDate = lastSync.created_at as Date | undefined
          if (lastSyncDate && Date.now() - lastSyncDate.getTime() < windowMs) {
            continue // still within the cadence window — skip
          }
        }
      }
      // Small gap between resources so a 5-resource connector doesn't burst
      // requests back-to-back into a provider's per-endpoint rate limit —
      // 429s themselves still get retried in fetchWithAuth, but spacing the
      // first attempt out means we usually don't hit the limit at all.
      if (i > 0) await new Promise(resolve => setTimeout(resolve, 400))
      try {
        const result = await this.syncResource(connector, resource, rawCreds, tenantId, backfill)
        results.push(result)
      } catch (err) {
        log.error({ tenant_id: tenantId, connector_id: connector.id, resource: resource.name, err }, 'Resource sync failed')
      }
    }

    return results
  }

  // ─── Historical Backfill (public API) ─────────────────────────────────────

  /**
   * Trigger a full historical backfill for a connector.
   *
   * Called automatically after OAuth callback completes.
   * Can also be triggered manually via POST /connectors/:id/backfill
   *
   * Processes up to 180 days of historical data, page by page.
   * All historical records flow through the engine — insights are tagged
   * with { source: 'sync', backfill: true } so the UI can distinguish them.
   */
  async backfill(
    connector: ConnectorConfig,
    tenantId: string,
  ): Promise<{ total_records: number; total_insights: number; duration_ms: number }> {
    const start = Date.now()
    const results = await this.syncConnector(connector, tenantId, true)
    return {
      total_records: results.reduce((s, r) => s + r.records_fetched, 0),
      total_insights: results.reduce((s, r) => s + r.insights_triggered, 0),
      duration_ms: Date.now() - start,
    }
  }

  // ─── Scheduled Polling ────────────────────────────────────────────────────

  /**
   * Poll all connected connectors for all tenants.
   * Called by the cron scheduler every 15 minutes.
   */
  async pollAll(connectors: ConnectorConfig[]): Promise<void> {
    if (this.running) return // skip if previous run still going
    this.running = true

    try {
      const credCol = this.db.collection('connector_credentials')
      // Find all unique tenant+connector pairs that have credentials
      const connected = await credCol.find({}).toArray() as SyncCredentials[]

      for (const cred of connected) {
        const connector = connectors.find(c => c.id === cred.connector_id)
        if (!connector || !connector.resources?.length) continue
        // Review fix PR #220: skip connectors that are not yet live.
        // 'planned' connectors (CBOE VIX, FRED, Google Trends) have no
        // working endpoint contract yet and would burn credentials on 404s.
        // 'beta' and 'ga' connectors are synced normally.
        if (connector.status === 'planned') continue

        try {
          await this.syncConnector(connector, cred.tenant_id, false)
        } catch (err) {
          log.error({ tenant_id: cred.tenant_id, connector_id: cred.connector_id, err }, 'Poll cycle failed')
        }
      }
    } finally {
      this.running = false
    }
  }
}
