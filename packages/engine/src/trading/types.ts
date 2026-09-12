/**
 * Trading strategy types.
 *
 * Pure data shapes used by the defensive trend-following engine. No
 * external dependencies so the engine can be unit-tested in isolation.
 */

export interface PricePoint {
  /** ISO date, e.g. 2024-01-02 */
  date: string
  /** Closing price in major currency units */
  close: number
}

export interface MarketData {
  ticker: string
  history: PricePoint[]
  /**
   * Gross profitability ratio (GrossProfitTTM / TotalRevenueTTM) from the
   * Alpha Vantage OVERVIEW endpoint. Used by computeQualityScore in the
   * scoring engine — gap #6 (TRADING_ENGINE_GAPS.md).
   * Undefined when no fundamentals data is available; the scoring engine
   * falls back to a neutral 0.5 via computeQualityScore(undefined).
   */
  grossProfitability?: number | undefined
  /**
   * News sentiment score [0, 1] from Finnhub /news-sentiment endpoint
   * (Phase 2). 0.5 = neutral, >0.5 = bullish, <0.5 = bearish.
   * Undefined when no sentiment data is available.
   */
  sentimentScore?: number | undefined
  /**
   * Return on equity (ROE) as a fraction (e.g. 0.20 = 20%). Used by the
   * enhanced quality score (Phase 2). From Finnhub fundamentals.
   */
  roe?: number | undefined
  /**
   * Gross margin as a fraction (e.g. 0.45 = 45%). Used by the enhanced
   * quality score (Phase 2). From Finnhub fundamentals.
   */
  grossMargin?: number | undefined
  /**
   * Debt-to-equity ratio (e.g. 1.5 = 150% debt/equity). Used by the
   * enhanced quality score (Phase 2). From Finnhub fundamentals.
   */
  debtToEquity?: number | undefined
  /**
   * Google Trends search volume index [0, 1] (Phase 3). Represents
   * recent search interest relative to a 1-year baseline. >1 = rising
   * attention, <1 = declining. Evidence: predicts short-term returns
   * (43/45 stocks in study), edge decays within ~1 week.
   */
  attentionSignal?: number | undefined
}

export interface Position {
  ticker: string
  quantity: number
  avgPrice: number
  currentPrice: number
  /** Trading wrapper type, e.g. 'isa', 'invest', 'cfd'. */
  accountType?: string
  /**
   * Asset class of the holding — used by the scoring engine to skip or
   * re-weight non-equity assets (gap #9, TRADING_ENGINE_GAPS.md).
   * Defaults to 'stock' when not specified (backward compatible).
   */
  assetClass?: 'stock' | 'etf' | 'cash' | 'commodity' | 'cryptocurrency'
  /**
   * Highest closing price since the position was opened (or last added to).
   * Used by the momentum trend-following strategy for trailing-stop logic.
   * When absent, the strategy derives it from price history.
   */
  highWaterMark?: number
}

export interface PortfolioSnapshot {
  tenantId?: string
  totalValue: number
  cash: number
  positions: Position[]
}

