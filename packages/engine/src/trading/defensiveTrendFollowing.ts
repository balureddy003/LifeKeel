/**
 * Defensive Trend Following strategy engine.
 *
 * Combines three evidence-based layers:
 *   1. Trend/momentum filter — prefer assets with positive 12-month momentum
 *   2. Quality filter — prefer profitable companies (neutral placeholder if no data)
 *   3. Volatility targeting — scale exposure down when portfolio volatility is high
 *
 * Output is a set of deterministic, risk-first recommendations (buy/sell/trim/hold)
 * that can be surfaced to a user for paper-trading approval.
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
  multiTimeframeMomentumScore,
  marketStateGate,
  sigmoidMomentumScore,
  diversificationAdjustedVol,
} from './strategy-enhancements.js'

const TRADING_DAYS_PER_YEAR = 252

/** Standard deviation of daily returns, annualised. */
function annualisedVolatility(history: PricePoint[], minLookback: number): number {
  if (history.length < minLookback + 1) return 0
  const returns: number[] = []
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]?.close
    const curr = history[i]?.close
    if (prev !== undefined && prev > 0 && curr !== undefined) returns.push((curr - prev) / prev)
  }
  if (returns.length === 0) return 0
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR)
}

/**
 * 12-month return excluding the most recent month to avoid short-term reversal.
 *
 * The raw return is mapped through the shared continuous sigmoid
 * (sigmoidMomentumScore in strategy-enhancements.ts):
 *   - ≤ -25% return → 0.00 (hard floor: don't buy losers)
 *   - -20% return → ~0.06
 *   - 0% return   → ~0.35 (flat momentum is mildly bearish)
 *   - 10% return  → ~0.76
 *   - 30% return  → ~0.95 (ceiling)
 *
 * This replaces the old raw-return-clamped-to-[0,1] mapping, where a 30%
 * annual return scored just 0.30 — below the 0.5 cash-deploy threshold,
 * so the strategy never bought anything even in strong bull markets.
 *
 * Review fix (PR #220): the previous two-piece curve was discontinuous at
 * zero (0.199 at -0.1% vs 0.686 at +0.1%), causing whipsaw sensitivity.
 */
export function computeMomentumScore(history: PricePoint[], minLookback = 63, momentumLookbackDays = TRADING_DAYS_PER_YEAR): number {
  const skipRecent = 21 // ~1 month
  if (history.length < minLookback + skipRecent) return 0
  const end = history.length - 1
  const lookback = Math.min(momentumLookbackDays, history.length - skipRecent)
  const pastPoint = history[end - lookback]
  const recentPoint = history[end]
  if (!pastPoint || !recentPoint) return 0
  const past = pastPoint.close
  const recent = recentPoint.close
  if (past <= 0) return 0
  const raw = (recent - past) / past
  // Shared continuous sigmoid (review fix PR #220: the inline two-piece
  // curve was discontinuous at zero, causing whipsaw sensitivity).
  return sigmoidMomentumScore(raw)
}

/** Higher score for lower volatility. Returns a value between 0 and 1. */
export function computeVolatilityScore(
  history: PricePoint[],
  targetVolatility = 10,
  minLookback = 63,
): number {
  const vol = annualisedVolatility(history, minLookback)
  if (vol <= 0) return 0.5 // flatline price data is not a reliable signal, treat as neutral
  const targetDecimal = targetVolatility / 100
  return Math.max(0, Math.min(1, targetDecimal / vol))
}

/** Gross profitability normalised to a 0–1 score. Neutral if no data. */
export function computeQualityScore(grossProfitability?: number): number {
  if (grossProfitability === undefined || grossProfitability === null) return 0.5
  return Math.max(0, Math.min(1, grossProfitability * 3))
}

/**
 * Enhanced quality score using multiple fundamental metrics (Phase 2).
 *
 * Combines ROE, gross margin, and leverage into a single 0–1 score.
 * Falls back to the simple gross-profitability score when enhanced
 * fundamentals are not available, preserving backward compatibility.
 *
 * Evidence: Asness, Moskowitz, Pedersen (2013) show that combining
 * quality with momentum improves Sharpe by ~0.1–0.15.
 */
