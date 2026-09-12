import path from 'node:path'
import {
  generateDefensiveTrendRecommendations,
  simulateRecommendation,
  type PortfolioSnapshot,
  type MarketData,
  type Position,
  type PricePoint,
  type RiskConfig,
  type StrategyRecommendation,
} from '../src/index.js'

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
  maxDrawdownPct: number
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

function createLcg(seed = 12345): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32
    return state / 2 ** 32
  }
}

function buildHistory(ticker: string, startPrice: number, days: number, drift: number, volatility: number): PricePoint[] {
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
    history.push({ date: dateStr, close: price })
  }
  return history
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
    for (const pos of positions) {
      const price = priceAt(params.priceHistories.get(pos.ticker)!, date)
      currentPrices.set(pos.ticker, price)
      pos.currentPrice = price
    }
    const positionValue = positions.reduce((s, p) => s + p.quantity * (currentPrices.get(p.ticker) ?? p.currentPrice), 0)
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

function main() {
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
    startCash: 10_000_00,
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

  console.log('\n=== Defensive Trend Following Backtest Summary ===\n')
  console.log(`Initial value: £${(result.strategyValues[0] / 100).toFixed(2)}`)
  console.log(`Final strategy value: £${(result.finalStrategyValue / 100).toFixed(2)} (return ${result.totalReturnPct.toFixed(2)}%)`)
  console.log(`Final benchmark value: £${(result.finalBenchmarkValue / 100).toFixed(2)} (return ${result.benchmarkReturnPct.toFixed(2)}%)`)
  console.log(`Max drawdown: ${result.maxDrawdownPct.toFixed(2)}% (benchmark ${result.benchmarkMaxDrawdownPct.toFixed(2)}%)`)
  console.log(`Trades executed: ${result.trades.length}`)
  console.log('\nPer-rebalance path:')
  console.log('Date\t\tStrategy\tBenchmark\tTrades')
  for (let i = 0; i < result.dates.length; i++) {
    const tradesOnDate = result.trades.filter((t) => t.date === result.dates[i])
    const tradeSummary = tradesOnDate.length > 0
      ? tradesOnDate.map((t) => `${t.side.toUpperCase()} ${t.ticker} ${t.quantity}`).join(', ')
      : 'hold'
    console.log(`${result.dates[i]}\t£${(result.strategyValues[i] / 100).toFixed(2)}\t£${(result.benchmarkValues[i] / 100).toFixed(2)}\t${tradeSummary}`)
  }
  console.log()
}

main()
