/**
 * Builds a trade intent for autonomous execution from a detector-fired event.
 *
 * Intentionally scoped to `trading_concentration_risk` and
 * `trading_price_drop_alert` only — both flag a specific ticker with a
 * trim/sell rationale that matches `generateDefensiveTrendRecommendations`'s
 * own logic. `trading_dividend_opportunity` has no corresponding action
 * anywhere in the recommendation engine, and `trading_rebalance_suggestion`'s
 * only response (`deploy_cash`) picks a new ticker to buy using a composite
 * score whose `quality` component is a hardcoded placeholder
 * (`packages/engine/src/trading/defensiveTrendFollowing.ts`) — auto-executing
 * either would mean moving real money on logic that doesn't exist or is
 * partly fake. See the "Autonomous trade execution" plan for the full
 * reasoning; extending this to the other two detectors is tracked there as
 * explicit follow-up work, not something to add here silently.
 */

import {
  generateDefensiveTrendRecommendations,
  generateMomentumRecommendations,
  simulateRecommendation,
  type StrategyRecommendation,
} from '@kairos/engine'
import { getSignalsCollection } from '../db.js'
import { buildSnapshotFromSignals, buildMarketDataFromSignals, loadStrategyConfig, tenantCanTrade } from './portfolio-data.js'

// Defensive detectors fire on losses (concentration, price drop) and can
// only trim/sell. Momentum detectors fire on gains (strong momentum,
// trailing stop) and can buy/add/deploy cash. A detector in both sets
// (e.g. trading_momentum_trailing_stop) can sell — cutting a winner whose
// trend has reversed is valid in both strategies.
const AUTO_TRADE_DETECTORS = new Set([
  'trading_concentration_risk',
  'trading_price_drop_alert',
  'trading_momentum_buy_signal',
  'trading_momentum_trailing_stop',
])

/**
 * Gap #7 (TRADING_ENGINE_GAPS.md): detector-to-recommendation matching was
 * ticker-only — buildAutoTradeIntent just matched by ticker, so a
 * trading_concentration_risk alert (UI copy: "trim to target weight") could
 * end up executing whatever the composite score produced for that ticker,
 * including a full sell. This map constrains which actions each detector
 * is allowed to trigger:
 * - trading_concentration_risk: may trim, or sell when the position is both
 *   severely overweight (>3x the cap) AND significantly underwater (>15%
 *   loss). This "forced deleveraging" mode prevents catastrophic
 *   concentration in a collapsing stock — the reddy003 tenant had DPW at
 *   49% weight (-24% loss) and dismissed every trim alert for 10 days.
 * - trading_price_drop_alert: may sell or trim — a price drop can
 *   legitimately warrant a full exit (stop-loss) or a trim.
 * - trading_momentum_buy_signal: may buy, add, or deploy cash — the
 *   detector fires when a ticker's momentum score crosses the add
 *   threshold, so the only valid actions are ones that increase exposure.
 * - trading_momentum_trailing_stop: may sell — the detector fires when
 *   a winner's price drops below the trailing stop, locking in gains.
 */
const DETECTOR_ALLOWED_ACTIONS: Record<string, Set<StrategyRecommendation['action']>> = {
  trading_concentration_risk: new Set(['trim', 'sell', 'hold']),
  trading_price_drop_alert: new Set(['sell', 'trim', 'hold']),
  trading_momentum_buy_signal: new Set(['buy', 'add', 'deploy_cash', 'hold']),
  trading_momentum_trailing_stop: new Set(['sell', 'trim', 'hold']),
}

/**
 * Forced deleveraging threshold: when a position is both severely
 * overweight (>3x the concentration cap) AND significantly underwater
 * (>15% loss from average), the concentration_risk detector is allowed
 * to recommend a full sell instead of just a trim. This catches the
 * DPW_US_EQ pattern (49% weight, -24% loss) where trim-only alerts were
 * dismissed for 10 days while the position bled.
 */
const FORCED_DELEVERAGE_WEIGHT_MULT = 3  // 3x the concentration cap
const FORCED_DELEVERAGE_LOSS_PCT = 15   // 15% drop from average

/**
 * Checks if a position qualifies for forced deleveraging (full sell
 * instead of trim). Returns true when the position weight exceeds 3x
 * the goal's concentration cap AND the position is down >15% from average.
 */
