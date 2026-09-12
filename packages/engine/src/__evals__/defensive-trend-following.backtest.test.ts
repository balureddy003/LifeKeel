/**
 * Defensive Trend Following (DTFE) backtest evaluation.
 *
 * Runs the DTFE strategy on synthetic multi-asset price histories and compares
 * the resulting portfolio path to a buy-and-hold benchmark. This is a minimal
 * sanity harness for the strategy layer; it is not a production trading strategy
 * and makes no real-money trades.
 */

import { describe, it, expect } from 'vitest'
import {
  generateDefensiveTrendRecommendations,
  simulateRecommendation,
  type PortfolioSnapshot,
  type MarketData,
  type Position,
  type PricePoint,
  type RiskConfig,
  type StrategyRecommendation,
} from '../index.js'

interface BacktestParams {
  startCash: number
  startPositions: Position[]
  priceHistories: Map<string, PricePoint[]>
  rebalanceDates: string[]
  config: RiskConfig
}

interface BacktestResult {
  dates: string[]
  strategyValues: number[]
  benchmarkValues: number[]
  finalStrategyValue: number
  finalBenchmarkValue: number
  totalReturnPct: number
  benchmarkReturnPct: number
  /** Peak-to-trough max drawdown for the strategy path (%). */
  maxDrawdownPct: number
  /** Peak-to-trough max drawdown for the benchmark path (%). */
  benchmarkMaxDrawdownPct: number
  trades: Array<{
    date: string
    action: StrategyRecommendation['action']
    ticker: string | undefined
    quantity: number
    price: number
    value: number
    side: 'buy' | 'sell'
  }>
}

function priceAt(history: PricePoint[], date: string): number {
  const point = history.find((p) => p.date === date)
  if (!point) throw new Error(`No price for ${date}`)
  return point.close
}

function marketDataAsOf(date: string, histories: Map<string, PricePoint[]>): Map<string, MarketData> {
  const map = new Map<string, MarketData>()
  for (const [ticker, history] of histories.entries()) {
    const idx = history.findIndex((p) => p.date === date)
    if (idx >= 0) {
      map.set(ticker, { ticker, history: history.slice(0, idx + 1) })
    }
  }
  return map
}

function runBacktest(params: BacktestParams): BacktestResult {
  let cash = params.startCash
  let positions = params.startPositions.map((p) => ({ ...p }))
  const trades: BacktestResult['trades'] = []
  const strategyValues: number[] = []
  const benchmarkValues: number[] = []

  const initialPrices = new Map<string, number>()
  for (const p of params.startPositions) {
    const history = params.priceHistories.get(p.ticker)
    if (history) initialPrices.set(p.ticker, history[0]!.close)
  }

  for (const date of params.rebalanceDates) {
    const currentPrices = new Map<string, number>()
    let positionValue = 0
    for (const pos of positions) {
      const price = priceAt(params.priceHistories.get(pos.ticker)!, date)
      currentPrices.set(pos.ticker, price)
      pos.currentPrice = price
      positionValue += pos.quantity * price
    }
    const totalValue = cash + positionValue

    const snapshot: PortfolioSnapshot = {
      totalValue,
      cash,
      positions: positions.map((p) => ({ ...p })),
    }

    const marketData = marketDataAsOf(date, params.priceHistories)
    const recommendations = generateDefensiveTrendRecommendations(snapshot, marketData, params.config)

    for (const rec of recommendations) {
      const sim = simulateRecommendation(snapshot, marketData, rec, params.config)
      if (sim.trade.quantity === 0) continue

      trades.push({
        date,
        action: rec.action,
        ticker: sim.trade.ticker,
        quantity: sim.trade.quantity,
        price: sim.trade.price,
        value: sim.trade.value,
        side: sim.trade.side,
      })

      const ticker = sim.trade.ticker
      const price = sim.trade.price
      const qty = sim.trade.quantity
      if (!ticker) continue

      if (sim.trade.side === 'sell') {
        cash += qty * price
        const pos = positions.find((p) => p.ticker === ticker)
        if (pos) {
          pos.quantity -= qty
          if (pos.quantity <= 0) positions = positions.filter((p) => p.ticker !== ticker)
        }
      } else {
        cash -= qty * price
        const pos = positions.find((p) => p.ticker === ticker)
        if (pos) {
          const totalQty = pos.quantity + qty
          pos.avgPrice = Math.round((pos.avgPrice * pos.quantity + price * qty) / totalQty)
          pos.quantity = totalQty
        } else {
          positions.push({ ticker, quantity: qty, avgPrice: price, currentPrice: price })
        }
      }

      // Recompute snapshot after each trade so subsequent recommendations see new state.
      const newPositionValue = positions.reduce((s, p) => s + p.quantity * (currentPrices.get(p.ticker) ?? p.currentPrice), 0)
      snapshot.totalValue = cash + newPositionValue
      snapshot.cash = cash
      snapshot.positions = positions.map((p) => ({ ...p }))
    }

    const strategyValue = cash + positions.reduce((s, p) => s + p.quantity * (currentPrices.get(p.ticker) ?? p.currentPrice), 0)
    const benchmarkValue = params.startCash + params.startPositions.reduce((s, p) => {
      const price = priceAt(params.priceHistories.get(p.ticker)!, date)
      return s + p.quantity * price
    }, 0)

    strategyValues.push(strategyValue)
    benchmarkValues.push(benchmarkValue)
  }

  const finalStrategyValue = strategyValues[strategyValues.length - 1] ?? params.startCash
  const finalBenchmarkValue = benchmarkValues[benchmarkValues.length - 1] ?? params.startCash

  const initialValue = params.startCash + params.startPositions.reduce((s, p) => s + p.quantity * (initialPrices.get(p.ticker) ?? p.avgPrice), 0)

  function maxDrawdown(values: number[]): number {
    let peak = values[0] ?? 0
    let maxDd = 0
    for (const v of values) {
      if (v > peak) peak = v
      const dd = peak > 0 ? ((peak - v) / peak) * 100 : 0
      if (dd > maxDd) maxDd = dd
    }
    return maxDd
  }

  return {
    dates: params.rebalanceDates,
    strategyValues,
    benchmarkValues,
    finalStrategyValue,
    finalBenchmarkValue,
    totalReturnPct: (finalStrategyValue / initialValue - 1) * 100,
    benchmarkReturnPct: (finalBenchmarkValue / initialValue - 1) * 100,
    maxDrawdownPct: maxDrawdown(strategyValues),
    benchmarkMaxDrawdownPct: maxDrawdown(benchmarkValues),
    trades,
  }
}

