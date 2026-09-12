/**
 * Guardrails stress test — verifies that the strategy engine's protective
 * mechanisms (stop-loss, trailing-stop, concentration-cap) trigger and cap
 * losses the way their own copy claims, when fed crash data resembling
 * the 2008 financial crisis and the 2020 COVID crash.
 *
 * This is a deterministic test: it constructs synthetic price paths that
 * mimic the shape of those crashes (sharp drawdown, partial recovery) and
 * asserts that each guardrail fires at the threshold it's configured to.
 * It does NOT validate real-world profitability — that's the job of the
 * shadow-backtest cron and the real-backtest.ts script. This test validates
 * that the safety mechanics themselves work as documented.
 *
 * Guardrails under test:
 *   1. Stop-loss (defensive + momentum): sells when price drops
 *      `stopLossThreshold` below `avgPrice`.
 *   2. Trailing-stop (momentum only): sells when price drops
 *      `trailingStopThreshold` below the high-water mark.
 *   3. Concentration cap (defensive + momentum): trims when position
 *      weight exceeds `maxPositionWeight` % of portfolio.
 *
 * Crash scenarios:
 *   - 2008-shaped: ~50% drawdown over ~12 months, slow partial recovery.
 *   - 2020-shaped: ~35% drawdown over ~1 month, fast V-shaped recovery.
 */

import { describe, it, expect } from 'vitest'
import {
  generateDefensiveTrendRecommendations,
  generateMomentumRecommendations,
  simulateRecommendation,
  type PortfolioSnapshot,
  type MarketData,
  type Position,
  type PricePoint,
  type RiskConfig,
} from '../index.js'

// ─── Synthetic price path builders ────────────────────────────────────────

/** Deterministic LCG for reproducible synthetic data. */
function createLcg(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32
    return state / 2 ** 32
  }
}

/**
 * Build a 2008-shaped crash: ~50% drawdown over ~250 trading days, then
 * a slow partial recovery to ~70% of the starting price by day 365.
 * Mimics the GFC: the crash was deep and the recovery was multi-year.
 */
function build2008Crash(ticker: string, startPrice: number): PricePoint[] {
  const rand = createLcg(ticker.split('').reduce((s, c) => s + c.charCodeAt(0), 0))
  const history: PricePoint[] = []
  let price = startPrice
  const startDate = new Date('2007-10-01')
  const crashDays = 250
  const recoveryDays = 115
  const totalDays = crashDays + recoveryDays
  for (let i = 0; i < totalDays; i++) {
    const date = new Date(startDate)
    date.setDate(date.getDate() + i)
    const dateStr = date.toISOString().split('T')[0] as string
    let dailyDrift: number
    if (i < crashDays) {
      // ~50% total drop: (1-0.5)^(1/250) ≈ -0.00277/day
      dailyDrift = Math.pow(0.5, 1 / crashDays) - 1
    } else {
      // Recover from 50% to 70% of start over 115 days
      dailyDrift = Math.pow(0.7 / 0.5, 1 / recoveryDays) - 1
    }
    const shock = (rand() - 0.5) * 0.02
    price = Math.max(1, Math.round(price * (1 + dailyDrift + shock)))
    history.push({ date: dateStr, close: price })
  }
  return history
}

/**
 * Build a 2020-shaped crash: ~35% drawdown over ~22 trading days, then
 * a fast V-shaped recovery to ~110% of the starting price by day 220.
 * Mimics the COVID crash: sharp drop, rapid Fed-driven recovery.
 */
function build2020Crash(ticker: string, startPrice: number): PricePoint[] {
  const rand = createLcg(ticker.split('').reduce((s, c) => s + c.charCodeAt(0), 0) + 1)
  const history: PricePoint[] = []
  let price = startPrice
  const startDate = new Date('2020-02-01')
  const crashDays = 22
  const recoveryDays = 200
  const totalDays = crashDays + recoveryDays
  for (let i = 0; i < totalDays; i++) {
    const date = new Date(startDate)
    date.setDate(date.getDate() + i)
    const dateStr = date.toISOString().split('T')[0] as string
    let dailyDrift: number
    if (i < crashDays) {
      // ~35% drop over 22 days
      dailyDrift = Math.pow(0.65, 1 / crashDays) - 1
    } else {
      // Recover from 65% to 110% of start over 200 days
      dailyDrift = Math.pow(1.1 / 0.65, 1 / recoveryDays) - 1
    }
    const shock = (rand() - 0.5) * 0.03
    price = Math.max(1, Math.round(price * (1 + dailyDrift + shock)))
    history.push({ date: dateStr, close: price })
  }
  return history
}