export function computeEnhancedQualityScore(fundamentals: {
  grossProfitability?: number | undefined
  roe?: number | undefined
  grossMargin?: number | undefined
  debtToEquity?: number | undefined
}): number {
  const { roe, grossMargin, debtToEquity, grossProfitability } = fundamentals

  // If we have enhanced fundamentals, use the multi-metric score
  if (roe !== undefined || grossMargin !== undefined || debtToEquity !== undefined) {
    const roeScore = roe !== undefined ? Math.max(0, Math.min(1, roe / 0.20)) : 0.5
    const marginScore = grossMargin !== undefined ? Math.max(0, Math.min(1, grossMargin / 0.50)) : 0.5
    const leverageScore = debtToEquity !== undefined ? Math.max(0, Math.min(1, 1 - debtToEquity / 2)) : 0.5
    return 0.4 * roeScore + 0.3 * marginScore + 0.3 * leverageScore
  }

  // Fall back to simple gross profitability score
  return computeQualityScore(grossProfitability)
}

function compositeScore(
  scores: { momentum: number; quality: number; volatility: number; week52High?: number; sentiment?: number },
  weights: { momentum: number; quality: number; volatility: number; week52High?: number; sentiment?: number },
): number {
  const total = weights.momentum + weights.quality + weights.volatility + (weights.week52High ?? 0) + (weights.sentiment ?? 0)
  if (total === 0) return 0
  return (
    scores.momentum * weights.momentum +
    scores.quality * weights.quality +
    scores.volatility * weights.volatility +
    (scores.week52High ?? 0) * (weights.week52High ?? 0) +
    (scores.sentiment ?? 0) * (weights.sentiment ?? 0)
  ) / total
}

function positionValue(position?: Position): number {
  if (!position) return 0
  return position.currentPrice * position.quantity
}

/**
 * Generate risk-first recommendations for a portfolio snapshot.
 *
 * The function is pure: it does not fetch market data or read from a database.
 * Callers supply a `Map<ticker, MarketData>` from any price-history source
 * (e.g., Alpha Vantage, Trading 212 metadata, or stored signal history).
 */