// Deterministic LCG so the backtest is reproducible across runs.
function createLcg(seed = 12345): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32
    return state / 2 ** 32
  }
}

function buildHistory(
  ticker: string,
  startPrice: number,
  days: number,
  drift: number,
  volatility: number,
): PricePoint[] {
  const rand = createLcg(ticker.split('').reduce((s, c) => s + c.charCodeAt(0), 0))
  const history: PricePoint[] = []
  let price = startPrice
  const startDate = new Date('2023-01-01')
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate)
    date.setDate(date.getDate() + i)
    const dateStr = date.toISOString().split('T')[0] as string
    const shock = (rand() - 0.5) * volatility * 2
    price = Math.max(1, Math.round(price * (1 + drift + shock)))
    history.push({ date: dateStr, close: price } as PricePoint)
  }
  return history
}

/**
 * Build a deterministic crash-and-partial-recovery history.
 * The price falls ~40% over the crash window and then flatlines.
 */
function buildCrashHistory(
  ticker: string,
  startPrice: number,
  days: number,
  crashRatio: number,
  recoveryRatio: number,
): PricePoint[] {
  const rand = createLcg(ticker.split('').reduce((s, c) => s + c.charCodeAt(0), 0))
  const history: PricePoint[] = []
  let price = startPrice
  const startDate = new Date('2023-01-01')
  const crashEnd = Math.floor(days * 0.6)
  const recoveryEnd = Math.floor(days * 0.8)
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate)
    date.setDate(date.getDate() + i)
    const dateStr = date.toISOString().split('T')[0] as string
    let dailyDrift = 0
    if (i < crashEnd) {
      dailyDrift = Math.pow(1 - crashRatio, 1 / crashEnd) - 1
    } else if (i < recoveryEnd) {
      dailyDrift = Math.pow(1 + recoveryRatio, 1 / (recoveryEnd - crashEnd)) - 1
    }
    const shock = (rand() - 0.5) * 0.02 * 2
    price = Math.max(1, Math.round(price * (1 + dailyDrift + shock)))
    history.push({ date: dateStr, close: price } as PricePoint)
  }
  return history
}

/**
 * Build a deterministic sideways, high-volatility history.
 * The price oscillates around the starting price with zero net drift.
 */
