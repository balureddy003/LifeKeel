/**
 * GET /portfolio/holdings — per-holding fundamentals for the Trading & Investment vertical
 *
 * Returns a tenant-scoped list of holdings (stocks, ETFs, cash). For the alpha
 * release this is backed by sandbox/demo data; in production it will be sourced
 * from the connected Trading 212 connector via the pipeline sync engine.
 */

import type { FastifyInstance } from 'fastify'
import { getSignalsCollection, getInsightsCollection, getDb } from '../db.js'
import type { TradingHolding, AssetClass } from '@kairos/specifications'
import { buildGoalKpiTargets } from '@kairos/platform'
import {
  generateDefensiveTrendRecommendations,
  generateMomentumRecommendations,
  scoreMomentumUniverse,
  simulateRecommendation,
  classifyPortfolioTier,
  detectRegimeFromMarketData,
  selectRegimeStrategy,
  type Engine,
  type Insight,
  type StrategyRecommendation,
  type SimulationResult,
  type UniverseScore,
} from '@kairos/engine'
import { z } from 'zod'
import {
  StrategyConfigSchema,
  type StrategyConfig,
  loadStrategyConfig,
  LiveTradingOptInSchema,
  type LiveTradingOptIn,
  loadLiveTradingOptIn,
  tenantCanTrade,
  isBrokerInLiveMode,
  buildSnapshotFromSignals,
  buildMarketDataFromSignals,
  loadPortfolioValueHistory,
  loadLatestPrices,
  fetchMacroIndicators,
} from '../trading/portfolio-data.js'
import {
  DEFAULT_MOMENTUM_UNIVERSE,
  runMomentumRebalanceForTenant,
} from '../trading/momentum-rebalance.js'
import { fetchPriceHistoryMultiSource } from '../jobs/shadow-backtest-runner.js'
import {
  createPendingTrade,
  confirmPendingTrade,
} from '../trading/trade-confirmation.js'
import { syncPieAllocation, getKairosPie, savePieId } from '../trading/pie-sync.js'
import { getTaxWrapperConfig, getTaxWrapperSettingsKey, getTaxAdvantagedAccountType } from '../trading/tax-wrappers.js'
import { getTenantCountry } from '../lib/tenant-context.js'

/** @deprecated Use getTaxWrapperConfig() instead — kept for backward compat with existing ISA data */
const DEFAULT_ISA_ALLOWANCE_MINOR = 2_000_000

/** Display label per trading detector — matches the demo fixtures' labels. */
const DETECTOR_LABELS: Record<string, string> = {
  trading_concentration_risk: 'Concentration risk',
  trading_price_drop_alert: 'Price drop alert',
  trading_dividend_opportunity: 'Dividend opportunity',
  trading_rebalance_suggestion: 'Rebalance suggestion',
}

/**
 * Fixed per-detector trade direction, used by the Calibration dashboard to
 * decide whether a price move counts as a "hit" (the position moved in the
 * recommended direction).
 *
 * Replaces the regex-based heuristic that matched free-text action copy
 * (`/sell|trim|reduce|cut/` etc.) — none of the four trading detectors'
 * action text (e.g. "Review position size and consider diversification")
 * ever contained any of those keywords, so hit rate was permanently 0%
 * for every trading detector. See TRADING_ENGINE_GAPS.md gap #3.
 *
 * Direction is derived from the detector's intent, not its copy:
 *  - concentration-risk / price-drop-alert → exit (trim/sell): a hit is a
 *    price decline after the alert (the alert warned you to reduce, and
 *    reducing would have avoided a loss).
 *  - dividend-opportunity / rebalance-suggestion → entry (buy/deploy): a
 *    hit is a price rise after the alert (the alert suggested buying in,
 *    and buying in would have captured a gain).
 */
const DETECTOR_DIRECTIONS: Record<string, 'entry' | 'exit'> = {
  trading_concentration_risk: 'exit',
  trading_price_drop_alert: 'exit',
  trading_dividend_opportunity: 'entry',
  trading_rebalance_suggestion: 'entry',
}

/**
 * Builds recommendation data from both synced signals and the same external
 * fallback used by the rebalance job. The recommendation endpoint previously
 * queried only held positions; a cash-only portfolio therefore supplied an
 * empty ticker list and could never discover a momentum candidate.
 */
const RECOMMENDATION_HISTORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const recommendationHistoryCache = new Map<string, { history: Awaited<ReturnType<typeof fetchPriceHistoryMultiSource>>; fetchedAt: number }>()

async function loadRecommendationMarketData(
  tenantId: string,
  snapshot: ReturnType<typeof buildSnapshotFromSignals>,
): Promise<{ tickers: string[]; marketData: Awaited<ReturnType<typeof buildMarketDataFromSignals>> }> {
  const positionTickers = snapshot.positions.map((p) => p.ticker)
  const tickers = Array.from(new Set([...positionTickers, ...DEFAULT_MOMENTUM_UNIVERSE]))
  const marketData = await buildMarketDataFromSignals(tenantId, tickers)
  const missingTickers = tickers.filter((ticker) => !marketData.has(ticker))
  const db = missingTickers.length > 0 ? await getDb() : undefined

  // Fetch in small batches so a cash-only recommendation request can populate
  // the full universe without serially waiting on every yfinance process or
  // overwhelming the public data endpoint.
  for (let i = 0; i < missingTickers.length; i += 5) {
    const batch = missingTickers.slice(i, i + 5)
    const histories = await Promise.all(batch.map(async (ticker) => {
      const cacheKey = `${tenantId}:${ticker}`
      const cached = recommendationHistoryCache.get(cacheKey)
      if (cached && Date.now() - cached.fetchedAt < RECOMMENDATION_HISTORY_CACHE_TTL_MS) {
        return { ticker, history: cached.history }
      }
      const history = await fetchPriceHistoryMultiSource(ticker, db, tenantId)
      recommendationHistoryCache.set(cacheKey, { history, fetchedAt: Date.now() })
      return { ticker, history }
    }))
    for (const { ticker, history } of histories) {
      if (history.length >= 63) marketData.set(ticker, { ticker, history })
    }
  }

  return { tickers, marketData }
}

export type { TradingHolding, AssetClass }

/** Demo holdings used while the Trading 212 connector sync is in alpha. */
const demoHoldings: TradingHolding[] = [
  {
    id: 'demo-holding-1',
    ticker: 'AAPL',
    name: 'Apple Inc.',
    assetClass: 'stock',
    currentPriceMinor: 22_500,
    dayChangeMinor: 125,
    dayChangePercent: 0.56,
    portfolioWeightPercent: 12.4,
    concentrationFlag: true,
    dividendYieldPercent: 0.5,
    newsSignal: 'Earnings beat',
    opportunityDetector: 'Rebalance suggestion',
    currency: 'USD',
  },
  {
    id: 'demo-holding-2',
    ticker: 'VUAG',
    name: 'Vanguard S&P 500 UCITS',
    assetClass: 'etf',
    currentPriceMinor: 8_420,
    dayChangeMinor: -42,
    dayChangePercent: -0.50,
    portfolioWeightPercent: 28.0,
    dividendYieldPercent: 1.3,
    newsSignal: 'Fed minutes',
    opportunityDetector: 'Dividend opportunity',
    currency: 'GBP',
  },
  {
    id: 'demo-holding-3',
    ticker: 'TSLA',
    name: 'Tesla Inc.',
    assetClass: 'stock',
    currentPriceMinor: 26_800,
    dayChangeMinor: -1_420,
    dayChangePercent: -5.03,
    portfolioWeightPercent: 8.1,
    concentrationFlag: false,
    newsSignal: 'Analyst downgrade',
    opportunityDetector: 'Price drop alert',
    currency: 'USD',
  },
  {
    id: 'demo-holding-4',
    ticker: 'CASH',
    name: 'Idle cash',
    assetClass: 'cash',
    currentPriceMinor: 4_200_000,
    dayChangeMinor: 0,
    dayChangePercent: 0,
    portfolioWeightPercent: 18.5,
    opportunityDetector: 'Rebalance suggestion',
    currency: 'GBP',
  },
]

