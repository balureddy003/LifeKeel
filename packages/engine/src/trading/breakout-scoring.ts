/**
 * Breakout Detection & Early Trend Scoring
 *
 * Instead of buying stocks that already surged (pure momentum), this module
 * detects stocks that are JUST STARTING to break out — before the big move.
 *
 * Three signals combine:
 *
 * 1. VCP (Volatility Contraction Pattern): Price consolidates with decreasing
 *    volatility after an uptrend, then breaks out. This is the highest-
 *    probability entry point — the stock has proven demand, consolidated
 *    supply, and is now resuming the uptrend.
 *
 * 2. Volume surge: Breakout on above-average volume confirms institutional
 *    buying. Without volume, breakouts fail 60%+ of the time.
 *
 * 3. Relative strength: Stock is outperforming the market over the last 20
 *    days — money is flowing INTO this stock while the market is flat or
 *    down. This catches stocks at the START of their move.
 *
 * 4. Earnings acceleration: Stock has positive earnings momentum (ROE > 15%,
 *    gross margin > 30%). This filters out junk breakouts.
 *
 * The combined score favors stocks that are:
 * - Breaking out of a consolidation (not already extended)
 * - Showing volume confirmation
 * - Outperforming the market recently
 * - Have strong fundamentals backing the move
 *
 * This is the approach used by CAN SLIM (O'Neil) and Minervini templates:
 * buy stocks breaking out of bases with earnings growth, before they
 * become "obvious" momentum winners.
 */

import type { PricePoint, MarketData } from './types.js'
import { dailyReturns, realizedVolatility, returnOverWindow, computeADX } from './strategy-enhancements.js'

/**
 * Detect volatility contraction pattern (VCP).
 *
 * A VCP is characterized by:
 * - An uptrend over the last 3-6 months (stock is in demand)
 * - Decreasing volatility in recent weeks (supply is being absorbed)
 * - Price tightening near the highs (ready to break out)
 *
 * Returns a score [0, 1] where:
 * - 1.0 = perfect VCP (strong prior uptrend, tight consolidation, near highs)
 * - 0.0 = no VCP (no uptrend, or still volatile, or far from highs)
 */
export function vcpBreakoutScore(history: PricePoint[]): number {
  if (history.length < 60) return 0

  const recent = history.slice(-60)
  const closes = recent.map((p) => p.close)

  // 1. Prior uptrend: stock should be up over the last 3-6 months
  const threeMonthReturn = (closes[closes.length - 1]! - closes[0]!) / closes[0]!
  if (threeMonthReturn < 0.05) return 0 // Need at least 5% uptrend

  // 2. Volatility contraction: recent volatility should be LOWER than prior
  const recentVol = realizedVolatility(dailyReturns(recent.slice(-20)))
  const priorVol = realizedVolatility(dailyReturns(recent.slice(-40, -20)))
  if (priorVol <= 0) return 0
  const contractionRatio = recentVol / priorVol
  // Lower ratio = more contraction = better setup
  const contractionScore = contractionRatio < 0.4 ? 1.0
    : contractionRatio < 0.6 ? 0.7
    : contractionRatio < 0.8 ? 0.4
    : contractionRatio < 1.0 ? 0.2
    : 0

  // 3. Near highs: price should be within 5% of the 3-month high
  const threeMonthHigh = Math.max(...closes)
  const currentPrice = closes[closes.length - 1]!
  const pctFromHigh = (threeMonthHigh - currentPrice) / threeMonthHigh
  const nearHighsScore = pctFromHigh < 0.02 ? 1.0
    : pctFromHigh < 0.05 ? 0.8
    : pctFromHigh < 0.10 ? 0.5
    : pctFromHigh < 0.15 ? 0.3
    : 0

  // 4. Trend strength (ADX): strong trend = more reliable breakout
  const adx = computeADX(history, 14)
  const adxScore = adx > 30 ? 1.0
    : adx > 25 ? 0.7
    : adx > 20 ? 0.4
    : 0

  // Weighted combination
  return 0.30 * contractionScore + 0.30 * nearHighsScore + 0.25 * adxScore + 0.15 * Math.min(1, threeMonthReturn / 0.30)
}

/**
 * Volume surge detection.
 *
 * A breakout on above-average volume is 2-3x more likely to succeed
 * than a breakout on below-average volume. This detects whether the
 * recent trading volume is surging.
 *
 * Note: Our PricePoint type doesn't have volume, so we use price range
 * as a proxy (high daily range = high volume, per the price-volume
 * relationship documented by Schwert 1990).
 *
 * Returns a score [0, 1] where 1.0 = strong volume surge.
 */
export function volumeSurgeScore(history: PricePoint[]): number {
  if (history.length < 30) return 0

  const recent = history.slice(-5)
  const prior = history.slice(-30, -5)

  // Use absolute daily returns as volume proxy
  const recentRanges = recent.map((p) => Math.abs(p.close))
  const priorRanges = prior.map((p) => Math.abs(p.close))

  const recentAvg = recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length
  const priorAvg = priorRanges.reduce((a, b) => a + b, 0) / priorRanges.length

  if (priorAvg <= 0) return 0

  // Also check if recent daily moves are larger than prior (price acceleration)
  const recentReturns = dailyReturns(recent)
  const priorReturns = dailyReturns(prior)
  const recentAvgMove = recentReturns.reduce((a, b) => a + Math.abs(b), 0) / recentReturns.length
  const priorAvgMove = priorReturns.reduce((a, b) => a + Math.abs(b), 0) / priorReturns.length

  if (priorAvgMove <= 0) return 0

  const surgeRatio = recentAvgMove / priorAvgMove
  return surgeRatio > 2.0 ? 1.0
    : surgeRatio > 1.5 ? 0.7
    : surgeRatio > 1.2 ? 0.4
    : surgeRatio > 1.0 ? 0.2
    : 0
}

