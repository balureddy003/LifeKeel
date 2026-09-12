/**
 * Phase 2 regime detector tests — macro indicator integration.
 */

import { describe, expect, it } from 'vitest'
import { detectRegime, detectRegimeFromMarketData } from '../regime-detector.js'
import type { PricePoint, MarketData } from '../types.js'

function buildRisingHistory(days: number): PricePoint[] {
  return Array.from({ length: days }, (_, i) => ({ date: `d${i}`, close: 100 + i * 0.5 }))
}

function buildFallingHistory(days: number): PricePoint[] {
  return Array.from({ length: days }, (_, i) => ({ date: `d${i}`, close: 100 - i * 0.5 }))
}

describe('detectRegime with macro indicators', () => {
  it('overrides to bear when VIX > 30 regardless of price action', () => {
    const history = buildRisingHistory(100) // bullish price action
    const result = detectRegime(history, { vix: 35 })
    expect(result.regime).toBe('bear')
    expect(result.vix).toBe(35)
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('downgrades bull to sideways when VIX is 20-30', () => {
    const history = buildRisingHistory(100) // strong uptrend
    const result = detectRegime(history, { vix: 25 })
    expect(result.regime).toBe('sideways')
    expect(result.vix).toBe(25)
  })

  it('downgrades bull to sideways when yield curve is inverted', () => {
    const history = buildRisingHistory(100)
    const result = detectRegime(history, { yieldCurveSpread: -0.15 })
    expect(result.regime).toBe('sideways')
    expect(result.yieldCurveSpread).toBe(-0.15)
  })

  it('reinforces bear when credit spreads are elevated', () => {
    const history = buildFallingHistory(100) // bearish price action
    const result = detectRegime(history, { creditSpread: 6.5 })
    expect(result.regime).toBe('bear')
    expect(result.creditSpread).toBe(6.5)
  })

  it('downgrades to sideways when credit spreads are elevated in bull market', () => {
    const history = buildRisingHistory(100)
    const result = detectRegime(history, { creditSpread: 6.0 })
    expect(result.regime).toBe('sideways')
  })

  it('classifies as bull when VIX < 20 and price action is bullish', () => {
    const history = buildRisingHistory(100)
    const result = detectRegime(history, { vix: 15 })
    expect(result.regime).toBe('bull')
    expect(result.vix).toBe(15)
  })

  it('falls back to macro-only classification when no price history', () => {
    const result = detectRegime([], { vix: 15 })
    expect(result.regime).toBe('bull')
    expect(result.confidence).toBe(0.5)
  })

  it('falls back to sideways when VIX 20-30 and no price history', () => {
    const result = detectRegime([], { vix: 25 })
    expect(result.regime).toBe('sideways')
  })

  it('returns bear when VIX > 30 and no price history', () => {
    const result = detectRegime([], { vix: 40 })
    expect(result.regime).toBe('bear')
  })

  it('preserves backward compatibility when no macro indicators provided', () => {
    const history = buildRisingHistory(100)
    const result = detectRegime(history)
    expect(result.vix).toBeUndefined()
    expect(result.yieldCurveSpread).toBeUndefined()
    expect(result.creditSpread).toBeUndefined()
    expect(result.regime).toBe('bull')
  })
})

describe('detectRegimeFromMarketData with macro indicators', () => {
  it('applies VIX override across multiple tickers', () => {
    const marketData = new Map<string, MarketData>([
      ['AAPL', { ticker: 'AAPL', history: buildRisingHistory(100) }],
      ['MSFT', { ticker: 'MSFT', history: buildRisingHistory(100) }],
    ])
    const result = detectRegimeFromMarketData(marketData, { vix: 35 })
    expect(result.regime).toBe('bear')
    expect(result.vix).toBe(35)
  })

  it('downgrades bull to sideways with elevated VIX', () => {
    const marketData = new Map<string, MarketData>([
      ['AAPL', { ticker: 'AAPL', history: buildRisingHistory(100) }],
    ])
    const result = detectRegimeFromMarketData(marketData, { vix: 22 })
    expect(result.regime).toBe('sideways')
  })

  it('works without macro indicators (backward compatible)', () => {
    const marketData = new Map<string, MarketData>([
      ['AAPL', { ticker: 'AAPL', history: buildRisingHistory(100) }],
    ])
    const result = detectRegimeFromMarketData(marketData)
    expect(result.vix).toBeUndefined()
    expect(result.regime).toBe('bull')
  })
})