export async function registerPortfolioRoutes(
  app: FastifyInstance,
  engine: Engine,
  onInsightsGenerated?: (insights: Insight[], tenantId: string) => Promise<void>,
): Promise<void> {
  /** GET /portfolio/holdings — list holdings for the tenant */
  app.get('/portfolio/holdings', async (request, reply) => {
    const { tenant_id } = request.authContext

    const signalsCol = await getSignalsCollection()
    const signals = await signalsCol
      .find({
        tenant_id,
        signal_type: { $in: ['portfolio_position', 'portfolio_summary', 'instrument_metadata'] },
      })
      .sort({ created_at: -1 })
      .toArray()

    const insightsCol = await getInsightsCollection()
    const insights = await insightsCol
      .find({
        tenant_id,
        detector_id: { $in: Object.keys(DETECTOR_LABELS) },
        state: { $ne: 'dismissed' },
      })
      .sort({ created_at: -1 })
      .toArray()

    const synced = buildHoldingsFromSignals(tenant_id, signals, insights)
    const holdings = synced.length > 0 ? synced : demoHoldings.map((h) => ({ ...h, id: `${tenant_id}:${h.id}` }))

    return reply.send({ holdings })
  })

  /**
   * GET /portfolio/home-kpis — aggregate values for the Home screen's
   * headline KPI tiles (unrealised P&L, portfolio concentration, dividend
   * yield). Computed from real positions only — never falls back to
   * demoHoldings, since a fabricated number in a hero tile is worse than an
   * honestly-empty one.
   */
  app.get('/portfolio/home-kpis', async (request, reply) => {
    const { tenant_id } = request.authContext

    const signalsCol = await getSignalsCollection()
    const signals = await signalsCol
      .find({
        tenant_id,
        signal_type: { $in: ['portfolio_position', 'portfolio_summary', 'instrument_metadata'] },
      })
      .sort({ created_at: -1 })
      .toArray()

    const snapshot = buildSnapshotFromSignals(tenant_id, signals)
    const positionsValue = snapshot.positions.reduce((sum, p) => sum + p.currentPrice * p.quantity, 0)

    const unrealisedPnlMinor = Math.round(
      snapshot.positions.reduce((sum, p) => sum + (p.currentPrice - p.avgPrice) * p.quantity, 0),
    )
    const concentrationPct = positionsValue > 0 && snapshot.positions.length > 0
      ? Number((Math.max(...snapshot.positions.map((p) => p.currentPrice * p.quantity)) / snapshot.totalValue * 100).toFixed(2))
      : 0

    // Dividend yield: value-weighted across positions with a synced
    // instrument_metadata.dividend_yield_pct — null (not 0) when no position
    // has that data yet, so the tile can say "not yet available" instead of
    // implying a real 0% yield.
    const dividendYieldByTicker = new Map<string, number>()
    for (const s of signals) {
      if (s.signal_type !== 'instrument_metadata') continue
      const data = s.data as Record<string, unknown> | undefined
      const ticker = String(data?.['ticker'] ?? '')
      const yieldPct = data?.['dividend_yield_pct']
      if (ticker && yieldPct !== undefined && !dividendYieldByTicker.has(ticker)) {
        dividendYieldByTicker.set(ticker, Number(yieldPct))
      }
    }
    let weightedYieldSum = 0
    let weightedYieldValue = 0
    for (const p of snapshot.positions) {
      const y = dividendYieldByTicker.get(p.ticker)
      if (y === undefined) continue
      const value = p.currentPrice * p.quantity
      weightedYieldSum += y * value
      weightedYieldValue += value
    }
    const dividendYieldPct = weightedYieldValue > 0 ? Number((weightedYieldSum / weightedYieldValue).toFixed(2)) : null

    return reply.send({
      unrealisedPnlMinor,
      concentrationPct,
      dividendYieldPct,
      hasPositions: snapshot.positions.length > 0,
    })
  })

  /** GET /portfolio/value-history — daily total-value series for the Research page's hero chart */
  app.get<{ Querystring: { days?: string } }>('/portfolio/value-history', async (request, reply) => {
    const { tenant_id } = request.authContext
    const days = Math.min(365, Math.max(1, Number(request.query.days) || 90))
    const points = await loadPortfolioValueHistory(tenant_id, days)
    return reply.send({ points })
  })

  /** GET /portfolio/holdings/price-history — per-ticker close series for the Stocks/ETFs grid sparklines */
  app.get<{ Querystring: { tickers?: string; days?: string } }>(
    '/portfolio/holdings/price-history',
    async (request, reply) => {
      const { tenant_id } = request.authContext
      const tickers = (request.query.tickers ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const days = Math.min(180, Math.max(7, Number(request.query.days) || 30))
      if (tickers.length === 0) return reply.send({ history: {} })

      const marketData = await buildMarketDataFromSignals(tenant_id, tickers, days)
      const history: Record<string, number[]> = {}
      for (const [ticker, data] of marketData) {
        history[ticker] = data.history.slice(-days).map((h) => h.close)
      }
      return reply.send({ history })
    },
  )

  /**
   * GET /portfolio/dividends — dividend payout history from Trading 212.
   * Returns dividend events synced from the /equity/history/dividends
   * endpoint, grouped by ticker with totals.
   */
  app.get<{ Querystring: { days?: string } }>('/portfolio/dividends', async (request, reply) => {
    const { tenant_id } = request.authContext
    const signalsCol = await getSignalsCollection()
    const days = Math.min(365, Math.max(1, Number(request.query.days) || 365))
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const docs = await signalsCol
      .find({
        tenant_id,
        signal_type: 'dividend_event',
        created_at: { $gte: since },
      })
      .sort({ created_at: -1 })
      .toArray()

    const dividends = docs.map((d) => {
      const data = d.data as Record<string, unknown>
      return {
        ticker: String(data.ticker ?? ''),
        amount: Number(data.dividend_amount ?? 0),
        quantity: Number(data.quantity ?? 0),
        pay_date: String(data.pay_date ?? ''),
        type: String(data.dividend_type ?? 'ordinary'),
      }
    })

    // Group by ticker for summary
    const byTicker = new Map<string, { ticker: string; totalAmount: number; count: number; latestDate: string }>()
    for (const d of dividends) {
      const existing = byTicker.get(d.ticker)
      if (existing) {
        existing.totalAmount += d.amount
        existing.count++
        if (d.pay_date > existing.latestDate) existing.latestDate = d.pay_date
      } else {
        byTicker.set(d.ticker, { ticker: d.ticker, totalAmount: d.amount, count: 1, latestDate: d.pay_date })
      }
    }

    const totalDividendIncome = dividends.reduce((sum, d) => sum + d.amount, 0)

    return reply.send({
      dividends,
      summary: {
        totalIncome: totalDividendIncome,
        totalIncomeDisplay: (totalDividendIncome / 100).toFixed(2),
        payoutCount: dividends.length,
        tickersWithDividends: byTicker.size,
        byTicker: Array.from(byTicker.values()).sort((a, b) => b.totalAmount - a.totalAmount),
      },
    })
  })

  /** GET /portfolio/recommendations — defensive trend-following recommendations */
  app.get('/portfolio/recommendations', async (request, reply) => {
    const { tenant_id } = request.authContext

    const signalsCol = await getSignalsCollection()
    const signals = await signalsCol
      .find({
        tenant_id,
        signal_type: { $in: ['portfolio_position', 'portfolio_summary'] },
      })
      .sort({ created_at: -1 })
      .toArray()

    const snapshot = buildSnapshotFromSignals(tenant_id, signals)
    const { tickers, marketData } = await loadRecommendationMarketData(tenant_id, snapshot)
    const strategyConfig = await loadStrategyConfig(tenant_id)
    // Inject country-specific tax wrapper config so the engine can generate
    // country-aware wrapper-preference recommendations (ISA for GB, ELSS for
    // IN, etc.) without hardcoding account-type values.
    const db = await getDb()
    const _country = await getTenantCountry(db, tenant_id)
    const _wrapperConfig = getTaxWrapperConfig(_country)
    if (_wrapperConfig) {
      strategyConfig.taxAdvantagedAccountType = _wrapperConfig.accountType
      strategyConfig.taxableAccountType = _wrapperConfig.taxableAccountType
      strategyConfig.taxWrapperName = _wrapperConfig.name
    }

    // Regime-aware strategy selection: detect the current market regime
    // from the portfolio's price history and switch between defensive and
    // momentum strategies accordingly. In bull markets, the momentum
    // strategy captures upside; in bear markets, the defensive strategy
    // protects capital. The tenant's explicit strategy choice is still
    // respected — regime detection only overrides when the tenant hasn't
    // explicitly chosen a strategy (i.e. using the default 'defensive').
    // Review wiring fix (PR #220): pass macro indicators (VIX, yield curve,
    // credit spreads) so the Phase 2 macro overrides actually engage. When no
    // macro signals have been synced yet, fetchMacroIndicators returns an
    // empty object and the detector falls back to price-only classification.
    const macroIndicators = await fetchMacroIndicators(tenant_id)
    const regimeResult = detectRegimeFromMarketData(marketData, macroIndicators)
    let effectiveStrategy = strategyConfig.strategy
    let regimeOverrides: Record<string, unknown> = {}
    if (strategyConfig.enabled && marketData.size > 0 && regimeResult.confidence > 0) {
      const regimeStrategy = selectRegimeStrategy(regimeResult.regime, strategyConfig as Record<string, unknown>)
      // Only override the strategy if the tenant is using the default
      // 'defensive' — if they explicitly chose 'momentum', respect that.
      if (strategyConfig.strategy === 'defensive' && regimeStrategy.strategy === 'momentum') {
        effectiveStrategy = 'momentum'
        regimeOverrides = regimeStrategy.configOverrides
      } else if (strategyConfig.strategy === 'defensive') {
        // Apply bear/sideways config overrides to the defensive strategy
        regimeOverrides = regimeStrategy.configOverrides
      }
    }
    const mergedConfig = { ...strategyConfig, ...regimeOverrides, strategy: effectiveStrategy }

    const recommendations = strategyConfig.enabled
      ? (effectiveStrategy === 'momentum'
        ? generateMomentumRecommendations(snapshot, marketData, mergedConfig)
        : generateDefensiveTrendRecommendations(snapshot, marketData, mergedConfig))
      : []

    // GET /portfolio/holdings falls back to demoHoldings whenever no real
    // signals produce a holding, but this endpoint reads totalValue/cash off
    // a `portfolio_summary` signal specifically — a tenant can have zero of
    // those (or a stale/empty one) while still having real portfolio_position
    // signals, so "no signals at all" isn't a reliable proxy for "totalValue
    // is genuinely missing." Keying off the actual computed value being zero
    // matches the visible symptom directly: a real £0 total next to the
    // non-zero allocation %s Research/Analytics render from those same
    // demoHoldings reads as broken regardless of which signal was missing.
    const demoCash = demoHoldings.find((h) => h.assetClass === 'cash')
    const usingDemoHoldings = snapshot.totalValue <= 0 && demoCash !== undefined
    const totalValue = usingDemoHoldings && demoCash
      ? Math.round(demoCash.currentPriceMinor / (demoCash.portfolioWeightPercent / 100))
      : snapshot.totalValue
    const cash = usingDemoHoldings && demoCash ? demoCash.currentPriceMinor : snapshot.cash

    const cashPct = (cash / Math.max(1, totalValue)) * 100
    return reply.send({
      recommendations,
      meta: {
        totalValue,
        cash,
        cashPct: Number(cashPct.toFixed(2)),
        tickersWithHistory: marketData.size,
        insufficientHistory: tickers.length - marketData.size,
        strategy: mergedConfig,
        regime: regimeResult,
      },
    })
  })

  /**
   * GET /portfolio/scores — Winner/Loser dashboard.
   * Returns per-ticker momentum scores for the entire universe, sorted by
   * score (highest first). Each score includes the raw return, 52-week high
   * proximity, volatility scale, current portfolio weight, and the action
   * the strategy recommends for that ticker.
   *
   * This is the data behind the "Top Winners" and "Top Losers" view —
   * computed from our own multi-timeframe momentum engine, not from
   * Trading 212's app-only curated lists.
   */
  app.get('/portfolio/scores', async (request, reply) => {
    const { tenant_id } = request.authContext

    const signalsCol = await getSignalsCollection()
    const signals = await signalsCol
      .find({
        tenant_id,
        signal_type: { $in: ['portfolio_position', 'portfolio_summary'] },
      })
      .sort({ created_at: -1 })
      .toArray()

    const snapshot = buildSnapshotFromSignals(tenant_id, signals)
    const { marketData } = await loadRecommendationMarketData(tenant_id, snapshot)
    const strategyConfig = await loadStrategyConfig(tenant_id)

    const scores: UniverseScore[] = strategyConfig.enabled
      ? scoreMomentumUniverse(snapshot, marketData, strategyConfig)
      : []

    const winners = scores.filter((s) => s.rawReturn > 0).slice(0, 10)
    const losers = scores.filter((s) => s.rawReturn < 0).reverse().slice(0, 10)

    return reply.send({
      scores,
      winners,
      losers,
      meta: {
        totalTickers: scores.length,
        tickersWithHistory: scores.filter((s) => !s.missingMarketData).length,
        strategy: strategyConfig.strategy,
        held: scores.filter((s) => s.currentWeight > 0).length,
      },
    })
  })

  /** POST /portfolio/simulate — preview the impact of a recommendation */
  const SimulateBodySchema = z.object({
    action: z.enum(['buy', 'sell', 'trim', 'hold', 'reduce_exposure', 'deploy_cash', 'add']),
    ticker: z.string().optional(),
  })

  app.post<{ Body: z.infer<typeof SimulateBodySchema> }>('/portfolio/simulate', async (request, reply) => {
    const parsed = SimulateBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid simulation body', issues: parsed.error.issues })
    }

    const { tenant_id } = request.authContext
    const signalsCol = await getSignalsCollection()
    const signals = await signalsCol
      .find({
        tenant_id,
        signal_type: { $in: ['portfolio_position', 'portfolio_summary'] },
      })
      .sort({ created_at: -1 })
      .toArray()

    const snapshot = buildSnapshotFromSignals(tenant_id, signals)
    const tickers = new Set<string>([...snapshot.positions.map((p) => p.ticker), parsed.data.ticker ?? ''])
    const marketData = await buildMarketDataFromSignals(tenant_id, Array.from(tickers).filter(Boolean))
    const strategyConfig = await loadStrategyConfig(tenant_id)

    const recommendation: StrategyRecommendation = {
      action: parsed.data.action,
      ticker: parsed.data.ticker,
      reason: 'User-requested paper-trade preview',
      confidence: 0,
      riskFlags: [],
    }

    const result: SimulationResult = simulateRecommendation(snapshot, marketData, recommendation, strategyConfig)
    return reply.send(result)
  })

  /** GET /portfolio/isa-allowance — annual tax wrapper allowance tracker.
   *
   * Route name kept as 'isa-allowance' for backward compatibility with the
   * frontend. Internally resolves the tenant's country to the correct tax
   * wrapper (ISA for GB, ELSS/§80C for IN, IRA for US, etc.) and returns
   * the appropriate limit. */
  app.get('/portfolio/isa-allowance', async (request, reply) => {
    const { tenant_id } = request.authContext
    const db = await getDb()
    const country = await getTenantCountry(db, tenant_id)
    const wrapperConfig = getTaxWrapperConfig(country)
    const settingsKey = getTaxWrapperSettingsKey(country)
    const defaultLimit = wrapperConfig?.limitMinor ?? DEFAULT_ISA_ALLOWANCE_MINOR
    const doc = await db.collection('tenant_settings').findOne({ tenant_id, key: settingsKey })
    const value = (doc?.value as { used?: number; limit?: number } | undefined) ?? {}
    const used = value.used ?? 0
    const limit = value.limit ?? defaultLimit
    return reply.send({
      used,
      limit,
      remaining: Math.max(0, limit - used),
      pct: limit > 0 ? Number(((used / limit) * 100).toFixed(2)) : 0,
      wrapper_type: wrapperConfig?.type ?? 'isa',
      wrapper_name: wrapperConfig?.name ?? 'ISA',
      currency: wrapperConfig?.currency ?? 'GBP',
    })
  })

  /** POST /portfolio/isa-allowance/sync — auto-update used amount from ISA signals.
   *
   * Trading 212's public API does not expose the annual ISA allowance used, so we
   * approximate it from the latest ISA account summary's invested_value. This is
   * accurate when the ISA is buy-and-hold; it drifts after sells. The user can
   * still override manually. */
  app.post('/portfolio/isa-allowance/sync', async (request, reply) => {
    const { tenant_id } = request.authContext
    const db = await getDb()
    const country = await getTenantCountry(db, tenant_id)
    const wrapperConfig = getTaxWrapperConfig(country)
    const settingsKey = getTaxWrapperSettingsKey(country)
    const defaultLimit = wrapperConfig?.limitMinor ?? DEFAULT_ISA_ALLOWANCE_MINOR
    const accountType = getTaxAdvantagedAccountType(country) ?? 'isa'

    // Query for the tax-advantaged account summary using the country-specific
    // account_type value (e.g. 'isa' for GB, 'cnc' for IN).
    const wrapperSummary = await db
      .collection('signals')
      .find({ tenant_id, signal_type: 'portfolio_summary', 'data.account_type': accountType })
      .sort({ created_at: -1 })
      .limit(1)
      .toArray()
    const data = wrapperSummary[0]?.data as { invested_value?: number } | undefined
    const used = data?.invested_value ?? 0

    const existing = await db.collection('tenant_settings').findOne({ tenant_id, key: settingsKey })
    const existingValue = (existing?.value as { limit?: number } | undefined) ?? {}
    const limit = existingValue.limit ?? defaultLimit

    await db.collection('tenant_settings').updateOne(
      { tenant_id, key: settingsKey },
      { $set: { tenant_id, key: settingsKey, value: { used, limit }, updated_at: new Date() } },
      { upsert: true },
    )

    return reply.send({
      ok: true,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      pct: limit > 0 ? Number(((used / limit) * 100).toFixed(2)) : 0,
      source: `${wrapperConfig?.type ?? 'isa'}_portfolio_summary`,
      wrapper_type: wrapperConfig?.type ?? 'isa',
      wrapper_name: wrapperConfig?.name ?? 'ISA',
      currency: wrapperConfig?.currency ?? 'GBP',
      approximated: true,
    })
  })

  /** POST /portfolio/isa-allowance — set ISA allowance used/limit for the tenant */
  const IsaAllowanceSchema = z.object({
    used: z.number().int().min(0),
    limit: z.number().int().min(0).optional(),
  })
  app.post<{ Body: z.infer<typeof IsaAllowanceSchema> }>('/portfolio/isa-allowance', async (request, reply) => {
    const parsed = IsaAllowanceSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid tax wrapper allowance body', issues: parsed.error.issues })
    }
    const { tenant_id } = request.authContext
    const db = await getDb()
    const country = await getTenantCountry(db, tenant_id)
    const wrapperConfig = getTaxWrapperConfig(country)
    const settingsKey = getTaxWrapperSettingsKey(country)
    const defaultLimit = wrapperConfig?.limitMinor ?? DEFAULT_ISA_ALLOWANCE_MINOR
    const limit = parsed.data.limit ?? defaultLimit
    const value = { used: parsed.data.used, limit }
    await db.collection('tenant_settings').updateOne(
      { tenant_id, key: settingsKey },
      { $set: { tenant_id, key: settingsKey, value, updated_at: new Date() } },
      { upsert: true },
    )
    return reply.send({
      ok: true,
      used: parsed.data.used,
      limit,
      remaining: Math.max(0, limit - parsed.data.used),
      pct: limit > 0 ? Number(((parsed.data.used / limit) * 100).toFixed(2)) : 0,
    })
  })

  /** GET /portfolio/strategy — current Defensive Trend Following configuration */
  app.get('/portfolio/strategy', async (request, reply) => {
    const { tenant_id } = request.authContext
    const config = await loadStrategyConfig(tenant_id)
    const strategyId = config.strategy === 'momentum' ? 'momentum-trend-following' : 'defensive-trend-following'
    return reply.send({ strategy_id: strategyId, ...config })
  })

  /** POST /portfolio/strategy — update Defensive Trend Following configuration */
  app.post<{ Body: StrategyConfig }>('/portfolio/strategy', async (request, reply) => {
    const parsed = StrategyConfigSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid strategy configuration', issues: parsed.error.issues })
    }
    const { tenant_id } = request.authContext
    const db = await getDb()
    await db.collection('tenant_settings').updateOne(
      { tenant_id, key: 'defensive_trend_strategy' },
      { $set: { tenant_id, key: 'defensive_trend_strategy', value: parsed.data, updated_at: new Date() } },
      { upsert: true },
    )
    const strategyId = parsed.data.strategy === 'momentum' ? 'momentum-trend-following' : 'defensive-trend-following'
    return reply.send({ strategy_id: strategyId, ...parsed.data })
  })

  /**
   * POST /portfolio/strategy/preview — recommendations a draft config would
   * produce right now, without saving it. Backs the Strategy Settings
   * sliders' live-impact readout: every drag would otherwise save
   * immediately, mutating the live strategy before the user has seen what
   * it does. Same recommendation logic as GET /portfolio/recommendations,
   * just fed the in-flight draft instead of the persisted config.
   */
  app.post<{ Body: StrategyConfig }>('/portfolio/strategy/preview', async (request, reply) => {
    const parsed = StrategyConfigSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid strategy configuration', issues: parsed.error.issues })
    }
    const { tenant_id } = request.authContext

    const signalsCol = await getSignalsCollection()
    const signals = await signalsCol
      .find({
        tenant_id,
        signal_type: { $in: ['portfolio_position', 'portfolio_summary'] },
      })
      .sort({ created_at: -1 })
      .toArray()

    const snapshot = buildSnapshotFromSignals(tenant_id, signals)
    const { tickers, marketData } = await loadRecommendationMarketData(tenant_id, snapshot)
    const draftConfig = parsed.data
    const db = await getDb()
    const draftCountry = await getTenantCountry(db, tenant_id)
    const draftWrapperConfig = getTaxWrapperConfig(draftCountry)
    const recommendations = draftConfig.enabled
      ? (draftConfig.strategy === 'momentum'
        ? generateMomentumRecommendations(snapshot, marketData, draftConfig)
        : generateDefensiveTrendRecommendations(snapshot, marketData, { ...draftConfig, taxAdvantagedAccountType: draftWrapperConfig?.accountType, taxableAccountType: draftWrapperConfig?.taxableAccountType, taxWrapperName: draftWrapperConfig?.name }))
      : []

    const cashPct = (snapshot.cash / Math.max(1, snapshot.totalValue)) * 100
    return reply.send({
      recommendations,
      meta: {
        totalValue: snapshot.totalValue,
        cash: snapshot.cash,
        cashPct: Number(cashPct.toFixed(2)),
        tickersWithHistory: marketData.size,
        insufficientHistory: tickers.length - marketData.size,
        strategy: draftConfig,
      },
    })
  })

  /**
   * POST /portfolio/rebalance — manually trigger a momentum rebalance for the
   * current tenant. Normally runs weekly on Mondays at 09:00 London time via
   * a cron job, but this endpoint allows on-demand rebalancing after strategy
   * config changes, portfolio sync fixes, or other operational events.
   *
   * Query parameter `reset_hwm=true` resets the portfolio high-water mark to
   * the current value before running the rebalance. Use this after data
   * corrections (e.g. stale position cleanup) that artificially inflated the
   * HWM and would trip the drawdown kill-switch.
   */
  app.post<{ Querystring: { reset_hwm?: string } }>('/portfolio/rebalance', async (request, reply) => {
    const { tenant_id } = request.authContext
    try {
      if (request.query.reset_hwm === 'true') {
        const db = await getDb()
        const signalsCol = await getSignalsCollection()
        const signals = await signalsCol
          .find({ tenant_id, signal_type: { $in: ['portfolio_position', 'portfolio_summary'] } })
          .sort({ created_at: -1 })
          .toArray()
        const snapshot = buildSnapshotFromSignals(tenant_id, signals)
        await db.collection('tenant_settings').updateOne(
          { tenant_id, key: 'portfolio_high_water_mark' },
          { $set: { tenant_id, key: 'portfolio_high_water_mark', value: { total_value: snapshot.totalValue, updated_at: new Date() }, updated_at: new Date() } },
          { upsert: true },
        )
      }
      const result = await runMomentumRebalanceForTenant(tenant_id)
      return reply.send(result)
    } catch (err) {
      return reply.status(500).send({ error: 'Rebalance failed', detail: err instanceof Error ? err.message : String(err) })
    }
  })

  /** GET /portfolio/calibration — per-detector accuracy dashboard for trading insights.
   *
   * Aggregates approved/dismissed trading insights and compares the decision price
   * to the latest market price to estimate hit rate and average return. */
  app.get('/portfolio/calibration', async (request, reply) => {
    const { tenant_id } = request.authContext
    const db = await getDb()

    const tradingDetectorIds = Object.keys(DETECTOR_LABELS)
    const insights = await db
      .collection('insights')
      .find({
        tenant_id,
        detector_id: { $in: tradingDetectorIds },
        state: { $in: ['completed', 'dismissed'] },
      })
      .sort({ created_at: -1 })
      .limit(500)
      .toArray()

    const tickers = new Set<string>()
    for (const insight of insights) {
      const ticker = (insight.feature_snapshot as Record<string, unknown> | undefined)?.ticker
      if (typeof ticker === 'string' && ticker) tickers.add(ticker)
    }

    const latestPrices = await loadLatestPrices(tenant_id, Array.from(tickers))

    const stats: Record<string, {
      detector_id: string
      label: string
      total: number
      approved: number
      dismissed: number
      hit: number
      miss: number
      avgReturnPct: number | null
      _returns: number[]
    }> = {}

    for (const detectorId of tradingDetectorIds) {
      stats[detectorId] = {
        detector_id: detectorId,
        label: DETECTOR_LABELS[detectorId]!,
        total: 0,
        approved: 0,
        dismissed: 0,
        hit: 0,
        miss: 0,
        avgReturnPct: null,
        _returns: [],
      }
    }

    const returns: number[] = []
    for (const insight of insights) {
      const detectorId = String(insight.detector_id)
      const stat = stats[detectorId]
      if (!stat) continue
      stat.total++

      if (insight.state === 'dismissed') {
        stat.dismissed++
        continue
      }
      stat.approved++

      const ticker = (insight.feature_snapshot as Record<string, unknown> | undefined)?.ticker
      if (typeof ticker !== 'string') continue
      const decisionPrice = (insight.feature_snapshot as Record<string, unknown> | undefined)?.current_price as number | undefined
      const latestPrice = latestPrices.get(ticker)
      if (!decisionPrice || !latestPrice) continue

      const returnPct = ((latestPrice - decisionPrice) / decisionPrice) * 100
      returns.push(returnPct)
      stat._returns.push(returnPct)

      // A "hit" is defined as the position moving in the recommended direction.
      // Direction comes from a fixed per-detector table (DETECTOR_DIRECTIONS),
      // not from regex-matching free-text action copy — the old regex never
      // matched any real trading detector's action text, so hit rate was
      // permanently 0%. See TRADING_ENGINE_GAPS.md gap #3.
      const direction = DETECTOR_DIRECTIONS[detectorId]
      if (direction === 'exit') {
        // Exit/trim/sell alert: a hit is a price decline (reducing avoided a loss).
        if (returnPct < 0) stat.hit++
        else stat.miss++
      } else if (direction === 'entry') {
        // Entry/buy/deploy alert: a hit is a price rise (buying captured a gain).
        if (returnPct > 0) stat.hit++
        else stat.miss++
      }
      // Detectors without a known direction (none today — all four are listed
      // in DETECTOR_DIRECTIONS) neither hit nor miss, preserving the existing
      // invariant that hit + miss <= approved.
    }

    const overallHitRate = insights.length > 0
      ? Object.values(stats).reduce((s, st) => s + st.hit, 0) /
        Math.max(1, Object.values(stats).reduce((s, st) => s + st.approved, 0))
      : null

    // Compute per-detector avgReturnPct and strip the internal _returns field
    const detectorStats = Object.values(stats).map((st) => {
      const { _returns, ...publicFields } = st
      return {
        ...publicFields,
        avgReturnPct: _returns.length > 0
          ? Number((_returns.reduce((a, b) => a + b, 0) / _returns.length).toFixed(2))
          : null,
      }
    })

    return reply.send({
      detectors: detectorStats,
      overall: {
        total: insights.length,
        approved: Object.values(stats).reduce((s, st) => s + st.approved, 0),
        dismissed: Object.values(stats).reduce((s, st) => s + st.dismissed, 0),
        hitRate: overallHitRate,
        avgReturnPct: returns.length > 0
          ? Number((returns.reduce((a, b) => a + b, 0) / returns.length).toFixed(2))
          : null,
      },
    })
  })

  /**
   * GET /portfolio/strategy-roi — money-weighted answer to "did following
   * Kairos's trade calls add anything over just holding?"
   *
   * The calibration dashboard already answers "was the direction right" as a
   * percentage; this route weights the same idea by actual position size to
   * produce a £ figure. For a sell/trim/reduce_exposure call, the
   * counterfactual is "what if I'd kept holding instead" — quantity × (price
   * when Kairos acted − latest price) is exactly the loss avoided (or, if
   * negative, the gain missed) by selling. For a buy/deploy call it's the
   * mirror: quantity × (latest price − price when Kairos acted).
   *
   * Uses the price recorded on the pending_trade at creation time, not a
   * confirmed broker fill price — Trading 212's execution report doesn't
   * come back through this integration, so a market order's real fill could
   * differ slightly (typically small, for liquid instruments, over the
   * 5-minute cancellation window). Included trades are 'executed' (real
   * money, only possible once KAIROS_ALLOW_LIVE_TRADING and the broker's
   * live-mode flag are both on) and 'logged' (every dry-run trade today,
   * while those switches are off) — kept separate in the response so the
   * two are never added together and presented as one number.
   */
  app.get('/portfolio/strategy-roi', async (request, reply) => {
    const { tenant_id } = request.authContext
    const db = await getDb()

    const trades = await db
      .collection('pending_trades')
      .find({ tenant_id, status: { $in: ['executed', 'logged'] } })
      .sort({ created_at: -1 })
      .limit(200)
      .toArray()

    const tickers = Array.from(new Set(trades.map((t) => String(t['ticker'] ?? '')).filter(Boolean)))
    const latestPrices = await loadLatestPrices(tenant_id, tickers)

    const rows = trades.map((t) => {
      const ticker = String(t['ticker'] ?? '')
      const quantity = Number(t['quantity'] ?? 0)
      const tradePrice = Number(t['price'] ?? 0)
      const latestPrice = latestPrices.get(ticker)
      const side = t['side'] as 'buy' | 'sell'
      const attributableMinor = latestPrice == null
        ? null
        : Math.round(side === 'sell' ? quantity * (tradePrice - latestPrice) : quantity * (latestPrice - tradePrice))

      return {
        tradeId: t['trade_id'],
        ticker,
        action: t['action'],
        quantity,
        tradePriceMinor: tradePrice,
        latestPriceMinor: latestPrice ?? null,
        valueMinor: t['value'],
        status: t['status'],
        isRealMoney: t['status'] === 'executed',
        createdAt: t['created_at'],
        attributableMinor,
      }
    })

    const sum = (predicate: (r: (typeof rows)[number]) => boolean) =>
      rows.filter((r) => r.attributableMinor != null && predicate(r))
        .reduce((total, r) => total + (r.attributableMinor ?? 0), 0)

    return reply.send({
      trades: rows,
      summary: {
        tradeCount: rows.length,
        pricedCount: rows.filter((r) => r.attributableMinor != null).length,
        realAttributableMinor: sum((r) => r.isRealMoney),
        dryRunAttributableMinor: sum((r) => !r.isRealMoney),
      },
    })
  })

  /** POST /portfolio/external-positions — add positions from a second broker manually.
   *
   * This lets users aggregate holdings across multiple brokers until those
   * brokers have their own Kairos connectors. Signals are stored with the
   * provided source so they can be distinguished from Trading 212 data. */
  const ExternalPositionSchema = z.object({
    source: z.string().min(1).default('external-broker'),
    accountType: z.string().optional(),
    positions: z.array(
      z.object({
        ticker: z.string(),
        quantity: z.number().int(),
        avg_price: z.number().int(),
        current_price: z.number().int(),
        currency: z.string().default('GBP'),
        account_type: z.string().optional(),
      }),
    ),
  })

  app.post<{ Body: z.infer<typeof ExternalPositionSchema> }>('/portfolio/external-positions', async (request, reply) => {
    const parsed = ExternalPositionSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid external positions', issues: parsed.error.issues })
    }
    const { tenant_id } = request.authContext
    const db = await getDb()
    const signals = db.collection('signals')
    const now = new Date()
    const { source, accountType, positions } = parsed.data
    const goal_kpi_targets = await buildGoalKpiTargets(db, tenant_id)

    const totalValue = positions.reduce((total, pos) => total + pos.quantity * pos.current_price, 0)
    const evaluatedInsights: Insight[] = []

    for (const pos of positions) {
      const positionValue = pos.quantity * pos.current_price
      const signalId = crypto.randomUUID()
      const data = {
        ...pos,
        account_type: pos.account_type ?? accountType ?? 'invest',
        position_value_minor: positionValue,
        portfolio_weight_pct: totalValue > 0 ? positionValue / totalValue * 100 : 0,
        current_price_gbp: pos.current_price / 100,
        avg_price_gbp: pos.avg_price / 100,
        drop_pct: pos.avg_price > 0 ? (pos.current_price - pos.avg_price) / pos.avg_price * 100 : 0,
        drop_from_avg_pct: pos.avg_price > 0 ? Math.abs(Math.min(0, (pos.current_price - pos.avg_price) / pos.avg_price * 100)) : 0,
        // Recovery fields default to 0 — the connector sync engine enriches
        // these by comparing to the prior sync's price. For manual uploads
        // there's no prior data to compare against.
        is_recovering: 0,
        recovery_pct: 0,
      }
      await signals.updateOne(
        { tenant_id, signal_type: 'portfolio_position', source, 'data.ticker': pos.ticker },
        {
          $set: {
            id: signalId,
            tenant_id,
            signal_type: 'portfolio_position',
            source,
            signal_hash: crypto.randomUUID(),
            created_at: now,
            data,
          },
        },
        { upsert: true },
      )

      const result = await engine.evaluate({
        event_type: 'portfolio_position',
        tenant_id,
        event_id: crypto.randomUUID(),
        data,
        goal_kpi_targets,
        derived_from_signals: [signalId],
      })
      evaluatedInsights.push(...result.insights)
    }

    const summarySignalId = crypto.randomUUID()
    const summaryData = {
      cash: 0,
      invested_value: totalValue,
      total_value: totalValue,
      currency: 'GBP',
      account_type: accountType ?? 'invest',
      cash_gbp: 0,
      cash_pct: 0,
    }
    await signals.updateOne(
      { tenant_id, signal_type: 'portfolio_summary', source },
      {
        $set: {
          id: summarySignalId,
          tenant_id,
          signal_type: 'portfolio_summary',
          source,
          signal_hash: crypto.randomUUID(),
          created_at: now,
          data: summaryData,
        },
      },
      { upsert: true },
    )

    const summaryResult = await engine.evaluate({
      event_type: 'portfolio_summary',
      tenant_id,
      event_id: crypto.randomUUID(),
      data: summaryData,
      goal_kpi_targets,
      derived_from_signals: [summarySignalId],
    })
    evaluatedInsights.push(...summaryResult.insights)
    if (evaluatedInsights.length > 0 && onInsightsGenerated) {
      await onInsightsGenerated(evaluatedInsights, tenant_id)
    }

    return reply.send({ ok: true, source, positions: positions.length, totalValue, insights_generated: evaluatedInsights.length })
  })

  app.get('/portfolio/external-positions', async (request, reply) => {
    const { tenant_id } = request.authContext
    const db = await getDb()
    const docs = await db
      .collection('signals')
      .find({ tenant_id, signal_type: 'portfolio_position', source: { $ne: 'trading-212' } })
      .sort({ created_at: -1 })
      .limit(200)
      .toArray()
    return reply.send({ positions: docs.map((d) => d.data) })
  })

  // ── Live trading opt-in + pending-trade execution ───────────────────────────
  // WARNING: Real-money order placement requires regulatory/compliance review.
  // The default mode is log-only. Even after opt-in, trades only execute when
  // KAIROS_ALLOW_LIVE_TRADING=true and broker credentials are in live mode.

  app.get('/portfolio/live-trading/status', async (request, reply) => {
    const { tenant_id } = request.authContext
    const optIn = await loadLiveTradingOptIn(tenant_id)
    const brokerLive = await isBrokerInLiveMode(tenant_id)
    const globalAllowed = process.env['KAIROS_ALLOW_LIVE_TRADING'] === 'true'
    const enabled = optIn?.enabled ?? false
    const ready = enabled && brokerLive && globalAllowed

    // Load strategy config overrides and portfolio tier
    const db = await getDb()
    let strategyConfig: { maxPositionWeight?: number; maxPositions?: number; minTradeValueMinor?: number; minPositionWeight?: number } | undefined
    let portfolioTier: 'small' | 'medium' | 'large' | undefined
    let portfolioValueMinor: number | undefined
    try {
      const cfgDoc = await db.collection('tenant_settings').findOne(
        { tenant_id, key: 'strategy_config' },
      )
      if (cfgDoc?.['value']) strategyConfig = cfgDoc['value'] as typeof strategyConfig

      // Detect portfolio value and tier
      const recentSignals = await db.collection('signals')
        .find({ tenant_id, signal_type: { $in: ['portfolio_summary', 'portfolio_position'] } })
        .sort({ created_at: -1 })
        .limit(100)
        .toArray()
      if (recentSignals.length > 0) {
        const snapshot = buildSnapshotFromSignals(tenant_id, recentSignals as Record<string, unknown>[])
        if (snapshot.totalValue > 0) {
          portfolioValueMinor = snapshot.totalValue
          portfolioTier = classifyPortfolioTier(snapshot.totalValue)
        }
      }
    } catch { /* best-effort */ }

    return reply.send({
      enabled,
      autoTradingEnabled: optIn?.autoTradingEnabled ?? false,
      maxOrderValueMinor: optIn?.maxOrderValueMinor,
      maxTradesPerDay: optIn?.maxTradesPerDay,
      ready,
      brokerLiveMode: brokerLive,
      globalAllowed,
      strategyConfig,
      portfolioTier,
      portfolioValueMinor,
      note: ready
        ? 'All three gates are on — trades that clear the order-value and daily-limit caps will place real orders with Trading 212.'
        : 'Real orders require three separate switches: tenant opt-in (this endpoint), the broker credential\'s live-mode flag, and the server\'s KAIROS_ALLOW_LIVE_TRADING env var. Until all three are on, trades are logged only — nothing is sent to the broker.',
    })
  })

  app.post<{ Body: LiveTradingOptIn }>('/portfolio/live-trading/opt-in', async (request, reply) => {
    const parsed = LiveTradingOptInSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid opt-in body', issues: parsed.error.issues })
    }
    const { tenant_id } = request.authContext

    // Backend vertical gate (defense in depth): live trading is only valid
    // for the trading-investment vertical. The frontend hides the UI for
    // other verticals, but a direct API call must be rejected independently.
    const canTrade = await tenantCanTrade(tenant_id)
    if (!canTrade) {
      return reply.status(403).send({
        error: 'Live trading is only available for the Trading & Investment vertical.',
      })
    }

    const db = await getDb()
    const value = { ...parsed.data, enabled: true, confirmedAt: new Date() }
    await db.collection('tenant_settings').updateOne(
      { tenant_id, key: 'live_trading_opt_in' },
      { $set: { tenant_id, key: 'live_trading_opt_in', value, updated_at: new Date() } },
      { upsert: true },
    )
    return reply.send({ ok: true, enabled: true, ready: process.env['KAIROS_ALLOW_LIVE_TRADING'] === 'true' })
  })

  app.post('/portfolio/live-trading/opt-out', async (request, reply) => {
    const { tenant_id } = request.authContext
    const db = await getDb()
    await db.collection('tenant_settings').updateOne(
      { tenant_id, key: 'live_trading_opt_in' },
      { $set: { tenant_id, key: 'live_trading_opt_in', value: { enabled: false }, updated_at: new Date() } },
      { upsert: true },
    )
    return reply.send({ ok: true, enabled: false })
  })

  /** POST /portfolio/live-trading/strategy-config — save position sizing overrides
   *
   * Stores the user's position sizing preferences in tenant_settings. These are
   * merged with portfolio-tier defaults at strategy execution time — user
   * overrides take precedence, tier defaults fill in any gaps.
   */
  app.post('/portfolio/live-trading/strategy-config', async (request, reply) => {
    const { tenant_id } = request.authContext
    const body = request.body as {
      maxPositionWeight?: number
      maxPositions?: number
      minTradeValueMinor?: number
      minPositionWeight?: number
    }
    // Strip undefined fields so we don't overwrite existing values with undefined
    const value: Record<string, number> = {}
    if (body.maxPositionWeight !== undefined && !Number.isNaN(body.maxPositionWeight)) {
      value.maxPositionWeight = Math.min(100, Math.max(1, body.maxPositionWeight))
    }
    if (body.maxPositions !== undefined && !Number.isNaN(body.maxPositions)) {
      value.maxPositions = Math.min(50, Math.max(0, Math.round(body.maxPositions)))
    }
    if (body.minTradeValueMinor !== undefined && !Number.isNaN(body.minTradeValueMinor)) {
      value.minTradeValueMinor = Math.min(1_000_000, Math.max(0, Math.round(body.minTradeValueMinor)))
    }
    if (body.minPositionWeight !== undefined && !Number.isNaN(body.minPositionWeight)) {
      value.minPositionWeight = Math.min(100, Math.max(0, body.minPositionWeight))
    }

    const db = await getDb()
    await db.collection('tenant_settings').updateOne(
      { tenant_id, key: 'strategy_config' },
      { $set: { tenant_id, key: 'strategy_config', value, updated_at: new Date() } },
      { upsert: true },
    )
    return reply.send({ ok: true, strategyConfig: value })
  })

  const TradeBodySchema = z.object({
    action: z.enum(['buy', 'sell', 'trim', 'hold', 'reduce_exposure', 'deploy_cash']),
    ticker: z.string().optional(),
    // Gap #23: allow fractional quantities — Trading 212 supports fractional
    // shares on some instruments. The manual path previously required
    // z.number().int(), which 400'd on fractional sell recommendations from
    // the simulator (e.g. DPW_US_EQ position quantity 3978.01919374). Both
    // paths now go through normalizeQuantity in createPendingTrade, which
    // rounds to 8 decimal places and rejects non-positive quantities.
    quantity: z.number().positive(),
    price: z.number().int().min(1),
    accountType: z.string().optional(),
    // Optional link to the goal this trade is helping to achieve.
    goal_id: z.string().optional(),
  })

  app.post<{ Body: z.infer<typeof TradeBodySchema> }>('/portfolio/trades', async (request, reply) => {
    const parsed = TradeBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid trade body', issues: parsed.error.issues })
    }
    const { tenant_id } = request.authContext
    const { tradeId, expiresAt, value, side } = await createPendingTrade(tenant_id, parsed.data, 'manual')
    return reply.status(201).send({ tenant_id, trade_id: tradeId, status: 'pending', ...parsed.data, value, side, expires_at: expiresAt })
  })

  app.get('/portfolio/trades', async (request, reply) => {
    const { tenant_id } = request.authContext
    const db = await getDb()
    const trades = await db
      .collection('pending_trades')
      .find({ tenant_id })
      .sort({ created_at: -1 })
      .limit(50)
      .toArray()
    return reply.send({ trades })
  })

  app.post<{ Params: { id: string } }>('/portfolio/trades/:id/cancel', async (request, reply) => {
    const { tenant_id } = request.authContext
    const { id } = request.params
    const db = await getDb()
    const result = await db.collection('pending_trades').updateOne(
      { tenant_id, trade_id: id, status: 'pending' },
      { $set: { status: 'cancelled', updated_at: new Date() } },
    )
    if (result.matchedCount === 0) {
      return reply.status(404).send({ error: 'Trade not found or already processed' })
    }
    return reply.send({ ok: true, status: 'cancelled' })
  })

  app.post<{ Params: { id: string } }>('/portfolio/trades/:id/confirm', async (request, reply) => {
    const { tenant_id, user_id } = request.authContext
    const { id } = request.params

    const result = await confirmPendingTrade(tenant_id, id, {
      type: 'user',
      userId: user_id,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    })

    if (result.status === 'not_found') return reply.status(404).send({ error: result.error })
    if (result.status === 'expired') return reply.status(410).send({ error: result.error })
    if (result.status === 'conflict') return reply.status(409).send({ error: result.error })
    if (result.status === 'cancelled') return reply.status(409).send({ error: result.error })
    // Gap #24: market is closed — the trade stays pending and can be retried
    // when the market opens. 409 Conflict (the trade's state conflicts with
    // the current market conditions, not with another request).
    if (result.status === 'market_closed') return reply.status(409).send({ error: result.error })

    return reply.send({ ok: true, status: result.status, receipt: result.receipt })
  })

  // ── EPIC-004: One-tap execution ────────────────────────────────────────────
  // Combines approval + trade confirmation in a single call. The approval
  // response is recorded, then the pending trade is immediately confirmed
  // (subject to all guard rails in confirmPendingTrade). If the trade fails
  // guard checks, the approval is still recorded but the trade stays pending.
  app.post<{
    Params: { id: string }
    Body: { approval_id?: string; notes?: string }
  }>('/portfolio/trades/:id/execute', async (request, reply) => {
    const { tenant_id, user_id } = request.authContext
    const { id } = request.params
    const { approval_id, notes } = request.body

    // Step 1: Record the approval if an approval_id is provided
    if (approval_id) {
      try {
        const db = await getDb()
        await db.collection('approvals').updateOne(
          { tenant_id, id: approval_id, status: 'pending' },
          { $set: { status: 'approved', approved_by: user_id, approved_at: new Date(), notes, updated_at: new Date() } },
        )
      } catch {
        // Approval recording is best-effort — the trade can still proceed
      }
    }

    // Step 2: Confirm the trade (runs all guard rails)
    const result = await confirmPendingTrade(tenant_id, id, {
      type: 'user',
      userId: user_id,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? '',
    })

    if (result.status === 'not_found') return reply.status(404).send({ error: result.error })
    if (result.status === 'expired') return reply.status(410).send({ error: result.error })
    if (result.status === 'conflict') return reply.status(409).send({ error: result.error })
    if (result.status === 'cancelled') return reply.status(409).send({ error: result.error })
    if (result.status === 'market_closed') return reply.status(409).send({ error: result.error })

    return reply.send({ ok: true, status: result.status, receipt: result.receipt, approval_recorded: !!approval_id })
  })

  /**
   * GET /portfolio/pie — fetch the Kairos-managed Trading 212 Pie.
   * Returns the pie id, name, and current instrument allocation. Returns
   * an empty response if no Kairos Pie exists yet.
   */
  app.get('/portfolio/pie', async (request, reply) => {
    const { tenant_id } = request.authContext
    const db = await getDb()
    const pie = await getKairosPie(db, tenant_id)
    return reply.send(pie)
  })

  /**
   * POST /portfolio/pie/sync — sync the strategy's target allocation to a
   * Trading 212 Pie. Creates a new Pie named "Kairos Momentum Strategy" if
   * one doesn't exist, or updates the existing one with the current target
   * weights.
   *
   * The target weights are derived from the momentum scores: each ticker's
   * weight is proportional to its momentum score, normalized to sum to 1.
   * This mirrors the strategy's rank-weighted deployment logic.
   */
  app.post('/portfolio/pie/sync', async (request, reply) => {
    const { tenant_id } = request.authContext
    const db = await getDb()

    // Load portfolio snapshot and market data
    const signalsCol = await getSignalsCollection()
    const signals = await signalsCol
      .find({
        tenant_id,
        signal_type: { $in: ['portfolio_position', 'portfolio_summary'] },
      })
      .sort({ created_at: -1 })
      .toArray()

    const snapshot = buildSnapshotFromSignals(tenant_id, signals)
    const { marketData } = await loadRecommendationMarketData(tenant_id, snapshot)
    const strategyConfig = await loadStrategyConfig(tenant_id)

    // Score the universe and build target weights from momentum scores
    const scores = scoreMomentumUniverse(snapshot, marketData, strategyConfig)
    const targetWeights = new Map<string, number>()

    // Use momentum score as weight, normalized to sum to 1
    const totalScore = scores.reduce((sum, s) => sum + Math.max(0, s.momentumScore), 0)
    for (const score of scores) {
      if (score.momentumScore > 0 && !score.missingMarketData) {
        targetWeights.set(score.ticker, score.momentumScore / Math.max(totalScore, 1))
      }
    }

    try {
      const result = await syncPieAllocation(db, tenant_id, targetWeights)
      if (result.pieId !== undefined) {
        await savePieId(db, tenant_id, result.pieId)
      }
      return reply.send({
        ok: true,
        pie_id: result.pieId,
        action: result.action,
        instruments: result.instruments,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: 'Pie sync failed', detail: msg })
    }
  })

  // ── EPIC-004: Rebalance preview ────────────────────────────────────────────
  // Returns current portfolio weights vs strategy target weights, drift per
  // position, and a list of suggested trades to rebalance. Read-only — does
  // not create or execute any trades.
  app.get('/portfolio/rebalance-preview', async (request, reply) => {
    const { tenant_id } = request.authContext
    const db = await getDb()

    try {
      // Fetch current holdings
      const holdingsDoc = await db.collection('portfolio_holdings').findOne({ tenant_id })
      const holdings = (holdingsDoc?.['holdings'] as Array<{
        ticker: string
        name?: string
        quantity: number
        avg_price: number
        current_price?: number
      }>) ?? []

      if (holdings.length === 0) {
        return reply.send({
          positions: [],
          target_weights: {},
          drift: [],
          suggested_trades: [],
          total_value: 0,
          max_drift_pct: 0,
          estimated_total_tax: 0,
          estimated_total_slippage: 0,
          tax_rate_pct: 20,
        })
      }

      // Fetch strategy target weights
      const strategyDoc = await db.collection('tenant_settings').findOne({ tenant_id })
      const targetWeights = (strategyDoc?.['strategy_config']?.['target_weights'] as Record<string, number>) ?? {}
      // Tenant-overridable CGT rate (Settings → Live Trading) — was a
      // hardcoded 20% assumption with no way to correct it. Same
      // tenant_settings document already fetched above, no extra query.
      const storedTaxRate = strategyDoc?.['tax_rate_pct']
      const taxRatePct = typeof storedTaxRate === 'number' ? storedTaxRate : 20

      // Calculate current weights
      const positions = holdings.map(h => {
        const price = h.current_price ?? h.avg_price
        return {
          ticker: h.ticker,
          name: h.name ?? h.ticker,
          quantity: h.quantity,
          current_price: price,
          value: price * h.quantity,
        }
      })
      const totalValue = positions.reduce((sum, p) => sum + p.value, 0)
      const currentWeights: Record<string, number> = {}
      for (const p of positions) {
        currentWeights[p.ticker] = totalValue > 0 ? p.value / totalValue : 0
      }

      // Calculate drift
      const drift = positions.map(p => {
        const currentWeight = currentWeights[p.ticker] ?? 0
        const targetWeight = targetWeights[p.ticker] ?? 0
        return {
          ticker: p.ticker,
          name: p.name,
          current_weight: currentWeight,
          target_weight: targetWeight,
          drift_pct: (currentWeight - targetWeight) * 100,
          value: p.value,
          quantity: p.quantity,
        }
      }).sort((a, b) => Math.abs(b.drift_pct) - Math.abs(a.drift_pct))

      // Generate suggested trades for positions with >5% drift
      // Include estimated tax impact and slippage for each trade
      const suggestedTrades = drift
        .filter(d => Math.abs(d.drift_pct) > 5)
        .map(d => {
          const targetValue = totalValue * d.target_weight
          const diff = targetValue - d.value
          const tradeValue = Math.abs(diff)
          const tradeQty = Math.round(tradeValue / d.current_weight > 0 ? (d.current_weight > 0 ? tradeValue / (d.value / d.quantity) : 0) : 0)
          const isSell = diff < 0
          // Estimate tax impact: only sells trigger CGT, at the tenant's
          // configured rate (default 20%, overridable in Settings → Live
          // Trading). Still a rough estimate — the actual gain depends on
          // the cost basis vs current price, which we approximate using
          // avg_price if available.
          const holding = holdings.find(h => h.ticker === d.ticker)
          const costBasis = holding ? holding.avg_price * tradeQty : 0
          const proceeds = d.value > 0 ? (d.value / d.quantity) * tradeQty : 0
          const estimatedGain = Math.max(0, proceeds - costBasis)
          const estimatedTax = isSell ? estimatedGain * (taxRatePct / 100) : 0
          // Estimate slippage: larger trades relative to position value
          // have higher slippage. Rough model: 0.05% base + 0.01% per
          // 1% of total portfolio value traded.
          const tradePctOfPortfolio = totalValue > 0 ? tradeValue / totalValue : 0
          const estimatedSlippagePct = 0.05 + (tradePctOfPortfolio * 100 * 0.01)
          const estimatedSlippageCost = tradeValue * (estimatedSlippagePct / 100)
          return {
            ticker: d.ticker,
            name: d.name,
            side: diff > 0 ? 'buy' : 'sell',
            quantity: tradeQty,
            value: tradeValue,
            reason: `${d.drift_pct > 0 ? 'Overweight' : 'Underweight'} by ${Math.abs(d.drift_pct).toFixed(1)}%`,
            estimated_tax: Math.round(estimatedTax),
            estimated_slippage_pct: Math.round(estimatedSlippagePct * 100) / 100,
            estimated_slippage_cost: Math.round(estimatedSlippageCost),
          }
        })

      const maxDriftPct = drift.length > 0 ? Math.max(...drift.map(d => Math.abs(d.drift_pct))) : 0

      // Aggregate cost estimates for the full rebalance
      const totalEstimatedTax = suggestedTrades.reduce((sum, t) => sum + (t.estimated_tax ?? 0), 0)
      const totalEstimatedSlippage = suggestedTrades.reduce((sum, t) => sum + (t.estimated_slippage_cost ?? 0), 0)

      return reply.send({
        positions: drift,
        target_weights: targetWeights,
        current_weights: currentWeights,
        drift,
        suggested_trades: suggestedTrades,
        total_value: totalValue,
        max_drift_pct: maxDriftPct,
        estimated_total_tax: totalEstimatedTax,
        estimated_total_slippage: totalEstimatedSlippage,
        tax_rate_pct: taxRatePct,
      })
    } catch (err) {
      request.log.error({ err }, 'Rebalance preview failed')
      return reply.status(500).send({ error: 'Failed to generate rebalance preview' })
    }
  })

  // ── Gap #30: Strategy eval endpoints ──────────────────────────────────────
  // Read-only access to the weekly eval reports produced by the cron jobs
  // in server.ts. The shadow backtest now runs per-tenant (using each
  // tenant's own Alpha Vantage connector credentials), so reports are
  // filtered by tenant_id. Falls back to tenant-agnostic reports (no
  // tenant_id field) for backward compatibility with older reports.

  /** GET /portfolio/strategy-eval/shadow-backtest — latest shadow backtest report */
  app.get('/portfolio/strategy-eval/shadow-backtest', async (request, reply) => {
    const { tenant_id } = request.authContext
    const db = await getDb()
    // Prefer the tenant's own report; fall back to legacy tenant-agnostic reports.
    const report = await db.collection('shadow_backtest_reports').findOne(
      { $or: [{ tenant_id }, { tenant_id: { $exists: false } }] },
      { sort: { run_at: -1 } },
    )
    if (!report) return reply.send({ report: null })
    return reply.send({
      report: {
        run_at: report['run_at'],
        mode: report['mode'],
        tickers: report['tickers'],
        initial_value: report['initial_value'],
        final_strategy_value: report['final_strategy_value'],
        final_benchmark_value: report['final_benchmark_value'],
        total_return_pct: report['total_return_pct'],
        benchmark_return_pct: report['benchmark_return_pct'],
        excess_return_pct: report['excess_return_pct'],
        annualized_strategy_return_pct: report['annualized_strategy_return_pct'],
        annualized_benchmark_return_pct: report['annualized_benchmark_return_pct'],
        evaluation_days: report['evaluation_days'],
        max_drawdown_pct: report['max_drawdown_pct'],
        benchmark_max_drawdown_pct: report['benchmark_max_drawdown_pct'],
        trade_count: report['trade_count'],
        rebalance_dates: report['rebalance_dates'],
      },
    })
  })

  /** POST /portfolio/strategy-eval/shadow-backtest/run — manually trigger a shadow backtest
   *
   * Runs the shadow backtest on demand for the calling tenant. Data source
   * priority: DB signals → yfinance → Alpha Vantage. No connector credentials
   * are strictly required — yfinance is free and needs no API key.
   *
   * Position sizing uses portfolio-tier defaults based on the tenant's actual
   * portfolio value, so small portfolios get fewer, larger positions.
   *
   * Returns the report directly (also persisted to shadow_backtest_reports).
   */
  app.post<{
    Body?: {
      tickers?: string[]
      strategy?: 'defensive' | 'momentum'
      riskConfigOverrides?: Record<string, unknown>
      historyLookbackDays?: number
      evaluationMonths?: number
    }
  }>('/portfolio/strategy-eval/shadow-backtest/run', async (request, reply) => {
    const { tenant_id } = request.authContext
    const db = await getDb()

    // Optional body lets a caller evaluate a candidate universe / strategy /
    // risk config before committing real money to it, instead of only ever
    // testing the hardcoded default universe with the defensive strategy.
    const body = request.body ?? {}
    const tickers = Array.isArray(body.tickers) && body.tickers.length > 0
      ? body.tickers.map((t) => String(t).trim().toUpperCase()).filter(Boolean)
      : undefined
    if (tickers && tickers.length > 40) {
      return reply.status(400).send({ error: 'At most 40 tickers may be backtested per run' })
    }
    const strategy = body.strategy === 'momentum' ? 'momentum' as const : undefined

    // Fetch the tenant's Alpha Vantage credentials (optional — used as fallback)
    let alphaVantageKey: string | undefined
    try {
      const cred = await db.collection('connector_credentials').findOne(
        { tenant_id, connector_id: 'alpha-vantage' },
      )
      if (cred?.['api_key']) {
        const { decryptIfNeeded } = await import('@kairos/platform')
        alphaVantageKey = decryptIfNeeded(cred['api_key'] as string) ?? undefined
      }
    } catch { /* AV is optional — yfinance and DB signals don't need it */ }

    // Fetch the tenant's actual portfolio value for tier-based sizing
    let portfolioValueMinor: number | undefined
    try {
      const recentSignals = await db.collection('signals')
        .find({ tenant_id, signal_type: { $in: ['portfolio_summary', 'portfolio_position'] } })
        .sort({ created_at: -1 })
        .limit(100)
        .toArray()
      if (recentSignals.length > 0) {
        const { buildSnapshotFromSignals } = await import('../trading/portfolio-data.js')
        const snapshot = buildSnapshotFromSignals(tenant_id, recentSignals as Record<string, unknown>[])
        if (snapshot.totalValue > 0) portfolioValueMinor = snapshot.totalValue
      }
    } catch { /* portfolio value lookup is best-effort */ }

    try {
      const { runShadowBacktestForReport } = await import('../jobs/shadow-backtest-runner.js')
      const report = await runShadowBacktestForReport({
        db,
        tenantId: tenant_id,
        alphaVantageKey,
        portfolioValueMinor,
        ...(tickers ? { tickers } : {}),
        ...(strategy ? { strategy } : {}),
        ...(body.riskConfigOverrides ? { riskConfigOverrides: body.riskConfigOverrides } : {}),
        ...(typeof body.historyLookbackDays === 'number' ? { historyLookbackDays: Math.min(3650, Math.max(365, Math.round(body.historyLookbackDays))) } : {}),
        ...(typeof body.evaluationMonths === 'number' ? { evaluationMonths: Math.min(120, Math.max(6, Math.round(body.evaluationMonths))) } : {}),
      })
      if (!report) {
        return reply.status(502).send({
          error: 'Shadow backtest returned no data',
          hint: 'All data sources failed (DB signals, yfinance, Alpha Vantage). Ensure at least one market data connector is connected and has synced data.',
        })
      }
      await db.collection('shadow_backtest_reports').insertOne(report)
      return reply.send({ report })
    } catch (err) {
      request.log.error({ err, tenant_id }, 'Manual shadow backtest failed')
      return reply.status(500).send({ error: 'Shadow backtest failed', detail: String(err) })
    }
  })

  /** GET /portfolio/strategy-eval/feature-hash — latest FeatureHashScorer eval reports */
  app.get('/portfolio/strategy-eval/feature-hash', async (_request, reply) => {
    const db = await getDb()
    // Get the latest report per detector
    const detectorIds = await db.collection('feature_hash_eval_reports').distinct('detector_id')
    const reports: Record<string, unknown>[] = []
    for (const detectorId of detectorIds) {
      const report = await db.collection('feature_hash_eval_reports').findOne(
        { detector_id: String(detectorId) },
        { sort: { run_at: -1 } },
      )
      if (report) reports.push(report)
    }
    return reply.send({ reports })
  })
}