function shouldForceDeleverage(
  eventData: Record<string, unknown>,
  goalKpiTargets?: Record<string, number>,
): boolean {
  const weight = Number(eventData['portfolio_weight_pct'] ?? 0)
  const currentPrice = Number(eventData['current_price'] ?? 0)
  const avgPrice = Number(eventData['avg_price'] ?? 0)
  const cap = goalKpiTargets?.['portfolio_concentration_max_pct'] ?? 10
  if (weight <= 0 || avgPrice <= 0) return false
  const isOverweight = weight > cap * FORCED_DELEVERAGE_WEIGHT_MULT
  const lossPct = ((avgPrice - currentPrice) / avgPrice) * 100
  const isUnderwater = lossPct > FORCED_DELEVERAGE_LOSS_PCT
  return isOverweight && isUnderwater
}

export interface AutoTradeIntent {
  action: StrategyRecommendation['action']
  ticker: string
  quantity: number
  price: number
  value: number
  side: 'buy' | 'sell'
}

/**
 * Returns null when the detector isn't in scope for autonomous execution,
 * when there's no live recommendation for the event's ticker, or when the
 * simulated trade quantity is zero (mirrors RecommendationsPanel.tsx's own
 * `result.trade.quantity === 0` guard on the manual path).
 */
export async function buildAutoTradeIntent(
  tenantId: string,
  detectorId: string,
  eventData: Record<string, unknown>,
): Promise<AutoTradeIntent | null> {
  if (!AUTO_TRADE_DETECTORS.has(detectorId)) return null

  // Backend vertical gate (defense in depth): autonomous trade creation is
  // only valid for the trading-investment vertical. The frontend hides the
  // auto-trading UI for other verticals, but the workflow engine can still
  // call this function — reject early before any portfolio data is loaded.
  const canTrade = await tenantCanTrade(tenantId)
  if (!canTrade) return null

  const ticker = typeof eventData['ticker'] === 'string' ? eventData['ticker'] : undefined
  if (!ticker) return null

  const signalsCol = await getSignalsCollection()
  const signals = await signalsCol
    .find({ tenant_id: tenantId, signal_type: { $in: ['portfolio_position', 'portfolio_summary'] } })
    .sort({ created_at: -1 })
    .toArray()

  const snapshot = buildSnapshotFromSignals(tenantId, signals)
  const tickers = snapshot.positions.map((p) => p.ticker)
  const marketData = await buildMarketDataFromSignals(tenantId, tickers)
  const strategyConfig = await loadStrategyConfig(tenantId)
  if (!strategyConfig.enabled) return null

  const recommendations = strategyConfig.strategy === 'momentum'
    ? generateMomentumRecommendations(snapshot, marketData, strategyConfig)
    : generateDefensiveTrendRecommendations(snapshot, marketData, strategyConfig)
  const foundRec = recommendations.find((r) => r.ticker === ticker)
  if (!foundRec || foundRec.action === 'hold') return null

  let recommendation = foundRec

  // Gap #7: constrain the action to what the firing detector is allowed to
  // trigger. concentration_risk may trim or (under forced deleveraging) sell.
  // If the composite score produced an action outside the allowed set, skip
  // it rather than executing a broken promise.
  const allowedActions = DETECTOR_ALLOWED_ACTIONS[detectorId]
  if (allowedActions && !allowedActions.has(recommendation.action)) {
    return null
  }

  // Forced deleveraging guard: concentration_risk may only full-sell when
  // the position is both severely overweight (>3x cap) AND significantly
  // underwater (>15% loss). Otherwise, downgrade a sell to a trim — the
  // alert's UI copy says "trim to target weight," so a full liquidation
  // would be a broken promise for a merely overweight position.
  if (detectorId === 'trading_concentration_risk' && recommendation.action === 'sell') {
    const position = snapshot.positions.find((p) => p.ticker === ticker)
    const positionData = signals.find((s) => {
      const d = s.data as Record<string, unknown> | undefined
      return d?.['ticker'] === ticker
    })?.data as Record<string, unknown> | undefined
    const forceDeleverage = position && positionData && shouldForceDeleverage(positionData)
    if (!forceDeleverage) {
      // Downgrade sell → trim for non-severe concentration cases
      recommendation = { ...recommendation, action: 'trim' }
    }
  }

  const result = simulateRecommendation(snapshot, marketData, recommendation, strategyConfig)
  if (!result.trade.ticker || result.trade.quantity === 0) return null

  return {
    action: recommendation.action,
    ticker: result.trade.ticker,
    quantity: result.trade.quantity,
    price: result.trade.price,
    value: result.trade.value,
    side: result.trade.side,
  }
}