function buildChopHistory(
  ticker: string,
  startPrice: number,
  days: number,
  amplitude: number,
): PricePoint[] {
  const rand = createLcg(ticker.split('').reduce((s, c) => s + c.charCodeAt(0), 0))
  const history: PricePoint[] = []
  let price = startPrice
  const startDate = new Date('2023-01-01')
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate)
    date.setDate(date.getDate() + i)
    const dateStr = date.toISOString().split('T')[0] as string
    const meanReversion = (startPrice - price) / startPrice * 0.02
    const shock = (rand() - 0.5) * amplitude * 2
    price = Math.max(1, Math.round(price * (1 + meanReversion + shock)))
    history.push({ date: dateStr, close: price } as PricePoint)
  }
  return history
}

/**
 * Build a mock Alpha Vantage TIME_SERIES_DAILY response body for a ticker.
 * The close values are integer minor units so the resulting PricePoint[] can
 * be fed directly into the backtest harness.
 */
function buildAlphaVantageResponse(
  ticker: string,
  days: number,
  startPrice: number,
): Record<string, Record<string, Record<string, string>>> {
  const history = buildHistory(ticker, startPrice, days, 0.0005, 0.015)
  const series: Record<string, Record<string, string>> = {}
  for (const point of history) {
    series[point.date] = { '4. close': String(point.close) }
  }
  return { 'Time Series (Daily)': series }
}

/**
 * Transform an Alpha Vantage TIME_SERIES_DAILY object into the PricePoint[]
 * shape the DTFE backtest expects. Mirrors packages/pipeline's transform.
 */