/** Build a flat history (no drift, low noise) for a second ticker. */
function buildFlat(ticker: string, startPrice: number, days: number): PricePoint[] {
  const rand = createLcg(ticker.split('').reduce((s, c) => s + c.charCodeAt(0), 0) + 99)
  const history: PricePoint[] = []
  let price = startPrice
  const startDate = new Date('2007-10-01')
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate)
    date.setDate(date.getDate() + i)
    const dateStr = date.toISOString().split('T')[0] as string
    const shock = (rand() - 0.5) * 0.005
    price = Math.max(1, Math.round(price * (1 + shock)))
    history.push({ date: dateStr, close: price })
  }
  return history
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

function priceAt(history: PricePoint[], date: string): number {
  const point = history.find((p) => p.date === date)
  if (!point) throw new Error(`No price for ${date}`)
  return point.close
}

// ─── Test configs ─────────────────────────────────────────────────────────

const DEFENSIVE_CONFIG: RiskConfig = {
  maxPositionWeight: 10,
  targetVolatility: 10,
  cashDeployThreshold: 5,
  stopLossThreshold: 0.10,
  minLookback: 63,
  qualityWeight: 0.35,
  momentumWeight: 0.40,
  volatilityWeight: 0.25,
  cashDeployScoreThreshold: 0.5,
  sellScoreThreshold: 0.3,
  trimScoreThreshold: 0.5,
  momentumLookbackDays: 252,
  maxCashDeployTickers: 1,
  reduceExposurePct: 0.20,
  addCashFraction: 0.25,
  trailingStopThreshold: 0.15,
  addMomentumThreshold: 0.15,
  sellMomentumThreshold: 0,
}