export interface RiskConfig {
  /** Maximum single-position weight as a percentage (default 10). */
  maxPositionWeight?: number
  /** Target annualised portfolio volatility as a percentage (default 10). */
  targetVolatility?: number
  /** Cash is flagged for deployment above this percentage (default 5). */
  cashDeployThreshold?: number
  /** Stop-loss threshold as a fraction of average cost (default 0.10). */
  stopLossThreshold?: number
  /** Minimum trading days of history required to score an asset (default 63). */
  minLookback?: number
  /** Quality weight in composite score (default 0.35). */
  qualityWeight?: number
  /** Momentum weight in composite score (default 0.40). */
  momentumWeight?: number
  /** Volatility weight in composite score (default 0.25). */
  volatilityWeight?: number
  /**
   * Composite score threshold for deploying cash into a new position
   * (default 0.5). Lowering this deploys cash more aggressively but buys
   * weaker-ranked assets. The 0.5 default is calibrated for the defensive
   * strategy; aggressive configs typically set 0.3–0.4.
   */
  cashDeployScoreThreshold?: number
  /**
   * Composite score below which a held position is recommended for full sale
   * (default 0.3). Lowering this holds positions longer through weak scores.
   */
  sellScoreThreshold?: number
  /**
   * Composite score below which a held position is recommended for trimming
   * (default 0.5). Must be >= sellScoreThreshold. Lowering this trims less
   * aggressively, letting marginal positions ride.
   */
  trimScoreThreshold?: number
  /**
   * Momentum lookback window in trading days, separate from minLookback
   * (default: 252 = 12 months). Shorter windows (e.g. 63 = 3 months, 21 = 1
   * month) detect trends faster but are noisier. The momentum score still
   * skips the most recent 21 days to avoid short-term reversal effects.
   */
  momentumLookbackDays?: number
  /**
   * Maximum number of tickers to deploy cash into per rebalance (default 1).
   * Setting this higher deploys cash faster across multiple high-scoring
   * assets instead of concentrating into a single pick.
   */
  maxCashDeployTickers?: number
  /**
   * Fraction of each position to sell when the portfolio-level reduce_exposure
   * recommendation fires (default 0.20 = 20%). Lowering this de-risks less
   * aggressively; setting it to 0 effectively disables the portfolio-level
   * de-risk, leaving only per-position stop-loss and concentration trims.
   */
  reduceExposurePct?: number
  /**
   * Fraction of available cash to deploy per "add" recommendation in the
   * momentum strategy (default 0.25 = 25%). The actual deploy amount is
   * scaled by the recommendation's confidence (momentum score), so stronger
   * momentum signals deploy more cash.
   */
  addCashFraction?: number
  /**
   * Trailing stop threshold for the momentum strategy: sell if the price
   * drops this fraction from the high-water mark (default 0.15 = 15%).
   * Tighter stops lock in gains faster but get stopped out on normal pullbacks.
   */
  trailingStopThreshold?: number
  /**
   * Momentum score above which the strategy adds to an existing position
   * (default 0.15 = 15% return over the lookback window). Higher values
   * require stronger momentum before adding, reducing whipsaw.
   */
  addMomentumThreshold?: number
  /**
   * Raw momentum return below which the strategy sells a position
   * (default 0 = sell when momentum turns negative). Set above 0 to sell
   * before momentum fully reverses.
   */
  sellMomentumThreshold?: number
  /**
   * Minimum trade value in minor currency units (default 0 = no minimum).
   * Trades whose absolute value falls below this threshold are skipped,
   * preventing tiny trades that cost more in fees than they're worth.
   * For example, set to 5000 (£50) to skip any trade smaller than £50.
   */
  minTradeValueMinor?: number
  /**
   * Minimum position size as a percentage of portfolio value (default 0).
   * When deploying cash, the strategy will not open a new position smaller
   * than this percentage. Prevents over-fragmentation on small portfolios
   * where maxPositionWeight would otherwise create tiny positions.
   * For example, set to 20 to require at least 20% allocation per position.
   */
  minPositionWeight?: number
  /**
   * Maximum number of concurrent positions (default 0 = unlimited).
   * When the portfolio already holds this many positions, the strategy
   * will not open new ones — only trim/sell existing positions. Useful
   * for small portfolios where 3-4 focused positions are better than
   * 10 tiny ones.
   */
  maxPositions?: number
  /**
   * Whether the broker supports fractional shares (default false).
   * When true, the simulator rounds quantities to 6 decimal places instead
   * of flooring to whole shares. This allows small portfolios to deploy
   * their full cash balance — e.g. £1,000 can buy 2.79 shares of GOOGL at
   * £358, instead of only 2 shares (£716) with £284 left idle.
   * Trading 212 and most modern retail brokers support fractional shares.
   */
  fractionalShares?: boolean
  /**
   * The account-type value that identifies tax-advantaged positions in the
   * tenant's country (e.g. 'isa' for GB, 'cnc' for IN). Used by the
   * cross-wrapper intelligence logic to detect when a tenant holds positions
   * in a taxable account but not in the tax-advantaged wrapper.
   * Defaults to 'isa' (backward compatible with existing UK tenants).
   */
  taxAdvantagedAccountType?: string
  /**
   * The account-type value that identifies taxable positions (e.g. 'invest'
   * for GB, 'cnc' for IN where CNC is both delivery and tax-advantaged).
   * Defaults to 'invest' (backward compatible).
   */
  taxableAccountType?: string
  /**
   * Human-readable name of the tax wrapper for this country (e.g. 'ISA',
   * 'ELSS (§80C)'). Used in the wrapper-preference recommendation text.
   * Defaults to 'ISA'.
   */
  taxWrapperName?: string

  // ── Phase 1 enhancements (price-data only) ────────────────────────────────