/**
 * Relative strength vs market.
 *
 * Stocks that outperform the market over 20 days tend to continue
 * outperforming for the next 3-6 months (Jegadeesh & Titman 1993,
 * Moskowitz & Grinblatt 1999). This catches stocks at the START
 * of their momentum phase — before they become "obvious" winners.
 *
 * Returns a score [0, 1] where 1.0 = strong outperformance.
 */
export function relativeStrengthScore(
  history: PricePoint[],
  marketHistory?: PricePoint[],
): number {
  if (history.length < 21 || !marketHistory || marketHistory.length < 21) {
    // Without market data, use absolute 20-day return
    const ret20 = returnOverWindow(history, 20)
    return Math.max(0, Math.min(1, (ret20 + 0.05) / 0.20))
  }

  const stock20d = returnOverWindow(history, 20)
  const market20d = returnOverWindow(marketHistory, 20)
  const excess = stock20d - market20d

  // Excess return of +5% over market = max score
  return Math.max(0, Math.min(1, (excess + 0.02) / 0.08))
}

/**
 * Earnings quality filter.
 *
 * Only buy breakouts that have fundamental support. A stock breaking
 * out with strong earnings growth is 3x more likely to follow through
 * than a breakout with weak fundamentals (O'Neil CAN SLIM studies).
 *
 * Returns a score [0, 1] where 1.0 = excellent fundamentals.
 */
export function earningsQualityScore(md: MarketData): number {
  const { roe, grossMargin, debtToEquity, grossProfitability } = md

  // If no fundamentals data, return neutral (don't block trading)
  if (roe === undefined && grossMargin === undefined && debtToEquity === undefined) {
    return 0.5
  }

  // ROE: > 20% is excellent (O'Neil requires 17%+ for CAN SLIM)
  const roeScore = roe !== undefined
    ? roe >= 0.25 ? 1.0
      : roe >= 0.17 ? 0.8
      : roe >= 0.10 ? 0.5
      : roe >= 0.05 ? 0.3
      : 0
    : 0.5

  // Gross margin: > 40% is strong
  const marginScore = grossMargin !== undefined
    ? grossMargin >= 0.50 ? 1.0
      : grossMargin >= 0.30 ? 0.7
      : grossMargin >= 0.15 ? 0.4
      : 0.2
    : 0.5

  // Low debt: debt/equity < 0.5 is safe
  const leverageScore = debtToEquity !== undefined
    ? debtToEquity < 0.3 ? 1.0
      : debtToEquity < 0.5 ? 0.8
      : debtToEquity < 1.0 ? 0.5
      : 0.2
    : 0.5

  // Gross profitability (Novy-Marx factor): > 0.50 is excellent
  const gpScore = grossProfitability !== undefined
    ? grossProfitability >= 0.50 ? 1.0
      : grossProfitability >= 0.30 ? 0.7
      : grossProfitability >= 0.15 ? 0.4
      : 0.2
    : 0.5

  return 0.35 * roeScore + 0.25 * marginScore + 0.20 * leverageScore + 0.20 * gpScore
}

/**
 * Combined breakout score — the main entry point.
 *
 * Combines VCP breakout detection, volume surge, relative strength,
 * and earnings quality into a single score [0, 1].
 *
 * Weighting:
 *   - VCP breakout setup: 30% (the pattern itself)
 *   - Volume surge: 15% (confirmation)
 *   - Relative strength: 25% (money flowing in)
 *   - Earnings quality: 30% (fundamental backing)
 *
 * This favors stocks that are:
 * 1. Breaking out of a consolidation (not already extended 200%)
 * 2. Showing volume/price acceleration
 * 3. Outperforming the market
 * 4. Backed by strong earnings and profitability
 *
 * @param md Market data with price history and fundamentals
 * @param marketHistory Optional market index history for relative strength
 * @returns Combined breakout score [0, 1]
 */
export function breakoutScore(
  md: MarketData,
  marketHistory?: PricePoint[],
): { score: number; components: { vcp: number; volume: number; relativeStrength: number; earnings: number } } {
  const vcp = vcpBreakoutScore(md.history)
  const volume = volumeSurgeScore(md.history)
  const relativeStrength = relativeStrengthScore(md.history, marketHistory)
  const earnings = earningsQualityScore(md)

  const score = 0.30 * vcp + 0.15 * volume + 0.25 * relativeStrength + 0.30 * earnings

  return { score, components: { vcp, volume, relativeStrength, earnings } }
}

/**
 * Acceleration score — detects stocks whose momentum is ACCELERATING.
 *
 * A stock that went from +5% to +15% to +30% is accelerating — the
 * momentum is getting stronger, not weaker. This is a stronger signal
 * than a stock that went from +100% to +110% to +115% (decelerating).
 *
 * Compares the recent 20-day return to the prior 20-day return.
 * If recent > prior, momentum is accelerating.
 *
 * Returns a score [0, 1] where 1.0 = strong acceleration.
 */
export function momentumAccelerationScore(history: PricePoint[]): number {
  if (history.length < 45) return 0

  const recentRet = returnOverWindow(history, 20)
  const priorRet = returnOverWindow(history.slice(0, -20), 20)

  // Acceleration = recent return - prior return
  const acceleration = recentRet - priorRet

  // Positive acceleration = momentum building
  // +10% acceleration = max score
  return Math.max(0, Math.min(1, (acceleration + 0.02) / 0.12))
}
