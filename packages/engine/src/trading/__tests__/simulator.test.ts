/**
 * Paper-trading simulator tests.
 */

import { describe, expect, it } from 'vitest'
import { simulateRecommendation } from '../simulator.js'
import type { PortfolioSnapshot, MarketData, StrategyRecommendation } from '../types.js'

function buildRisingHistory(days: number): { date: string; close: number }[] {
  const history: { date: string; close: number }[] = []
  for (let i = 0; i < days; i++) {
    history.push({ date: `2024-01-${String(i + 1).padStart(2, '0')}`, close: 100 + i * 0.5 })
  }
  return history
}

describe('simulateRecommendation', () => {
  it('simulates a trim reducing concentration', () => {
    const snapshot: PortfolioSnapshot = {
      totalValue: 100_000,
      cash: 0,
      positions: [{ ticker: 'AAPL', quantity: 1000, avgPrice: 80, currentPrice: 100 }],
    }
    const marketData = new Map<string, MarketData>([
      ['AAPL', { ticker: 'AAPL', history: buildRisingHistory(300) }],
    ])
    const recommendation: StrategyRecommendation = {
      action: 'trim',
      ticker: 'AAPL',
      reason: 'Concentration too high',
      confidence: 0.9,
      riskFlags: ['concentration'],
    }

    const result = simulateRecommendation(snapshot, marketData, recommendation)
    expect(result.before.maxConcentrationPct).toBe(100)
    expect(result.after.maxConcentrationPct).toBeLessThan(100)
    expect(result.deltas.cash).toBeGreaterThan(0)
    expect(result.trade.side).toBe('sell')
  })

  it('simulates a sell removing the position', () => {
    const snapshot: PortfolioSnapshot = {
      totalValue: 100_000,
      cash: 0,
      positions: [{ ticker: 'TSLA', quantity: 100, avgPrice: 200, currentPrice: 170 }],
    }
    const marketData = new Map<string, MarketData>()
    const recommendation: StrategyRecommendation = {
      action: 'sell',
      ticker: 'TSLA',
      reason: 'Stop loss',
      confidence: 0.85,
      riskFlags: ['stop_loss'],
    }

    const result = simulateRecommendation(snapshot, marketData, recommendation)
    expect(result.after.positions).toHaveLength(0)
    expect(result.after.cash).toBe(100 * 170)
  })

  it('simulates deploy_cash buying the target ticker', () => {
    const snapshot: PortfolioSnapshot = {
      totalValue: 100_000,
      cash: 20_000,
      positions: [{ ticker: 'VUAG', quantity: 100, avgPrice: 80, currentPrice: 85 }],
    }
    const marketData = new Map<string, MarketData>([
      ['VUAG', { ticker: 'VUAG', history: buildRisingHistory(300) }],
      ['AAPL', { ticker: 'AAPL', history: buildRisingHistory(300) }],
    ])
    const recommendation: StrategyRecommendation = {
      action: 'deploy_cash',
      ticker: 'AAPL',
      reason: 'Cash drag',
      confidence: 0.8,
      riskFlags: ['cash_drag'],
    }

    const result = simulateRecommendation(snapshot, marketData, recommendation)
    expect(result.after.positions.some((p) => p.ticker === 'AAPL')).toBe(true)
    expect(result.after.cash).toBeLessThan(snapshot.cash)
    expect(result.trade.side).toBe('buy')
  })

  it('simulates reduce_exposure de-risking the portfolio', () => {
    const snapshot: PortfolioSnapshot = {
      totalValue: 100_000,
      cash: 0,
      positions: [
        { ticker: 'AAPL', quantity: 100, avgPrice: 80, currentPrice: 100 },
        { ticker: 'TSLA', quantity: 100, avgPrice: 150, currentPrice: 160 },
      ],
    }
    const marketData = new Map<string, MarketData>([
      ['AAPL', { ticker: 'AAPL', history: buildRisingHistory(300) }],
      ['TSLA', { ticker: 'TSLA', history: buildRisingHistory(300) }],
    ])
    const recommendation: StrategyRecommendation = {
      action: 'reduce_exposure',
      reason: 'High volatility',
      confidence: 0.9,
      riskFlags: ['high_volatility'],
    }

    const result = simulateRecommendation(snapshot, marketData, recommendation)
    expect(result.after.cash).toBeGreaterThan(0)
    const totalQty = result.after.positions.reduce((s, p) => s + p.quantity, 0)
    expect(totalQty).toBeLessThan(
      snapshot.positions.reduce((s, p) => s + p.quantity, 0),
    )
  })

  it('uses strategy config maxPositionWeight when simulating a trim', () => {
    const snapshot: PortfolioSnapshot = {
      totalValue: 100_000,
      cash: 0,
      positions: [{ ticker: 'AAPL', quantity: 1000, avgPrice: 80, currentPrice: 100 }],
    }
    const marketData = new Map<string, MarketData>()
    const recommendation: StrategyRecommendation = {
      action: 'trim',
      ticker: 'AAPL',
      reason: 'Concentration too high',
      confidence: 0.9,
      riskFlags: ['concentration'],
    }

    const loose = simulateRecommendation(snapshot, marketData, recommendation, { maxPositionWeight: 50 })
    const strict = simulateRecommendation(snapshot, marketData, recommendation, { maxPositionWeight: 5 })

    expect(strict.trade.quantity).toBeGreaterThan(loose.trade.quantity)
  })
})