/** Most recent live opportunity per ticker (and one portfolio-level fallback,
 * e.g. rebalance suggestions which fire on the account summary, not a position)
 * — built from real detector engine output, not a guess. */
interface Opportunity {
  label: string
  urgency?: 'low' | 'medium' | 'high' | 'critical'
  confidence?: number
}

function latestOpportunities(
  insights: Array<{
    detector_id: string
    feature_snapshot?: Record<string, unknown> | undefined
    urgency?: 'low' | 'medium' | 'high' | 'critical'
    confidence_breakdown?: { combined_score?: number } | undefined
  }>,
): { byTicker: Map<string, Opportunity>; portfolioLevel: Opportunity | undefined } {
  const byTicker = new Map<string, Opportunity>()
  let portfolioLevel: Opportunity | undefined
  for (const insight of insights) {
    const label = DETECTOR_LABELS[insight.detector_id]
    if (!label) continue
    const opportunity: Opportunity = {
      label,
      urgency: insight.urgency,
      confidence: insight.confidence_breakdown?.combined_score,
    }
    const ticker = insight.feature_snapshot?.['ticker']
    if (typeof ticker === 'string' && ticker) {
      if (!byTicker.has(ticker)) byTicker.set(ticker, opportunity)
    } else if (!portfolioLevel) {
      portfolioLevel = opportunity
    }
  }
  return { byTicker, portfolioLevel }
}

