/**
 * Alpha mining module — short-term signal generators that discover trade
 * opportunities the weekly momentum rebalance misses.
 *
 * The momentum engine looks at 42-252 day windows. These signals operate on
 * 5-20 day windows, catching:
 *   - Breakout from consolidation (Bollinger Band squeeze breakout)
 *   - Mean-reversion bounces (RSI oversold + support touch)
 *   - Volume-weighted momentum surges (short-term price + volume confirmation)
 *   - Gap continuation (post-earnings or news gap that keeps running)
 *
 * All functions are pure and deterministic — no I/O, no side effects.
 * They return a signal score in [-1, 1] where:
 *   > 0 = bullish (buy/add signal)
 *   < 0 = bearish (sell/trim signal)
 *   0 = no signal
 *
 * The momentum engine blends these with the long-term momentum score to
 * generate more trade recommendations per rebalance cycle.
 */

import type { PricePoint } from './types.js'
import { dailyReturns, realizedVolatility } from './strategy-enhancements.js'

/**
 * RSI (Relative Strength Index) — measures overbought/oversold conditions.
 * RSI > 70 = overbought (potential sell), RSI < 30 = oversold (potential buy).
 *
 * We use a modified RSI that generates trade signals:
 *   - RSI < 30 → bullish mean-reversion signal (oversold bounce)
 *   - RSI > 70 → bearish signal (overbought, take profits)
 *   - 30-70 → neutral
 *
 * @param history Price history (most recent last)
 * @param period RSI period (default 14 days)
 * @returns Signal score in [-1, 1]
 */
export function rsiSignal(history: PricePoint[], period = 14): number {
  if (history.length < period + 1) return 0
  const closes = history.slice(-(period + 1)).map((p) => p.close)
  let gains = 0
  let losses = 0
  for (let i = 1; i < closes.length; i++) {
    const curr = closes[i]
    const prev = closes[i - 1]
    if (curr === undefined || prev === undefined) continue
    const change = curr - prev
    if (change > 0) gains += change
    else losses -= change
  }
  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 1 // all gains → extremely overbought
  const rs = avgGain / avgLoss
  const rsi = 100 - (100 / (1 + rs))

  // Map RSI to signal: oversold → buy, overbought → sell
  if (rsi < 30) {
    // Oversold: bullish mean-reversion signal, stronger as RSI goes lower
    return (30 - rsi) / 30 // 0 to 1
  }
  if (rsi > 70) {
    // Overbought: bearish signal, stronger as RSI goes higher
    return -(rsi - 70) / 30 // 0 to -1
  }
  return 0
}

/**
 * Bollinger Band breakout signal — detects when a stock breaks out of a
 * consolidation range. When price closes above the upper band after a
 * period of low volatility (squeeze), it signals a momentum breakout.
 *
 * @param history Price history (most recent last)
 * @param period Moving average period (default 20 days)
 * @param stdDev Number of standard deviations for bands (default 2.0)
 * @returns Signal score in [-1, 1]
 */
export function bollingerBreakoutSignal(
  history: PricePoint[],
  period = 20,
  stdDev = 2.0,
): number {
  if (history.length < period + 5) return 0
  const recent = history.slice(-period)
  const closes = recent.map((p) => p.close)
  const mean = closes.reduce((a, b) => a + b, 0) / closes.length
  const variance =
    closes.reduce((a, b) => a + (b - mean) ** 2, 0) / closes.length
  const sd = Math.sqrt(variance)
  if (sd <= 0) return 0

  const upperBand = mean + stdDev * sd
  const lowerBand = mean - stdDev * sd
  const currentPrice = history[history.length - 1]?.close
  if (currentPrice === undefined) return 0

  // Check for squeeze (low volatility period before breakout)
  // Compare current band width to recent average band width
  const bandWidth = (upperBand - lowerBand) / mean
  const lookbackSqueeze = history.slice(-period - 10, -period + 1)
  if (lookbackSqueeze.length >= 10) {
    const lbCloses = lookbackSqueeze.map((p) => p.close)
    const lbMean = lbCloses.reduce((a, b) => a + b, 0) / lbCloses.length
    const lbVar =
      lbCloses.reduce((a, b) => a + (b - lbMean) ** 2, 0) / lbCloses.length
    const lbSd = Math.sqrt(lbVar)
    const lbWidth = (2 * stdDev * lbSd) / lbMean
    // Squeeze: current band width < 80% of recent band width
    const isSqueeze = bandWidth < lbWidth * 0.8

    if (currentPrice > upperBand && isSqueeze) {
      // Breakout from squeeze → strong bullish signal
      const breakoutStrength = (currentPrice - upperBand) / sd
      return Math.min(1, breakoutStrength)
    }
    if (currentPrice < lowerBand && isSqueeze) {
      // Breakdown from squeeze → strong bearish signal
      const breakdownStrength = (lowerBand - currentPrice) / sd
      return Math.max(-1, -breakdownStrength)
    }
  }

  // Standard breakout (no squeeze requirement)
  if (currentPrice > upperBand) {
    return Math.min(0.5, (currentPrice - upperBand) / sd)
  }
  if (currentPrice < lowerBand) {
    return Math.max(-0.5, -(lowerBand - currentPrice) / sd)
  }
  return 0
}

