/**
 * Market regime detection for regime-aware strategy switching.
 *
 * Classifies the current market state as 'bull', 'bear', or 'sideways'
 * based on portfolio-level price history and optional macro indicators
 * (VIX, yield curve, credit spreads). Uses a 63-day (quarter) rolling
 * return and volatility to determine the regime:
 *
 * - Bull:   positive 63-day return (> +5%) and low volatility (< 25% annualized)
 * - Bear:   negative 63-day return (< -5%) or high volatility (> 35% annualized)
 * - Sideways: everything else (flat return, moderate volatility)
 *
 * When macro indicators are provided (Phase 2), they override or reinforce
 * the price-based classification:
 * - VIX > 30 → bear (crisis), VIX > 20 → cautious (sideways)
 * - Yield curve inversion (10Y-2Y < 0) → bear bias
 * - Elevated credit spreads (HY > 5%) → bear bias
 *
 * The regime is used by the strategy engine to switch between defensive
 * (bear/sideways) and momentum (bull) modes, capturing upside in bull
 * markets while protecting capital in bear markets.
 *
 * The thresholds are deliberately conservative — a 5% quarterly return
 * is a weak bull signal, but the strategy switch is gradual (the defensive
 * strategy still deploys cash in sideways markets), so false positives
 * are low-cost.
 */

import type { PricePoint, MarketData } from './types.js'
import { computeADX } from './strategy-enhancements.js'

export type MarketRegime = 'bull' | 'bear' | 'sideways'

/**
 * Optional macro indicators that enhance regime detection (Phase 2).
 * All fields are optional — when absent, the detector falls back to
 * price-only classification.
 */
export interface MacroIndicators {
  /** Current VIX level (e.g. 18.5). */
  vix?: number | undefined
  /** 10Y-2Y yield curve spread in percent (e.g. -0.15 = inverted). */
  yieldCurveSpread?: number | undefined
  /** High-yield credit spread in percent (e.g. 4.2). */
  creditSpread?: number | undefined
}

export interface RegimeResult {
  regime: MarketRegime
  /** 63-day rolling return as a percentage (e.g. +12.5 = 12.5% gain) */
  quarterlyReturn: number
  /** Annualized volatility as a percentage (e.g. 18.3 = 18.3%) */
  annualizedVolatility: number
  /** Confidence in the regime classification [0, 1] */
  confidence: number
  /** VIX level if macro indicators were provided, undefined otherwise. */
  vix?: number | undefined
  /** Yield curve spread if provided. */
  yieldCurveSpread?: number | undefined
  /** Credit spread if provided. */
  creditSpread?: number | undefined
  /**
   * ADX (Average Directional Index) — trend strength indicator (Phase 3).
   * ADX > 25 = trending market (good for momentum), ADX < 20 = ranging
   * (momentum whipsaws). Undefined when insufficient price history.
   */
  adx?: number | undefined
  /** True when ADX indicates a ranging market (ADX < 20). */
  isRanging?: boolean | undefined
}

/**
 * Minimum number of price points required to classify the regime.
 * Set to 29 so that ADX (which needs 2*period+1 = 29 points for
 * period=14) is always computable when the price-based path runs.
 * Below this we fall back to macro-only classification.
 */
const MIN_HISTORY_POINTS = 29

/**
 * Detect the market regime from a single ticker's price history.
 * Uses the most recent 63 trading days (one quarter) for the rolling
 * return and volatility calculation. When macro indicators are provided,
 * they override or reinforce the price-based classification.
 */
