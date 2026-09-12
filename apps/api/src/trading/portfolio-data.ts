/**
 * Shared portfolio-data loaders for the Trading & Investment vertical.
 *
 * Extracted out of apps/api/src/routes/portfolio.ts so the same
 * snapshot/market-data/strategy-config/live-trading-opt-in logic can be
 * reused by both the HTTP routes and the autonomous-trading path
 * (apps/api/src/trading/auto-trade.ts, apps/api/src/trading/trade-confirmation.ts)
 * without duplicating (and risking drift in) the underlying queries.
 */

import { z } from 'zod'
import { getDb, getSignalsCollection } from '../db.js'
import { getTenantCollection } from '@kairos/platform'
import type { PortfolioSnapshot, MarketData } from '@kairos/engine'

export const StrategyConfigSchema = z.object({
  enabled: z.boolean().default(true),
  // Strategy selection: 'defensive' (capital preservation, default) or
  // 'momentum' (aggressive trend-following). The auto-trader branches on
  // this to call generateDefensiveTrendRecommendations or
  // generateMomentumRecommendations. Changing this mid-stream does not
  // retroactively change existing pending trades — only new ones.
  strategy: z.enum(['defensive', 'momentum']).default('defensive'),
  // Paper mode: when true, the auto-trader creates pending trades and the
  // confirmation sweep logs what would have executed, but no real broker
  // call is made. Defaults to true — tenants must explicitly opt into live
  // execution by setting this to false in their tenant_settings doc.
  paper_mode: z.boolean().default(true),
  maxPositionWeight: z.number().min(1).max(100).default(10),
  targetVolatility: z.number().min(1).max(100).default(10),
  cashDeployThreshold: z.number().min(0).max(100).default(5),
  stopLossThreshold: z.number().min(0).max(1).default(0.10),
  minLookback: z.number().int().min(20).default(63),
  qualityWeight: z.number().min(0).max(1).default(0.35),
  momentumWeight: z.number().min(0).max(1).default(0.40),
  volatilityWeight: z.number().min(0).max(1).default(0.25),
  // Momentum strategy knobs (ignored when strategy = 'defensive')
  // Defaults lowered from 0.5/1 to 0.45/3 — the old values were too
  // conservative, causing the defensive strategy to make 0-1 trades in 6
  // months of backtesting vs a 34% benchmark return. The engine code's own
  // defaults were already updated (defensiveTrendFollowing.ts) but the schema
  // default enforced here was still using the old values, overriding the
  // engine defaults for tenants without an explicit config.
  // Lowered further to 0.35: the reddy003 tenant had £39K (37%) idle cash
  // for 10 days with zero deployment at 0.45 — still too conservative.
  cashDeployScoreThreshold: z.number().min(0).max(1).default(0.35),
  sellScoreThreshold: z.number().min(0).max(1).default(0.3),
  trimScoreThreshold: z.number().min(0).max(1).default(0.5),
  momentumLookbackDays: z.number().int().min(10).default(252),
  maxCashDeployTickers: z.number().int().min(1).max(20).default(3),
  reduceExposurePct: z.number().min(0).max(1).default(0.20),
  addCashFraction: z.number().min(0).max(1).default(0.25),
  trailingStopThreshold: z.number().min(0).max(1).default(0.15),
  addMomentumThreshold: z.number().min(0).max(1).default(0.15),
  sellMomentumThreshold: z.number().min(-1).max(1).default(0),
  // Live-trading safety: if the portfolio's total value drops this far below
  // its recorded high-water mark, the weekly rebalance job auto-disables
  // auto-trading and writes an audit alert. Expressed as a fraction (0.10 =
  // 10% drawdown). Default 0 = disabled (backwards compat for existing
  // tenants). Set to 0.10 for live momentum trading.
  autoDisableDrawdownPct: z.number().min(0).max(0.5).default(0),
  // Phase 1-3 strategy enhancement knobs (review wiring fix PR #220: the zod
  // schema strips unknown keys, so these engine config fields were silently
  // dropped from tenant configs — the enhancements could never be enabled).
  // All default to disabled/neutral so existing tenants are unaffected.
  // Enabled by default for new strategy configurations. Existing stored
  // values remain authoritative, so changing these defaults does not silently
  // rewrite a tenant's explicit settings.
  volScaleTargetVol: z.number().min(0).max(1).default(0.15),
  volScaleMin: z.number().min(0.05).max(1).default(0.35),
  volScaleMax: z.number().min(1).max(5).default(1.25),
  volScaleLookbackDays: z.number().int().min(20).max(504).default(126),
  week52HighWeight: z.number().min(0).max(1).default(0.2),
  fastLookbackDays: z.number().int().min(0).max(252).default(63),
  mediumLookbackDays: z.number().int().min(0).max(252).default(126),
  slowLookbackDays: z.number().int().min(0).max(504).default(252),
  fastWeight: z.number().min(0).max(1).default(0.25),
  mediumWeight: z.number().min(0).max(1).default(0.35),
  slowWeight: z.number().min(0).max(1).default(0.4),
  marketStateGateEnabled: z.boolean().default(true),
  marketStateGateTicker: z.string().default('SPY_US_EQ'),
  marketStateGateThreshold: z.number().min(-1).max(0).default(-0.05),
  marketStateGateCutoff: z.number().min(-1).max(0).default(-0.20),
  // Turnover reduction: only rebalance when the score or weight has changed
  // materially since the last rebalance. Default 0.05 (5%) — prevents the
  // strategy from trimming winners every cycle just because they grew 1% past
  // the position cap, while still acting on genuine drift. Sells and
  // stop-losses are never filtered (filterByTurnover always passes them).
  minScoreChangeForRebalance: z.number().min(0).max(1).default(0.05),
  minWeightDriftForRebalance: z.number().min(0).max(1).default(0.05),
  crossSectionalWeight: z.number().min(0).max(1).default(0.35),
  sentimentWeight: z.number().min(0).max(1).default(0),
  spreadBps: z.number().min(0).max(500).default(0),
  commissionBps: z.number().min(0).max(500).default(0),
  marketImpactBps: z.number().min(0).max(500).default(0),
  maxExpectedTradeReturnBps: z.number().min(1).max(1000).default(50),
  // Rank-based momentum scoring: when true, the momentum engine replaces the
  // saturating sigmoid score with a percentile-rank score across the universe.
  // Fixes tail-blindness (NVDA +150% scores higher than +35% instead of
  // identically) and is regime-adaptive (best relative performers still rank
  // high in bear markets). Default false for backward compat — enable for
  // tenants who want the strategy to concentrate capital in the strongest
  // trends rather than treating all "good" stocks as equal.
  rankBasedScoring: z.boolean().default(false),
  // Alpha-mining signal weight: blends short-term signals (RSI, Bollinger
  // breakout, momentum surge, gap continuation, VCP) with the long-term
  // momentum score to mine more trade opportunities. 0 = disabled (pure
  // long-term momentum). Recommended: 0.20 for balanced, 0.30 for aggressive
  // short-term trading. Higher values generate more trades with higher
  // turnover — good for capturing short-term moves, but increases costs.
  alphaSignalWeight: z.number().min(0).max(0.5).default(0),
  // Asymmetric turnover banding: higher hurdle for entering new positions.
  // Exits and stop-losses still use minScoreChangeForRebalance. Evidence
  // (JPM 2019): banding cuts transaction costs more than reducing rebalance
  // frequency, keeping exposure to the signal while raising the entry bar.
  minScoreChangeForRebalanceEntry: z.number().min(0).max(0.5).default(0),
  // Absolute momentum filter: only deploy/add to stocks with positive absolute
  // momentum (their own 21+ day return is positive). This is the absolute leg
  // of dual momentum and prevents "best of a bad bunch" buys in broad declines.
  absoluteMomentumFilter: z.boolean().default(false),
  // Rank-weighted cash deployment: concentrate cash in the top-scoring
  // candidates instead of equal-weighting. The #1 pick gets ~40% more capital
  // than #5, matching evidence that top-decile momentum names drive most
  // momentum profits.
  rankWeightedDeployment: z.boolean().default(false),
  // ML ensemble signal weight: blends each asset's momentum score with a
  // cross-sectional ridge regression prediction trained on-the-fly from price
  // history. Adds a machine-learning layer on top of momentum and alpha-mining
  // without requiring external ML libraries or persisted model artifacts.
  // Recommended: 0.15 for balanced, 0.25 for aggressive. 0 = disabled.
  mlEnsembleWeight: z.number().min(0).max(0.5).default(0),
  // Kelly criterion position sizing: scales target weights by the Kelly
  // fraction (edge / odds) instead of using a fixed maxPositionWeight. Uses
  // academic default parameters (55% win rate, 1.3 win/loss ratio) until
  // enough live trades accumulate for calibration.
  kellyEnabled: z.boolean().default(false),
  // Fraction of full Kelly to use. 0.5 = half-Kelly (recommended — 75% of
  // optimal growth at 50% of drawdown). 1.0 = full Kelly (maximum growth,
  // high drawdowns). 0.25 = quarter-Kelly (conservative).
  kellyScale: z.number().min(0.1).max(2.0).default(0.5),
  // Minimum closed trades before using live edge estimates instead of
  // academic defaults. Below this, the defaults are used.
  kellyMinTrades: z.number().min(0).max(200).default(20),
  // Regime-aware momentum overrides: detect bull/bear/sideways from the market
  // index and tune momentum parameters dynamically. In bear/sideways regimes,
  // the engine tightens stops, lowers concentration limits, and raises the
  // alpha-mining weight to favor mean-reversion signals.
  regimeAwareMomentum: z.boolean().default(false),
  // Market-index ticker used for regime detection. SPY is the standard US
  // equity benchmark; VUAG is the UK-listed Vanguard S&P 500 UCITS ETF.
  regimeMarketTicker: z.string().default('SPY_US_EQ'),
  // Sector concentration cap: maximum exposure to any single sector as a
  // percentage of total portfolio value. Prevents the portfolio from becoming
  // a single-sector bet (e.g. 90% in semiconductors). 0 = disabled.
  maxSectorWeight: z.number().min(0).max(100).default(0),
  // Phase 5: ATR-based adaptive trailing stops. Computes stop percentage
  // per-ticker from its volatility rather than a fixed percentage.
  atrBasedStops: z.boolean().default(false),
  atrMultiplier: z.number().min(1).max(10).default(3.0),
  atrMinStop: z.number().min(0.05).max(0.30).default(0.10),
  atrMaxStop: z.number().min(0.20).max(0.80).default(0.50),
  // Phase 5: Bear regime hedge with inverse ETF
  bearRegimeHedge: z.boolean().default(false),
  bearRegimeHedgeTicker: z.string().optional(),
  bearRegimeHedgeMaxPct: z.number().min(0).max(0.50).default(0.30),

  // Fractional shares: when true, the simulator rounds quantities to 6 decimal
  // places instead of flooring to whole shares. Trading 212 supports fractional
  // shares, so this should be true for tenants using the Trading 212 connector.
  // Default false for backward compat with brokers that don't support them.
  fractionalShares: z.boolean().default(false),
  // Tax wrapper config — injected at runtime from the tenant's country (not
  // stored in tenant_settings). These fields are optional so the schema can
  // parse stored configs that don't have them (backward compat).
  taxAdvantagedAccountType: z.string().optional(),
  taxableAccountType: z.string().optional(),
  taxWrapperName: z.string().optional(),
})

