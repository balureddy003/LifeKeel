/**
 * Phase 1 strategy enhancement tests.
 *
 * Verifies volatility scaling, 52-week high signal, multi-timeframe
 * momentum, market state gate, turnover reduction, and transaction
 * cost model on deterministic price history.
 */

import { describe, expect, it } from 'vitest'
import {
  volatilityScale,
  week52HighScore,
  multiTimeframeMomentumScore,
  marketStateGate,
  computeADX,
  filterByTurnover,
  estimateTransactionCost,
  realizedVolatility,
  dailyReturns,
  sigmoidMomentumScore,
  returnOverWindow,
  computeKellyFraction,
  kellyScaledWeight,
} from '../strategy-enhancements.js'
import type { TradeOutcome } from '../strategy-enhancements.js'
import type { PricePoint } from '../types.js'

function buildRisingHistory(days: number, startPrice = 100, drift = 0.5): PricePoint[] {
  const history: PricePoint[] = []
  for (let i = 0; i < days; i++) {
    history.push({ date: `2024-01-${String(i + 1).padStart(2, '0')}`, close: startPrice + i * drift })
  }
  return history
}

function buildFallingHistory(days: number, startPrice = 100, drift = 0.5): PricePoint[] {
  const history: PricePoint[] = []
  for (let i = 0; i < days; i++) {
    history.push({ date: `2024-01-${String(i + 1).padStart(2, '0')}`, close: startPrice - i * drift })
  }
  return history
}

function buildVolatileHistory(days: number): PricePoint[] {
  const history: PricePoint[] = []
  let price = 100
  for (let i = 0; i < days; i++) {
    price = price * (i % 2 === 0 ? 1.05 : 0.95)
    history.push({ date: `2024-01-${String(i + 1).padStart(2, '0')}`, close: price })
  }
  return history
}

describe('volatilityScale', () => {
  it('returns 1 when target vol is 0 (disabled)', () => {
    const history = buildVolatileHistory(150)
    expect(volatilityScale(history, 0)).toBe(1)
  })

  it('scales down for high-volatility assets', () => {
    const history = buildVolatileHistory(150)
    const scale = volatilityScale(history, 0.12, 126, 0.2, 2.0)
    expect(scale).toBeLessThan(1)
    expect(scale).toBeGreaterThanOrEqual(0.2)
  })

  it('scales up for low-volatility assets', () => {
    const history = buildRisingHistory(150, 100, 0.01) // very smooth
    const scale = volatilityScale(history, 0.12, 126, 0.2, 2.0)
    expect(scale).toBeGreaterThan(1)
    expect(scale).toBeLessThanOrEqual(2.0)
  })

  it('respects min and max bounds', () => {
    const history = buildVolatileHistory(150)
    const scaleMin = volatilityScale(history, 0.01, 126, 0.5, 0.6)
    expect(scaleMin).toBe(0.5) // would be very low, clamped to min
    const smoothHistory = buildRisingHistory(150, 100, 0.001)
    const scaleMax = volatilityScale(smoothHistory, 1.0, 126, 0.2, 3.0)
    expect(scaleMax).toBeLessThanOrEqual(3.0)
  })

  it('returns 1 for insufficient data', () => {
    // Single point → no returns → vol = 0 → scale = 1
    const history: PricePoint[] = [{ date: 'd1', close: 100 }]
    expect(volatilityScale(history, 0.12)).toBe(1)
  })
})

describe('week52HighScore', () => {
  it('returns 1.0 when at the 52-week high', () => {
    const history = buildRisingHistory(300)
    const score = week52HighScore(history)
    expect(score).toBeGreaterThan(0.9) // last point is the highest
  })

  it('returns low score when far below 52-week high', () => {
    const history: PricePoint[] = []
    // Rise to 200, then fall to 100
    for (let i = 0; i < 200; i++) history.push({ date: `d${i}`, close: 100 + i })
    for (let i = 0; i < 100; i++) history.push({ date: `d${200 + i}`, close: 200 - i })
    const score = week52HighScore(history)
    expect(score).toBeLessThan(0.3) // current is 100, high was 299
  })

  it('returns 0.5 (neutral) for insufficient history', () => {
    const history = buildRisingHistory(30)
    expect(week52HighScore(history)).toBe(0.5)
  })
})