  /**
   * Target annualized volatility for the volatility-scaling overlay
   * (Barroso & Santa-Clara 2015). Position sizes are scaled by
   * (target / realized) vol, capped between volScaleMin and volScaleMax.
   * Default 0.12 (12%). Set to 0 to disable volatility scaling.
   */
  volScaleTargetVol?: number
  /** Minimum volatility scale factor (default 0.2 = 20% of full size). */
  volScaleMin?: number
  /** Maximum volatility scale factor (default 2.0 = 200% of full size). */
  volScaleMax?: number
  /** Lookback window in days for realized vol calculation (default 126 = 6 months). */
  volScaleLookbackDays?: number

  /**
   * Weight of the 52-week-high signal in the composite score
   * (George & Hwang 2004). Default 0.15. Set to 0 to disable.
   * When enabled, the other weights (momentum/quality/volatility) are
   * renormalized to sum with this weight.
   */
  week52HighWeight?: number

  /**
   * Multi-timeframe momentum lookback windows in trading days
   * (Man AHL / Moskowitz, Ooi, Pedersen 2012). When all three are set,
   * the momentum score blends fast/medium/slow signals instead of using
   * a single lookback. Default: disabled (single-window via
   * momentumLookbackDays). Set all three to enable.
   */
  fastLookbackDays?: number
  mediumLookbackDays?: number
  slowLookbackDays?: number
  /** Weight of the fast signal in the multi-timeframe blend (default 0.3). */
  fastWeight?: number
  /** Weight of the medium signal in the multi-timeframe blend (default 0.4). */
  mediumWeight?: number
  /** Weight of the slow signal in the multi-timeframe blend (default 0.3). */
  slowWeight?: number

  /**
   * Market state gate (Cooper, Gutierrez, Hameed 2004). When enabled,
   * position sizes are reduced when the broad market 12-month return is
   * negative. The gate uses a market-index ticker's price history.
   * Default: disabled. Set marketStateGateTicker to enable.
   */
  marketStateGateEnabled?: boolean
  /** Ticker to use as the market index for the state gate (e.g. 'VUAG_US_EQ'). */
  marketStateGateTicker?: string
  /** Market 12m return below which exposure is halved (default -0.05 = -5%). */
  marketStateGateThreshold?: number
  /** Market 12m return below which exposure goes to zero (default -0.20 = -20%). */
  marketStateGateCutoff?: number

  /**
   * Turnover reduction: only rebalance when the composite score has changed
   * by more than this fraction since the last rebalance (default 0 = disabled).
   * E.g. 0.10 = only act if score changed by >10%.
   */
  minScoreChangeForRebalance?: number
  /** Turnover reduction: only rebalance when weight drifted by more than this fraction (default 0 = disabled). */
  minWeightDriftForRebalance?: number
  /**
   * Asymmetric turnover reduction: higher hurdle for *entering* a new position
   * than for *exiting* or maintaining one. Evidence (JPM 2019): banding reduces
   * costs more than reducing frequency because it keeps existing exposures to
   * a proven signal while raising the bar for new trades. Default 0 = disabled.
   * When set, entry decisions require score change > this value; exits/stops
   * always fire; existing-position trims use minScoreChangeForRebalance.
   */
  minScoreChangeForRebalanceEntry?: number
  /**
   * Cross-sectional momentum blend weight (Phase 3, default 0 = disabled).
   * When > 0, each asset's time-series momentum score is blended with its
   * cross-sectional quartile rank across the scored universe:
   * blended = TS × (1 − w) + CS × w.
   */
  crossSectionalWeight?: number

  /**
   * Sentiment blend weight in the defensive composite score (Phase 2,
   * default 0 = disabled). When > 0, news sentiment [0,1] replaces part of
   * the momentum weight. Neutral 0.5 when no sentiment data exists.
   */
  sentimentWeight?: number

  /**
   * Transaction cost model for the simulator. Spread + commission + market
   * impact in basis points. When set, the simulator skips trades whose
   * estimated cost exceeds the expected return from the recommendation.
   */
  spreadBps?: number
  commissionBps?: number
  marketImpactBps?: number
  /**
   * Maximum expected return per trade in basis points at confidence = 1.0
   * (default 50). Used by the simulator's cost-benefit check: a trade's
   * expected benefit is confidence × this value. Trades whose estimated
   * transaction cost exceeds their expected benefit are skipped.
   */
  maxExpectedTradeReturnBps?: number