export type StrategyConfig = z.infer<typeof StrategyConfigSchema>

export async function loadStrategyConfig(tenantId: string): Promise<StrategyConfig> {
  const db = await getDb()
  const doc = await getTenantCollection<Record<string, unknown>>(db, 'tenant_settings', tenantId)
    .findOne({ key: 'defensive_trend_strategy' })
  const value = (doc?.value as Record<string, unknown> | undefined) ?? {}
  return StrategyConfigSchema.parse(value)
}

/**
 * Platform-level ceiling for the maximum order value a tenant can set.
 * £10,000 (1,000,000 minor units) — this is a retail SMB platform, not
 * institutional trading. The UI should also clamp to this value.
 */
export const MAX_ORDER_VALUE_MINOR = 1_000_000 // £10,000

/**
 * Platform-level ceiling for the maximum number of trades per day a tenant
 * can set. 20 is more than enough for a retail investor using autonomous
 * trading; anything higher would defeat the purpose of the guardrail.
 */
export const MAX_TRADES_PER_DAY = 20

export const LiveTradingOptInSchema = z.object({
  enabled: z.boolean(),
  confirmedAt: z.string().datetime().or(z.date()).optional(),
  method: z.enum(['email', 'totp', 'manual']).default('manual'),
  // Gap #10 (TRADING_ENGINE_GAPS.md): both fields were .optional() with no
  // default and no minimum enforced by the API schema. evaluateTradeExecution
  // fell back to Number.MAX_SAFE_INTEGER when unset, and skipped the daily
  // check entirely when maxTradesPerDay was undefined — a direct POST to
  // /portfolio/live-trading/opt-in could enable live trading with no caps.
  // Now both are required with sane server-side defaults: £50 (5000 minor)
  // per order, 1 trade per day — matching the Studio UI's existing defaults.
  //
  // Platform ceilings (MAX_ORDER_VALUE_MINOR / MAX_TRADES_PER_DAY) prevent a
  // user from setting unreasonably high caps that would defeat the purpose of
  // having guardrails. These are server-enforced — the UI also clamps the
  // input fields, but the API must enforce independently (defense in depth).
  maxOrderValueMinor: z.number().int().min(1).max(MAX_ORDER_VALUE_MINOR).default(5000),
  maxTradesPerDay: z.number().int().min(1).max(MAX_TRADES_PER_DAY).default(1),
  autoTradingEnabled: z.boolean().default(false),
})

