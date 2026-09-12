/**
 * Paper-trading simulator for the Defensive Trend Following strategy.
 *
 * Given a portfolio snapshot, market-data history, and a proposed action,
 * computes the estimated portfolio state after the action executes. No real
 * orders are placed — this is purely deterministic arithmetic used to preview
 * impact before the user approves a recommendation.
 */

import type { MarketData, PortfolioSnapshot, Position, PricePoint, RiskConfig, StrategyRecommendation } from './types.js'
import { estimateTransactionCost, diversificationAdjustedVol, volatilityScale, computeKellyFraction, kellyScaledWeight } from './strategy-enhancements.js'

const TRADING_DAYS_PER_YEAR = 252

export interface SimulatedPosition {
  ticker: string
  quantity: number
  avgPrice: number
  currentPrice: number
  value: number
  weightPct: number
  unrealisedPnl: number
  accountType?: string
}

export interface PortfolioMetrics {
  totalValue: number
  cash: number
  cashPct: number
  investedValue: number
  positions: SimulatedPosition[]
  maxConcentrationPct: number
  estimatedVolatility: number
}

export interface SimulationResult {
  action: StrategyRecommendation['action']
  ticker?: string
  before: PortfolioMetrics
  after: PortfolioMetrics
  trade: {
    ticker?: string
    quantity: number
    price: number
    value: number
    side: 'buy' | 'sell'
  }
  /** Estimated transaction cost in minor currency units (0 when cost model disabled). */
  transactionCost: number
  /** True when the trade was skipped because transaction cost exceeded expected benefit. */
  skippedDueToCost: boolean
  deltas: {
    totalValue: number
    cash: number
    cashPct: number
    maxConcentrationPct: number
    estimatedVolatility: number
  }
}

function annualisedVolatility(history: PricePoint[]): number {
  if (history.length < 2) return 0
  const returns: number[] = []
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]?.close
    const curr = history[i]?.close
    if (prev !== undefined && prev > 0 && curr !== undefined) returns.push((curr - prev) / prev)
  }
  if (returns.length === 0) return 0
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR)
}

function computeMetrics(
  snapshot: PortfolioSnapshot,
  marketData: Map<string, MarketData>,
): PortfolioMetrics {
  const positions: SimulatedPosition[] = snapshot.positions.map((p) => {
    const value = p.currentPrice * p.quantity
    const unrealisedPnl = (p.currentPrice - p.avgPrice) * p.quantity
    const accountType = (p as unknown as Record<string, string | undefined>)['accountType']
    const pos: SimulatedPosition = {
      ticker: p.ticker,
      quantity: p.quantity,
      avgPrice: p.avgPrice,
      currentPrice: p.currentPrice,
      value,
      weightPct: 0,
      unrealisedPnl,
    }
    if (accountType) pos.accountType = accountType
    return pos
  })

  const investedValue = positions.reduce((sum, p) => sum + p.value, 0)
  const totalValue = investedValue + snapshot.cash
  const cashPct = totalValue > 0 ? (snapshot.cash / totalValue) * 100 : 0

  for (const p of positions) {
    p.weightPct = totalValue > 0 ? (p.value / totalValue) * 100 : 0
  }

  const maxConcentrationPct = positions.length > 0
    ? Math.max(...positions.map((p) => p.weightPct))
    : 0

  let portfolioVol = 0
  let weightSum = 0
  for (const p of positions) {
    const vol = annualisedVolatility(marketData.get(p.ticker)?.history ?? [])
    portfolioVol += (p.weightPct / 100) * vol
    weightSum += p.weightPct / 100
  }
  // Review fix PR #220: adjust for diversification — a weighted average of
  // individual vols assumes perfect correlation and overstates portfolio vol.
  const estimatedVolatility = weightSum > 0
    ? diversificationAdjustedVol(portfolioVol / weightSum, positions.length)
    : 0

  return {
    totalValue,
    cash: snapshot.cash,
    cashPct,
    investedValue,
    positions,
    maxConcentrationPct,
    estimatedVolatility: estimatedVolatility * 100,
  }
}

function buildNewSnapshot(
  original: PortfolioSnapshot,
  newPositions: Position[],
  newCash: number,
): PortfolioSnapshot {
  const snapshot: PortfolioSnapshot = {
    totalValue: newPositions.reduce((s, p) => s + p.currentPrice * p.quantity, 0) + newCash,
    cash: newCash,
    positions: newPositions,
  }
  if (original.tenantId) snapshot.tenantId = original.tenantId
  return snapshot
}