const MOMENTUM_CONFIG: RiskConfig = {
  maxPositionWeight: 25,
  targetVolatility: 25,
  cashDeployThreshold: 5,
  stopLossThreshold: 0.15,
  minLookback: 63,
  qualityWeight: 0,
  momentumWeight: 1.0,
  volatilityWeight: 0,
  cashDeployScoreThreshold: 0.5,
  sellScoreThreshold: 0.3,
  trimScoreThreshold: 0.5,
  momentumLookbackDays: 252,
  maxCashDeployTickers: 3,
  reduceExposurePct: 0.20,
  addCashFraction: 0.25,
  trailingStopThreshold: 0.15,
  addMomentumThreshold: 0.15,
  sellMomentumThreshold: 0,
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Guardrails stress test — 2008-shaped crash', () => {
  // Build a 2008-shaped crash for the held ticker and a flat path for a
  // second ticker (so the engine has something to compare against).
  const crash = build2008Crash('CRASH', 10000)        // 100.00 → ~50.00 → ~70.00
  const flat = buildFlat('FLAT', 10000, crash.length)  // ~100.00 throughout
  const histories = new Map<string, PricePoint[]>([['CRASH', crash], ['FLAT', flat]])

  it('defensive stop-loss fires when a position drops 10% below avgPrice', () => {
    // Hold CRASH at avgPrice 100.00 (10000 minor). The 2008 path drops
    // below 90.00 (9000 minor) within the first ~20 days. At the first
    // rebalance where price <= 9000, the engine must emit a sell with
    // riskFlags=['stop_loss'].
    const stopLossTriggerDate = crash.find((p) => p.close <= 9000)!.date
    const positions: Position[] = [
      { ticker: 'CRASH', quantity: 100, avgPrice: 10000, currentPrice: priceAt(crash, stopLossTriggerDate) },
    ]
    const snapshot: PortfolioSnapshot = {
      totalValue: 100 * priceAt(crash, stopLossTriggerDate) + 5000_00,
      cash: 5000_00,
      positions,
    }
    const marketData = marketDataAsOf(stopLossTriggerDate, histories)

    const recs = generateDefensiveTrendRecommendations(snapshot, marketData, DEFENSIVE_CONFIG)
    const stopLoss = recs.find((r) => r.riskFlags?.includes('stop_loss'))

    expect(stopLoss).toBeDefined()
    expect(stopLoss?.action).toBe('sell')
    expect(stopLoss?.ticker).toBe('CRASH')
  })

  it('momentum stop-loss fires when a position drops 15% below avgPrice', () => {
    // Momentum stop-loss is 15%, so the trigger price is 85.00 (8500 minor).
    const stopLossTriggerDate = crash.find((p) => p.close <= 8500)!.date
    const positions: Position[] = [
      { ticker: 'CRASH', quantity: 100, avgPrice: 10000, currentPrice: priceAt(crash, stopLossTriggerDate) },
    ]
    const snapshot: PortfolioSnapshot = {
      totalValue: 100 * priceAt(crash, stopLossTriggerDate) + 5000_00,
      cash: 5000_00,
      positions,
    }
    const marketData = marketDataAsOf(stopLossTriggerDate, histories)

    const recs = generateMomentumRecommendations(snapshot, marketData, MOMENTUM_CONFIG)
    const stopLoss = recs.find((r) => r.riskFlags?.includes('stop_loss'))

    expect(stopLoss).toBeDefined()
    expect(stopLoss?.action).toBe('sell')
    expect(stopLoss?.ticker).toBe('CRASH')
  })

  it('momentum trailing-stop fires when price drops 15% from high-water mark', () => {
    // Build a position that rose to a high-water mark of 120.00 (12000
    // minor) and has now fallen back to 100.00 (10000 minor) — a 16.7%
    // drop from the HWM, which exceeds the 15% trailing-stop threshold.
    // The avgPrice is 80.00 so the fixed stop-loss (85% of 80 = 68.00)
    // does NOT fire first — we want to isolate the trailing-stop.
    const positions: Position[] = [
      {
        ticker: 'CRASH',
        quantity: 100,
        avgPrice: 8000,        // £80.00 — stop-loss would fire at £68.00
        currentPrice: 10000,   // £100.00 — well above stop-loss
        highWaterMark: 12000,  // £120.00 — HWM set during the run-up
      },
    ]
    const snapshot: PortfolioSnapshot = {
      totalValue: 100 * 10000 + 5000_00,
      cash: 5000_00,
      positions,
    }
    // Use a date late enough that the engine has lookback history.
    const evalDate = crash[Math.floor(crash.length * 0.5)]!.date
    const marketData = marketDataAsOf(evalDate, histories)

    const recs = generateMomentumRecommendations(snapshot, marketData, MOMENTUM_CONFIG)
    const trailingStop = recs.find((r) => r.riskFlags?.includes('trailing_stop'))

    expect(trailingStop).toBeDefined()
    expect(trailingStop?.action).toBe('sell')
    expect(trailingStop?.ticker).toBe('CRASH')
  })

  it('defensive concentration cap trims a position exceeding 10% weight', () => {
    // Construct a portfolio where CRASH is 60% of total value, far
    // exceeding the 10% defensive cap. The price is flat (no stop-loss
    // trigger) so we isolate the concentration check.
    const evalDate = crash[Math.floor(crash.length * 0.3)]!.date
    const currentPrice = priceAt(crash, evalDate)
    const positions: Position[] = [
      // 60% weight: 600 shares at currentPrice, total portfolio = ~1000*price
      { ticker: 'CRASH', quantity: 600, avgPrice: currentPrice, currentPrice },
    ]
    const positionValue = 600 * currentPrice
    const cash = positionValue * 2 / 3  // cash = 40% of total, position = 60%
    const snapshot: PortfolioSnapshot = {
      totalValue: positionValue + cash,
      cash,
      positions,
    }
    const marketData = marketDataAsOf(evalDate, histories)

    const recs = generateDefensiveTrendRecommendations(snapshot, marketData, DEFENSIVE_CONFIG)
    const trim = recs.find((r) => r.riskFlags?.includes('concentration'))

    expect(trim).toBeDefined()
    expect(trim?.action).toBe('trim')
    expect(trim?.ticker).toBe('CRASH')
  })

  it('momentum strategy does NOT emit a concentration trim (gap vs defensive)', () => {
    // FINDING: the momentum strategy computes currentWeight but does NOT
    // emit a trim recommendation when a position exceeds maxPositionWeight.
    // The defensive strategy does (defensiveTrendFollowing.ts:269-278),
    // but the momentum generator only has trailing-stop, stop-loss,
    // negative-momentum, and cash-deployment — no concentration check.
    // maxPositionWeight is used by the simulator's findTargetQuantity to
    // size NEW buys, but there's no mechanism to trim an EXISTING oversized
    // position in the momentum strategy.
    //
    // This test documents the gap. If the momentum strategy is ever
    // extended to include a concentration trim, this test should be
    // updated to assert the trim fires.
    const evalDate = crash[Math.floor(crash.length * 0.3)]!.date
    const currentPrice = priceAt(crash, evalDate)
    const positions: Position[] = [
      { ticker: 'CRASH', quantity: 500, avgPrice: currentPrice, currentPrice },
    ]
    const positionValue = 500 * currentPrice
    const cash = positionValue  // 50% position, 50% cash
    const snapshot: PortfolioSnapshot = {
      totalValue: positionValue + cash,
      cash,
      positions,
    }
    const marketData = marketDataAsOf(evalDate, histories)

    const recs = generateMomentumRecommendations(snapshot, marketData, MOMENTUM_CONFIG)
    const trim = recs.find((r) => r.riskFlags?.includes('concentration'))

    // Document the current behavior: no concentration trim in momentum.
    expect(trim).toBeUndefined()
  })

  it('full 2008 backtest: defensive strategy caps drawdown below its stop-loss', () => {
    // Run the defensive strategy through the full 2008 crash path with
    // a position held from day 1. The stop-loss should fire and cap the
    // realized loss at ~10% (the stop-loss threshold), not the full ~50%
    // drawdown the market experienced.
    let cash = 5000_00  // £5,000 cash
    const positions: Position[] = [
      { ticker: 'CRASH', quantity: 50, avgPrice: 10000, currentPrice: 10000 },  // £5,000 in CRASH
    ]
    const trades: Array<{ action: string; ticker: string | undefined; riskFlags?: string[] }> = []

    // Rebalance weekly (every 5 days) through the crash
    for (let i = 0; i < crash.length; i += 5) {
      const date = crash[i]!.date
      for (const pos of positions) {
        const price = priceAt(histories.get(pos.ticker)!, date)
        pos.currentPrice = price
        if (pos.highWaterMark === undefined || price > pos.highWaterMark) {
          pos.highWaterMark = price
        }
      }
      const positionValue = positions.reduce((s, p) => s + p.quantity * p.currentPrice, 0)
      const snapshot: PortfolioSnapshot = {
        totalValue: cash + positionValue,
        cash,
        positions: positions.map((p) => ({ ...p })),
      }
      const marketData = marketDataAsOf(date, histories)
      const recs = generateDefensiveTrendRecommendations(snapshot, marketData, DEFENSIVE_CONFIG)

      for (const rec of recs) {
        const sim = simulateRecommendation(snapshot, marketData, rec, DEFENSIVE_CONFIG)
        if (sim.trade && sim.trade.quantity > 0) {
          trades.push({ action: rec.action, ticker: rec.ticker, riskFlags: rec.riskFlags })
          // Apply the trade to our running state
          const pos = positions.find((p) => p.ticker === rec.ticker)
          if (pos && (rec.action === 'sell' || rec.action === 'trim')) {
            pos.quantity -= sim.trade.quantity
            cash += sim.trade.value
          } else if (!pos && rec.action === 'buy') {
            positions.push({
              ticker: rec.ticker!,
              quantity: sim.trade.quantity,
              avgPrice: sim.trade.price,
              currentPrice: sim.trade.price,
            })
            cash -= sim.trade.value
          }
        }
      }
    }

    // The stop-loss must have fired at least once during the crash.
    const stopLossTrades = trades.filter((t) => t.riskFlags?.includes('stop_loss'))
    expect(stopLossTrades.length).toBeGreaterThan(0)
    expect(stopLossTrades[0]?.action).toBe('sell')

    // After the stop-loss fires, the position should be fully closed (defensive
    // stop-loss is a full sell, not a trim). Verify the CRASH position is gone.
    const crashPosition = positions.find((p) => p.ticker === 'CRASH')
    expect(crashPosition?.quantity ?? 0).toBe(0)

    // The realized portfolio value should be higher than a buy-and-hold
    // benchmark that rode the full crash down. Buy-and-hold would be at
    // ~50% of the starting £10,000 = ~£5,000 at the trough. The defensive
    // strategy should have stopped out near -10% on the £5,000 position
    // = ~£4,500 + £5,000 cash = ~£9,500, well above the ~£5,000 trough.
    const finalValue = cash + positions.reduce((s, p) => s + p.quantity * p.currentPrice, 0)
    expect(finalValue).toBeGreaterThan(8000_00)  // > £8,000 (buy-and-hold trough was ~£5,000)
  })
})

