/**
 * Shadow backtest runner — runs the Defensive Trend Following Engine (DTFE)
 * in paper-only mode against real market price history.
 *
 * Data source priority (most efficient free-tier usage):
 *   1. market_price signals already synced to the DB by any connector
 *      (yfinance, Alpha Vantage, Polygon, HF Data) — no API calls needed
 *   2. yfinance Python bridge (scripts/fetch-yfinance.py) — free, 20+ years
 *      of history, no API key, ~2000 req/hr soft limit
 *   3. Alpha Vantage API — fallback when neither DB signals nor yfinance
 *      are available (25 req/day free tier, 100 days compact history)
 *
 * Position sizing uses portfolio-tier defaults:
 *   - small  (<£2K):   25% max weight, 4 positions max, £50 min trade
 *   - medium (<£10K):  15% max weight, 7 positions max, £50 min trade
 *   - large  (≥£10K):  10% max weight, unlimited positions, £25 min trade
 *
 * The start cash defaults to the tenant's actual portfolio value (from
 * portfolio_summary signals), falling back to £10,000 if no portfolio
 * data exists yet.
 *
 * This module is compiled as part of the API build (apps/api/dist/), so it
 * works in the production Docker container without needing a TypeScript
 * loader.
 */
import {
  generateDefensiveTrendRecommendations,
  generateMomentumRecommendations,
  simulateRecommendation,
  mergeWithTierDefaults,
  classifyPortfolioTier,
  type PortfolioSnapshot,
  type Position,
  type PricePoint,
  type RiskConfig,
  type StrategyRecommendation,
} from '@kairos/engine'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { createLogger, getTenantCollection } from '@kairos/platform'
import { loadStrategyConfig } from '../trading/portfolio-data.js'

const log = createLogger({ service: 'shadow-backtest-runner', version: '0.0.0' })

const execFileAsync = promisify(execFile)

export interface BacktestPeriodPerformance {
  period: string
  start_date: string
  end_date: string
  strategy_return_pct: number
  benchmark_return_pct: number
  excess_return_pct: number
  max_drawdown_pct: number
}

export interface ShadowBacktestReport {
  run_at: Date
  mode: 'trading212' | 'av_only' | 'dry_run'
  tickers: string[]
  initial_value: number
  final_strategy_value: number
  final_benchmark_value: number
  total_return_pct: number
  benchmark_return_pct: number
  /** Strategy return minus benchmark return, measured over the same dates. */
  excess_return_pct: number
  /** Annualized returns are reported only as context; short periods remain noisy. */
  annualized_strategy_return_pct: number
  annualized_benchmark_return_pct: number
  evaluation_days: number
  period_performance: BacktestPeriodPerformance[]
  max_drawdown_pct: number
  benchmark_max_drawdown_pct: number
  trade_count: number
  rebalance_dates: string[]
  /** Tenant that owns this report. Set when the cron runs per-tenant. */
  tenant_id?: string
  /** Data source that produced the price history. */
  data_source?: 'db_signals' | 'yfinance' | 'alpha_vantage' | 'mixed'
  /** Portfolio tier used for position sizing defaults. */
  portfolio_tier?: 'small' | 'medium' | 'large'
  /** Actual portfolio value used as start cash (minor units). */
  start_cash_minor?: number
  /** Strategy evaluated in this run ('defensive' or 'momentum'). */
  strategy?: 'defensive' | 'momentum'
}

export interface ShadowBacktestOptions {
  /** Decrypted Alpha Vantage API key from the tenant's connector credentials. */
  alphaVantageKey?: string
  /** Tenant ID to tag the report with. */
  tenantId?: string
  /** Override the default ticker list. */
  tickers?: string[]
  /** MongoDB Db instance for reading synced market_price signals. */
  db?: import('mongodb').Db
  /** Actual portfolio value in minor units (overrides default start cash). */
  portfolioValueMinor?: number
  /** User overrides for risk config (merged with tier defaults). */
  riskConfigOverrides?: RiskConfig
  /**
   * Which strategy to evaluate (default 'defensive'). Set to 'momentum' to
   * backtest the aggressive trend-following strategy the weekly rebalance
   * job runs for opted-in tenants.
   */
  strategy?: 'defensive' | 'momentum'
  /** Number of calendar days of history to fetch (default 5 years). */
  historyLookbackDays?: number
  /** Number of monthly rebalance points (default 60). */
  evaluationMonths?: number
}