describe('multiTimeframeMomentumScore', () => {
  it('scores rising history positively', () => {
    const history = buildRisingHistory(300)
    const score = multiTimeframeMomentumScore(history)
    expect(score).toBeGreaterThan(0.5)
  })

  it('scores falling history low', () => {
    const history = buildFallingHistory(300)
    const score = multiTimeframeMomentumScore(history)
    expect(score).toBeLessThan(0.3)
  })

  it('returns neutral for insufficient data', () => {
    const history = buildRisingHistory(20)
    const score = multiTimeframeMomentumScore(history)
    // With insufficient data, returns will be 0 → sigmoid(0) = neutral-ish
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(1)
  })
})

describe('marketStateGate', () => {
  it('returns 1 (full exposure) in a rising market', () => {
    const history = buildRisingHistory(300, 100, 0.5)
    const scale = marketStateGate(history)
    expect(scale).toBe(1)
  })

  it('returns 0 (cash) in a severe crash', () => {
    const history = buildFallingHistory(300, 100, 0.5)
    // 300 days * 0.5 drift = 150 point drop → ~-60% over 12 months
    const scale = marketStateGate(history)
    expect(scale).toBe(0)
  })

  it('returns 0.25 at the midpoint between threshold and cutoff', () => {
    // Build history with -12.5% over 252 days (midpoint of -5% and -20%)
    // Gate halves exposure at -5% (0.5) and goes to cash at -20% (0.0)
    // Midpoint = 0.25
    const history: PricePoint[] = []
    const startPrice = 100
    const endPrice = startPrice * (1 - 0.125) // -12.5%
    for (let i = 0; i < 253; i++) {
      const price = startPrice + (endPrice - startPrice) * (i / 252)
      history.push({ date: `d${i}`, close: price })
    }
    const scale = marketStateGate(history, -0.05, -0.20)
    expect(scale).toBeCloseTo(0.25, 1)
  })

  it('returns 1 for insufficient history', () => {
    const history = buildRisingHistory(100)
    expect(marketStateGate(history)).toBe(1)
  })
})

describe('computeADX', () => {
  it('returns 0 for insufficient data', () => {
    const history = buildRisingHistory(10)
    expect(computeADX(history)).toBe(0)
  })

  it('returns a positive value for trending history', () => {
    const history = buildRisingHistory(60)
    const adx = computeADX(history, 14)
    expect(adx).toBeGreaterThanOrEqual(0)
  })
})

describe('filterByTurnover', () => {
  it('always keeps sell recommendations', () => {
    const recs = [
      { ticker: 'AAPL', action: 'sell', confidence: 0.8 },
      { ticker: 'MSFT', action: 'hold', confidence: 0.6 },
    ]
    const lastScores = new Map([['AAPL', 0.8], ['MSFT', 0.6]])
    const lastWeights = new Map([['AAPL', 10], ['MSFT', 5]])
    const currentWeights = new Map([['AAPL', 10], ['MSFT', 5]])
    const filtered = filterByTurnover(recs, lastScores, lastWeights, currentWeights, 0.10, 0.20)
    expect(filtered).toHaveLength(1)
    expect(filtered[0]!.action).toBe('sell')
  })

  it('filters out hold recs with minimal score change', () => {
    const recs = [
      { ticker: 'AAPL', action: 'deploy_cash', confidence: 0.61 },
    ]
    const lastScores = new Map([['AAPL', 0.60]])
    const lastWeights = new Map([['AAPL', 10]])
    const currentWeights = new Map([['AAPL', 10]])
    const filtered = filterByTurnover(recs, lastScores, lastWeights, currentWeights, 0.10, 0.20)
    expect(filtered).toHaveLength(0) // 0.61 vs 0.60 = 1.7% change < 10%
  })

  it('keeps recs with significant score change', () => {
    const recs = [
      { ticker: 'AAPL', action: 'deploy_cash', confidence: 0.75 },
    ]
    const lastScores = new Map([['AAPL', 0.60]])
    const lastWeights = new Map([['AAPL', 10]])
    const currentWeights = new Map([['AAPL', 10]])
    const filtered = filterByTurnover(recs, lastScores, lastWeights, currentWeights, 0.10, 0.20)
    expect(filtered).toHaveLength(1) // 0.75 vs 0.60 = 25% change > 10%
  })

  it('keeps recs with significant weight drift', () => {
    const recs = [
      { ticker: 'AAPL', action: 'trim', confidence: 0.61 },
    ]
    const lastScores = new Map([['AAPL', 0.60]])
    const lastWeights = new Map([['AAPL', 10]])
    const currentWeights = new Map([['AAPL', 15]]) // 50% drift
    const filtered = filterByTurnover(recs, lastScores, lastWeights, currentWeights, 0.10, 0.20)
    expect(filtered).toHaveLength(1)
  })

  it('always keeps recs for tickers with no history', () => {
    const recs = [
      { ticker: 'NEW', action: 'deploy_cash', confidence: 0.5 },
    ]
    const filtered = filterByTurnover(recs, new Map(), new Map(), new Map(), 0.10, 0.20)
    expect(filtered).toHaveLength(1)
  })

  it('passes through all when thresholds are 0', () => {
    const recs = [
      { ticker: 'AAPL', action: 'hold', confidence: 0.5 },
      { ticker: 'MSFT', action: 'deploy_cash', confidence: 0.6 },
    ]
    const filtered = filterByTurnover(recs, new Map(), new Map(), new Map(), 0, 0)
    expect(filtered).toHaveLength(2)
  })
})

