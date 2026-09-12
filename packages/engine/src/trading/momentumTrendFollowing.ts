/**
 * Momentum Trend Following strategy engine.
 *
 * The aggressive counterpart to the Defensive Trend Following engine. Instead
 * of optimising for capital preservation, this strategy rides momentum:
 *
 *   1. Score assets by PURE momentum (ignore quality and volatility)
 *   2. Buy the strongest momentum assets
 *   3. Add to existing winners (momentum continuation)
 *   4. Cut losers fast (sell when momentum turns negative or trailing stop hits)
 *   5. No weight cap — let winners concentrate
 *   6. No portfolio-volatility de-risk — volatility is the price of momentum
 *
 * This strategy will massively outperform in trending markets and lose money
 * fast in choppy/whipsaw markets. It is NOT a buy-and-hold replacement — it
 * is an active momentum strategy that requires frequent rebalancing.
 */

import type {
  MarketData,
  PortfolioSnapshot,
  Position,
  PricePoint,
  RiskConfig,
  StrategyRecommendation,
} from './types.js'
import {
  volatilityScale,
  week52HighScore,
  marketStateGate,
  multiTimeframeMomentumScore,
  sigmoidMomentumScore,
  returnOverWindow,
  crossSectionalRank,
  blendTsAndCsMomentum,
  percentileRankScore,
  atrBasedStopPct,
  dynamicRebalanceIntervalDays,
  bearRegimeHedgeAllocation,
} from './strategy-enhancements.js'
import { mineAlphaSignal } from './alpha-mining.js'
import { detectRegimeFromMarketData, selectRegimeStrategy, type MarketRegime } from './regime-detector.js'
import { computeCrossSectionalMlSignal } from './ml-ensemble.js'
import { breakoutScore, momentumAccelerationScore } from './breakout-scoring.js'

// sigmoidMomentumScore is used by computePureMomentumScore below — re-exported
// here so the import isn't tree-shaken away.

const TRADING_DAYS_PER_YEAR = 252

/**
 * Sector mapping for US-equity tickers in the momentum universe.
 * Used to enforce sector concentration caps and avoid hidden correlation
 * risk (e.g. 90% of the portfolio ending up in semiconductors).
 *
 * Sectors follow the GICS-style taxonomy used by most data providers.
 */
const SECTOR_MAP: Record<string, string> = {
  // Technology / Semiconductors
  AAPL_US_EQ: 'technology', MSFT_US_EQ: 'technology', GOOGL_US_EQ: 'technology',
  META_US_EQ: 'technology', NVDA_US_EQ: 'technology',
  AMD_US_EQ: 'technology', INTC_US_EQ: 'technology', QCOM_US_EQ: 'technology',
  TXN_US_EQ: 'technology', AVGO_US_EQ: 'technology', MU_US_EQ: 'technology',
  AMAT_US_EQ: 'technology', LRCX_US_EQ: 'technology', MRVL_US_EQ: 'technology',
  STX_US_EQ: 'technology', WDC_US_EQ: 'technology', NOW_US_EQ: 'technology',
  PANW_US_EQ: 'technology', FTNT_US_EQ: 'technology', IBM_US_EQ: 'technology',
  CSCO_US_EQ: 'technology', ORCL_US_EQ: 'technology', ADBE_US_EQ: 'technology',
  CRM_US_EQ: 'technology', ACN_US_EQ: 'technology', NFLX_US_EQ: 'technology',
  // Consumer Discretionary / EV
  TSLA_US_EQ: 'consumer_discretionary', DIS_US_EQ: 'consumer_discretionary',
  AMZN_US_EQ: 'consumer_discretionary',  // overlaps with tech; classified as discretionary for sector-cap purposes
  // Financials
  V_US_EQ: 'financials', MA_US_EQ: 'financials', JPM_US_EQ: 'financials',
  BAC_US_EQ: 'financials',
  // Healthcare
  UNH_US_EQ: 'healthcare', LLY_US_EQ: 'healthcare',
  // Energy
  XOM_US_EQ: 'energy', CVX_US_EQ: 'energy',
  // Consumer Staples / Retail
  HD_US_EQ: 'consumer_staples', COST_US_EQ: 'consumer_staples',
  // Broad market / ETF
  SPY_US_EQ: 'market',
}

function getSector(ticker: string): string {
  return SECTOR_MAP[ticker] ?? 'other'
}

/**
 * Pure momentum score: fractional return over the lookback window, skipping
 * the most recent `skipRecent` days to avoid short-term reversal noise.
 *
 * Returns a score between 0 and 1 via a sigmoid mapping that preserves
 * ranking order without saturating. The previous implementation clipped
 * rawReturn to [0, 1], which meant a +200% return and a +100% return both
 * scored 1.0 — indistinguishable. The sigmoid maps the full range of
 * returns to a smooth curve:
 *   - rawReturn <= -0.25 → 0 (unambiguously bearish)
 *   - rawReturn = 0      → ~0.35 (flat momentum is mildly bearish)
 *   - rawReturn = +0.10  → ~0.76
 *   - rawReturn = +0.30  → ~0.95
 *   - rawReturn = +1.00  → ~0.999 (approaches but never reaches 1.0)
 *
 * The rawReturn is preserved separately for sell decisions (negative
 * momentum → sell) and for the trailing-stop logic.
 */