describe('Guardrails stress test — 2020-shaped V-shaped crash', () => {
  const crash = build2020Crash('CRASH', 10000)   // 100.00 → ~65.00 → ~110.00
  const flat = buildFlat('FLAT', 10000, crash.length)
  const histories = new Map<string, PricePoint[]>([['CRASH', crash], ['FLAT', flat]])

  it('defensive stop-loss fires during the rapid 35% COVID drop', () => {
    // The 2020 crash drops 35% in 22 days. The defensive 10% stop-loss
    // should fire within the first few days.
    const stopLossTriggerDate = crash.find((p) => p.close <= 9000)!.date
    const positions: Position[] = [
      { ticker: 'CRASH', quantity: 100, avgPrice: 10000, currentPrice: priceAt(crash, stopLossTriggerDate) },
    ]
    const snapshot: PortfolioSnapshot = {
      totalValue: 100 * priceAt(crash, stopLossTriggerDate) + 5000_00,
      cash: 5000_00,
      positions,
    }
    const marketData = marketDataAsOf(stopLossTriggerDate, histories)

    const recs = generateDefensiveTrendRecommendations(snapshot, marketData, DEFENSIVE_CONFIG)
    const stopLoss = recs.find((r) => r.riskFlags?.includes('stop_loss'))

    expect(stopLoss).toBeDefined()
    expect(stopLoss?.action).toBe('sell')
  })

  it('momentum trailing-stop fires during the 2020 crash after a prior run-up', () => {
    // Simulate a position that had risen to 130.00 (13000 minor) before
    // the crash, then fell to 100.00 (10000 minor) — a 23% drop from HWM,
    // exceeding the 15% trailing-stop. avgPrice is 70.00 so the fixed
    // stop-loss (85% of 70 = 59.50) does not fire first.
    const crashDay = crash.find((p) => p.close <= 10000)!  // back to ~100 during the drop
    const positions: Position[] = [
      {
        ticker: 'CRASH',
        quantity: 100,
        avgPrice: 7000,         // £70.00 — stop-loss at £59.50, not triggered
        currentPrice: crashDay.close,
        highWaterMark: 13000,   // £130.00 — HWM from the pre-crash run-up
      },
    ]
    const snapshot: PortfolioSnapshot = {
      totalValue: 100 * crashDay.close + 5000_00,
      cash: 5000_00,
      positions,
    }
    const marketData = marketDataAsOf(crashDay.date, histories)

    const recs = generateMomentumRecommendations(snapshot, marketData, MOMENTUM_CONFIG)
    const trailingStop = recs.find((r) => r.riskFlags?.includes('trailing_stop'))

    expect(trailingStop).toBeDefined()
    expect(trailingStop?.action).toBe('sell')
    expect(trailingStop?.ticker).toBe('CRASH')
  })

  it('full 2020 backtest: stop-loss fires before the full 35% drawdown is realized', () => {
    // Run the defensive strategy through the 2020 V-shaped crash. The
    // stop-loss should fire during the initial drop, capping the loss
    // at ~10% even though the market eventually recovered to +10%.
    let cash = 5000_00
    const positions: Position[] = [
      { ticker: 'CRASH', quantity: 50, avgPrice: 10000, currentPrice: 10000 },
    ]
    let stopLossFired = false
    let stopLossFiredAtPrice = 0

    for (let i = 0; i < crash.length; i += 5) {
      const date = crash[i]!.date
      for (const pos of positions) {
        const price = priceAt(histories.get(pos.ticker)!, date)
        pos.currentPrice = price
        if (pos.highWaterMark === undefined || price > pos.highWaterMark) {
          pos.highWaterMark = price
        }
      }
      const positionValue = positions.reduce((s, p) => s + p.quantity * p.currentPrice, 0)
      const snapshot: PortfolioSnapshot = {
        totalValue: cash + positionValue,
        cash,
        positions: positions.map((p) => ({ ...p })),
      }
      const marketData = marketDataAsOf(date, histories)
      const recs = generateDefensiveTrendRecommendations(snapshot, marketData, DEFENSIVE_CONFIG)

      for (const rec of recs) {
        if (rec.riskFlags?.includes('stop_loss')) {
          stopLossFired = true
          stopLossFiredAtPrice = positions.find((p) => p.ticker === rec.ticker)?.currentPrice ?? 0
        }
        const sim = simulateRecommendation(snapshot, marketData, rec, DEFENSIVE_CONFIG)
        if (sim.trade && sim.trade.quantity > 0) {
          const pos = positions.find((p) => p.ticker === rec.ticker)
          if (pos && (rec.action === 'sell' || rec.action === 'trim')) {
            pos.quantity -= sim.trade.quantity
            cash += sim.trade.value
          } else if (!pos && rec.action === 'buy') {
            positions.push({
              ticker: rec.ticker!,
              quantity: sim.trade.quantity,
              avgPrice: sim.trade.price,
              currentPrice: sim.trade.price,
            })
            cash -= sim.trade.value
          }
        }
      }
    }

    expect(stopLossFired).toBe(true)
    // The stop-loss should have fired near the 10% threshold (price ~90.00),
    // not at the bottom of the crash (~65.00). Allow some slack for the
    // weekly rebalance interval (the price may have dropped further between
    // rebalances before the engine saw it).
    expect(stopLossFiredAtPrice).toBeGreaterThan(8000)   // > £80.00 (not the £65.00 trough)
    expect(stopLossFiredAtPrice).toBeLessThanOrEqual(9000) // <= £90.00 (the 10% threshold)
  })
})