export function generateDefensiveTrendRecommendations(
  snapshot: PortfolioSnapshot,
  marketData: Map<string, MarketData>,
  config: RiskConfig = {},
): StrategyRecommendation[] {
  const {
    maxPositionWeight = 10,
    targetVolatility = 10,
    cashDeployThreshold = 5,
    stopLossThreshold = 0.10,
    minLookback = 63,
    qualityWeight = 0.35,
    momentumWeight = 0.40,
    volatilityWeight = 0.25,
    // Lowered from 0.5 → 0.45 → 0.35: with the rescaled momentum sigmoid, a
    // stock with 5% annual return + neutral quality + 25% vol now scores
    // ~0.45, clearing the deploy threshold. The reddy003 tenant had £39K
    // (37%) idle cash for 10 days with zero deployment — the 0.45 threshold
    // was still too conservative for real-world portfolios with mixed
    // momentum. 0.35 deploys into anything above neutral quality + slight
    // positive momentum, which is the right behaviour for a defensive
    // strategy that should be fully invested in uptrends.
    cashDeployScoreThreshold = 0.35,
    sellScoreThreshold = 0.3,
    trimScoreThreshold = 0.5,
    momentumLookbackDays = TRADING_DAYS_PER_YEAR,
    // Increased from 1 → 3: deploy cash to the top 3 scoring assets per
    // rebalance instead of just 1. This accelerates capital deployment and
    // captures more opportunities per rebalance cycle.
    maxCashDeployTickers = 3,
    reduceExposurePct = 0.20,
    // Phase 1 enhancements
    week52HighWeight = 0,
    fastLookbackDays,
    mediumLookbackDays,
    slowLookbackDays,
    fastWeight = 0.3,
    mediumWeight = 0.4,
    slowWeight = 0.3,
    volScaleTargetVol = 0,
    volScaleMin = 0.2,
    volScaleMax = 2.0,
    volScaleLookbackDays = 126,
    marketStateGateEnabled = false,
    marketStateGateTicker,
    marketStateGateThreshold = -0.05,
    marketStateGateCutoff = -0.20,
    sentimentWeight = 0,
  } = config

  const totalValue = Math.max(snapshot.totalValue, 1)
  const cashPct = (snapshot.cash / totalValue) * 100

  const weights = {
    momentum: momentumWeight,
    quality: qualityWeight,
    volatility: volatilityWeight,
    ...(week52HighWeight > 0 ? { week52High: week52HighWeight } : {}),
    ...(sentimentWeight > 0 ? { sentiment: sentimentWeight } : {}),
  }
  const recommendations: StrategyRecommendation[] = []

  // Market state gate: compute once from the market-index ticker
  let marketGateScale = 1
  if (marketStateGateEnabled && marketStateGateTicker) {
    const marketMd = marketData.get(marketStateGateTicker)
    if (marketMd) {
      marketGateScale = marketStateGate(marketMd.history, marketStateGateThreshold, marketStateGateCutoff)
    }
  }

  // ── 1. Score every asset in the universe ─────────────────────────────────────
  const allTickers = new Set<string>([
    ...snapshot.positions.map((p) => p.ticker),
    ...Array.from(marketData.keys()),
  ])

  const scoredAssets = new Map<string, {
    ticker: string
    momentum: number
    quality: number
    volatility: number
    week52High: number
    composite: number
    currentWeight: number
    annualisedVol: number
    volScale: number
    position?: Position
    missingMarketData?: boolean
  }>()

  let portfolioVolatility = 0
  let riskWeightSum = 0
  let riskPositionCount = 0

  for (const ticker of allTickers) {
    const md = marketData.get(ticker)
    const position = snapshot.positions.find((p) => p.ticker === ticker)
    const value = positionValue(position)
    const weight = (value / totalValue) * 100

    // Gap #5 (TRADING_ENGINE_GAPS.md): when a ticker has no MarketData entry
    // at all, momentum and volatility both hard-defaulted to 0, producing
    // composite = 0.5 * 0.35 = 0.175 — below the 0.3 sell threshold. Any
    // position whose ticker failed to match market data got a phantom "sell"
    // recommendation at 0.7 confidence purely from a data-matching failure.
    // With auto-trading enabled, this became a real pending trade to
    // liquidate the whole position, triggered by a lookup failure.
    //
    // Fix: skip scoring entirely for tickers with no market data. The
    // position is still included in the portfolio-volatility calculation
    // (with annualisedVol = 0), but no per-position recommendation is
    // generated — a data gap is not a sell signal.
    if (!md) {
      scoredAssets.set(ticker, {
        ticker,
        momentum: 0,
        quality: 0,
        volatility: 0,
        week52High: 0,
        composite: 0,
        currentWeight: weight,
        annualisedVol: 0,
        volScale: 1,
        missingMarketData: true,
        ...(position ? { position } : {}),
      })
      if (value > 0) {
        // Still contributes to portfolio volatility (as 0 — we don't know
        // the real volatility, so we don't inflate the portfolio risk score)
        riskWeightSum += weight / 100
      }
      continue
    }

    const momentum = (fastLookbackDays && mediumLookbackDays && slowLookbackDays)
      ? multiTimeframeMomentumScore(md.history, fastLookbackDays, mediumLookbackDays, slowLookbackDays, fastWeight, mediumWeight, slowWeight)
      : computeMomentumScore(md.history, minLookback, momentumLookbackDays)
    const volatility = computeVolatilityScore(md.history, targetVolatility, minLookback)
    // Gap #6 (TRADING_ENGINE_GAPS.md): replaced the hardcoded quality = 0.5
    // placeholder with the real computeQualityScore call. grossProfitability
    // comes from the Alpha Vantage OVERVIEW endpoint (stored as a
    // company_fundamentals signal, threaded through MarketData by
    // buildMarketDataFromSignals). When no fundamentals data is available,
    // computeQualityScore(undefined) returns 0.5 — the same neutral value as
    // the old placeholder, but now explicitly "no data" rather than "fake
    // data." This means the composite score is only affected by quality when
    // real fundamentals exist.
    // Phase 2: use enhanced quality score when ROE/margin/leverage are available.
    const quality = computeEnhancedQualityScore({
      grossProfitability: md.grossProfitability,
      roe: md.roe,
      grossMargin: md.grossMargin,
      debtToEquity: md.debtToEquity,
    })
    const w52h = week52HighWeight > 0 ? week52HighScore(md.history) : 0
    // Phase 2 sentiment factor (review wiring fix): neutral 0.5 when no
    // sentiment data exists, so enabling sentimentWeight without a sentiment
    // feed leaves the composite unchanged.
    const sentiment = sentimentWeight > 0 ? (md.sentimentScore ?? 0.5) : 0
    const composite = compositeScore(
      {
        momentum,
        quality,
        volatility,
        ...(week52HighWeight > 0 ? { week52High: w52h } : {}),
        ...(sentimentWeight > 0 ? { sentiment } : {}),
      },
      weights,
    )
    const annualisedVol = annualisedVolatility(md.history, minLookback)
    // Volatility scaling factor (Barroso & Santa-Clara 2015)
    const volScale = volatilityScale(md.history, volScaleTargetVol, volScaleLookbackDays, volScaleMin, volScaleMax)

    scoredAssets.set(ticker, {
      ticker,
      momentum,
      quality,
      volatility,
      week52High: w52h,
      composite,
      currentWeight: weight,
      annualisedVol,
      volScale,
      ...(position ? { position } : {}),
    })

    if (value > 0) {
      portfolioVolatility += (weight / 100) * annualisedVol
      riskWeightSum += weight / 100
      riskPositionCount += 1
    }
  }

  // Review fix PR #220: a weighted average of individual vols assumes perfect
  // correlation (ρ=1) and overestimates diversified portfolio vol by 40–70%,
  // causing unnecessary de-risking. Apply the standard equal-weight
  // diversification adjustment (assumed ρ̄ = 0.4).
  const averagePortfolioVolatility = riskWeightSum > 0
    ? diversificationAdjustedVol(portfolioVolatility / riskWeightSum, riskPositionCount)
    : 0
  const scaledVol = averagePortfolioVolatility * 100

  // ── 2. Portfolio-level risk recommendation ───────────────────────────────────
  if (scaledVol > targetVolatility) {
    recommendations.push({
      action: 'reduce_exposure',
      reason: `Portfolio volatility ${scaledVol.toFixed(1)}% exceeds the ${targetVolatility}% target. Reduce overall risk before adding new positions.`,
      confidence: Math.min(0.95, (scaledVol - targetVolatility) / targetVolatility),
      riskFlags: ['high_volatility'],
    })
  }

  // ── 3. Position-level recommendations ──────────────────────────────────────
  for (const asset of scoredAssets.values()) {
    const { ticker, position, currentWeight, composite } = asset
    if (!position) continue

    // Gap #5: skip composite-score-based recommendations for tickers with no
    // market data. A data gap is not a sell signal — the composite-score-based
    // sell/trim at line 247+ must not fire on a phantom score. However, the
    // stop-loss and concentration checks below use position data (avgPrice,
    // currentPrice, weight) which comes from the broker, not market data, so
    // they're still valid and must still run.
    const scored = scoredAssets.get(ticker)
    const missingMarketData = scored?.missingMarketData === true

    // Gap #9 (TRADING_ENGINE_GAPS.md): no asset-class awareness — every
    // holding (crypto, commodity ETF, etc.) was scored with equity-calibrated
    // momentum/volatility/10%-stop-loss logic. Non-stock assets have
    // fundamentally different risk profiles (crypto volatility is 3-5x
    // equities, commodities trend differently). Skip the equity-calibrated
    // composite-score and stop-loss checks for non-stock assets. The
    // concentration check (weight cap) still applies — concentration risk
    // is asset-class-agnostic.
    const isNonStock = position.assetClass && position.assetClass !== 'stock'

    const stopLossPrice = position.avgPrice ? position.avgPrice * (1 - stopLossThreshold) : 0
    if (!isNonStock && stopLossPrice > 0 && position.currentPrice <= stopLossPrice) {
      recommendations.push({
        action: 'sell',
        ticker,
        // currentPrice/avgPrice are minor units (pence) like the rest of the
        // pipeline — same raw-number-in-user-facing-text bug fixed in the
        // detector reasoning_templates, just a different code path.
        reason: `Position has fallen to £${(position.currentPrice / 100).toFixed(2)} against an average cost of £${(position.avgPrice / 100).toFixed(2)}. Stop-loss threshold (${(stopLossThreshold * 100).toFixed(0)}%) breached.`,
        confidence: 0.85,
        riskFlags: ['stop_loss'],
      })
      continue
    }

    if (currentWeight > maxPositionWeight) {
      recommendations.push({
        action: 'trim',
        ticker,
        reason: `Position weight ${currentWeight.toFixed(1)}% exceeds the ${maxPositionWeight}% cap. Trim to limit single-name concentration.`,
        confidence: Math.min(0.9, currentWeight / maxPositionWeight - 1),
        riskFlags: ['concentration'],
      })
      continue
    }

    // Gap #5: skip composite-score-based sell/trim for tickers with no
    // market data. The composite score is 0 when market data is missing
    // (not a real "weak" score), so the < 0.3 sell and < 0.5 trim thresholds
    // would fire on a phantom score — producing a confident sell
    // recommendation from a data lookup failure, not real analysis.
    // Gap #9: also skip for non-stock assets — equity-calibrated composite
    // scores don't apply to crypto/commodities/etc.
    if (missingMarketData || isNonStock) continue

    if (composite < sellScoreThreshold) {
      recommendations.push({
        action: 'sell',
        ticker,
        reason: `Composite momentum/quality/volatility score is ${(composite * 100).toFixed(0)} (weak). Position no longer meets defensive criteria.`,
        confidence: 0.7,
        riskFlags: ['weak_score'],
      })
      continue
    }

    if (composite < trimScoreThreshold) {
      recommendations.push({
        action: 'trim',
        ticker,
        reason: `Composite score is ${(composite * 100).toFixed(0)} — below the defensive threshold. Consider reducing exposure.`,
        confidence: 0.65,
        riskFlags: ['weak_score'],
      })
      continue
    }

    // Strong score and not oversized → hold
    recommendations.push({
      action: 'hold',
      ticker,
      reason: `Composite score is ${(composite * 100).toFixed(0)}. Position meets defensive criteria and stays within risk limits.`,
      confidence: composite,
      riskFlags: [],
    })
  }

  // ── 4. Cash deployment suggestion ───────────────────────────────────────────
  // Apply market state gate: skip cash deployment entirely in down markets
  if (marketGateScale <= 0) {
    // Market in crash territory — hold cash, don't deploy
  } else if (cashPct > cashDeployThreshold && !recommendations.some((r) => r.action === 'reduce_exposure')) {
    // Rank assets by composite score, excluding those already near the
    // maxPositionWeight cap. Deploy to the top N tickers above the score
    // threshold, not just one — spreads cash deployment and captures more
    // opportunities per rebalance.
    const candidates = [...scoredAssets.values()]
      .filter((asset) => asset.currentWeight <= maxPositionWeight * 0.8)
      .filter((asset) => !asset.missingMarketData)
      .sort((a, b) => b.composite - a.composite)

    const deployTickers = candidates
      .filter((asset) => asset.composite >= cashDeployScoreThreshold)
      .slice(0, maxCashDeployTickers)

    for (const asset of deployTickers) {
      // Review fix PR #220: previously confidence was composite * volScale *
      // marketGateScale — three multiplicative penalties compound
      // (0.6 × 0.5 × 0.5 = 0.15), over-penalising assets in mildly
      // unfavourable conditions. Use the average of the two risk adjustments
      // so each contributes proportionally without compounding.
      const riskAdjustment = (asset.volScale + marketGateScale) / 2
      const scaledConfidence = asset.composite * riskAdjustment
      recommendations.push({
        action: 'deploy_cash',
        ticker: asset.ticker,
        reason: `Cash is ${cashPct.toFixed(1)}% of the portfolio. Deploy excess cash into ${asset.ticker}, the highest-scoring defensive asset (${(asset.composite * 100).toFixed(0)}).`,
        confidence: Math.max(0, Math.min(1, scaledConfidence)),
        riskFlags: ['cash_drag'],
      })
    }
  }

  // ── 5. Cross-wrapper intelligence (tax-advantaged vs taxable) ─────────────
  // If the tenant holds taxable positions but no tax-advantaged positions,
  // gently nudge them to use the tax wrapper for new money. This is a
  // tax-efficiency signal rather than a trade action.
  //
  // Country-aware: the account-type values differ by country (e.g. 'isa'/
  // 'invest' for GB, 'cnc' for IN). The caller passes the correct values via
  // RiskConfig; defaults preserve backward compatibility with existing UK
  // tenants.
  const taxAdvantagedType = config.taxAdvantagedAccountType ?? 'isa'
  const taxableType = config.taxableAccountType ?? 'invest'
  const wrapperName = config.taxWrapperName ?? 'ISA'
  const hasTaxable = snapshot.positions.some((p) => p.accountType === taxableType)
  const hasTaxAdvantaged = snapshot.positions.some((p) => p.accountType === taxAdvantagedType)
  if (hasTaxable && !hasTaxAdvantaged) {
    recommendations.push({
      action: 'hold',
      reason: `You currently hold positions in a taxable account. Consider using your ${wrapperName} wrapper for new money so gains remain tax-free.`,
      confidence: 0.75,
      riskFlags: ['wrapper_preference'],
    })
  }

  return recommendations
}