interface BacktestResult {
  dates: string[]
  strategyValues: number[]
  benchmarkValues: number[]
  trades: Array<{ action: string; ticker: string; quantity: number; value: number; price: number }>
  finalStrategyValue: number
  finalBenchmarkValue: number
  totalReturnPct: number
  benchmarkReturnPct: number
  excessReturnPct: number
  annualizedStrategyReturnPct: number
  annualizedBenchmarkReturnPct: number
  evaluationDays: number
  periodPerformance: BacktestPeriodPerformance[]
  maxDrawdownPct: number
  benchmarkMaxDrawdownPct: number
}

function toMinorUnits(value: number): number {
  return Math.round(value * 100)
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Unified price history fetcher — tries DB signals → yfinance → Alpha Vantage.
 * Used by both the shadow backtest and the momentum rebalance (which needs
 * market data for the default ticker universe when the portfolio is fully
 * in cash and has no position signals).
 *
 * Strips the `_US_EQ` / `_GB_EQ` suffix that Kairos uses internally — yfinance
 * and Alpha Vantage expect bare tickers (AAPL, not AAPL_US_EQ).
 */
export async function fetchPriceHistoryMultiSource(
  ticker: string,
  db?: import('mongodb').Db,
  tenantId?: string,
  lookbackDays = 365,
): Promise<PricePoint[]> {
  const bareTicker = ticker.replace(/_[A-Z]{2}_EQ$/, '')
  const avKey = process.env['ALPHA_VANTAGE_API_KEY']

  // 1. Try DB signals first
  if (db && tenantId) {
    try {
      const history = await fetchHistoryFromDbSignals(db, tenantId, ticker, lookbackDays)
      if (history.length >= 63) return history
    } catch { /* fall through */ }
  }

  // 2. Try yfinance (free, no API key)
  try {
    const history = await fetchYfinanceHistory(bareTicker, lookbackDays)
    if (history.length > 0) return history
  } catch { /* fall through */ }

  // 3. Fall back to Alpha Vantage
  if (avKey) {
    try {
      const history = await fetchAlphaVantageHistory(bareTicker, avKey, 'compact')
      if (history.length > 0) return history
    } catch { /* fall through */ }
    await sleep(1_000)
  }

  return []
}

// ─── yfinance price fetching (free, no API key, 20+ years history) ────────

export async function fetchYfinanceHistory(ticker: string, lookbackDays = 365): Promise<PricePoint[]> {
  const scriptPath = resolve(process.cwd(), 'scripts', 'fetch-yfinance.py')
  const fromDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0]
  try {
    const { stdout } = await execFileAsync('python3', [
      scriptPath, '--resource', 'DailyHistory', '--symbol', ticker, '--from', fromDate,
    ], { timeout: 30_000, maxBuffer: 1024 * 1024 * 5 })
    // The script emits { ticker, history: [{date, close, ...}] } — extract the
    // history array. Older versions emitted a flat array, so handle both shapes.
    const parsed = JSON.parse(stdout) as
      | Array<{ date: string; close: number; open?: number; high?: number; low?: number; volume?: number }>
      | { ticker: string; history: Array<{ date: string; close: number; open?: number; high?: number; low?: number; volume?: number }> }
      | { error: string }
    const rows = Array.isArray(parsed)
      ? parsed
      : 'history' in parsed ? parsed.history : []
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      log.warn({ ticker, error: !Array.isArray(parsed) && 'error' in parsed ? parsed.error : 'unexpected shape' }, `yfinance returned no history for ${ticker}`)
      return []
    }
    return rows
      .map((d) => ({ date: d.date, close: toMinorUnits(d.close) }))
      .sort((a, b) => a.date.localeCompare(b.date))
  } catch (err) {
    log.warn({ ticker, err: String(err) }, `yfinance fetch failed for ${ticker}`)
    return []
  }
}