  /**
   * Rank-based momentum scoring (default false). When true, the momentum
   * engine replaces the saturating sigmoid score with a percentile-rank score
   * across the scored universe. This fixes tail-blindness: under the sigmoid,
   * a stock up 150% scores identically to one up 35% (both saturate near
   * 0.95). Under rank-based scoring, the 150% gainer scores higher because it
   * ranks higher relative to its peers.
   *
   * Rank-based scoring is also regime-adaptive: in a bear market, the best
   * relative performers still score high, which is the correct behaviour for
   * cross-sectional momentum. The sigmoid, by contrast, scores everything
   * below 0% return as near-zero regardless of relative performance.
   *
   * The raw return is still preserved separately for sell decisions
   * (negative momentum → sell) and trailing-stop logic, which depend on
   * absolute return, not relative rank.
   */
  rankBasedScoring?: boolean

  /**
   * Alpha-mining signal weight (default 0 = disabled). When > 0, the
   * momentum engine blends each asset's long-term momentum score with a
   * short-term alpha signal (RSI, Bollinger breakout, momentum surge, gap
   * continuation, VCP). This mines additional trade opportunities that the
   * weekly momentum rebalance misses:
   *
   *   - A stock with moderate long-term momentum but a strong short-term
   *     breakout gets a higher blended score → triggers a buy
   *   - A stock with strong long-term momentum but an overbought RSI gets
   *     a lower blended score → triggers a trim before the reversal
   *
   * Recommended range: 0.15-0.30. Higher values make the strategy more
   * responsive to short-term signals, generating more trades but with
   * higher turnover.
   */
  alphaSignalWeight?: number

  /**
   * When true, deploy cash only into tickers with positive absolute momentum
   * (the asset's own return is positive over the lookback window). This is the
   * absolute-momentum leg of dual momentum: even a top-ranked relative winner
   * is skipped if it is going down in absolute terms. Helps avoid deploying into
   * the "best of a bad bunch" during broad declines. Default false.
   */
  absoluteMomentumFilter?: boolean

  /**
   * When true, rank-weight cash deployment: the top-scoring candidate receives
   * a larger fraction of the available cash, the #2 candidate less, and so on.
   * This concentrates capital in the strongest pick rather than equal-weighting
   * the top N, matching the evidence that top-decile momentum names drive most
   * momentum profits. Default false.
   */
  rankWeightedDeployment?: boolean

  /**
   * Phase 3: ML ensemble signal weight (default 0 = disabled). When > 0, the
   * momentum engine blends each asset's score with a cross-sectional ridge
   * regression prediction trained on-the-fly from price-derived features.
   * This adds a machine-learning layer on top of momentum and alpha-mining
   * signals, potentially improving selection by learning which combination of
   * momentum, volatility, and trend-strength features is currently predicting
   * short-term returns. Recommended range: 0.10-0.25.
   */
  mlEnsembleWeight?: number

  /**
   * Phase 4: Kelly criterion position sizing (default false). When true,
   * position sizes are scaled by the Kelly fraction (edge / odds) rather
   * than using a fixed maxPositionWeight. Uses academic default parameters
   * (win rate 55%, win/loss ratio 1.3) until enough live trade history
   * accumulates for calibration. Half-Kelly by default (kellyScale = 0.5).
   */
  kellyEnabled?: boolean
  /** Fraction of full Kelly to use (0.5 = half-Kelly, 1.0 = full Kelly). */
  kellyScale?: number
  /** Minimum closed trades required before using live data instead of defaults. */
  kellyMinTrades?: number

  /**
   * Phase 2: regime-aware momentum overrides. When true, the engine detects
   * bull/bear/sideways market regimes from the market-index ticker and adjusts
   * momentum parameters (tighter stops in bear/sideways, lower concentration
   * limits, higher alphaSignalWeight for mean-reversion). Default false.
   */
  regimeAwareMomentum?: boolean

  /**
   * Market-index ticker used for regime detection when regimeAwareMomentum is
   * enabled. Recommended: 'SPY_US_EQ' or 'VUAG_US_EQ'.
   */
  regimeMarketTicker?: string

  /**
   * Maximum sector exposure as a percentage of total portfolio value. Prevents
   * the strategy from concentrating in a single sector (e.g. 90% in
   * semiconductors). 0 = disabled. Recommended: 25-40 for aggressive, 15-25 for
   * defensive. Default 0.
   */
  maxSectorWeight?: number

  // ── Phase 5: Advanced risk management ─────────────────────────────────