function transformAlphaVantageTimeSeriesDaily(
  body: Record<string, Record<string, Record<string, string>>>,
  symbol: string,
): PricePoint[] {
  const series = body['Time Series (Daily)'] as Record<string, Record<string, string>> | undefined
  if (!series || typeof series !== 'object' || Array.isArray(series)) return []
  return Object.entries(series)
    .map(([date, day]) => ({
      ticker: symbol,
      date,
      close: Number(day['4. close'] ?? 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

describe('Defensive Trend Following backtest', () => {
  it('runs a 6-month monthly-rebalance backtest without errors', () => {
    const aapl = buildHistory('AAPL', 10000, 365, 0.0008, 0.015)
    const tsla = buildHistory('TSLA', 16000, 365, 0.0002, 0.025)
    const vukg = buildHistory('VUKG', 4000, 365, 0.0005, 0.008)
    const histories = new Map<string, PricePoint[]>([
      ['AAPL', aapl],
      ['TSLA', tsla],
      ['VUKG', vukg],
    ])

    const rebalanceDates: string[] = []
    for (let i = 0; i < 6; i++) {
      const date = new Date('2023-04-01')
      date.setMonth(date.getMonth() + i)
      rebalanceDates.push(date.toISOString().split('T')[0] as string)
    }

    const result = runBacktest({
      startCash: 10_000_00, // £10k minor
      startPositions: [
        { ticker: 'AAPL', quantity: 50, avgPrice: 10000, currentPrice: 10000 },
        { ticker: 'TSLA', quantity: 30, avgPrice: 16000, currentPrice: 16000 },
      ],
      priceHistories: histories,
      rebalanceDates,
      config: {
        maxPositionWeight: 10,
        targetVolatility: 10,
        cashDeployThreshold: 5,
        stopLossThreshold: 0.10,
        minLookback: 63,
      },
    })

    expect(result.strategyValues.length).toBe(6)
    expect(result.benchmarkValues.length).toBe(6)
    expect(result.trades.length).toBeGreaterThanOrEqual(0)
    expect(result.finalStrategyValue).toBeGreaterThan(0)
    expect(result.finalBenchmarkValue).toBeGreaterThan(0)
  })

  it('trims an oversized position when it exceeds the configured cap', () => {
    const aapl = buildHistory('AAPL', 10000, 180, 0.0005, 0.01)
    const histories = new Map<string, PricePoint[]>([['AAPL', aapl]])

    const rebalanceDates = ['2023-04-01']
    const result = runBacktest({
      startCash: 0,
      startPositions: [{ ticker: 'AAPL', quantity: 1000, avgPrice: 10000, currentPrice: 10000 }],
      priceHistories: histories,
      rebalanceDates,
      config: { maxPositionWeight: 10 },
    })

    const trim = result.trades.find((t) => t.action === 'trim')
    expect(trim).toBeDefined()
    expect(trim?.ticker).toBe('AAPL')
    expect(trim?.side).toBe('sell')
  })

  it('deploys excess cash when cash is above the configured threshold', () => {
    // Strong positive trend with low volatility gives AAPL a high DTFE score.
    const aapl = buildHistory('AAPL', 10000, 365, 0.003, 0.005)
    const histories = new Map<string, PricePoint[]>([['AAPL', aapl]])

    const rebalanceDates = ['2023-04-01']
    const result = runBacktest({
      startCash: 50_000_00,
      startPositions: [],
      priceHistories: histories,
      rebalanceDates,
      config: { cashDeployThreshold: 5, maxPositionWeight: 10, minLookback: 63 },
    })

    const deploy = result.trades.find((t) => t.action === 'deploy_cash')
    expect(deploy).toBeDefined()
    expect(deploy?.ticker).toBe('AAPL')
    expect(deploy?.side).toBe('buy')
  })

  it('limits drawdown versus buy-and-hold in a market crash', () => {
    // 40% crash over 60% of the window, 10% partial recovery, then flat.
    const aapl = buildCrashHistory('AAPL', 10000, 365, 0.40, 0.10)
    const tsla = buildCrashHistory('TSLA', 16000, 365, 0.45, 0.08)
    const vukg = buildCrashHistory('VUKG', 4000, 365, 0.20, 0.05)
    const histories = new Map<string, PricePoint[]>([
      ['AAPL', aapl],
      ['TSLA', tsla],
      ['VUKG', vukg],
    ])

    const rebalanceDates: string[] = []
    for (let i = 0; i < 6; i++) {
      const date = new Date('2023-04-01')
      date.setMonth(date.getMonth() + i)
      rebalanceDates.push(date.toISOString().split('T')[0] as string)
    }

    const result = runBacktest({
      startCash: 10_000_00,
      startPositions: [
        { ticker: 'AAPL', quantity: 50, avgPrice: 10000, currentPrice: 10000 },
        { ticker: 'TSLA', quantity: 30, avgPrice: 16000, currentPrice: 16000 },
        { ticker: 'VUKG', quantity: 100, avgPrice: 4000, currentPrice: 4000 },
      ],
      priceHistories: histories,
      rebalanceDates,
      config: {
        maxPositionWeight: 10,
        targetVolatility: 10,
        cashDeployThreshold: 5,
        stopLossThreshold: 0.10,
        minLookback: 63,
      },
    })

    // The defensive posture should not prevent losses, but it should lose less
    // and experience a smaller peak-to-trough drawdown than buy-and-hold.
    expect(result.maxDrawdownPct).toBeLessThan(result.benchmarkMaxDrawdownPct)
    expect(result.totalReturnPct).toBeGreaterThan(result.benchmarkReturnPct)
  })

  it('trims a severely concentrated portfolio back under the cap in a crash', () => {
    // Single stock starts at 75% of portfolio value; market then crashes.
    const aapl = buildCrashHistory('AAPL', 10000, 365, 0.35, 0.05)
    const histories = new Map<string, PricePoint[]>([['AAPL', aapl]])

    const rebalanceDates: string[] = []
    for (let i = 0; i < 6; i++) {
      const date = new Date('2023-04-01')
      date.setMonth(date.getMonth() + i)
      rebalanceDates.push(date.toISOString().split('T')[0] as string)
    }

    const result = runBacktest({
      startCash: 3_333_33,
      startPositions: [{ ticker: 'AAPL', quantity: 1000, avgPrice: 10000, currentPrice: 10000 }],
      priceHistories: histories,
      rebalanceDates,
      config: {
        maxPositionWeight: 10,
        targetVolatility: 10,
        cashDeployThreshold: 5,
        stopLossThreshold: 0.10,
        minLookback: 63,
      },
    })

    const trims = result.trades.filter((t) => t.action === 'trim' && t.ticker === 'AAPL')
    expect(trims.length).toBeGreaterThan(0)

    // The defensive posture should also show a smaller drawdown than buy-and-hold
    // even when starting from an already concentrated book.
    expect(result.maxDrawdownPct).toBeLessThan(result.benchmarkMaxDrawdownPct)
  })

  it('does not over-trade or drift far from benchmark in a choppy sideways market', () => {
    // High daily volatility with zero net drift — a classic whipsaw environment.
    const aapl = buildChopHistory('AAPL', 10000, 365, 0.04)
    const tsla = buildChopHistory('TSLA', 16000, 365, 0.05)
    const vukg = buildChopHistory('VUKG', 4000, 365, 0.02)
    const histories = new Map<string, PricePoint[]>([
      ['AAPL', aapl],
      ['TSLA', tsla],
      ['VUKG', vukg],
    ])

    const rebalanceDates: string[] = []
    for (let i = 0; i < 6; i++) {
      const date = new Date('2023-04-01')
      date.setMonth(date.getMonth() + i)
      rebalanceDates.push(date.toISOString().split('T')[0] as string)
    }

    const result = runBacktest({
      startCash: 10_000_00,
      startPositions: [
        { ticker: 'AAPL', quantity: 50, avgPrice: 10000, currentPrice: 10000 },
        { ticker: 'TSLA', quantity: 30, avgPrice: 16000, currentPrice: 16000 },
        { ticker: 'VUKG', quantity: 100, avgPrice: 4000, currentPrice: 4000 },
      ],
      priceHistories: histories,
      rebalanceDates,
      config: {
        maxPositionWeight: 10,
        targetVolatility: 10,
        cashDeployThreshold: 5,
        stopLossThreshold: 0.10,
        minLookback: 63,
      },
    })

    // In a sideways market, a trend-following strategy should avoid churning.
    // We allow some cash deployment and trims, but not more than two trades per
    // rebalance on average.
    expect(result.trades.length).toBeLessThanOrEqual(result.dates.length * 2)

    // The strategy path should not materially diverge from the benchmark.
    const returnDifference = Math.abs(result.totalReturnPct - result.benchmarkReturnPct)
    expect(returnDifference).toBeLessThan(5)
  })

  it('handles a large portfolio scale without timing out', () => {
    const histories = new Map<string, PricePoint[]>()
    const positions: Position[] = []
    const startCash = 1_000_000_00 // £1m
    const totalPositionValue = startCash
    const tickers: string[] = []
    const count = 50
    for (let i = 0; i < count; i++) {
      const ticker = `STK${i.toString().padStart(3, '0')}`
      tickers.push(ticker)
      const startPrice = 10000 + i * 100
      histories.set(ticker, buildHistory(ticker, startPrice, 365, 0.0005, 0.015))
      // Equal weight ~2% each.
      const quantity = Math.floor((totalPositionValue / count) / startPrice)
      positions.push({ ticker, quantity, avgPrice: startPrice, currentPrice: startPrice })
    }

    const rebalanceDates: string[] = []
    for (let i = 0; i < 6; i++) {
      const date = new Date('2023-04-01')
      date.setMonth(date.getMonth() + i)
      rebalanceDates.push(date.toISOString().split('T')[0] as string)
    }

    const startTime = Date.now()
    const result = runBacktest({
      startCash: 0,
      startPositions: positions,
      priceHistories: histories,
      rebalanceDates,
      config: {
        maxPositionWeight: 5,
        targetVolatility: 10,
        cashDeployThreshold: 5,
        stopLossThreshold: 0.10,
        minLookback: 63,
      },
    })
    const elapsedMs = Date.now() - startTime

    expect(result.strategyValues.length).toBe(6)
    expect(result.benchmarkValues.length).toBe(6)
    expect(elapsedMs).toBeLessThan(500)
  })

  it('ingests Alpha Vantage-shaped daily time series and backtests without errors', () => {
    // Simulate a realistic upstream connector response. This stress-tests the
    // boundary between connector-transformed market data and the strategy layer.
    const response = buildAlphaVantageResponse('AAPL', 365, 10000)
    const aapl = transformAlphaVantageTimeSeriesDaily(response, 'AAPL')
    const tsla = transformAlphaVantageTimeSeriesDaily(
      buildAlphaVantageResponse('TSLA', 365, 16000),
      'TSLA',
    )
    const vukg = transformAlphaVantageTimeSeriesDaily(
      buildAlphaVantageResponse('VUKG', 365, 4000),
      'VUKG',
    )

    const histories = new Map<string, PricePoint[]>([
      ['AAPL', aapl],
      ['TSLA', tsla],
      ['VUKG', vukg],
    ])

    const rebalanceDates: string[] = []
    for (let i = 0; i < 6; i++) {
      const date = new Date('2023-04-01')
      date.setMonth(date.getMonth() + i)
      rebalanceDates.push(date.toISOString().split('T')[0] as string)
    }

    const result = runBacktest({
      startCash: 10_000_00,
      startPositions: [
        { ticker: 'AAPL', quantity: 50, avgPrice: 10000, currentPrice: 10000 },
        { ticker: 'TSLA', quantity: 30, avgPrice: 16000, currentPrice: 16000 },
        { ticker: 'VUKG', quantity: 100, avgPrice: 4000, currentPrice: 4000 },
      ],
      priceHistories: histories,
      rebalanceDates,
      config: {
        maxPositionWeight: 10,
        targetVolatility: 10,
        cashDeployThreshold: 5,
        stopLossThreshold: 0.10,
        minLookback: 63,
      },
    })

    expect(result.strategyValues.length).toBe(6)
    expect(result.benchmarkValues.length).toBe(6)
    expect(result.finalStrategyValue).toBeGreaterThan(0)
    expect(result.finalBenchmarkValue).toBeGreaterThan(0)
  })
})