export function detectRegime(history: PricePoint[], macro?: MacroIndicators): RegimeResult {
  // Macro override: VIX > 30 is always bear (crisis), regardless of price action
  if (macro?.vix !== undefined && macro.vix > 30) {
    const vol = macro.vix
    return {
      regime: 'bear',
      quarterlyReturn: 0,
      annualizedVolatility: vol,
      // Review fix PR #220: floor confidence at 0.5 so a VIX just over 30
      // still registers as a confident bear call (0.5) and scales up to 1.0
      // by VIX=50. Previously (vol-30)/20 gave 0.0 confidence at the
      // threshold, contradicting the "always bear" override.
      confidence: Math.min(1, 0.5 + (vol - 30) / 40),
      vix: macro.vix,
      yieldCurveSpread: macro.yieldCurveSpread,
      creditSpread: macro.creditSpread,
    }
  }

  if (history.length < MIN_HISTORY_POINTS) {
    // With macro data, we can still classify even without price history
    if (macro?.vix !== undefined) {
      if (macro.vix > 20) {
        return {
          regime: 'sideways',
          quarterlyReturn: 0,
          annualizedVolatility: macro.vix,
          confidence: 0.5,
          vix: macro.vix,
          yieldCurveSpread: macro.yieldCurveSpread,
          creditSpread: macro.creditSpread,
        }
      }
      return {
        regime: 'bull',
        quarterlyReturn: 0,
        annualizedVolatility: macro.vix,
        confidence: 0.5,
        vix: macro.vix,
        yieldCurveSpread: macro.yieldCurveSpread,
        creditSpread: macro.creditSpread,
      }
    }
    return {
      regime: 'sideways',
      quarterlyReturn: 0,
      annualizedVolatility: 0,
      confidence: 0,
    }
  }

  // Use the last 63 trading days (or all available if < 63)
  const window = history.slice(-63)
  const startPrice = window[0]!.close
  const endPrice = window[window.length - 1]!.close
  // Guard against corrupt price data (review fix PR #220): a zero/negative
  // start price divides by zero → Infinity/NaN, which would poison the
  // whole regime classification.
  if (startPrice <= 0 || endPrice <= 0) {
    return {
      regime: 'sideways',
      quarterlyReturn: 0,
      annualizedVolatility: 0,
      confidence: 0,
    }
  }
  const quarterlyReturn = ((endPrice - startPrice) / startPrice) * 100

  // Annualized volatility from daily returns. Simple returns (not log) for
  // consistency with strategy-enhancements.ts — mixing log and simple
  // returns makes volatility estimates disagree systematically between
  // components (review fix PR #220). Both prices must be positive or the
  // data point is skipped rather than producing NaN.
  const dailyReturns: number[] = []
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1]!.close
    const curr = window[i]!.close
    if (prev > 0 && curr > 0) dailyReturns.push((curr - prev) / prev)
  }
  const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / (dailyReturns.length || 1)
  const variance = dailyReturns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / (dailyReturns.length || 1)
  const dailyVol = Math.sqrt(variance)
  const annualizedVolatility = dailyVol * Math.sqrt(252) * 100

  // Classify regime from price action
  let regime: MarketRegime
  let confidence: number

  if (quarterlyReturn > 5 && annualizedVolatility < 25) {
    regime = 'bull'
    confidence = Math.min(1, quarterlyReturn / 15)
  } else if (quarterlyReturn < -5 || annualizedVolatility > 35) {
    regime = 'bear'
    confidence = Math.min(1, Math.max(
      Math.abs(quarterlyReturn) / 15,
      (annualizedVolatility - 35) / 20,
    ))
  } else {
    regime = 'sideways'
    const returnScore = 1 - Math.min(1, Math.abs(quarterlyReturn) / 5)
    const volScore = 1 - Math.min(1, Math.abs(annualizedVolatility - 20) / 15)
    confidence = (returnScore + volScore) / 2
  }

  // Macro reinforcement: override bull → sideways when macro signals are cautious
  if (macro) {
    // VIX 20-30 → downgrade bull to sideways (cautious)
    if (regime === 'bull' && macro.vix !== undefined && macro.vix > 20) {
      regime = 'sideways'
      confidence = Math.min(confidence, 0.6)
    }
    // Yield curve inversion → downgrade bull to sideways
    if (regime === 'bull' && macro.yieldCurveSpread !== undefined && macro.yieldCurveSpread < 0) {
      regime = 'sideways'
      confidence = Math.min(confidence, 0.6)
    }
    // Elevated credit spreads → reinforce bear
    if (macro.creditSpread !== undefined && macro.creditSpread > 5) {
      if (regime !== 'bear') {
        regime = 'sideways'
        confidence = Math.min(confidence, 0.5)
      } else {
        confidence = Math.min(1, confidence + 0.15)
      }
    }
  }

  const result: RegimeResult = { regime, quarterlyReturn, annualizedVolatility, confidence }
  if (macro?.vix !== undefined) result.vix = macro.vix
  if (macro?.yieldCurveSpread !== undefined) result.yieldCurveSpread = macro.yieldCurveSpread
  if (macro?.creditSpread !== undefined) result.creditSpread = macro.creditSpread

  // Phase 3: ADX trend-strength indicator. Downgrade bull to sideways
  // when ADX < 20 (ranging market — momentum strategies whipsaw here).
  const adx = computeADX(history, 14)
  if (adx > 0) {
    result.adx = Number(adx.toFixed(2))
    result.isRanging = adx < 20
    if (regime === 'bull' && adx < 20) {
      regime = 'sideways'
      confidence = Math.min(confidence, 0.5)
      result.regime = regime
      result.confidence = confidence
    }
  }

  return result
}