export type LiveTradingOptIn = z.infer<typeof LiveTradingOptInSchema>

export async function loadLiveTradingOptIn(tenantId: string): Promise<LiveTradingOptIn | null> {
  const db = await getDb()
  const doc = await getTenantCollection<Record<string, unknown>>(db, 'tenant_settings', tenantId)
    .findOne({ key: 'live_trading_opt_in' })
  if (!doc) return null
  const parsed = LiveTradingOptInSchema.safeParse(doc.value)
  return parsed.success ? parsed.data : null
}

/**
 * The tenant's active vertical ID (e.g. 'trading-investment',
 * 'property-wealth', 'smb-operations', 'audience-growth'), or null if no
 * vertical has been activated yet.
 *
 * Live trading and autonomous trading are only valid for the
 * 'trading-investment' vertical. This helper is the backend gate that
 * prevents a tenant on a non-trading vertical from enabling auto-trading
 * — the frontend conditionally hides the UI, but the API must enforce it
 * independently (defense in depth).
 */
export async function loadTenantVertical(tenantId: string): Promise<string | null> {
  const db = await getDb()
  const doc = await getTenantCollection<Record<string, unknown>>(db, 'tenant_settings', tenantId)
    .findOne()
  return (doc?.['active_vertical'] as string | undefined) ?? null
}

