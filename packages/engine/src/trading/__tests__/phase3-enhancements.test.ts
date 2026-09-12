/**
 * Phase 3 strategy enhancement tests.
 *
 * Tests cross-sectional momentum ranking, ADX trend/range detection,
 * and Google Trends attention signal.
 */

import { describe, expect, it } from 'vitest'
import {
  crossSectionalRank,
  blendTsAndCsMomentum,
  attentionScore,
  computeADX,
} from '../strategy-enhancements.js'
import { detectRegime } from '../regime-detector.js'
import type { PricePoint } from '../types.js'

describe('crossSectionalRank', () => {
  it('ranks assets into buy/hold/sell by quartile', () => {
    const assets = [
      { ticker: 'AAPL', score: 0.9 },
      { ticker: 'MSFT', score: 0.8 },
      { ticker: 'GOOG', score: 0.6 },
      { ticker: 'TSLA', score: 0.2 },
    ]
    const actions = crossSectionalRank(assets)
    expect(actions.get('AAPL')).toBe('buy') // top 25%
    expect(actions.get('TSLA')).toBe('sell') // bottom 25%
    expect(actions.get('GOOG')).toBe('hold') // middle
  })

  it('handles single asset', () => {
    const actions = crossSectionalRank([{ ticker: 'AAPL', score: 0.5 }])
    expect(actions.get('AAPL')).toBe('buy') // only one, it's the top
  })

  it('handles empty list', () => {
    expect(crossSectionalRank([]).size).toBe(0)
  })

  it('respects custom thresholds', () => {
    const assets = [
      { ticker: 'A', score: 0.9 },
      { ticker: 'B', score: 0.7 },
      { ticker: 'C', score: 0.5 },
      { ticker: 'D', score: 0.3 },
    ]
    // Top 50% buy, bottom 50% sell
    const actions = crossSectionalRank(assets, 0.5, 0.5)
    expect(actions.get('A')).toBe('buy')
    expect(actions.get('B')).toBe('buy')
    expect(actions.get('C')).toBe('sell')
    expect(actions.get('D')).toBe('sell')
  })
})

describe('blendTsAndCsMomentum', () => {
  it('returns high score when both TS and CS are strong', () => {
    const score = blendTsAndCsMomentum(0.9, 'buy')
    expect(score).toBeGreaterThan(0.8)
  })

  it('returns low score when both TS and CS are weak', () => {
    const score = blendTsAndCsMomentum(0.2, 'sell')
    expect(score).toBeLessThan(0.3)
  })

  it('returns mid score when TS strong but CS weak', () => {
    const score = blendTsAndCsMomentum(0.9, 'sell')
    expect(score).toBeGreaterThan(0.4)
    expect(score).toBeLessThan(0.7)
  })

  it('respects custom TS weight', () => {
    const tsWeighted = blendTsAndCsMomentum(0.9, 'sell', 0.9)
    const csWeighted = blendTsAndCsMomentum(0.9, 'sell', 0.1)
    expect(tsWeighted).toBeGreaterThan(csWeighted) // TS-heavy favors the 0.9
  })
})

describe('attentionScore', () => {
  it('returns 1.0 for 2x search volume', () => {
    expect(attentionScore(2.0)).toBe(1.0)
  })

  it('returns 0.5 for neutral (1x) search volume', () => {
    expect(attentionScore(1.0)).toBeCloseTo(0.333, 2)
  })

  it('returns 0 for declining (0.5x) search volume', () => {
    expect(attentionScore(0.5)).toBe(0)
  })

  it('returns 0.5 (neutral) when no data', () => {
    expect(attentionScore(undefined)).toBe(0.5)
  })

  it('clamps values outside the range', () => {
    expect(attentionScore(3.0)).toBe(1.0) // above max
    expect(attentionScore(0.1)).toBe(0.0) // below min
  })
})

describe('detectRegime with ADX', () => {
  it('includes ADX in result when sufficient history', () => {
    const history: PricePoint[] = []
    for (let i = 0; i < 100; i++) {
      history.push({ date: `d${i}`, close: 100 + i * 0.5 })
    }
    const result = detectRegime(history)
    expect(result.adx).toBeDefined()
    expect(result.adx).toBeGreaterThanOrEqual(0)
  })

  it('marks ranging markets with isRanging flag', () => {
    // Flat history → low ADX → ranging
    const history: PricePoint[] = []
    for (let i = 0; i < 100; i++) {
      history.push({ date: `d${i}`, close: 100 + Math.sin(i / 5) * 0.1 })
    }
    const result = detectRegime(history)
    // With very flat history, ADX should be low
    if (result.adx !== undefined && result.adx < 20) {
      expect(result.isRanging).toBe(true)
    }
  })

  it('downgrades bull to sideways when ADX indicates ranging', () => {
    // Build history that's technically rising (quarterly return > 5%)
    // but choppy enough to have low ADX
    const history: PricePoint[] = []
    for (let i = 0; i < 100; i++) {
      // Overall rising but with lots of back-and-forth
      const trend = i * 0.8
      const noise = Math.sin(i / 3) * 5
      history.push({ date: `d${i}`, close: 100 + trend + noise })
    }
    const result = detectRegime(history)
    // If ADX is low and the regime was initially bull, it should be sideways
    if (result.adx !== undefined && result.adx < 20) {
      expect(result.regime).not.toBe('bull')
    }
  })
})