/**
 * Short-term momentum surge — detects stocks that have surged in the last
 * 5-10 days with above-average volume (approximated by price movement
 * magnitude since we don't have volume data in MarketData).
 *
 * Uses the ratio of 5-day return to 20-day return: if the 5-day return
 * is much larger than the 20-day return, the stock is accelerating.
 *
 * @param history Price history (most recent last)
 * @returns Signal score in [-1, 1]
 */
export function shortTermSurgeSignal(history: PricePoint[]): number {
  if (history.length < 25) return 0
  const closes = history.map((p) => p.close)
  const current = closes[closes.length - 1]
  const fiveDaysAgo = closes[closes.length - 6]
  const twentyDaysAgo = closes[closes.length - 21]
  if (current === undefined || !fiveDaysAgo || !twentyDaysAgo || fiveDaysAgo <= 0 || twentyDaysAgo <= 0) return 0

  const fiveDayReturn = (current - fiveDaysAgo) / fiveDaysAgo
  const twentyDayReturn = (current - twentyDaysAgo) / twentyDaysAgo

  // Acceleration: 5-day return is much larger than 20-day return
  // This means most of the 20-day move happened in the last 5 days
  if (twentyDayReturn === 0) return 0
  const acceleration = fiveDayReturn / Math.abs(twentyDayReturn)

  // If 5-day return > 50% of 20-day return, it's accelerating
  if (fiveDayReturn > 0 && acceleration > 0.5) {
    return Math.min(1, acceleration - 0.5)
  }
  // Deceleration: 5-day return is negative while 20-day is positive
  if (fiveDayReturn < 0 && twentyDayReturn > 0) {
    return Math.max(-1, fiveDayReturn / Math.abs(twentyDayReturn))
  }
  return 0
}

/**
 * Gap continuation signal — detects when a stock has gapped up (or down)
 * and is continuing in the gap direction. This catches post-earnings or
 * news-driven moves that keep running.
 *
 * A gap is defined as today's open being > 2% away from yesterday's close.
 * Since we only have close data (not OHLC), we approximate using
 * consecutive day-to-day returns: a >3% single-day move followed by
 * continuation in the same direction.
 *
 * @param history Price history (most recent last)
 * @returns Signal score in [-1, 1]
 */
export function gapContinuationSignal(history: PricePoint[]): number {
  if (history.length < 5) return 0
  const closes = history.slice(-5).map((p) => p.close)
  const returns = dailyReturns(history.slice(-5))
  if (returns.length < 3) return 0

  // Look for a large single-day move (> 3%) followed by continuation
  for (let i = 0; i < returns.length - 1; i++) {
    const dayReturn = returns[i]
    if (!dayReturn) continue
    if (Math.abs(dayReturn) > 0.03) {
      // Large move detected — check if next day continues in same direction
      const continuation = returns[i + 1]
      if (continuation === undefined) continue
      if (dayReturn > 0 && continuation > 0) {
        // Bullish gap + continuation
        return Math.min(1, dayReturn + continuation)
      }
      if (dayReturn < 0 && continuation < 0) {
        // Bearish gap + continuation
        return Math.max(-1, dayReturn + continuation)
      }
    }
  }
  return 0
}