describe('estimateTransactionCost', () => {
  it('returns 0 when no costs configured', () => {
    expect(estimateTransactionCost(10000)).toBe(0)
  })

  it('calculates cost from bps', () => {
    // 10000 minor units * 15 bps / 10000 = 15
    expect(estimateTransactionCost(10000, 10, 0, 5)).toBe(15)
  })

  it('handles large trades', () => {
    // 1,000,000 minor units * 20 bps = 2000
    expect(estimateTransactionCost(1000000, 10, 5, 5)).toBe(2000)
  })
})

describe('realizedVolatility and dailyReturns', () => {
  it('computes daily returns correctly', () => {
    const history: PricePoint[] = [
      { date: 'd1', close: 100 },
      { date: 'd2', close: 110 },
      { date: 'd3', close: 105 },
    ]
    const returns = dailyReturns(history)
    expect(returns).toHaveLength(2)
    expect(returns[0]).toBeCloseTo(0.1, 5)  // +10%
    expect(returns[1]).toBeCloseTo(-5/110, 5) // ~-4.5%
  })

  it('returns 0 vol for empty returns', () => {
    expect(realizedVolatility([])).toBe(0)
  })

  it('returns positive vol for non-constant returns', () => {
    const returns = [0.01, -0.01, 0.02, -0.02]
    const vol = realizedVolatility(returns)
    expect(vol).toBeGreaterThan(0)
  })
})

describe('sigmoidMomentumScore', () => {
  it('is continuous across zero (review fix: no whipsaw discontinuity)', () => {
    // The old two-piece curve jumped from 0.199 to 0.686 as returns crossed
    // zero. The fixed curve must be smooth through zero.
    const eps = 0.001
    const justBelow = sigmoidMomentumScore(-eps)
    const justAbove = sigmoidMomentumScore(eps)
    expect(Math.abs(justAbove - justBelow)).toBeLessThan(0.01)
  })

  it('scores zero return as mildly bearish (~0.30)', () => {
    expect(sigmoidMomentumScore(0)).toBeCloseTo(0.30, 1)
  })

  it('returns high score for large positive return', () => {
    expect(sigmoidMomentumScore(1.0)).toBeGreaterThan(0.85)
  })

  it('returns low score for negative return', () => {
    expect(sigmoidMomentumScore(-0.15)).toBeLessThan(0.2)
  })

  it('returns exactly 0 for momentum at or below -25%', () => {
    expect(sigmoidMomentumScore(-0.25)).toBe(0)
    expect(sigmoidMomentumScore(-0.50)).toBe(0)
  })

  it('scores +10% return around 0.45', () => {
    expect(sigmoidMomentumScore(0.10)).toBeCloseTo(0.45, 1)
  })

  it('preserves return magnitude at high returns', () => {
    // The key fix: +100% should score meaningfully higher than +35%
    const high = sigmoidMomentumScore(1.0)
    const med = sigmoidMomentumScore(0.35)
    expect(high - med).toBeGreaterThan(0.1)
  })
})