export function computePureMomentumScore(
  history: PricePoint[],
  minLookback = 21,
  momentumLookbackDays = 42,
  skipRecent = 5,
): { score: number; rawReturn: number } {
  if (history.length < minLookback + skipRecent) return { score: 0, rawReturn: 0 }
  const end = history.length - 1
  const lookback = Math.min(momentumLookbackDays, history.length - skipRecent)
  const pastPoint = history[end - lookback]
  const recentPoint = history[end - skipRecent]
  if (!pastPoint || !recentPoint) return { score: 0, rawReturn: 0 }
  const past = pastPoint.close
  const recent = recentPoint.close
  if (past <= 0) return { score: 0, rawReturn: 0 }
  const rawReturn = (recent - past) / past
  // Use the sigmoid mapping from strategy-enhancements.ts — same curve the
  // defensive strategy uses, so the two strategies are comparable. This
  // preserves ranking order without saturating at +100%.
  const score = sigmoidMomentumScore(rawReturn)
  return { score, rawReturn }
}

/**
 * Derive the high-water mark for a position. If the position has an explicit
 * highWaterMark field (from live trading), use it. Otherwise, compute the
 * highest close since the position was opened — NOT the highest close in the
 * entire price history.
 *
 * The previous implementation used the entire history, which meant a stock
 * that peaked 5 years ago (before the position was opened) would trigger a
 * trailing stop the moment the price dipped below that historical peak —
 * even though the position never saw that price. The trailing stop is
 * supposed to lock in gains *since the position was opened*, not since the
 * beginning of time.
 *
 * Since we don't have the position's open date in the snapshot, we use the
 * average entry price as a lower bound: the HWM is the highest close that
 * is >= the average entry price. This is a conservative approximation —
 * it may include some history before the position was opened if the stock
 * was above the entry price then, but it excludes the pre-entry peak that
 * caused the false trailing-stop triggers.
 */
function getHighWaterMark(position: Position, history: PricePoint[] | undefined): number {
  if (position.highWaterMark && position.highWaterMark > 0) return position.highWaterMark
  if (!history || history.length === 0) return position.currentPrice
  // Use the average entry price as the floor — only consider closes at or
  // above the entry price as candidates for the high-water mark. This
  // excludes the pre-entry historical peak that caused false stops.
  const entryPrice = position.avgPrice > 0 ? position.avgPrice : position.currentPrice
  let hwm = entryPrice
  for (const point of history) {
    if (point.close > hwm) hwm = point.close
  }
  return Math.max(hwm, position.currentPrice)
}

/**
 * Generate momentum trend-following recommendations for a portfolio snapshot.
 *
 * The function is pure: it does not fetch market data or read from a database.
 * Callers supply a `Map<ticker, MarketData>` from any price-history source.
 */