/**
 * Volatility contraction pattern (VCP) — detects stocks where volatility
 * is contracting (tighter daily ranges) before a potential breakout.
 * This is Mark Minervini's VCP pattern: successive contractions in price
 * volatility indicate institutional accumulation before a breakout.
 *
 * @param history Price history (most recent last)
 * @returns Signal score in [0, 1] — higher = more contracted (closer to breakout)
 */
export function volatilityContractionSignal(history: PricePoint[]): number {
  if (history.length < 40) return 0
  // Compare recent 10-day vol to prior 20-day vol
  const recent10 = dailyReturns(history.slice(-11))
  const prior20 = dailyReturns(history.slice(-31, -10))
  if (recent10.length < 5 || prior20.length < 10) return 0

  const recentVol = realizedVolatility(recent10)
  const priorVol = realizedVolatility(prior20)
  if (priorVol <= 0) return 0

  // Contraction ratio: < 1 means vol is decreasing (contracting)
  const contractionRatio = recentVol / priorVol
  if (contractionRatio < 0.6) {
    // Strong contraction → high breakout probability
    return Math.min(1, (0.6 - contractionRatio) / 0.6 + 0.3)
  }
  return 0
}

/**
 * Composite alpha signal — combines all short-term signals into a single
 * score that can be blended with the long-term momentum score.
 *
 * Weighting:
 *   - RSI: 20% (mean-reversion counter-signal)
 *   - Bollinger breakout: 30% (trend continuation)
 *   - Short-term surge: 25% (momentum acceleration)
 *   - Gap continuation: 15% (news/event-driven)
 *   - VCP: 10% (breakout setup detector, always positive)
 *
 * @param history Price history (most recent last)
 * @returns Composite signal score in [-1, 1]
 */
export function compositeAlphaSignal(history: PricePoint[]): number {
  const rsi = rsiSignal(history)
  const bollinger = bollingerBreakoutSignal(history)
  const surge = shortTermSurgeSignal(history)
  const gap = gapContinuationSignal(history)
  const vcp = volatilityContractionSignal(history)

  // VCP is a setup detector (always 0 to 1), not directional.
  // Use it as a confidence multiplier on the directional signals.
  const directional = rsi * 0.2 + bollinger * 0.3 + surge * 0.25 + gap * 0.15
  const vcpBoost = vcp * 0.1

  // If VCP detects a contraction (breakout setup), boost directional signals
  const boosted = vcp > 0.3 && directional > 0 ? directional * (1 + vcp * 0.3) : directional

  return Math.max(-1, Math.min(1, boosted + vcpBoost))
}

/**
 * Generate short-term trade recommendations from alpha signals.
 *
 * This is the main entry point for the alpha-mining module. The momentum
 * engine calls this to discover additional trade opportunities beyond
 * the long-term momentum score.
 *
 * @param history Price history (most recent last)
 * @param currentPrice Current price for signal context
 * @returns Signal with direction, strength, and reason
 */
export interface AlphaSignal {
  /** Signal score in [-1, 1] — positive = bullish, negative = bearish */
  score: number
  /** Human-readable reason for the signal */
  reason: string
  /** Which sub-signals fired */
  components: {
    rsi: number
    bollinger: number
    surge: number
    gap: number
    vcp: number
  }
}

export function mineAlphaSignal(history: PricePoint[]): AlphaSignal {
  const rsi = rsiSignal(history)
  const bollinger = bollingerBreakoutSignal(history)
  const surge = shortTermSurgeSignal(history)
  const gap = gapContinuationSignal(history)
  const vcp = volatilityContractionSignal(history)
  const score = compositeAlphaSignal(history)

  const reasons: string[] = []
  if (rsi > 0.3) reasons.push('RSI oversold bounce')
  if (rsi < -0.3) reasons.push('RSI overbought')
  if (bollinger > 0.3) reasons.push('Bollinger breakout')
  if (bollinger < -0.3) reasons.push('Bollinger breakdown')
  if (surge > 0.3) reasons.push('Short-term momentum surge')
  if (surge < -0.3) reasons.push('Momentum deceleration')
  if (gap > 0.3) reasons.push('Gap continuation')
  if (gap < -0.3) reasons.push('Gap reversal')
  if (vcp > 0.3) reasons.push('Volatility contraction (breakout setup)')

  return {
    score,
    reason: reasons.length > 0 ? reasons.join(', ') : 'No short-term signal',
    components: { rsi, bollinger, surge, gap, vcp },
  }
}