function currentPriceFromMarket(ticker: string, marketData: Map<string, MarketData>): number {
  const md = marketData.get(ticker)
  if (!md || md.history.length === 0) return 0
  const last = md.history[md.history.length - 1]
  return last?.close ?? 0
}

function findTargetQuantity(
  action: StrategyRecommendation['action'],
  ticker: string | undefined,
  position: Position | undefined,
  snapshot: PortfolioSnapshot,
  metrics: PortfolioMetrics,
  marketData: Map<string, MarketData>,
  config: RiskConfig = {},
  recommendationConfidence?: number,
): { ticker?: string; quantity: number; price: number; value: number; side: 'buy' | 'sell' } {
  if (!ticker) return { quantity: 0, price: 0, value: 0, side: 'buy' }

  // For existing positions use the snapshot price; for new positions use market data.
  const price = position?.currentPrice ?? currentPriceFromMarket(ticker, marketData)
  if (!price) return { quantity: 0, price: 0, value: 0, side: 'buy' }

  // Fractional shares: when the broker supports fractional shares (e.g.
  // Trading 212), round to 4 decimal places instead of flooring to whole
  // shares. This lets small portfolios deploy their full cash balance —
  // e.g. £1,000 buys 2.79 shares of GOOGL instead of only 2 (£716).
  // 4 places (not 6) because Trade212 enforces a per-instrument precision
  // cap and rejects orders with more decimals than the instrument allows.
  // Most US stocks accept 4; the broker-execution layer also rounds to 4
  // as a safety net, so internal sizing and broker submission match.
  const fractional = config.fractionalShares ?? false
  const roundQty = (value: number): number => {
    const rounded = fractional ? Math.round(value * 1e4) / 1e4 : Math.floor(value)
    // Guard against floating-point noise producing tiny negative quantities
    // (e.g. -0.0001 from a near-zero excess value). Such values would later
    // fail validation in createPendingTrade.
    return rounded > 0 ? rounded : 0
  }

  const maxPositionWeight = config.maxPositionWeight ?? 10
  // Phase 4: Kelly criterion position sizing. When enabled, scale the
  // target weight by the Kelly fraction (edge / odds), capped at the
  // base maxPositionWeight. Uses academic default parameters until
  // enough live trade history accumulates for calibration.
  const effectiveMaxWeight = config.kellyEnabled
    ? kellyScaledWeight(
        maxPositionWeight,
        computeKellyFraction(
          [],
          config.kellyScale ?? 0.5,
          config.kellyMinTrades ?? 20,
        ),
        recommendationConfidence,
      )
    : maxPositionWeight
  const targetValue = (effectiveMaxWeight / 100) * snapshot.totalValue
  const currentValue = (position?.quantity ?? 0) * price

  // ── maxPositions guard: don't open new positions if already at the cap ──
  const maxPositions = config.maxPositions ?? 0
  const isNewPosition = !position || position.quantity === 0
  const currentHeldCount = snapshot.positions.filter((p) => p.quantity > 0).length
  if (maxPositions > 0 && isNewPosition && currentHeldCount >= maxPositions
      && (action === 'buy' || action === 'deploy_cash')) {
    return { ticker, quantity: 0, price, value: 0, side: 'buy' }
  }

  // ── minPositionWeight guard: don't open positions smaller than the minimum ──
  const minPositionWeight = config.minPositionWeight ?? 0
  if (minPositionWeight > 0 && isNewPosition
      && (action === 'buy' || action === 'deploy_cash')) {
    const minPositionValue = (minPositionWeight / 100) * snapshot.totalValue
    if (targetValue < minPositionValue) {
      // Would need to deploy at least minPositionValue, but maxPositionWeight caps below it.
      // Skip — the config is contradictory for this portfolio size.
      return { ticker, quantity: 0, price, value: 0, side: 'buy' }
    }
  }

  let result: { ticker?: string; quantity: number; price: number; value: number; side: 'buy' | 'sell' }

  switch (action) {
    case 'sell': {
      // Sell entire position
      const qty = position?.quantity ?? 0
      result = { ticker, quantity: qty, price, value: qty * price, side: 'sell' }
      break
    }
    case 'trim': {
      // Reduce to target weight (or sell half if no target weight logic needed)
      let qty: number
      if (!position || currentValue <= targetValue) {
        qty = roundQty((position?.quantity ?? 0) / 2)
      } else {
        const excessValue = currentValue - targetValue
        qty = roundQty(excessValue / price)
      }
      result = { ticker, quantity: qty, price, value: qty * price, side: 'sell' }
      break
    }
    case 'buy':
    case 'deploy_cash': {
      // Deploy enough cash to bring target up to weight, capped by available cash.
      // For new positions, ensure the deploy meets minPositionWeight.
      // For deploy_cash, scale the target by the recommendation confidence so
      // that rank-weighted deployment concentrates capital in top picks rather
      // than each pick trying to deploy the full maxPositionWeight.
      const confidenceScale = action === 'deploy_cash' ? (recommendationConfidence ?? 1) : 1
      const scaledTargetValue = targetValue * confidenceScale
      const minDeploy = isNewPosition && minPositionWeight > 0
        ? Math.max(scaledTargetValue, (minPositionWeight / 100) * snapshot.totalValue)
        : scaledTargetValue
      const shortfall = Math.max(0, minDeploy - currentValue)
      // Volatility scaling: when volScaleTargetVol > 0, scale the deploy value
      // inversely to the instrument's realized volatility. A volatile stock
      // gets a smaller position; a calm stock gets a larger one — targeting
      // a constant volatility contribution across all positions. The scale
      // is capped to [volScaleMin, volScaleMax] (default [0.2, 2.0]).
      const volScaleFactor = config.volScaleTargetVol && config.volScaleTargetVol > 0
        ? volatilityScale(
            marketData.get(ticker)?.history ?? [],
            config.volScaleTargetVol,
            config.volScaleLookbackDays ?? 126,
            config.volScaleMin ?? 0.2,
            config.volScaleMax ?? 2.0,
          )
        : 1
      const scaledShortfall = shortfall * volScaleFactor
      const deployValue = Math.min(scaledShortfall, snapshot.cash)
      const qty = roundQty(deployValue / price)
      result = { ticker, quantity: qty, price, value: qty * price, side: 'buy' }
      break
    }
    case 'add': {
      // Momentum continuation: buy more of an existing winner.
      // Deploy a fraction of available cash proportional to the recommendation's
      // confidence (momentum score), capped by available cash.
      // Apply volatility scaling the same way as deploy_cash — a volatile
      // winner gets a smaller add, a calm one gets a larger add.
      // Phase 4: When Kelly is enabled, cap the add at the Kelly-scaled target
      // weight so position additions also benefit from edge-based sizing.
      const volScaleFactor = config.volScaleTargetVol && config.volScaleTargetVol > 0
        ? volatilityScale(
            marketData.get(ticker)?.history ?? [],
            config.volScaleTargetVol,
            config.volScaleLookbackDays ?? 126,
            config.volScaleMin ?? 0.2,
            config.volScaleMax ?? 2.0,
          )
        : 1
      const addFraction = (config.addCashFraction ?? 0.25) * (recommendationConfidence ?? 0.5) * volScaleFactor
      let deployValue = Math.min(snapshot.cash * addFraction, snapshot.cash)
      // Kelly cap: don't add beyond the Kelly-scaled target weight
      if (config.kellyEnabled) {
        const kellyMaxValue = (effectiveMaxWeight / 100) * snapshot.totalValue
        const currentAlready = currentValue
        const maxAddValue = Math.max(0, kellyMaxValue - currentAlready)
        deployValue = Math.min(deployValue, maxAddValue)
      }
      const qty = roundQty(deployValue / price)
      result = { ticker, quantity: qty, price, value: qty * price, side: 'buy' }
      break
    }
    case 'reduce_exposure': {
      // Reduce every position by the configured fraction as a portfolio-level de-risk
      const reducePct = config.reduceExposurePct ?? 0.20
      const qty = position ? roundQty(position.quantity * reducePct) : 0
      result = { ticker, quantity: qty, price, value: qty * price, side: 'sell' }
      break
    }
    default:
      result = { quantity: 0, price: 0, value: 0, side: 'buy' }
  }

  // ── minTradeValueMinor guard: skip trades that are too small to be worthwhile ──
  const minTradeValue = config.minTradeValueMinor ?? 0
  if (minTradeValue > 0 && result.value > 0 && result.value < minTradeValue) {
    // Full sell is always allowed even if below min (clearing a position is worthwhile).
    if (action !== 'sell') {
      return { ticker, quantity: 0, price, value: 0, side: result.side }
    }
  }

  return result
}