// ─── DB signals fetching (reuses already-synced market_price data) ────────

export async function fetchHistoryFromDbSignals(
  db: import('mongodb').Db,
  tenantId: string,
  ticker: string,
  lookbackDays = 365,
): Promise<PricePoint[]> {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
  const docs = await getTenantCollection<Record<string, unknown>>(db, 'signals', tenantId)
    .find({
      signal_type: { $in: ['market_price', 'portfolio_position'] },
      'data.ticker': ticker,
      created_at: { $gte: since },
    })
    .sort({ created_at: 1 })
    .limit(800)
    .toArray()

  const byDate = new Map<string, number>()
  for (const doc of docs) {
    const data = doc.data as Record<string, unknown> | undefined
    if (!data) continue
    const signalType = String(doc.signal_type ?? '')
    const close = signalType === 'market_price'
      ? Number(data.price ?? 0)
      : Number(data.current_price ?? 0)
    if (!close) continue
    const date = signalType === 'market_price' && typeof data.date === 'string'
      ? data.date
      : (doc.created_at instanceof Date ? doc.created_at.toISOString().split('T')[0] : '')
    if (!date) continue
    byDate.set(date, close)
  }

  return Array.from(byDate.entries())
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Alpha Vantage price fetching (fallback) ──────────────────────────────

export async function fetchAlphaVantageHistory(
  ticker: string,
  apiKey: string,
  outputSize: 'compact' | 'full' = 'compact',
): Promise<PricePoint[]> {
  const url = new URL('https://www.alphavantage.co/query')
  url.searchParams.set('function', 'TIME_SERIES_DAILY')
  url.searchParams.set('symbol', ticker)
  url.searchParams.set('apikey', apiKey)
  url.searchParams.set('outputsize', outputSize)

  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new Error(`Alpha Vantage ${ticker} failed: ${res.status} ${res.statusText}`)
  }
  const body = (await res.json()) as Record<string, unknown>

  const series = body['Time Series (Daily)'] as Record<string, Record<string, string>> | undefined
  if (!series || typeof series !== 'object' || Array.isArray(series)) {
    const note = body['Note'] || body['Information'] || JSON.stringify(body).slice(0, 200)
    throw new Error(`Alpha Vantage ${ticker}: no time series data (${note})`)
  }

  return Object.entries(series)
    .map(([date, day]) => ({
      date,
      close: toMinorUnits(Number(day['4. close'] ?? 0)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Rebalance date builder ───────────────────────────────────────────────

function findNearestDate(target: string, available: string[]): string | undefined {
  return available.reduce((best, date) => {
    if (date > target) return best
    if (!best || date > best) return date
    return best
  }, undefined as string | undefined)
}

function buildRebalanceDates(histories: Map<string, PricePoint[]>, months = 6): string[] {
  const allDates = new Set<string>()
  for (const history of histories.values()) {
    for (const point of history) allDates.add(point.date)
  }
  const sortedDates = Array.from(allDates).sort()
  const lastDate = sortedDates[sortedDates.length - 1]
  if (!lastDate) return []

  const last = new Date(lastDate)
  const dates: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    const candidate = new Date(last.getFullYear(), last.getMonth() - i, 1)
    const target = candidate.toISOString().split('T')[0] as string
    const nearest = findNearestDate(target, sortedDates)
    if (nearest) dates.push(nearest)
  }

  // If monthly rebalance points are too sparse, sample evenly from available dates.
  if (dates.length < 2) {
    const step = Math.max(1, Math.floor(sortedDates.length / months))
    for (let i = sortedDates.length - 1; i >= 0; i -= step) {
      dates.push(sortedDates[i]!)
      if (dates.length >= months) break
    }
    dates.sort()
  }

  return dates
}

// ─── Backtest engine ──────────────────────────────────────────────────────

function priceAt(history: PricePoint[], date: string): number {
  const point = history.find((p) => p.date === date)
  if (!point) {
    // Fall back to the nearest earlier date
    const earlier = history.filter((p) => p.date <= date)
    return earlier[earlier.length - 1]?.close ?? history[0]?.close ?? 0
  }
  return point.close
}

function runBacktest(params: {
  startCash: number
  startPositions: Position[]
  priceHistories: Map<string, PricePoint[]>
  rebalanceDates: string[]
  config: RiskConfig
  strategy?: 'defensive' | 'momentum'
}): BacktestResult {
  const { startCash, startPositions, priceHistories, rebalanceDates, config, strategy = 'defensive' } = params

  let cash = startCash
  const positions = new Map<string, Position & { highWaterMark?: number }>()
  for (const pos of startPositions) {
    positions.set(pos.ticker, { ...pos })
  }

  const strategyValues: number[] = []
  const benchmarkValues: number[] = []
  const trades: BacktestResult['trades'] = []

  // Benchmark: equal-weight buy-and-hold, initialized on the same date as
  // the strategy. The old code used history[0], which could precede the first
  // rebalance by months or years and gave the benchmark an unfair look-ahead
  // advantage. Both portfolios now start with the same cash on the first
  // evaluation date.
  const benchmarkStartCash = startCash
  const benchmarkAllocPerTicker = startPositions.length > 0
    ? benchmarkStartCash / startPositions.length
    : 0
  const benchmarkStartDate = rebalanceDates[0]
  const benchmarkShares = new Map<string, number>()
  for (const pos of startPositions) {
    const history = priceHistories.get(pos.ticker)
    if (!history || history.length === 0 || !benchmarkStartDate) continue
    const firstPrice = priceAt(history, benchmarkStartDate)
    if (firstPrice > 0) benchmarkShares.set(pos.ticker, benchmarkAllocPerTicker / firstPrice)
  }

  for (const date of rebalanceDates) {
    // Update current prices and high-water marks
    for (const [ticker, pos] of positions) {
      const history = priceHistories.get(ticker)
      if (!history) continue
      pos.currentPrice = priceAt(history, date)
      if (pos.highWaterMark === undefined || pos.currentPrice > pos.highWaterMark) {
        pos.highWaterMark = pos.currentPrice
      }
    }

    // Build portfolio snapshot
    const positionValue = Array.from(positions.values()).reduce(
      (sum, p) => sum + p.quantity * p.currentPrice, 0,
    )
    const totalValue = cash + positionValue
    const snapshot: PortfolioSnapshot = { totalValue, cash, positions: Array.from(positions.values()) }

    // Build market data
    const marketData = new Map()
    for (const [ticker, history] of priceHistories) {
      const idx = history.findIndex((p) => p.date === date)
      if (idx >= 0) {
        marketData.set(ticker, { ticker, history: history.slice(0, idx + 1) })
      }
    }

    // Generate recommendations. The momentum strategy is the aggressive
    // trend-following variant used by the weekly rebalance job; testing it
    // here is what makes a universe/strategy choice empirical rather than a
    // guess, since the live rebalance path uses momentum for opted-in tenants.
    const recs = strategy === 'momentum'
      ? generateMomentumRecommendations(snapshot, marketData, config)
      : generateDefensiveTrendRecommendations(snapshot, marketData, config)

    // Execute recommendations
    for (const rec of recs as StrategyRecommendation[]) {
      if (!rec.ticker) continue
      const sim = simulateRecommendation(snapshot, marketData, rec, config)
      if (sim.trade && sim.trade.quantity > 0) {
        const pos = positions.get(rec.ticker)
        if (rec.action === 'sell' || rec.action === 'trim') {
          if (pos) {
            pos.quantity -= sim.trade.quantity
            cash += sim.trade.value
            trades.push({
              action: rec.action,
              ticker: rec.ticker,
              quantity: sim.trade.quantity,
              value: sim.trade.value,
              price: sim.trade.price,
            })
          }
        } else if (rec.action === 'buy' || rec.action === 'add' || rec.action === 'deploy_cash') {
          // deploy_cash is the primary buy mechanism for new positions —
          // without it, the strategy can never enter the market from cash.
          if (pos) {
            const newQty = pos.quantity + sim.trade.quantity
            const newAvg = (pos.quantity * pos.avgPrice + sim.trade.value) / newQty
            pos.quantity = newQty
            pos.avgPrice = newAvg
          } else {
            positions.set(rec.ticker, {
              ticker: rec.ticker,
              quantity: sim.trade.quantity,
              avgPrice: sim.trade.price,
              currentPrice: sim.trade.price,
            })
          }
          cash -= sim.trade.value
          trades.push({
            action: rec.action,
            ticker: rec.ticker,
            quantity: sim.trade.quantity,
            value: sim.trade.value,
            price: sim.trade.price,
          })
        }
      }
    }

    // Record strategy value
    const finalPositionValue = Array.from(positions.values()).reduce(
      (sum, p) => sum + p.quantity * p.currentPrice, 0,
    )
    strategyValues.push(cash + finalPositionValue)

    // Record benchmark value
    let benchmarkValue = 0
    for (const [ticker, shares] of benchmarkShares) {
      const history = priceHistories.get(ticker)
      if (!history) continue
      benchmarkValue += shares * priceAt(history, date)
    }
    benchmarkValues.push(benchmarkValue)
  }

  const finalStrategyValue = strategyValues[strategyValues.length - 1] ?? startCash
  const finalBenchmarkValue = benchmarkValues[benchmarkValues.length - 1] ?? benchmarkStartCash

  const totalReturnPct = ((finalStrategyValue - startCash) / startCash) * 100
  const benchmarkReturnPct = ((finalBenchmarkValue - benchmarkStartCash) / benchmarkStartCash) * 100
  const excessReturnPct = totalReturnPct - benchmarkReturnPct
  const firstDate = rebalanceDates[0]
  const lastDate = rebalanceDates[rebalanceDates.length - 1]
  const evaluationDays = firstDate && lastDate
    ? Math.max(0, Math.round((Date.parse(lastDate) - Date.parse(firstDate)) / 86_400_000))
    : 0
  const annualize = (returnPct: number): number => {
    if (evaluationDays < 365 || returnPct <= -100) {
      // Still report the mathematical annualization for periods shorter than
      // a year, but callers should treat it as context rather than a forecast.
      if (evaluationDays <= 0) return returnPct
    }
    return ((Math.pow(1 + returnPct / 100, 365 / Math.max(1, evaluationDays)) - 1) * 100)
  }
  const annualizedStrategyReturnPct = annualize(totalReturnPct)
  const annualizedBenchmarkReturnPct = annualize(benchmarkReturnPct)
  const periodPerformance = buildPeriodPerformance(rebalanceDates, strategyValues, benchmarkValues)

  // Max drawdown calculation
  const maxDrawdownPct = computeMaxDrawdown(strategyValues)
  const benchmarkMaxDrawdownPct = computeMaxDrawdown(benchmarkValues)

  return {
    dates: rebalanceDates,
    strategyValues,
    benchmarkValues,
    trades,
    finalStrategyValue,
    finalBenchmarkValue,
    totalReturnPct,
    benchmarkReturnPct,
    excessReturnPct,
    annualizedStrategyReturnPct,
    annualizedBenchmarkReturnPct,
    evaluationDays,
    periodPerformance,
    maxDrawdownPct,
    benchmarkMaxDrawdownPct,
  }
}

function computeMaxDrawdown(values: number[]): number {
  if (values.length < 2) return 0
  let peak = values[0]!
  let maxDD = 0
  for (const v of values) {
    if (v > peak) peak = v
    const dd = ((peak - v) / peak) * 100
    if (dd > maxDD) maxDD = dd
  }
  return maxDD
}

export function buildPeriodPerformance(
  dates: string[],
  strategyValues: number[],
  benchmarkValues: number[],
): BacktestPeriodPerformance[] {
  const byPeriod = new Map<string, number[]>()
  dates.forEach((date, index) => {
    const period = date.slice(0, 4)
    const indices = byPeriod.get(period) ?? []
    indices.push(index)
    byPeriod.set(period, indices)
  })

  return [...byPeriod.entries()].map(([period, indices]) => {
    const first = indices[0]!
    const last = indices[indices.length - 1]!
    const strategyStart = strategyValues[first] ?? 0
    const strategyEnd = strategyValues[last] ?? strategyStart
    const benchmarkStart = benchmarkValues[first] ?? 0
    const benchmarkEnd = benchmarkValues[last] ?? benchmarkStart
    const strategySeries = indices.map((i) => strategyValues[i] ?? strategyStart)
    const benchmarkSeries = indices.map((i) => benchmarkValues[i] ?? benchmarkStart)
    const roundPct = (value: number): number => Number(value.toFixed(6))
    const strategyReturn = strategyStart > 0 ? roundPct(((strategyEnd / strategyStart) - 1) * 100) : 0
    const benchmarkReturn = benchmarkStart > 0 ? roundPct(((benchmarkEnd / benchmarkStart) - 1) * 100) : 0
    return {
      period,
      start_date: dates[first]!,
      end_date: dates[last]!,
      strategy_return_pct: strategyReturn,
      benchmark_return_pct: benchmarkReturn,
      excess_return_pct: roundPct(strategyReturn - benchmarkReturn),
      max_drawdown_pct: roundPct(computeMaxDrawdown(strategySeries)),
    }
  })
}

// ─── Main entry point ─────────────────────────────────────────────────────

/**
 * Runs a shadow backtest and returns a structured report suitable for DB
 * persistence.
 *
 * Data source priority (most efficient free-tier usage):
 *   1. market_price signals already in the DB (synced by yfinance/AV/Polygon)
 *   2. yfinance Python bridge (free, 20+ years, no API key)
 *   3. Alpha Vantage API (fallback, 25 req/day free tier)
 *
 * Position sizing uses portfolio-tier defaults based on the actual portfolio
 * value, merged with any user overrides.
 */
export async function runShadowBacktestForReport(options?: ShadowBacktestOptions): Promise<ShadowBacktestReport | null> {
  const tenantId = options?.tenantId
  const db = options?.db
  const avKey = options?.alphaVantageKey ?? process.env['ALPHA_VANTAGE_API_KEY']

  const tickerList = options?.tickers
    ?? (process.env['SHADOW_TICKERS']
      ? process.env['SHADOW_TICKERS']!.split(',').map((t) => t.trim().toUpperCase())
      : [
          // Mega-cap tech
          'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'AVGO', 'AMD', 'MU',
          'NFLX', 'ADBE', 'CRM', 'ORCL', 'INTC', 'QCOM', 'TXN', 'AMAT', 'LRCX', 'MRVL',
          'DELL', 'STX', 'WDC', 'PANW', 'FTNT', 'NOW', 'IBM', 'CSCO', 'ACN', 'V',
          'MA', 'UNH', 'LLY', 'JPM', 'BAC', 'XOM', 'CVX', 'HD', 'COST', 'DIS',
          // Mid-cap tech & semis
          'ON', 'NXPI', 'SWKS', 'QRVO', 'ADI', 'ROST', 'MCHP', 'GFS', 'ASML', 'TSM',
          // Sector ETFs (diversification + momentum across sectors)
          'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLB', 'XLU', 'XLRE',
          // Multi-asset (uncorrelated momentum)
          'GLD', 'TLT', 'HYG', 'DBC',
          // Inverse ETF (bear regime hedge)
          'SH', 'PSQ',
        ])

  // Determine start cash: actual portfolio value > env var > default £10,000
  const startCashMinor = options?.portfolioValueMinor
    ?? Number(process.env['SHADOW_START_CASH'] ?? '10000') * 100
  const months = options?.evaluationMonths
    ?? Number(process.env['SHADOW_MONTHS'] ?? '60')
  const historyLookbackDays = options?.historyLookbackDays
    ?? Number(process.env['SHADOW_LOOKBACK_DAYS'] ?? String(5 * 365))

  // Fetch price histories with data source priority
  const priceHistories = new Map<string, PricePoint[]>()
  const sourcesUsed = new Set<'db_signals' | 'yfinance' | 'alpha_vantage'>()

  for (const ticker of tickerList) {
    let history: PricePoint[] = []

    // 1. Try DB signals first (free — data already synced)
    if (db && tenantId) {
      try {
        history = await fetchHistoryFromDbSignals(db, tenantId, ticker, historyLookbackDays)
        if (history.length >= 63) {  // need at least minLookback days
          priceHistories.set(ticker, history)
          sourcesUsed.add('db_signals')
          log.info({ ticker, source: 'db_signals', points: history.length }, `${ticker}: db_signals (${history.length} points)`)
          continue
        }
        log.info({ ticker, source: 'db_signals', points: history.length }, `${ticker}: db_signals had only ${history.length} points, trying yfinance`)
      } catch (err) {
        log.warn({ ticker, err: String(err) }, `${ticker}: db_signals threw`)
      }
    }

    // 2. Try yfinance (free, no API key, 20+ years)
    if (history.length < 63) {
      try {
        history = await fetchYfinanceHistory(ticker, historyLookbackDays)
        if (history.length > 0) {
          priceHistories.set(ticker, history)
          sourcesUsed.add('yfinance')
          log.info({ ticker, source: 'yfinance', points: history.length }, `${ticker}: yfinance (${history.length} points)`)
          continue
        }
        log.warn({ ticker }, `${ticker}: yfinance returned 0 points`)
      } catch (err) {
        log.warn({ ticker, err: String(err) }, `${ticker}: yfinance threw`)
      }
    }

    // 3. Fall back to Alpha Vantage (rate-limited free tier)
    if (history.length < 63 && avKey) {
      try {
        // Use 'compact' (100 days) for Alpha Vantage free tier — 'full' is
        // premium-only. yfinance already provides 20+ years for free, so AV
        // is only a last-resort fallback for the most recent 100 days.
        history = await fetchAlphaVantageHistory(ticker, avKey, 'compact')
        if (history.length > 0) {
          priceHistories.set(ticker, history)
          sourcesUsed.add('alpha_vantage')
          log.info({ ticker, source: 'alpha_vantage', points: history.length }, `${ticker}: alpha_vantage (${history.length} points)`)
        }
      } catch (err) {
        log.warn({ ticker, err: String(err) }, `${ticker}: alpha_vantage threw`)
      }
      await sleep(1_000) // Alpha Vantage rate limit
    }

    if (history.length === 0) {
      log.warn({ ticker }, `${ticker}: ALL SOURCES FAILED`)
    }
  }

  if (priceHistories.size === 0) return null

  // Determine data source label
  const dataSource: ShadowBacktestReport['data_source'] =
    sourcesUsed.size <= 1
      ? (sourcesUsed.values().next().value ?? 'alpha_vantage')
      : 'mixed'

  // Portfolio tier and config
  const tier = classifyPortfolioTier(startCashMinor)
  const tierCfg = mergeWithTierDefaults(startCashMinor, options?.riskConfigOverrides)

  const startPositions: Position[] = tickerList
    .filter((t) => priceHistories.has(t))
    .map((ticker) => {
      const history = priceHistories.get(ticker)!
      const latestPrice = history[history.length - 1]!.close
      return { ticker, quantity: 0, avgPrice: latestPrice, currentPrice: latestPrice }
    })

  if (startPositions.length === 0) return null

  const rebalanceDates = buildRebalanceDates(priceHistories, months)
  if (rebalanceDates.length === 0) return null

  // Load the tenant's live strategy config so the backtest reflects actual
  // trading configuration (Phase 1-4 features). Falls back to empty object
  // if tenant ID is not provided or config loading fails.
  let tenantStrategyConfig: Record<string, unknown> = {}
  let tenantStrategyField: 'defensive' | 'momentum' | undefined
  if (tenantId) {
    try {
      const liveConfig = await loadStrategyConfig(tenantId)
      // Strip non-RiskConfig fields — only keep risk parameters that the
      // engine's generateMomentumRecommendations / generateDefensiveTrendRecommendations
      // functions accept in their RiskConfig.
      const { strategy_id, enabled, strategy, paper_mode, ...riskConfig } = liveConfig as Record<string, unknown>
      tenantStrategyConfig = riskConfig
      tenantStrategyField = strategy as 'defensive' | 'momentum' | undefined
      log.info(
        { tenant_id: tenantId, configKeys: Object.keys(tenantStrategyConfig).length, strategy: tenantStrategyField },
        'Loaded tenant strategy config for backtest',
      )
    } catch (err) {
      log.warn({ tenant_id: tenantId, err: String(err) }, 'Failed to load tenant strategy config for backtest — using defaults')
    }
  }

  // Determine which strategy to backtest. Priority:
  //   1. Explicit options.strategy override
  //   2. Tenant's live strategy config
  //   3. Default 'defensive'
  const backtestStrategy: 'defensive' | 'momentum' =
    options?.strategy ?? tenantStrategyField ?? 'defensive'

  // Strategy-specific base defaults. The momentum engine has different
  // optimal thresholds than the defensive engine — applying defensive
  // thresholds to the momentum strategy causes it to miss winners and
  // underperform badly (confirmed: -36% with defensive thresholds vs
  // positive returns with momentum thresholds).
  const strategyDefaults: RiskConfig = backtestStrategy === 'momentum'
    ? {
        cashDeployScoreThreshold: 0.10,
        maxCashDeployTickers: 5,
        minLookback: 21,
        stopLossThreshold: 0.15,
        trailingStopThreshold: 0.15,
        addMomentumThreshold: 0.15,
        sellScoreThreshold: 0.30,
        trimScoreThreshold: 0.50,
      }
    : {
        cashDeployScoreThreshold: 0.35,
        maxCashDeployTickers: 3,
        minLookback: 63,
        stopLossThreshold: 0.10,
      }

  const result = runBacktest({
    startCash: startCashMinor,
    startPositions,
    priceHistories,
    rebalanceDates,
    strategy: backtestStrategy,
    config: {
      maxPositionWeight: tierCfg.maxPositionWeight,
      maxPositions: tierCfg.maxPositions,
      minTradeValueMinor: tierCfg.minTradeValueMinor,
      minPositionWeight: tierCfg.minPositionWeight,
      targetVolatility: 10,
      cashDeployThreshold: 5,
      // Strategy-specific defaults (momentum vs defensive)
      ...strategyDefaults,
      // Transaction cost model. 15 bps round-trip estimate for liquid
      // UK/US equities on a zero-commission broker: ~10 bps spread + ~5 bps
      // market impact. The tenant config may override these to 0.
      spreadBps: 10,
      marketImpactBps: 5,
      // Load the tenant's live strategy config so the backtest reflects the
      // actual trading configuration (Phase 1-4 features: rank-based scoring,
      // alpha-mining, ML ensemble, Kelly sizing, regime awareness, etc.).
      ...(tenantStrategyConfig as RiskConfig),
      // Caller overrides land last so every RiskConfig knob is testable.
      ...(options?.riskConfigOverrides ?? {}),
    },
  })

  return {
    run_at: new Date(),
    mode: 'av_only',
    tickers: tickerList,
    initial_value: result.strategyValues[0] ?? 0,
    final_strategy_value: result.finalStrategyValue,
    final_benchmark_value: result.finalBenchmarkValue,
    total_return_pct: result.totalReturnPct,
    benchmark_return_pct: result.benchmarkReturnPct,
    excess_return_pct: result.excessReturnPct,
    annualized_strategy_return_pct: result.annualizedStrategyReturnPct,
    annualized_benchmark_return_pct: result.annualizedBenchmarkReturnPct,
    evaluation_days: result.evaluationDays,
    period_performance: result.periodPerformance,
    max_drawdown_pct: result.maxDrawdownPct,
    benchmark_max_drawdown_pct: result.benchmarkMaxDrawdownPct,
    trade_count: result.trades.length,
    rebalance_dates: result.dates,
    data_source: dataSource,
    portfolio_tier: tier,
    start_cash_minor: startCashMinor,
    strategy: backtestStrategy,
    ...(tenantId ? { tenant_id: tenantId } : {}),
  }
}