export function generateMomentumRecommendations(
  snapshot: PortfolioSnapshot,
  marketData: Map<string, MarketData>,
  config: RiskConfig = {},
): StrategyRecommendation[] {
  let {
    minLookback = 21,
    momentumLookbackDays = 42,
    maxPositionWeight = 10,
    maxCashDeployTickers = 3,
    cashDeployThreshold = 1,
    cashDeployScoreThreshold = 0.1,
    stopLossThreshold = 0.15,
    // Trailing stop: sell if price drops this fraction from the high-water mark
    trailingStopThreshold = 0.15,
    // Momentum thresholds for add/hold/sell decisions
    addMomentumThreshold = 0.15,
    sellMomentumThreshold = 0,
    // Fraction of available cash to deploy per "add" recommendation
    addCashFraction = 0.25,
    // Phase 1 enhancements
    volScaleTargetVol = 0,
    volScaleMin = 0.2,
    volScaleMax = 2.0,
    volScaleLookbackDays = 126,
    week52HighWeight = 0,
    fastLookbackDays = 0,
    mediumLookbackDays = 0,
    slowLookbackDays = 0,
    fastWeight = 0.3,
    mediumWeight = 0.4,
    slowWeight = 0.3,
    marketStateGateEnabled = false,
    marketStateGateTicker,
    marketStateGateThreshold = -0.05,
    marketStateGateCutoff = -0.20,
    // Phase 3: cross-sectional momentum. When > 0, each asset's time-series
    // score is blended with its cross-sectional rank across the universe
    // (Jegadeesh & Titman 1993). 0 = disabled (pure time-series).
    crossSectionalWeight = 0,
    // Rank-based scoring: replace the saturating sigmoid with a percentile
    // rank across the universe. Fixes tail-blindness (NVDA +150% currently
    // scores identically to +35% under the sigmoid) and is regime-adaptive
    // (best relative performers still rank high in bear markets).
    rankBasedScoring = false,
    // Alpha-mining: blend short-term signals (RSI, breakout, surge, gap, VCP)
    // with the long-term momentum score to mine more trade opportunities.
    alphaSignalWeight = 0,
    // Dual-momentum absolute filter: only deploy/add to tickers whose absolute
    // return is positive. Prevents deploying into the best of a bad bunch.
    absoluteMomentumFilter = false,
    // Rank-weighted cash deployment: concentrate cash in the top-scoring
    // candidates rather than equal-weighting the top N.
    rankWeightedDeployment = false,
    // Phase 3: ML ensemble signal weight. Blends a cross-sectional ridge
    // regression prediction (trained on-the-fly from price-derived features)
    // with the momentum and alpha-mining scores. 0 = disabled.
    mlEnsembleWeight = 0,
    // Phase 2: regime-aware momentum overrides. When true, the engine detects
    // bull/bear/sideways regime from the market-index ticker and adjusts
    // momentum parameters dynamically.
    regimeAwareMomentum = false,
    // Market-index ticker used for regime detection (e.g. 'SPY_US_EQ' or
    // 'VUAG_US_EQ'). Required when regimeAwareMomentum is true.
    regimeMarketTicker,
    // Maximum sector exposure as a percentage of total portfolio value.
    // Prevents the portfolio from concentrating in a single sector (e.g.
    // 90% in semiconductors). 0 = disabled.
    maxSectorWeight = 0,
    // Phase 5: ATR-based adaptive trailing stop. When true, the trailing
    // stop percentage is computed per-ticker from its Average True Range
    // rather than using a fixed trailingStopThreshold. Volatile stocks
    // get wider stops, calm stocks get tighter stops.
    atrBasedStops = false,
    atrMultiplier = 3.0,
    atrMinStop = 0.10,
    atrMaxStop = 0.50,
    // Phase 5: Bear regime hedge. When true, the engine recommends
    // allocating to an inverse ETF when the market regime is bear.
    bearRegimeHedge = false,
    bearRegimeHedgeTicker,
    bearRegimeHedgeMaxPct = 0.30,
    // Breakout scoring weight: blends breakout detection (VCP, volume surge,
    // relative strength, earnings quality) with pure backward momentum.
    // 0 = pure momentum (buy after the move). 0.5 = equal weight.
    // 0.7 = breakout-focused (buy at the START of the move).
    breakoutWeight = 0,
  } = config

  const totalValue = Math.max(snapshot.totalValue, 1)
  const cashPct = (snapshot.cash / totalValue) * 100
  const recommendations: StrategyRecommendation[] = []

  // Market state gate: compute once from the market-index ticker
  let marketGateScale = 1
  if (marketStateGateEnabled && marketStateGateTicker) {
    const marketMd = marketData.get(marketStateGateTicker)
    if (marketMd) {
      marketGateScale = marketStateGate(marketMd.history, marketStateGateThreshold, marketStateGateCutoff)
    }
  }

  // Regime-aware momentum overrides: detect bull/bear/sideways from the
  // market index and tune momentum parameters without switching strategy.
  // In bull regimes we let winners run (wider stops, more concentration);
  // in bear/sideways regimes we tighten risk controls and reduce concentration.
  let currentRegime: MarketRegime | undefined
  if (regimeAwareMomentum && regimeMarketTicker) {
    const regimeMd = marketData.get(regimeMarketTicker)
    if (regimeMd) {
      currentRegime = detectRegimeFromMarketData(new Map([[regimeMarketTicker, regimeMd]])).regime
      const overrides = selectRegimeStrategy(currentRegime).configOverrides
      // Apply only numeric overrides that make sense for the momentum engine.
      // We intentionally do NOT switch strategy — we stay momentum but adapt.
      if (typeof overrides.cashDeployThreshold === 'number') {
        // Leave cash deploy threshold alone — momentum wants to deploy cash.
      }
      if (typeof overrides.stopLossThreshold === 'number') stopLossThreshold = overrides.stopLossThreshold
      if (typeof overrides.trailingStopThreshold === 'number') trailingStopThreshold = overrides.trailingStopThreshold
      if (typeof overrides.reduceExposurePct === 'number') {
        // Not used directly here; portfolio-level de-risk is handled elsewhere.
      }
      // In bear/sideways, lower maxPositionWeight and maxSectorWeight to reduce concentration.
      if (currentRegime !== 'bull' && maxPositionWeight > 15) {
        maxPositionWeight = Math.min(maxPositionWeight, 15)
      }
      if (currentRegime !== 'bull' && maxSectorWeight > 25) {
        maxSectorWeight = Math.min(maxSectorWeight, 25)
      }
      // In bear/sideways, rely more on alpha-mining (mean-reversion) and less on momentum.
      if (currentRegime !== 'bull') {
        alphaSignalWeight = Math.min(0.4, alphaSignalWeight + 0.15)
      }
    }
  }

  // Phase 5: Bear regime hedge — recommend allocating to an inverse ETF
  // when the market regime is bear. This converts market drawdowns into
  // positive returns, partially offsetting long position losses.
  if (bearRegimeHedge && bearRegimeHedgeTicker && currentRegime === 'bear') {
    const hedgePct = bearRegimeHedgeAllocation('bear', bearRegimeHedgeMaxPct)
    const hedgeValue = (hedgePct / 100) * totalValue
    if (hedgeValue > 0 && cashPct >= hedgePct * 100) {
      recommendations.push({
        action: 'deploy_cash',
        ticker: bearRegimeHedgeTicker,
        reason: `Bear regime detected — hedging ${(hedgePct * 100).toFixed(0)}% of portfolio with inverse ETF to offset long exposure.`,
        confidence: 0.7,
        riskFlags: ['bear_hedge'],
      })
    }
  }

  // ── 1. Score every asset in the universe by pure momentum ───────────────
  const allTickers = new Set<string>([
    ...snapshot.positions.map((p) => p.ticker),
    ...Array.from(marketData.keys()),
  ])

  const scoredAssets = new Map<string, {
    ticker: string
    momentumScore: number
    rawReturn: number
    week52High: number
    volScale: number
    timeSeriesScore: number
    position?: Position
    currentWeight: number
    missingMarketData: boolean
  }>()

  for (const ticker of allTickers) {
    const md = marketData.get(ticker)
    const position = snapshot.positions.find((p) => p.ticker === ticker)
    const value = position ? position.currentPrice * position.quantity : 0
    const weight = (value / totalValue) * 100

    if (!md) {
      scoredAssets.set(ticker, {
        ticker,
        momentumScore: 0,
        rawReturn: 0,
        week52High: 0,
        volScale: 1,
        timeSeriesScore: 0,
        currentWeight: weight,
        missingMarketData: true,
        ...(position ? { position } : {}),
      })
      continue
    }

    const hasMultiTimeframeConfig = (fastLookbackDays ?? 0) > 0
      && (mediumLookbackDays ?? 0) > 0
      && (slowLookbackDays ?? 0) > 0
    const pureMomentum = computePureMomentumScore(
      md.history,
      minLookback,
      momentumLookbackDays,
    )
    const rawReturn = pureMomentum.rawReturn
    const timeSeriesScore = hasMultiTimeframeConfig
      ? multiTimeframeMomentumScore(
          md.history,
          fastLookbackDays,
          mediumLookbackDays,
          slowLookbackDays,
          fastWeight,
          mediumWeight,
          slowWeight,
        )
      : pureMomentum.score
    const w52h = week52HighWeight > 0 ? week52HighScore(md.history) : 0
    const volScale = volatilityScale(md.history, volScaleTargetVol, volScaleLookbackDays, volScaleMin, volScaleMax)
    // When 52-week high is enabled, blend it with the time-series momentum
    // score. Multi-timeframe momentum is used only when all three lookbacks
    // are configured; otherwise preserve the single-window behavior.
    const blendedScore = week52HighWeight > 0
      ? timeSeriesScore * (1 - week52HighWeight) + w52h * week52HighWeight
      : timeSeriesScore
    scoredAssets.set(ticker, {
      ticker,
      momentumScore: blendedScore,
      rawReturn,
      week52High: w52h,
      volScale,
      timeSeriesScore,
      currentWeight: weight,
      missingMarketData: false,
      ...(position ? { position } : {}),
    })
  }

  // Rank-based scoring: replace the saturating sigmoid score with a
  // percentile rank across the universe. This fixes tail-blindness (a stock
  // up 150% scores higher than one up 35% because it ranks higher) and is
  // regime-adaptive (best relative performers still rank high in bear
  // markets). The raw return is preserved for sell/stop decisions which
  // depend on absolute return. Applied before cross-sectional blending so
  // the CS rank operates on the rank-based score, not the sigmoid.
  //
  // Residual momentum (Blitz, Huij & Martens 2011): rank on the stock's return
  // in excess of the universe average, not total return. This isolates stock-
  // specific momentum and roughly doubles the strategy Sharpe ratio. We
  // pre-compute the universe average once here.
  const scoredForRanking = [...scoredAssets.values()].filter((a) => !a.missingMarketData)
  const universeAvgReturn = scoredForRanking.length > 0
    ? scoredForRanking.reduce((sum, a) => sum + a.rawReturn, 0) / scoredForRanking.length
    : 0

  if (rankBasedScoring) {
    if (scoredForRanking.length >= 2) {
      const allReturns = scoredForRanking.map((a) => a.rawReturn)
      const allResidualReturns = allReturns.map((r) => r - universeAvgReturn)
      for (const asset of scoredForRanking) {
        // Residual momentum: subtract the universe average before ranking.
        // The raw return used for absolute sell decisions is unchanged.
        const residual = asset.rawReturn - universeAvgReturn
        const rankScore = percentileRankScore(residual, allResidualReturns)
        // Re-blend with 52-week high if enabled, using the rank score as
        // the time-series component
        const blended = week52HighWeight > 0
          ? rankScore * (1 - week52HighWeight) + asset.week52High * week52HighWeight
          : rankScore
        asset.momentumScore = blended
        asset.timeSeriesScore = rankScore
      }
    }
  }

  // Phase 3 (review wiring fix): cross-sectional momentum ranking. Rank all
  // scored assets against each other and blend the quartile position with the
  // time-series score — an asset should be strong both absolutely (TS) and
  // relative to the alternatives (CS). Only applied when crossSectionalWeight
  // > 0 and there are enough assets to rank meaningfully (>= 4).
  if (crossSectionalWeight > 0) {
    const rankable = [...scoredAssets.values()]
      .filter((a) => !a.missingMarketData)
      .map((a) => ({ ticker: a.ticker, score: a.momentumScore }))
    if (rankable.length >= 4) {
      const csActions = crossSectionalRank(rankable)
      const tsWeight = 1 - Math.min(1, crossSectionalWeight)
      for (const asset of scoredAssets.values()) {
        if (asset.missingMarketData) continue
        const csAction = csActions.get(asset.ticker)
        if (csAction) {
          asset.momentumScore = blendTsAndCsMomentum(asset.momentumScore, csAction, tsWeight)
        }
      }
    }
  }

  // Alpha-mining: blend short-term signals (RSI, Bollinger breakout, momentum
  // surge, gap continuation, VCP) with the long-term momentum score. This
  // mines additional trade opportunities that the weekly momentum rebalance
  // misses — a stock with moderate long-term momentum but a strong short-term
  // breakout gets a higher blended score, triggering a buy. Conversely, a
  // stock with strong long-term momentum but an overbought RSI gets a lower
  // score, triggering a trim before the reversal.
  if (alphaSignalWeight > 0) {
    for (const asset of scoredAssets.values()) {
      if (asset.missingMarketData) continue
      const md = marketData.get(asset.ticker)
      if (!md || md.history.length < 15) continue
      const alpha = mineAlphaSignal(md.history)
      // Blend: momentumScore is [0, 1], alpha.score is [-1, 1]
      // Convert momentumScore to [-1, 1] space for consistent blending
      const tsCentered = asset.momentumScore * 2 - 1
      const blended = tsCentered * (1 - alphaSignalWeight) + alpha.score * alphaSignalWeight
      // Convert back to [0, 1] space
      asset.momentumScore = (blended + 1) / 2
      // Clamp to [0, 1]
      asset.momentumScore = Math.max(0, Math.min(1, asset.momentumScore))
    }
  }

  // Phase 3: ML ensemble signal. Train a cross-sectional ridge regression on
  // the fly using price-derived features and the most recent 5-day return as
  // a momentum-continuation target. Blend the predicted, normalized score
  // with the existing momentum/alpha signal.
  if (mlEnsembleWeight > 0) {
    const mlScores = computeCrossSectionalMlSignal(marketData, 5, 0.1, 8)
    for (const asset of scoredAssets.values()) {
      if (asset.missingMarketData) continue
      const ml = mlScores.get(asset.ticker)
      if (ml === undefined) continue
      const tsCentered = asset.momentumScore * 2 - 1
      const mlCentered = ml * 2 - 1
      const blended = tsCentered * (1 - mlEnsembleWeight) + mlCentered * mlEnsembleWeight
      asset.momentumScore = (blended + 1) / 2
      asset.momentumScore = Math.max(0, Math.min(1, asset.momentumScore))
    }
  }

  // ── 1b. Breakout scoring: blend breakout detection with momentum ──────
  // Pure momentum buys stocks AFTER they've already surged (MRVL +217%).
  // Breakout scoring detects stocks at the START of their move — breaking
  // out of consolidation with volume, relative strength, and earnings
  // backing. This is the key to high returns: get in BEFORE the big move.
  //
  // The breakoutWeight config controls how much the breakout score
  // influences the final ranking vs pure backward momentum.
  if (breakoutWeight && breakoutWeight > 0) {
    // Get market index history for relative strength calculation
    const marketTicker = config.regimeMarketTicker ?? 'SPY_US_EQ'
    const marketMd = marketData.get(marketTicker)
    const marketHistory = marketMd?.history

    for (const asset of scoredAssets.values()) {
      if (asset.missingMarketData) continue
      const md = marketData.get(asset.ticker)
      if (!md || md.history.length < 20) continue

      const breakout = breakoutScore(md, marketHistory)
      const acceleration = momentumAccelerationScore(md.history)

      // Blend: breakout score catches early-stage breakouts,
      // momentum score captures established trends, acceleration
      // detects building momentum.
      // Final score = momentumScore * (1 - breakoutWeight) + breakout * breakoutWeight
      // Plus an acceleration bonus that can boost the score up to 10%
      const blended = asset.momentumScore * (1 - breakoutWeight)
        + breakout.score * breakoutWeight
        + acceleration * 0.10

      asset.momentumScore = Math.max(0, Math.min(1, blended))
    }
  }

  // ── 2. Position-level recommendations ──────────────────────────────────
  for (const asset of scoredAssets.values()) {
    const { ticker, position, momentumScore, rawReturn, missingMarketData } = asset
    if (!position) continue

    // Skip momentum-based recommendations for tickers with no market data
    if (missingMarketData) continue

    const history = marketData.get(ticker)?.history
    const hwm = getHighWaterMark(position, history)
    const dropFromHwm = hwm > 0 ? (hwm - position.currentPrice) / hwm : 0

    // Phase 5: ATR-based adaptive trailing stop. When enabled, compute the
    // stop percentage from the stock's actual volatility rather than using
    // a fixed percentage. This prevents whipsaw on volatile stocks (which
    // need wider stops) while keeping tight stops on calm stocks.
    const effectiveTrailingStop = atrBasedStops && history && history.length > 21
      ? atrBasedStopPct(history, atrMultiplier, 63, atrMinStop, atrMaxStop)
      : trailingStopThreshold

    // Trailing stop: sell if the position has dropped below the high-water
    // mark by more than the trailing stop threshold. This locks in gains as
    // the position moves up, rather than using a fixed stop from entry price.
    //
    // Only fire when HWM > avgPrice — the trailing stop is meant to lock in
    // GAINS. If the position never went above its entry price (HWM = avgPrice),
    // there are no gains to lock in, and the fixed stop-loss below is the
    // appropriate guard. Without this guard, the trailing stop and fixed
    // stop-loss would both trigger at the same price when HWM = avgPrice, but
    // the trailing stop (checked first) would mask the fixed stop-loss signal.
    if (hwm > position.avgPrice && dropFromHwm >= effectiveTrailingStop) {
      recommendations.push({
        action: 'sell',
        ticker,
        reason: `Trailing stop triggered: price has dropped ${(dropFromHwm * 100).toFixed(1)}% from the high of ${(hwm / 100).toFixed(2)} (stop: ${(effectiveTrailingStop * 100).toFixed(1)}%${atrBasedStops ? ' ATR-based' : ''}). Locking in gains.`,
        confidence: 0.85,
        riskFlags: ['trailing_stop'],
      })
      continue
    }

    // Fixed stop-loss from entry price (backstop for positions that never went up)
    const stopLossPrice = position.avgPrice * (1 - stopLossThreshold)
    if (position.currentPrice <= stopLossPrice) {
      recommendations.push({
        action: 'sell',
        ticker,
        reason: `Stop-loss triggered: price has fallen ${(stopLossThreshold * 100).toFixed(0)}% below the average cost of ${(position.avgPrice / 100).toFixed(2)}.`,
        confidence: 0.85,
        riskFlags: ['stop_loss'],
      })
      continue
    }

    // Cut losers: sell when momentum turns negative
    if (rawReturn <= sellMomentumThreshold) {
      recommendations.push({
        action: 'sell',
        ticker,
        reason: `Momentum has turned negative (${(rawReturn * 100).toFixed(1)}% over the lookback window). Cutting the loser.`,
        confidence: 0.75,
        riskFlags: ['negative_momentum'],
      })
      continue
    }

    // Add to winners: strong positive momentum → buy more.
    // Dual-momentum filter: skip adding to an existing position if the asset's
    // absolute momentum is negative (rawReturn <= 0). We still hold — a trim
    // signal may come from alpha-mining — but we don't pour fresh cash into a
    // stock that is falling in absolute terms.
    if (momentumScore >= addMomentumThreshold && snapshot.cash > 0 && (!absoluteMomentumFilter || rawReturn > 0)) {
      recommendations.push({
        action: 'add',
        ticker,
        reason: `Strong positive momentum (${(momentumScore * 100).toFixed(0)}% over the lookback window). Adding to the winner.`,
        confidence: momentumScore,
        riskFlags: ['momentum_continuation'],
      })
      continue
    }

    // Moderate positive momentum → hold
    recommendations.push({
      action: 'hold',
      ticker,
      reason: `Moderate momentum (${(momentumScore * 100).toFixed(0)}%). Holding.`,
      confidence: momentumScore,
      riskFlags: [],
    })
  }

  // ── 2b. Rotation: trim underperformers to deploy into better picks ────
  // For each held position with a "hold" recommendation, check if there are
  // significantly better momentum picks in the universe. If the position's
  // score is below the trimScoreThreshold AND there are candidates with
  // materially higher scores, trim the position to rotate capital.
  const trimScore = config.trimScoreThreshold ?? 0.20
  const sellScore = config.sellScoreThreshold ?? 0.15
  const rotationGap = 0.15 // Minimum score gap to justify rotation

  // Find the best non-held candidates by momentum score
  const heldTickers = new Set(snapshot.positions.map((p) => p.ticker))
  const topCandidates = [...scoredAssets.values()]
    .filter((a) => !a.missingMarketData)
    .filter((a) => !heldTickers.has(a.ticker))
    .filter((a) => a.momentumScore >= (config.cashDeployScoreThreshold ?? 0.05))
    .sort((a, b) => b.momentumScore - a.momentumScore)
    .slice(0, 5)

  const bestCandidateScore = topCandidates.length > 0 ? topCandidates[0]!.momentumScore : 0

  if (topCandidates.length > 0 && bestCandidateScore > 0) {
    for (let i = 0; i < recommendations.length; i++) {
      const rec = recommendations[i]!
      // Only rotate positions that are held (hold or add recommendations)
      if (rec.action !== 'hold' && rec.action !== 'add') continue

      const asset = scoredAssets.get(rec.ticker!)
      if (!asset || asset.missingMarketData) continue

      // Trim if the position's score is below the sell threshold
      // OR if there's a candidate with a materially higher score
      const scoreGap = bestCandidateScore - asset.momentumScore
      if (asset.momentumScore < sellScore || scoreGap >= rotationGap) {
        recommendations[i] = {
          action: 'trim',
          ticker: rec.ticker!,
          reason: `Rotating: ${rec.ticker} scores ${(asset.momentumScore * 100).toFixed(0)}% vs top pick ${topCandidates[0]!.ticker} at ${(bestCandidateScore * 100).toFixed(0)}%. Trimming to redeploy.`,
          confidence: 0.65,
          riskFlags: ['rotation'],
        }
      }
    }
  }

  // ── 3. Cash deployment into top momentum picks ─────────────────────────
  // Apply market state gate: skip deployment in down markets
  if (marketGateScale > 0 && cashPct > cashDeployThreshold && snapshot.cash > 0) {
    // Exclude tickers that already have a sell/stop-loss recommendation —
    // deploying cash into a ticker we're simultaneously selling is
    // contradictory and the dedup guard would block the deploy anyway.
    const sellTickers = new Set(
      recommendations
        .filter((r) => r.action === 'sell' || r.action === 'reduce_exposure' || r.action === 'trim')
        .map((r) => r.ticker)
        .filter((t): t is string => !!t),
    )
    // Rank ALL assets (held or not) by momentum score, excluding those with
    // missing market data or an active sell recommendation. Deploy to the
    // top N above the score threshold.
    let candidates = [...scoredAssets.values()]
      .filter((asset) => !asset.missingMarketData)
      .filter((asset) => !sellTickers.has(asset.ticker))
      .filter((asset) => asset.momentumScore >= cashDeployScoreThreshold)
      // Dual-momentum absolute filter: only deploy cash into tickers whose
      // absolute (own) momentum is positive. Prevents buying the best of
      // a bad bunch when the broad market is falling.
      .filter((asset) => !absoluteMomentumFilter || asset.rawReturn > 0)
      .sort((a, b) => b.momentumScore - a.momentumScore)
      .slice(0, maxCashDeployTickers)

    // Sector concentration cap: don't let any single sector exceed maxSectorWeight
    // of the portfolio. We compute existing sector weights from held positions,
    // then greedily skip candidates whose sector would breach the cap.
    const sectorWeights = new Map<string, number>()
    if (maxSectorWeight > 0) {
      for (const pos of snapshot.positions) {
        const sector = getSector(pos.ticker)
        if (sector === 'market' || sector === 'other') continue
        const value = pos.currentPrice * pos.quantity
        const weight = (value / totalValue) * 100
        sectorWeights.set(sector, (sectorWeights.get(sector) ?? 0) + weight)
      }
    }

    // Rank-weighted deployment: concentrate capital in the top-scoring picks.
    // Weights decay linearly so the #1 candidate gets the largest allocation.
    // Sum of weights = 1; with 5 candidates: 0.29, 0.24, 0.20, 0.16, 0.12.
    const candidateCount = candidates.length
    const rankWeights = candidates.map((_, i) => (candidateCount - i) / ((candidateCount * (candidateCount + 1)) / 2))
    const totalWeight = rankWeights.reduce((a, b) => a + b, 0) || 1

    for (let i = 0; i < candidates.length; i++) {
      const asset = candidates[i]
      if (!asset) continue

      // Sector concentration cap: skip this candidate if adding a maxPositionWeight
      // target position would breach the sector limit.
      if (maxSectorWeight > 0) {
        const sector = getSector(asset.ticker)
        if (sector !== 'market' && sector !== 'other') {
          const currentSectorWeight = sectorWeights.get(sector) ?? 0
          const projectedAdd = Math.min(maxPositionWeight, 100 - currentSectorWeight)
          if (currentSectorWeight + projectedAdd > maxSectorWeight) {
            continue // Skip — sector already at cap
          }
          // Track that we're allocating projectedAdd to this sector for
          // subsequent candidates in the sorted list.
          sectorWeights.set(sector, currentSectorWeight + projectedAdd)
        }
      }

      const rankWeight = rankWeightedDeployment ? (rankWeights[i] ?? 0) / totalWeight : 1 / candidateCount
      // Review fix PR #220: average the two risk adjustments instead of
      // multiplying — compounding 0.5 × 0.5 = 0.25 over-penalises.
      const riskAdjustment = (asset.volScale + marketGateScale) / 2
      const scaledConfidence = asset.momentumScore * riskAdjustment
      recommendations.push({
        action: 'deploy_cash',
        ticker: asset.ticker,
        reason: rankWeightedDeployment
          ? `Cash is ${cashPct.toFixed(1)}% of the portfolio. Deploy #${i + 1}/${candidateCount} ranked momentum pick ${asset.ticker} (${(asset.momentumScore * 100).toFixed(0)}% score, ${(rankWeight * 100).toFixed(0)}% of cash slice).`
          : `Cash is ${cashPct.toFixed(1)}% of the portfolio. Deploy into ${asset.ticker}, the strongest momentum pick (${(asset.momentumScore * 100).toFixed(0)}% over the lookback window).`,
        // Confidence is scaled by risk adjustment and rank weight so the
        // simulator sizes larger positions to higher-ranked candidates.
        // The rankWeight already concentrates capital in top picks (e.g.
        // #1 gets 0.53, #5 gets 0.07 with 5 candidates), so no additional
        // candidateCount multiplier is needed — that caused non-linear
        // scaling and confidence clamping at 1.0 for top picks.
        confidence: Math.max(0, Math.min(1, scaledConfidence * rankWeight * 2)),
        riskFlags: ['cash_deployment'],
      })
    }
  }

  return recommendations
}