/**
 * Detect the market regime from multiple tickers' price histories.
 * Aggregates by computing the average quarterly return and volatility
 * across all tickers, then classifies the regime from the aggregate.
 *
 * This is more robust than single-ticker detection because it captures
 * the broad market trend rather than a single stock's movement.
 */
export function detectRegimeFromMarketData(marketData: Map<string, MarketData>, macro?: MacroIndicators): RegimeResult {
  const results: RegimeResult[] = []
  for (const data of marketData.values()) {
    if (data.history.length >= MIN_HISTORY_POINTS) {
      results.push(detectRegime(data.history, macro))
    }
  }

  if (results.length === 0) {
    // Fall back to macro-only classification if available
    if (macro) {
      return detectRegime([], macro)
    }
    return {
      regime: 'sideways',
      quarterlyReturn: 0,
      annualizedVolatility: 0,
      confidence: 0,
    }
  }

  // Aggregate: average return and volatility across all tickers
  const avgReturn = results.reduce((sum, r) => sum + r.quarterlyReturn, 0) / results.length
  const avgVol = results.reduce((sum, r) => sum + r.annualizedVolatility, 0) / results.length
  const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length

  // Re-classify from the aggregate metrics
  let regime: MarketRegime
  if (avgReturn > 5 && avgVol < 25) {
    regime = 'bull'
  } else if (avgReturn < -5 || avgVol > 35) {
    regime = 'bear'
  } else {
    regime = 'sideways'
  }

  // Apply macro overrides on the aggregate too
  if (macro) {
    if (macro.vix !== undefined && macro.vix > 30) {
      regime = 'bear'
    } else if (regime === 'bull' && macro.vix !== undefined && macro.vix > 20) {
      regime = 'sideways'
    }
    if (regime === 'bull' && macro.yieldCurveSpread !== undefined && macro.yieldCurveSpread < 0) {
      regime = 'sideways'
    }
  }

  const result: RegimeResult = {
    regime,
    quarterlyReturn: Number(avgReturn.toFixed(2)),
    annualizedVolatility: Number(avgVol.toFixed(2)),
    confidence: Number(avgConfidence.toFixed(2)),
  }
  if (macro?.vix !== undefined) result.vix = macro.vix
  if (macro?.yieldCurveSpread !== undefined) result.yieldCurveSpread = macro.yieldCurveSpread
  if (macro?.creditSpread !== undefined) result.creditSpread = macro.creditSpread
  return result
}

/**
 * Regime-aware strategy selector.
 *
 * Returns the strategy name and config overrides based on the detected
 * market regime:
 *
 * - Bull:     Use momentum strategy for maximum upside capture
 * - Bear:     Use defensive strategy with tighter stops and higher cash threshold
 * - Sideways: Use defensive strategy with default parameters
 *
 * The caller merges the returned config overrides with the tenant's
 * existing strategy config (overrides win).
 */
export function selectRegimeStrategy(
  regime: MarketRegime,
  baseConfig: Record<string, unknown> = {},
): { strategy: 'defensive' | 'momentum', configOverrides: Record<string, unknown> } {
  switch (regime) {
    case 'bull':
      return {
        strategy: 'momentum',
        configOverrides: {
          // In bull markets, deploy cash aggressively
          cashDeployThreshold: 1,
          maxCashDeployTickers: 5,
          // Wider stops — let winners run
          trailingStopThreshold: 0.20,
          stopLossThreshold: 0.15,
        },
      }
    case 'bear':
      return {
        strategy: 'defensive',
        configOverrides: {
          // In bear markets, hold more cash and cut losses faster
          cashDeployThreshold: 15,
          cashDeployScoreThreshold: 0.55,
          stopLossThreshold: 0.05,
          trimScoreThreshold: 0.45,
          reduceExposurePct: 0.30,
          maxCashDeployTickers: 1,
        },
      }
    case 'sideways':
      return {
        strategy: 'defensive',
        configOverrides: {
          // In sideways markets, use default defensive parameters
          // but with slightly lower deploy threshold to stay invested
          cashDeployThreshold: 5,
          cashDeployScoreThreshold: 0.35,
        },
      }
  }
}