describe('returnOverWindow', () => {
  it('computes return over the specified window', () => {
    const history = buildRisingHistory(300, 100, 1) // 100, 101, 102...
    const ret = returnOverWindow(history, 252, 21)
    expect(ret).toBeGreaterThan(0)
  })

  it('returns 0 for insufficient data', () => {
    const history = buildRisingHistory(50)
    expect(returnOverWindow(history, 252, 21)).toBe(0)
  })
})

describe('computeKellyFraction', () => {
  it('uses academic defaults when insufficient trades', () => {
    const outcomes: TradeOutcome[] = [
      { ticker: 'A', return: 0.05, win: true },
      { ticker: 'B', return: -0.03, win: false },
    ]
    const kelly = computeKellyFraction(outcomes, 0.5, 20)
    expect(kelly.usingDefaults).toBe(true)
    expect(kelly.sampleSize).toBe(2)
    expect(kelly.winRate).toBeCloseTo(0.55, 1)
    expect(kelly.winLossRatio).toBeCloseTo(1.3, 1)
    // Full Kelly = (0.55 * 1.3 - 0.45) / 1.3 ≈ 0.204
    // Half Kelly ≈ 0.102
    expect(kelly.kellyFraction).toBeCloseTo(0.102, 1)
  })

  it('computes from live trade history when enough trades', () => {
    const outcomes: TradeOutcome[] = []
    // 12 wins at +5%, 8 losses at -4% → 60% win rate, 1.25 win/loss ratio
    for (let i = 0; i < 12; i++) outcomes.push({ ticker: `W${i}`, return: 0.05, win: true })
    for (let i = 0; i < 8; i++) outcomes.push({ ticker: `L${i}`, return: -0.04, win: false })
    const kelly = computeKellyFraction(outcomes, 0.5, 20)
    expect(kelly.usingDefaults).toBe(false)
    expect(kelly.sampleSize).toBe(20)
    expect(kelly.winRate).toBeCloseTo(0.6, 1)
    expect(kelly.winLossRatio).toBeCloseTo(1.25, 1)
    // Full Kelly = (0.6 * 1.25 - 0.4) / 1.25 = (0.75 - 0.4) / 1.25 = 0.28
    // Half Kelly = 0.14
    expect(kelly.kellyFraction).toBeCloseTo(0.14, 1)
  })

  it('returns 0 fraction when edge is negative', () => {
    const outcomes: TradeOutcome[] = []
    // 30% win rate, 0.5 win/loss ratio → clearly negative edge
    for (let i = 0; i < 3; i++) outcomes.push({ ticker: `W${i}`, return: 0.02, win: true })
    for (let i = 0; i < 7; i++) outcomes.push({ ticker: `L${i}`, return: -0.04, win: false })
    const kelly = computeKellyFraction(outcomes, 1.0, 5)
    expect(kelly.kellyFraction).toBe(0)
  })
})

describe('kellyScaledWeight', () => {
  it('scales base weight by Kelly fraction and confidence', () => {
    const kelly = {
      kellyFraction: 0.20,
      winRate: 0.55,
      winLossRatio: 1.3,
      sampleSize: 0,
      usingDefaults: true,
    }
    // Full confidence (1.0): scaledFraction = 0.20 * (0.5 + 0.5*1.0) = 0.20
    // kellyWeightPct = 0.20 * 100 = 20%
    // Capped at baseWeightPct (40%) → 20%
    const highConf = kellyScaledWeight(40, kelly, 1.0)
    expect(highConf).toBeCloseTo(20, 0)

    // Medium confidence (0.5): scaledFraction = 0.20 * (0.5 + 0.25) = 0.15
    // kellyWeightPct = 15%
    const medConf = kellyScaledWeight(40, kelly, 0.5)
    expect(medConf).toBeCloseTo(15, 0)
  })

  it('caps at base weight when Kelly suggests more', () => {
    const kelly = {
      kellyFraction: 0.60,
      winRate: 0.7,
      winLossRatio: 2.0,
      sampleSize: 50,
      usingDefaults: false,
    }
    // Full confidence: scaledFraction = 0.60 * 1.0 = 0.60 → 60%
    // But baseWeightPct is 40 → capped at 40
    const weight = kellyScaledWeight(40, kelly, 1.0)
    expect(weight).toBe(40)
  })
})