/**
 * Per-ticker universe score for the Winner/Loser dashboard.
 * Exposes the internal scoring data so the UI can show top winners/losers,
 * momentum scores, and current portfolio weights side-by-side.
 */
export interface UniverseScore {
  ticker: string
  /** Composite momentum score [0, 1] after all blending (multi-timeframe, rank, alpha, ML). */
  momentumScore: number
  /** Raw price return over the momentum lookback period (e.g. +0.35 = +35%). */
  rawReturn: number
  /** 52-week high proximity score [0, 1] (1 = at 52-week high). */
  week52High: number
  /** Volatility scale factor applied to position sizing. */
  volScale: number
  /** Time-series momentum score before cross-sectional blending. */
  timeSeriesScore: number
  /** Current portfolio weight as a percentage (0 = not held). */
  currentWeight: number
  /** Current price in minor units, or undefined if not held. */
  currentPrice?: number | undefined
  /** Quantity held, or undefined if not held. */
  quantity?: number | undefined
  /** True when market data is missing for this ticker. */
  missingMarketData: boolean
  /** Action recommended by the strategy for this ticker. */
  action: 'buy' | 'sell' | 'trim' | 'hold' | 'reduce_exposure' | 'deploy_cash' | 'add'
}

/**
 * Score every ticker in the universe and return per-ticker scores sorted by
 * momentum score (highest first). This is the data behind the Winner/Loser
 * dashboard — it shows which stocks the engine ranks highest and why.
 *
 * Calls generateMomentumRecommendations internally and maps the scored assets
 * to the UniverseScore type, enriched with the recommended action per ticker.
 */