/** The vertical ID that is allowed to use live/autonomous trading. */
export const TRADING_VERTICAL_ID = 'trading-investment'

/**
 * Defense-in-depth check: returns true only when the tenant's active
 * vertical is the trading vertical. Used by the opt-in endpoint and the
 * trade-confirmation path to reject live/autonomous trading for tenants
 * on other verticals, regardless of what the UI shows.
 */
export async function tenantCanTrade(tenantId: string): Promise<boolean> {
  const vertical = await loadTenantVertical(tenantId)
  return vertical === TRADING_VERTICAL_ID
}

export async function isBrokerInLiveMode(tenantId: string): Promise<boolean> {
  const db = await getDb()
  const creds = await getTenantCollection<Record<string, unknown>>(db, 'connector_credentials', tenantId)
    .findOne({ connector_id: 'trading-212' })
  const extra = creds?.extra as Record<string, unknown> | undefined
  if (extra?.live_mode === true || extra?.live_mode === 'true') return true
  if (creds?.live_mode === true || creds?.live_mode === 'true') return true
  return false
}

export function buildSnapshotFromSignals(
  tenantId: string,
  signals: Record<string, unknown>[],
): PortfolioSnapshot {
  const summaries = signals
    .filter((s) => s.signal_type === 'portfolio_summary')
    .map((s) => s.data as Record<string, unknown> | undefined)
    .filter((d): d is Record<string, unknown> => d !== null && d !== undefined)

  const summary = summaries[0] ?? {}
  const reportedTotalValue = Number(summary.total_value ?? 0)
  const cash = Number(summary.cash ?? 0)

  const positionsByTicker = new Map<string, Record<string, unknown>>()
  for (const s of signals.filter((s) => s.signal_type === 'portfolio_position')) {
    const data = s.data as Record<string, unknown> | undefined
    if (!data) continue
    const ticker = String(data.ticker ?? '')
    if (!ticker || ticker === 'CASH') continue
    const existing = positionsByTicker.get(ticker)
    if (!existing || (s.created_at instanceof Date && existing.created_at instanceof Date && s.created_at > existing.created_at)) {
      positionsByTicker.set(ticker, { ...data, created_at: s.created_at })
    }
  }

  const positions: PortfolioSnapshot['positions'] = Array.from(positionsByTicker.values())
    .filter((data) => {
      // Filter out zero-quantity positions — these are stale signals from
      // positions that were sold or never actually held. Without this filter,
      // the momentum strategy sees phantom positions with 0 price/quantity,
      // generates SELL recommendations for them, and the broker rejects the
      // orders ("Selling more equities than owned"). This wastes every
      // rebalance cycle on phantom sells instead of deploying cash.
      const qty = Number(data.quantity ?? 0)
      return qty > 0
    })
    .map((data) => ({
    ticker: String(data.ticker ?? ''),
    quantity: Number(data.quantity ?? 0),
    avgPrice: Number(data.avg_price ?? 0),
    currentPrice: Number(data.current_price ?? 0),
    accountType: data.account_type as string | undefined,
    // Gap #9 (TRADING_ENGINE_GAPS.md): thread asset_class through from the
    // portfolio_position signal so the scoring engine can skip or re-weight
    // non-equity assets. Defaults to 'stock' when not present (backward
    // compatible — existing positions without asset_class are treated as
    // stocks, which is the current behavior).
    assetClass: (data.asset_class as 'stock' | 'etf' | 'cash' | 'commodity' | 'cryptocurrency' | undefined) ?? 'stock',
  }))

  // Compute the true total portfolio value as the sum of all position market
  // values plus cash. Trading 212's account-summary total_value can drift
  // from this sum because the account summary and portfolio positions are
  // fetched at slightly different times and prices move between them. This
  // drift caused portfolio weights to sum to >100% because the denominator
  // was smaller than the actual sum of holdings. Computing from positions
  // guarantees weights always sum to exactly 100%.
  const positionsValue = positions.reduce((sum, p) => sum + p.currentPrice * p.quantity, 0)
  const totalValue = positionsValue + cash > 0 ? positionsValue + cash : reportedTotalValue

  // Cash fallback: if the portfolio_summary signal reports cash=0 but there
  // are no positions (or all positions were filtered out as zero-quantity),
  // the entire account value is uninvested cash. The Trading212 connector's
  // Cash resource (/equity/account/cash) sometimes fails to sync or the
  // field mapping doesn't populate the cash field — without this fallback,
  // the momentum strategy sees cashPct=0% and never deploys cash into new
  // positions, leaving the entire portfolio uninvested indefinitely.
  const effectiveCash = (cash === 0 && positions.length === 0 && totalValue > 0)
    ? totalValue
    : cash

  return { tenantId, totalValue, cash: effectiveCash, positions }
}