  /**
   * ATR-based adaptive trailing stops. When true, the trailing stop percentage
   * is computed per-ticker from its Average True Range rather than using a
   * fixed trailingStopThreshold. Volatile stocks get wider stops, calm stocks
   * get tighter stops. This prevents whipsaw on volatile stocks while keeping
   * tight stops on calm stocks. Default false.
   */
  atrBasedStops?: boolean
  /** Multiplier on ATR for stop calculation (default 3.0 = 3x ATR). */
  atrMultiplier?: number
  /** Minimum stop percentage (default 0.10 = 10%). */
  atrMinStop?: number
  /** Maximum stop percentage (default 0.50 = 50%). */
  atrMaxStop?: number

  /**
   * Bear regime hedge: when true and the market regime is bear, the engine
   * recommends allocating to an inverse ETF to hedge long exposure.
   */
  bearRegimeHedge?: boolean
  /** Ticker for the inverse ETF to use as hedge (e.g. 'SH_US_EQ' for short S&P 500). */
  bearRegimeHedgeTicker?: string
  /** Maximum portfolio percentage to allocate to the hedge (default 0.30 = 30%). */
  bearRegimeHedgeMaxPct?: number
  /**
   * Breakout scoring weight [0, 1]. Blends breakout detection (VCP pattern,
   * volume surge, relative strength, earnings quality) with pure backward
   * momentum. 0 = pure momentum (buy after the move). 0.5 = equal weight.
   * 0.7 = breakout-focused (buy at the START of the move, before the surge).
   */
  breakoutWeight?: number
}

/**
 * Portfolio-size tier — used to auto-select sensible defaults for
 * maxPositionWeight, maxPositions, and minTradeValueMinor based on the
 * total portfolio value. Small portfolios need fewer, larger positions
 * to avoid over-fragmentation and fee drag; large portfolios can afford
 * finer-grained diversification.
 */
export type PortfolioTier = 'small' | 'medium' | 'large'

/**
 * Classify a portfolio into a size tier based on total value (minor units).
 *
 * - small:  < £2,000   → 4 positions max, 25% max weight, £50 min trade
 * - medium: < £10,000  → 7 positions max, 15% max weight, £50 min trade
 * - large:  ≥ £10,000  → 10+ positions,  10% max weight, £25 min trade
 *
 * These tiers are defaults — the user can override any field in LiveTradingSettings.
 */
export function classifyPortfolioTier(totalValueMinor: number): PortfolioTier {
  if (totalValueMinor < 200_000) return 'small'   // < £2,000
  if (totalValueMinor < 1_000_000) return 'medium' // < £10,000
  return 'large'
}

/**
 * Return tier-appropriate defaults for RiskConfig fields that depend on
 * portfolio size. The caller merges these with the user's explicit overrides
 * (user overrides win).
 */
export function tierDefaults(tier: PortfolioTier): {
  maxPositionWeight: number
  maxPositions: number
  minTradeValueMinor: number
  minPositionWeight: number
} {
  switch (tier) {
    case 'small':
      return {
        maxPositionWeight: 25,    // 4 positions max
        maxPositions: 4,
        minTradeValueMinor: 5000, // £50 min trade
        minPositionWeight: 15,    // don't open positions smaller than 15%
      }
    case 'medium':
      return {
        maxPositionWeight: 15,    // ~7 positions
        maxPositions: 7,
        minTradeValueMinor: 5000, // £50 min trade
        minPositionWeight: 8,
      }
    case 'large':
      return {
        maxPositionWeight: 10,    // 10+ positions
        maxPositions: 0,          // unlimited
        minTradeValueMinor: 2500, // £25 min trade
        minPositionWeight: 3,
      }
  }
}

/**
 * Merge tier defaults with user overrides. User-provided values take
 * precedence; tier defaults fill in any gaps.
 */
export function mergeWithTierDefaults(
  totalValueMinor: number,
  userConfig?: RiskConfig,
): {
  maxPositionWeight: number
  maxPositions: number
  minTradeValueMinor: number
  minPositionWeight: number
} {
  const tier = classifyPortfolioTier(totalValueMinor)
  const defaults = tierDefaults(tier)
  return {
    maxPositionWeight: userConfig?.maxPositionWeight ?? defaults.maxPositionWeight,
    maxPositions: userConfig?.maxPositions ?? defaults.maxPositions,
    minTradeValueMinor: userConfig?.minTradeValueMinor ?? defaults.minTradeValueMinor,
    minPositionWeight: userConfig?.minPositionWeight ?? defaults.minPositionWeight,
  }
}

export interface StrategyRecommendation {
  action: 'buy' | 'sell' | 'trim' | 'hold' | 'reduce_exposure' | 'deploy_cash' | 'add'
  ticker?: string
  reason: string
  confidence: number
  riskFlags: string[]
}