function buildHoldingsFromSignals(
  tenantId: string,
  signals: Record<string, unknown>[],
  insights: Array<{
    detector_id: string
    feature_snapshot?: Record<string, unknown> | undefined
    urgency?: 'low' | 'medium' | 'high' | 'critical'
    confidence_breakdown?: { combined_score?: number } | undefined
  }>,
): TradingHolding[] {
  // `signals` holds one document per sync cycle, not one per ticker — a
  // position that hasn't changed still gets a fresh doc each poll if any
  // volatile field (price, pnl) differs by even a fraction. Sorted
  // newest-first upstream, so keep only the first (latest) doc per ticker;
  // otherwise a single real holding renders as N duplicate rows here.
  const latestPositionByTicker = new Map<string, Record<string, unknown>>()
  for (const s of signals) {
    if (s.signal_type !== 'portfolio_position') continue
    const data = s.data as Record<string, unknown> | undefined
    if (!data) continue
    const ticker = String(data.ticker ?? '')
    if (!ticker || latestPositionByTicker.has(ticker)) continue
    latestPositionByTicker.set(ticker, data)
  }
  const positions = [...latestPositionByTicker.values()]

  const summaries = signals
    .filter((s) => s.signal_type === 'portfolio_summary')
    .map((s) => s.data as Record<string, unknown> | undefined)
    .filter((d): d is Record<string, unknown> => d !== null && d !== undefined)

  const metadataByTicker = new Map<string, Record<string, unknown>>()
  for (const s of signals.filter((s) => s.signal_type === 'instrument_metadata')) {
    const data = s.data as Record<string, unknown> | undefined
    if (!data) continue
    const ticker = String(data.ticker ?? '')
    if (ticker) metadataByTicker.set(ticker, data)
  }

  const reportedTotalValue = summaries.length > 0 ? Number(summaries[0]?.total_value ?? 0) : 0

  const cashSummary = summaries.find((s) => s.cash !== undefined)
  if (cashSummary) {
    const cash = Number(cashSummary.cash ?? 0)
    if (cash > 0) {
      positions.push({
        ticker: 'CASH',
        name: 'Idle cash',
        asset_class: 'cash',
        quantity: 0,
        current_price: cash,
        avg_price: cash,
        unrealised_pnl: 0,
        currency: String(cashSummary.currency ?? 'GBP'),
      })
    }
  }

  // Compute the true total portfolio value as the sum of all position market
  // values (including cash). Trading 212's account-summary total_value can
  // drift from the sum of individual positions because the two API calls
  // happen at slightly different times and prices move between them — this
  // drift caused portfolio weights to sum to >100% (e.g. 120.9%) because the
  // denominator was smaller than the actual sum of holdings. Computing the
  // total from the positions themselves guarantees weights always sum to
  // exactly 100%. We still keep reportedTotalValue for display purposes.
  let computedTotalValue = 0
  for (const pos of positions) {
    const currentPrice = Number(pos.current_price ?? 0)
    const quantity = Number(pos.quantity ?? 0)
    computedTotalValue += pos.asset_class === 'cash' ? currentPrice : currentPrice * quantity
  }
  // Fall back to the reported total only if we somehow have no positions
  const totalValue = Math.max(1, computedTotalValue > 0 ? computedTotalValue : reportedTotalValue)

  const { byTicker, portfolioLevel } = latestOpportunities(insights)

  return positions.map((pos, index) => {
    const ticker = String(pos.ticker ?? '')
    const meta = metadataByTicker.get(ticker)
    const currentPrice = Number(pos.current_price ?? 0)
    const avgPrice = Number(pos.avg_price ?? 0)
    const quantity = Number(pos.quantity ?? 0)
    // The synthetic CASH position (pushed above) has no share quantity — its
    // cash amount is stored in current_price with quantity: 0, so the normal
    // price * quantity formula always zeroed out its market value and weight.
    const marketValue = pos.asset_class === 'cash' ? currentPrice : currentPrice * quantity
    const weight = totalValue > 0 ? (marketValue / totalValue) * 100 : 0
    const dayChange = currentPrice - avgPrice
    const dayChangePercent = avgPrice > 0 ? (dayChange / avgPrice) * 100 : 0

    const assetClass = (meta?.asset_class ?? pos.asset_class ?? 'stock') as AssetClass
    const name = String(meta?.name ?? pos.name ?? ticker)
    const currency = String(meta?.currency ?? pos.currency ?? 'GBP')
    const accountType = (pos.account_type ?? meta?.account_type) as string | undefined
    const sector = meta?.sector ? String(meta.sector) : undefined

    const opportunity = byTicker.get(ticker) ?? (assetClass === 'cash' ? portfolioLevel : undefined)

    return {
      id: `${tenantId}:${ticker}:${index}`,
      ticker,
      name,
      assetClass,
      currentPriceMinor: currentPrice,
      dayChangeMinor: dayChange,
      dayChangePercent: Number(dayChangePercent.toFixed(2)),
      portfolioWeightPercent: Number(weight.toFixed(2)),
      concentrationFlag: weight > 10,
      dividendYieldPercent: meta?.dividend_yield_pct !== undefined ? Number(meta.dividend_yield_pct) : undefined,
      // No real news data source is connected — showing a random headline here
      // would be fabricated content on a live financial account, so this stays
      // unset until an actual news connector exists.
      newsSignal: undefined,
      opportunityDetector: opportunity?.label,
      opportunityUrgency: opportunity?.urgency,
      opportunityConfidence: opportunity?.confidence,
      currency,
      accountType,
      sector,
    }
  })
}