export function simulateRecommendation(
  snapshot: PortfolioSnapshot,
  marketData: Map<string, MarketData>,
  recommendation: StrategyRecommendation,
  config: RiskConfig = {},
): SimulationResult {
  const before = computeMetrics(snapshot, marketData)
  const ticker = recommendation.ticker
  const position = snapshot.positions.find((p) => p.ticker === ticker)

  const trade = findTargetQuantity(recommendation.action, ticker, position, snapshot, before, marketData, config, recommendation.confidence)

  // Transaction cost model: estimate the cost of the trade and skip if
  // it exceeds the expected benefit. Sells are never skipped (risk management).
  const spreadBps = config.spreadBps ?? 0
  const commissionBps = config.commissionBps ?? 0
  const marketImpactBps = config.marketImpactBps ?? 0
  const hasCostModel = spreadBps > 0 || commissionBps > 0 || marketImpactBps > 0
  const costOf = (value: number) =>
    hasCostModel && value > 0 ? estimateTransactionCost(value, spreadBps, commissionBps, marketImpactBps) : 0
  let transactionCost = costOf(trade.value)

  // Skip buys where the transaction cost exceeds the expected return.
  // Expected benefit is confidence × maxExpectedTradeReturnBps (default 50
  // bps) of the trade value — a full-confidence trade is expected to make
  // ~0.5% over the holding period. (Review fix PR #220: the old formula
  // used confidence × trade value — i.e. up to 100% expected return — so
  // the cost check never fired.) Sells always proceed — cutting risk is
  // worth the cost.
  const maxExpectedTradeReturnBps = config.maxExpectedTradeReturnBps ?? 50
  const isBuy = trade.side === 'buy' && trade.quantity > 0
  const expectedBenefit = isBuy
    ? (trade.value * (recommendation.confidence ?? 0) * maxExpectedTradeReturnBps) / 10000
    : transactionCost + 1
  const skippedDueToCost = isBuy && transactionCost > 0 && transactionCost > expectedBenefit

  let newPositions: Position[] = snapshot.positions.map((p) => ({ ...p }))
  let newCash = snapshot.cash

  // Portfolio-level de-risk is modelled as a configurable trim across every held position.
  if (recommendation.action === 'reduce_exposure') {
    const reducePct = config.reduceExposurePct ?? 0.20
    const soldValue = snapshot.positions.reduce((sum, p) => {
      const reduceQty = Math.floor(p.quantity * reducePct)
      return sum + reduceQty * p.currentPrice
    }, 0)
    newPositions = snapshot.positions
      .map((p) => {
        const remaining = p.quantity - Math.floor(p.quantity * reducePct)
        return remaining > 0 ? { ...p, quantity: remaining } : null
      })
      .filter((p): p is Position => p !== null)
    transactionCost = costOf(soldValue)
    newCash += soldValue - transactionCost
    trade.value = soldValue
  } else if (skippedDueToCost) {
    // Trade skipped — transaction cost exceeds expected benefit. Leave
    // positions and cash unchanged.
  } else if (trade.quantity > 0) {
    const tradeValue = trade.quantity * trade.price
    const idx = newPositions.findIndex((p) => p.ticker === ticker)

    if (trade.side === 'buy') {
      // Review fix PR #220: executed trades must actually pay the estimated
      // transaction cost — previously only the trade value moved, so
      // backtest returns were overstated by the cost on every trade.
      newCash -= tradeValue + transactionCost
      if (idx >= 0) {
        const existing = newPositions[idx]!
        const totalCost = existing.avgPrice * existing.quantity + tradeValue
        const totalQty = existing.quantity + trade.quantity
        newPositions[idx] = {
          ...existing,
          quantity: totalQty,
          avgPrice: totalQty > 0 ? totalCost / totalQty : existing.avgPrice,
        }
      } else if (ticker) {
        newPositions.push({
          ticker,
          quantity: trade.quantity,
          avgPrice: trade.price,
          currentPrice: trade.price,
        })
      }
    } else {
      newCash += tradeValue - transactionCost
      if (idx >= 0) {
        const existing = newPositions[idx]!
        const remaining = existing.quantity - trade.quantity
        if (remaining > 0) {
          newPositions[idx] = { ...existing, quantity: remaining }
        } else {
          newPositions.splice(idx, 1)
        }
      }
    }
  }

  const afterSnapshot = buildNewSnapshot(snapshot, newPositions, newCash)
  const after = computeMetrics(afterSnapshot, marketData)

  const result: SimulationResult = {
    action: recommendation.action,
    before,
    after,
    trade,
    transactionCost,
    skippedDueToCost,
    deltas: {
      totalValue: after.totalValue - before.totalValue,
      cash: after.cash - before.cash,
      cashPct: after.cashPct - before.cashPct,
      maxConcentrationPct: after.maxConcentrationPct - before.maxConcentrationPct,
      estimatedVolatility: after.estimatedVolatility - before.estimatedVolatility,
    },
  }
  if (ticker) result.ticker = ticker
  return result
}