export function scoreMomentumUniverse(
  snapshot: PortfolioSnapshot,
  marketData: Map<string, MarketData>,
  config: RiskConfig = {},
): UniverseScore[] {
  const recommendations = generateMomentumRecommendations(snapshot, marketData, config)
  const recByTicker = new Map(recommendations.filter((r) => r.ticker).map((r) => [r.ticker as string, r.action]))

  const totalValue = Math.max(snapshot.totalValue, 1)
  const allTickers = new Set<string>([
    ...snapshot.positions.map((p) => p.ticker),
    ...Array.from(marketData.keys()),
  ])

  const scores: UniverseScore[] = []
  for (const ticker of allTickers) {
    const md = marketData.get(ticker)
    const position = snapshot.positions.find((p) => p.ticker === ticker)
    const value = position ? position.currentPrice * position.quantity : 0
    const weight = (value / totalValue) * 100

    if (!md || md.history.length < (config.minLookback ?? 21)) {
      scores.push({
        ticker,
        momentumScore: 0,
        rawReturn: 0,
        week52High: 0,
        volScale: 1,
        timeSeriesScore: 0,
        currentWeight: weight,
        currentPrice: position?.currentPrice,
        quantity: position?.quantity,
        missingMarketData: true,
        action: recByTicker.get(ticker) ?? 'hold',
      })
      continue
    }

    const pureMomentum = computePureMomentumScore(
      md.history,
      config.minLookback ?? 21,
      config.momentumLookbackDays ?? 42,
    )
    const hasMultiTimeframe = (config.fastLookbackDays ?? 0) > 0
      && (config.mediumLookbackDays ?? 0) > 0
      && (config.slowLookbackDays ?? 0) > 0
    const timeSeriesScore = hasMultiTimeframe
      ? multiTimeframeMomentumScore(
          md.history,
          config.fastLookbackDays ?? 21,
          config.mediumLookbackDays ?? 63,
          config.slowLookbackDays ?? 126,
          config.fastWeight ?? 0.3,
          config.mediumWeight ?? 0.4,
          config.slowWeight ?? 0.3,
        )
      : pureMomentum.score
    const w52h = (config.week52HighWeight ?? 0) > 0 ? week52HighScore(md.history) : 0
    const volScale = volatilityScale(
      md.history,
      config.volScaleTargetVol ?? 0,
      config.volScaleLookbackDays ?? 126,
      config.volScaleMin ?? 0.2,
      config.volScaleMax ?? 2.0,
    )
    const blendedScore = (config.week52HighWeight ?? 0) > 0
      ? timeSeriesScore * (1 - (config.week52HighWeight ?? 0)) + w52h * (config.week52HighWeight ?? 0)
      : timeSeriesScore

    // Apply breakout scoring if enabled
    const breakoutWeight = config.breakoutWeight
    let finalScore = blendedScore
    if (breakoutWeight && breakoutWeight > 0) {
      const marketTicker = config.regimeMarketTicker ?? 'SPY_US_EQ'
      const marketMd = marketData.get(marketTicker)
      const breakout = breakoutScore(md, marketMd?.history)
      const acceleration = momentumAccelerationScore(md.history)
      finalScore = Math.max(0, Math.min(1,
        blendedScore * (1 - breakoutWeight)
        + breakout.score * breakoutWeight
        + acceleration * 0.10
      ))
    }

    scores.push({
      ticker,
      momentumScore: finalScore,
      rawReturn: pureMomentum.rawReturn,
      week52High: w52h,
      volScale,
      timeSeriesScore,
      currentWeight: weight,
      currentPrice: position?.currentPrice,
      quantity: position?.quantity,
      missingMarketData: false,
      action: recByTicker.get(ticker) ?? 'hold',
    })
  }

  // Sort by momentum score descending (top winners first)
  scores.sort((a, b) => b.momentumScore - a.momentumScore)
  return scores
}