export interface PortfolioValuePoint {
  date: string // YYYY-MM-DD
  totalValue: number
}

/**
 * Daily portfolio-value history for the Research page's hero chart.
 *
 * The connector sync cron writes a fresh `portfolio_summary` signal every 15
 * minutes, so a tenant with any real sync history has many docs per day —
 * charting every one would be a noisy, meaningless zigzag driven by sync
 * timing rather than the market. Keeps the last `total_value` seen on each
 * UTC calendar day (that day's closing snapshot), same granularity every
 * daily-value chart in this space (Robinhood, Wealthfront) uses by default.
 */
export async function loadPortfolioValueHistory(tenantId: string, days = 90): Promise<PortfolioValuePoint[]> {
  const signalsCol = await getSignalsCollection()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const docs = await signalsCol
    .find({
      tenant_id: tenantId,
      signal_type: 'portfolio_summary',
      'data.total_value': { $exists: true },
      created_at: { $gte: since },
    })
    .sort({ created_at: 1 })
    .toArray()

  const byDay = new Map<string, number>()
  for (const doc of docs) {
    const data = doc.data as Record<string, unknown> | undefined
    const totalValue = Number(data?.['total_value'] ?? NaN)
    if (!Number.isFinite(totalValue)) continue
    const createdAt = doc.created_at instanceof Date ? doc.created_at : new Date(doc.created_at as string)
    const date = createdAt.toISOString().slice(0, 10)
    byDay.set(date, totalValue) // later docs overwrite earlier ones — last value of the day wins
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, totalValue]) => ({ date, totalValue }))
}