describe('Guardrails — edge cases', () => {
  it('stop-loss does NOT fire for non-stock assets in defensive strategy', () => {
    // The defensive strategy explicitly skips stop-loss for non-stock
    // assets (crypto, commodities) — confirmed at defensiveTrendFollowing.ts:255.
    const crash = build2008Crash('CRYPTO', 10000)
    const histories = new Map<string, PricePoint[]>([['CRYPTO', crash]])
    const stopLossTriggerDate = crash.find((p) => p.close <= 9000)!.date
    const positions: Position[] = [
      { ticker: 'CRYPTO', quantity: 100, avgPrice: 10000, currentPrice: priceAt(crash, stopLossTriggerDate), assetClass: 'cryptocurrency' },
    ]
    const snapshot: PortfolioSnapshot = {
      totalValue: 100 * priceAt(crash, stopLossTriggerDate) + 5000_00,
      cash: 5000_00,
      positions,
    }
    const marketData = marketDataAsOf(stopLossTriggerDate, histories)

    const recs = generateDefensiveTrendRecommendations(snapshot, marketData, DEFENSIVE_CONFIG)
    const stopLoss = recs.find((r) => r.riskFlags?.includes('stop_loss'))

    // Stop-loss should NOT fire for crypto in the defensive strategy.
    expect(stopLoss).toBeUndefined()
  })

  it('concentration cap still applies to non-stock assets in defensive strategy', () => {
    // The concentration check is asset-class-agnostic (defensiveTrendFollowing.ts:250-251).
    const crash = build2008Crash('CRYPTO', 10000)
    const histories = new Map<string, PricePoint[]>([['CRYPTO', crash]])
    const evalDate = crash[Math.floor(crash.length * 0.3)]!.date
    const currentPrice = priceAt(crash, evalDate)
    const positions: Position[] = [
      { ticker: 'CRYPTO', quantity: 600, avgPrice: currentPrice, currentPrice, assetClass: 'cryptocurrency' },
    ]
    const positionValue = 600 * currentPrice
    const cash = positionValue * 2 / 3
    const snapshot: PortfolioSnapshot = {
      totalValue: positionValue + cash,
      cash,
      positions,
    }
    const marketData = marketDataAsOf(evalDate, histories)

    const recs = generateDefensiveTrendRecommendations(snapshot, marketData, DEFENSIVE_CONFIG)
    const trim = recs.find((r) => r.riskFlags?.includes('concentration'))

    expect(trim).toBeDefined()
    expect(trim?.action).toBe('trim')
  })

  it('stop-loss does not fire when price is above the threshold', () => {
    // Sanity check: with a small drawdown (5%), the 10% defensive stop-loss
    // should NOT fire.
    const crash = build2008Crash('CRASH', 10000)
    const histories = new Map<string, PricePoint[]>([['CRASH', crash]])
    // Find a date where the price is down ~5% (above the 10% threshold)
    const mildDropDate = crash.find((p) => p.close <= 9500 && p.close > 9000)!.date
    const positions: Position[] = [
      { ticker: 'CRASH', quantity: 100, avgPrice: 10000, currentPrice: priceAt(crash, mildDropDate) },
    ]
    const snapshot: PortfolioSnapshot = {
      totalValue: 100 * priceAt(crash, mildDropDate) + 5000_00,
      cash: 5000_00,
      positions,
    }
    const marketData = marketDataAsOf(mildDropDate, histories)

    const recs = generateDefensiveTrendRecommendations(snapshot, marketData, DEFENSIVE_CONFIG)
    const stopLoss = recs.find((r) => r.riskFlags?.includes('stop_loss'))

    expect(stopLoss).toBeUndefined()
  })
})