/** Build a ticker → price history map from stored signals.
 *
 * Reads both `portfolio_position` snapshots and `market_price` records. Market
 * prices take precedence because they carry an explicit trading date. The
 * engine needs at least ~63 daily observations to compute momentum and
 * volatility. For a new connector that has not yet accumulated history, the
 * recommendation output will reflect the limited data honestly. */
export async function buildMarketDataFromSignals(
  tenantId: string,
  tickers: string[],
  lookbackDays = 365,
): Promise<Map<string, MarketData>> {
  const signalsCol = await getSignalsCollection()
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
  const marketData = new Map<string, MarketData>()

  for (const ticker of tickers) {
    const docs = await signalsCol
      .find({
        tenant_id: tenantId,
        signal_type: { $in: ['portfolio_position', 'market_price'] },
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

    const history = Array.from(byDate.entries())
      .map(([date, close]) => ({ date, close }))
      .sort((a, b) => a.date.localeCompare(b.date))

    if (history.length >= 2) {
      marketData.set(ticker, { ticker, history })
    }

    // Gap #6 (TRADING_ENGINE_GAPS.md): fetch the latest company_fundamentals
    // signal for this ticker and attach gross_profitability to the MarketData
    // entry. This is what computeQualityScore uses — replacing the hardcoded
    // quality = 0.5 placeholder. If no fundamentals data exists yet (e.g.
    // the quarterly sync hasn't run), grossProfitability stays undefined and
    // computeQualityScore falls back to a neutral 0.5.
    const fundamentalsDoc = await signalsCol
      .find({
        tenant_id: tenantId,
        signal_type: 'company_fundamentals',
        'data.ticker': ticker,
      })
      .sort({ created_at: -1 })
      .limit(1)
      .toArray()
    const fundamentalsData = fundamentalsDoc[0]?.data as {
      gross_profitability?: number
      roe?: number
      gross_margin?: number
      debt_to_equity?: number
    } | undefined
    if (fundamentalsData) {
      const existing = marketData.get(ticker)
      if (existing) {
        if (fundamentalsData.gross_profitability !== undefined) existing.grossProfitability = fundamentalsData.gross_profitability
        // Phase 2 enhanced fundamentals (review wiring fix): populate ROE,
        // gross margin, and leverage when the fundamentals signal carries them
        // (Finnhub /stock/metric via the finnhub_financial_metrics transform).
        if (fundamentalsData.roe !== undefined) existing.roe = fundamentalsData.roe
        if (fundamentalsData.gross_margin !== undefined) existing.grossMargin = fundamentalsData.gross_margin
        if (fundamentalsData.debt_to_equity !== undefined) existing.debtToEquity = fundamentalsData.debt_to_equity
      }
    }

    // Phase 2 sentiment (review wiring fix): fetch the latest sentiment_score
    // signal (Finnhub /news-sentiment) and attach it to MarketData. Neutral
    // 0.5 is used downstream when absent.
    const sentimentDoc = await signalsCol
      .find({
        tenant_id: tenantId,
        signal_type: 'sentiment_score',
        'data.ticker': ticker,
      })
      .sort({ created_at: -1 })
      .limit(1)
      .toArray()
    const sentimentData = sentimentDoc[0]?.data as { sentiment?: number } | undefined
    if (sentimentData?.sentiment !== undefined) {
      const existing = marketData.get(ticker)
      if (existing) existing.sentimentScore = sentimentData.sentiment
    }

    // Phase 3 attention signal (review wiring fix): latest attention_signal
    // (Google Trends search volume ratio) for the ML feature pipeline.
    const attentionDoc = await signalsCol
      .find({
        tenant_id: tenantId,
        signal_type: 'attention_signal',
        'data.ticker': ticker,
      })
      .sort({ created_at: -1 })
      .limit(1)
      .toArray()
    const attentionData = attentionDoc[0]?.data as { search_volume_ratio?: number } | undefined
    if (attentionData?.search_volume_ratio !== undefined) {
      const existing = marketData.get(ticker)
      if (existing) existing.attentionSignal = attentionData.search_volume_ratio
    }
  }

  return marketData
}

/** Fetch the latest macro indicators (VIX, yield curve, credit spread) from
 * stored signals. Returns undefined fields when no data has been synced yet —
 * the regime detector treats missing fields as "no macro override".
 *
 * Review wiring fix (PR #220): detectRegimeFromMarketData accepted macro
 * indicators but no caller ever fetched them, making the Phase 2 macro
 * override dead code. */
export async function fetchMacroIndicators(
  tenantId: string,
): Promise<{ vix?: number; yieldCurveSpread?: number; creditSpread?: number }> {
  const signalsCol = await getSignalsCollection()
  const macro: { vix?: number; yieldCurveSpread?: number; creditSpread?: number } = {}

  const [vixDoc, yieldDoc, creditDoc] = await Promise.all([
    signalsCol
      .find({ tenant_id: tenantId, signal_type: 'vix_index' })
      .sort({ created_at: -1 })
      .limit(1)
      .toArray(),
    signalsCol
      .find({ tenant_id: tenantId, signal_type: 'yield_curve_spread' })
      .sort({ created_at: -1 })
      .limit(1)
      .toArray(),
    signalsCol
      .find({ tenant_id: tenantId, signal_type: 'credit_spread' })
      .sort({ created_at: -1 })
      .limit(1)
      .toArray(),
  ])

  const vixValue = (vixDoc[0]?.data as { vix_value?: number } | undefined)?.vix_value
  if (vixValue !== undefined) macro.vix = vixValue
  // Review fix PR #220: the FRED connector transforms store the values under
  // field names matching the signal type (yield_curve_spread, credit_spread),
  // not a generic 'spread' key. Read both for backward compatibility.
  const yieldData = yieldDoc[0]?.data as { yield_curve_spread?: number; spread?: number } | undefined
  const yieldValue = yieldData?.yield_curve_spread ?? yieldData?.spread
  if (yieldValue !== undefined) macro.yieldCurveSpread = yieldValue
  const creditData = creditDoc[0]?.data as { credit_spread?: number; spread?: number } | undefined
  const creditValue = creditData?.credit_spread ?? creditData?.spread
  if (creditValue !== undefined) macro.creditSpread = creditValue

  return macro
}

/** Latest known price per ticker, used by the Calibration dashboard and the
 *  Strategy ROI panel.
 *
 *  Reads both `market_price` signals (Alpha Vantage daily price) and
 *  `portfolio_position` signals (Trading 212 sync, refreshed every 15 min,
 *  carrying `current_price`). `market_price` is the more authoritative source
 *  when present because it carries an explicit trading date, but for tenants
 *  whose only reliable price source is the broker sync (e.g. a Trading-212-only
 *  tenant whose Alpha Vantage tickers don't match — see TRADING_ENGINE_GAPS
 *  gap #2), falling back to `portfolio_position.current_price` is what unblocks
 *  non-zero ROI/Calibration numbers. Mirrors the dual-source pattern already
 *  used by `buildMarketDataFromSignals` above. Most-recent doc wins per ticker. */
export async function loadLatestPrices(tenantId: string, tickers: string[]): Promise<Map<string, number>> {
  const db = await getDb()
  const latestPrices = new Map<string, number>()
  for (const ticker of tickers) {
    const docs = await getTenantCollection<Record<string, unknown>>(db, 'signals', tenantId)
      .find({
        signal_type: { $in: ['market_price', 'portfolio_position'] },
        'data.ticker': ticker,
      })
      .sort({ created_at: -1 })
      .limit(1)
      .toArray()
    const doc = docs[0]
    if (!doc) continue
    const data = doc.data as { price?: number; current_price?: number } | undefined
    const signalType = String(doc.signal_type ?? '')
    const price = signalType === 'market_price'
      ? data?.price
      : data?.current_price
    if (price !== undefined && Number.isFinite(price)) latestPrices.set(ticker, price)
  }
  return latestPrices
}
