/**
 * Weekly momentum rebalance job.
 *
 * The defensive auto-trader is reactive — it only fires when a detector
 * triggers (concentration risk, price drop). The momentum strategy needs
 * to be PROACTIVE: every week, score the entire universe, deploy cash into
 * the top momentum picks, add to existing winners, and cut losers whose
 * momentum has reversed.
 *
 * This job runs on a weekly cron (Mondays 09:00 London time, before LSE
 * open) and creates pending trades for every momentum recommendation —
 * same createPendingTrade path the detector-driven auto-trader uses. The
 * paper_mode flag in the strategy config controls whether those pending
 * trades execute (live) or just get logged (paper).
 */

import {
  generateMomentumRecommendations,
  simulateRecommendation,
  filterByTurnover,
} from '@kairos/engine'
import { ConnectorActionExecutor } from '@kairos/workflows'
import { findEnabledMomentumTenantIds, getDb, getSignalsCollection } from '../db.js'
import { buildSnapshotFromSignals, buildMarketDataFromSignals, loadStrategyConfig, tenantCanTrade } from './portfolio-data.js'
import { createPendingTrade, findExistingAutoTradeForToday } from './trade-confirmation.js'
import { fetchPriceHistoryMultiSource } from '../jobs/shadow-backtest-runner.js'
import { createLogger, getTenantCollection } from '@kairos/platform'

const log = createLogger({ service: 'momentum-rebalance', version: '0.0.0' })

/** Broad liquid US-equity universe used consistently by recommendations,
 * rebalancing, and shadow backtests. Held positions are added to this list
 * at runtime so a position outside the default universe is never dropped. */
export const DEFAULT_MOMENTUM_UNIVERSE = [
  'SPY_US_EQ',
  'AAPL_US_EQ', 'MSFT_US_EQ', 'GOOGL_US_EQ', 'AMZN_US_EQ', 'NVDA_US_EQ',
  'META_US_EQ', 'TSLA_US_EQ', 'AVGO_US_EQ', 'AMD_US_EQ', 'MU_US_EQ',
  'NFLX_US_EQ', 'ADBE_US_EQ', 'CRM_US_EQ', 'ORCL_US_EQ', 'INTC_US_EQ',
  'QCOM_US_EQ', 'TXN_US_EQ', 'AMAT_US_EQ', 'LRCX_US_EQ', 'MRVL_US_EQ',
  'DELL_US_EQ', 'STX_US_EQ', 'WDC_US_EQ', 'PANW_US_EQ', 'FTNT_US_EQ',
  'NOW_US_EQ', 'IBM_US_EQ', 'CSCO_US_EQ', 'ACN_US_EQ', 'V_US_EQ',
  'MA_US_EQ', 'UNH_US_EQ', 'LLY_US_EQ', 'JPM_US_EQ', 'BAC_US_EQ',
  'XOM_US_EQ', 'CVX_US_EQ', 'HD_US_EQ', 'COST_US_EQ', 'DIS_US_EQ',
] as const

/**
 * Fetch the broker's actual available-to-trade cash balance via the
 * Trading 212 cash endpoint. Returns null if the call fails or the
 * credential isn't in live mode — the caller falls back to the signal-
 * based cash in that case.
 *
 * The broker's availableToTrade is the authoritative cash figure: it
 * accounts for pending orders, unsettled trades, and margin requirements
 * that the synced signal (refreshed every 15 min) doesn't see.
 */
async function fetchBrokerAvailableCash(db: Awaited<ReturnType<typeof getDb>>, tenantId: string): Promise<number | null> {
  try {
    const executor = new ConnectorActionExecutor(db)
    // The 'get_cash' action fetches /equity/account/cash, which returns
    // availableToTrade in account currency (pounds). This is the authoritative
    // cash figure — it accounts for pending orders and unsettled trades.
    const result = await executor.execute(tenantId, 'trading-212', 'get_cash', {})
    if (!result.ok || !result.body) return null
    const data = result.body as Record<string, unknown>
    // The cash endpoint returns { availableToTrade, total, invested, ... }
    // in account currency (pounds), NOT minor units (pence). Convert to
    // pence here so the engine's minor-unit convention is consistent.
    const availableToTrade = data['availableToTrade']
    const free = data['free']
    const cash = availableToTrade ?? free
    if (typeof cash === 'number' && Number.isFinite(cash) && cash >= 0) {
      return Math.round(cash * 100)
    }
    return null
  } catch (err) {
    log.warn({ tenant_id: tenantId, err }, 'Failed to fetch broker available cash — falling back to signal cash')
    return null
  }
}

/**
 * Sum the value of all pending and executing auto-trades for the tenant.
 * These represent cash already committed to orders that haven't settled yet,
 * so the rebalance must not re-deploy that cash.
 */
async function sumPendingTradeValue(db: Awaited<ReturnType<typeof getDb>>, tenantId: string): Promise<number> {
  const pending = await getTenantCollection<Record<string, unknown>>(db, 'pending_trades', tenantId)
    .find({
      origin: 'auto_workflow',
      status: { $in: ['pending', 'executing'] },
      side: 'buy',
    })
    .toArray()
  return pending.reduce((sum: number, t: Record<string, unknown>) => sum + Number(t['value'] ?? 0), 0)
}

/**
 * Load the portfolio high-water mark (peak total value) from tenant_settings.
 * Stored under key 'portfolio_high_water_mark'. Returns 0 if no HWM has been
 * recorded yet — the caller treats 0 as "not yet initialised, record current
 * value as the baseline".
 */
async function loadPortfolioHighWaterMark(db: ReturnType<typeof getDb> extends Promise<infer D> ? D : never, tenantId: string): Promise<number> {
  const doc = await getTenantCollection<Record<string, unknown>>(db, 'tenant_settings', tenantId)
    .findOne({ key: 'portfolio_high_water_mark' })
  return (doc?.['value'] as { total_value?: number } | undefined)?.total_value ?? 0
}

/**
 * Update the portfolio high-water mark if the current value exceeds it.
 * Never lowers the HWM — that's the whole point of a drawdown measure.
 */
async function updatePortfolioHighWaterMark(db: ReturnType<typeof getDb> extends Promise<infer D> ? D : never, tenantId: string, currentValue: number): Promise<void> {
  const existing = await loadPortfolioHighWaterMark(db, tenantId)
  if (currentValue > existing) {
    await getTenantCollection<Record<string, unknown>>(db, 'tenant_settings', tenantId).updateOne(
      { key: 'portfolio_high_water_mark' },
      { $set: { tenant_id: tenantId, key: 'portfolio_high_water_mark', value: { total_value: currentValue, updated_at: new Date() }, updated_at: new Date() } },
      { upsert: true },
    )
  }
}

/**
 * Turnover-reduction state (Phase 1.5, review wiring fix PR #220).
 * Persisted in tenant_settings under key 'momentum_rebalance_state' so the
 * weekly rebalance can compare this week's scores/weights against last
 * week's and skip trades whose thesis hasn't materially changed.
 */
interface RebalanceState {
  scores: Record<string, number>
  weights: Record<string, number>
}

async function loadRebalanceState(db: ReturnType<typeof getDb> extends Promise<infer D> ? D : never, tenantId: string): Promise<{ scores: Map<string, number>; weights: Map<string, number> }> {
  const doc = await getTenantCollection<Record<string, unknown>>(db, 'tenant_settings', tenantId)
    .findOne({ key: 'momentum_rebalance_state' })
  const value = doc?.['value'] as RebalanceState | undefined
  return {
    scores: new Map(Object.entries(value?.scores ?? {})),
    weights: new Map(Object.entries(value?.weights ?? {})),
  }
}

async function saveRebalanceState(db: ReturnType<typeof getDb> extends Promise<infer D> ? D : never, tenantId: string, scores: Map<string, number>, weights: Map<string, number>): Promise<void> {
  await getTenantCollection<Record<string, unknown>>(db, 'tenant_settings', tenantId).updateOne(
    { key: 'momentum_rebalance_state' },
    {
      $set: {
        tenant_id: tenantId,
        key: 'momentum_rebalance_state',
        value: { scores: Object.fromEntries(scores), weights: Object.fromEntries(weights) },
        updated_at: new Date(),
      },
    },
    { upsert: true },
  )
}

/**
 * Live-trading safety check: if the portfolio's current total value has
 * dropped more than `autoDisableDrawdownPct` below its recorded high-water
 * mark, auto-disable auto-trading and write an audit alert. This is the
 * automatic kill-switch that prevents the momentum strategy from continuing
 * to trade into a sustained drawdown (the backtest showed -25% to -37% in
 * bear markets — the kill-switch trips at -10% by default for live trading).
 *
 * Returns true if the rebalance should be skipped (drawdown exceeded),
 * false if it's safe to proceed.
 */
async function checkDrawdownKillSwitch(
  db: ReturnType<typeof getDb> extends Promise<infer D> ? D : never,
  tenantId: string,
  currentValue: number,
  thresholdPct: number,
): Promise<boolean> {
  if (thresholdPct <= 0) return false // kill-switch disabled

  const hwm = await loadPortfolioHighWaterMark(db, tenantId)
  if (hwm <= 0) {
    // No HWM recorded yet — seed it with the current value as the baseline.
    // This is the first rebalance; there's no drawdown to measure against.
    await updatePortfolioHighWaterMark(db, tenantId, currentValue)
    return false
  }

  const drawdown = (hwm - currentValue) / hwm
  if (drawdown >= thresholdPct) {
    log.warn(
      { tenant_id: tenantId, hwm, current_value: currentValue, drawdown_pct: Math.round(drawdown * 100), threshold_pct: Math.round(thresholdPct * 100) },
      'Drawdown kill-switch tripped — auto-disabling auto-trading',
    )

    // Auto-disable auto-trading by flipping autoTradingEnabled to false in
    // the live_trading_opt_in doc. The tenant can re-enable manually after
    // reviewing the drawdown.
    await getTenantCollection<Record<string, unknown>>(db, 'tenant_settings', tenantId).updateOne(
      { key: 'live_trading_opt_in' },
      { $set: { 'value.autoTradingEnabled': false, 'value.killSwitchTrippedAt': new Date(), updated_at: new Date() } },
    )

    // Write an audit alert so the tenant sees why auto-trading stopped.
    await getTenantCollection<Record<string, unknown>>(db, 'audit_logs', tenantId).insertOne({
      action: 'auto_trading.kill_switch_tripped',
      resource_type: 'portfolio',
      details: {
        high_water_mark: hwm,
        current_value: currentValue,
        drawdown_pct: Math.round(drawdown * 100),
        threshold_pct: Math.round(thresholdPct * 100),
      },
      created_at: new Date(),
    })

    return true
  }

  // Update HWM if we're at a new peak (only when not tripping — avoids
  // recording a depressed value as the new "peak" during a drawdown).
  await updatePortfolioHighWaterMark(db, tenantId, currentValue)
  return false
}

export interface RebalanceResult {
  tenantId: string
  strategy: 'momentum' | 'defensive'
  skipped: boolean
  skipReason?: string
  recommendations: number
  tradesCreated: number
  tradesSkipped: number
}

/**
 * Run a weekly momentum rebalance for a single tenant.
 *
 * Skips tenants whose strategy is 'defensive' (the reactive detector-driven
 * auto-trader handles those) or whose strategy is disabled. For momentum
 * tenants, scores the universe and creates a pending trade for every
 * recommendation that produces a non-zero trade quantity.
 */
export async function runMomentumRebalanceForTenant(tenantId: string): Promise<RebalanceResult> {
  const strategyConfig = await loadStrategyConfig(tenantId)

  if (!strategyConfig.enabled) {
    return { tenantId, strategy: strategyConfig.strategy, skipped: true, skipReason: 'strategy disabled', recommendations: 0, tradesCreated: 0, tradesSkipped: 0 }
  }

  if (strategyConfig.strategy !== 'momentum') {
    return { tenantId, strategy: strategyConfig.strategy, skipped: true, skipReason: `strategy is ${strategyConfig.strategy}, not momentum`, recommendations: 0, tradesCreated: 0, tradesSkipped: 0 }
  }

  const canTrade = await tenantCanTrade(tenantId)
  if (!canTrade) {
    return { tenantId, strategy: strategyConfig.strategy, skipped: true, skipReason: 'tenant not in trading vertical', recommendations: 0, tradesCreated: 0, tradesSkipped: 0 }
  }

  const signalsCol = await getSignalsCollection()
  const signals = await signalsCol
    .find({ tenant_id: tenantId, signal_type: { $in: ['portfolio_position', 'portfolio_summary'] } })
    .sort({ created_at: -1 })
    .toArray()

  const snapshot = buildSnapshotFromSignals(tenantId, signals)
  // Always score the union of held positions AND the broad candidate universe.
  // The previous implementation collapsed the universe to only held positions
  // once any position existed — so the strategy could never discover a new
  // momentum winner to deploy cash into. It could only add to existing
  // winners or sell losers, never rotate into a new name. A momentum strategy
  // that can't see the broader universe is just a hold-and-trim strategy.
  //
  // Backtest comparison (scripts/compare-universes.mjs) showed a 3-name
  // universe returned +6% over 4.5 years while a 20-40 name universe returned
  // +432% — breadth is the single biggest driver of momentum strategy
  // performance. The strategy picks the top 3-5 by momentum score each
  // rebalance; it does NOT buy all 40.
  const positionTickers = snapshot.positions.map((p) => p.ticker)
  // Union: held positions + default universe, deduplicated.
  const tickers = Array.from(new Set([...positionTickers, ...DEFAULT_MOMENTUM_UNIVERSE]))
  let marketData = await buildMarketDataFromSignals(tenantId, tickers)

  // If DB signals have no market data for tickers in the universe (e.g. the
  // portfolio is fully in cash and no market_price signals exist), fetch
  // from yfinance/Alpha Vantage — the same multi-source approach the shadow
  // backtest uses. Without this, the strategy can't score any tickers and
  // cash deployment never fires. Fetch for any ticker missing from the
  // signals-based market data, not just when the entire map is empty.
  const missingTickers = tickers.filter((t) => !marketData.has(t))
  if (missingTickers.length > 0) {
    const db = await getDb()
    for (const ticker of missingTickers) {
      const history = await fetchPriceHistoryMultiSource(ticker, db, tenantId)
      if (history.length > 0) {
        marketData.set(ticker, {
          ticker,
          history,
        })
      }
    }
    const fetched = missingTickers.filter((t) => marketData.has(t))
    if (fetched.length > 0) {
      log.info({ tenant_id: tenantId, tickers: fetched }, 'Fetched market data from yfinance/Alpha Vantage for missing universe tickers')
    }
  }

  // Drawdown kill-switch: check before generating any recommendations. If
  // the portfolio has dropped more than autoDisableDrawdownPct below its
  // high-water mark, skip this rebalance and auto-disable auto-trading. The
  // tenant must manually re-enable after reviewing the drawdown.
  //
  // Runs in BOTH paper and live mode. Paper mode is where guardrails should
  // be proven — if the kill-switch doesn't fire in paper, there is no
  // evidence it will work before going live. The previous guard
  // (!strategyConfig.paper_mode) skipped the check entirely in paper mode,
  // meaning a paper-mode strategy could draw down 50% with no kill-switch
  // trip, giving false confidence that the strategy is safe to go live.
  const db = await getDb()
  if (strategyConfig.autoDisableDrawdownPct > 0) {
    const skipForDrawdown = await checkDrawdownKillSwitch(
      db,
      tenantId,
      snapshot.totalValue,
      strategyConfig.autoDisableDrawdownPct,
    )
    if (skipForDrawdown) {
      return {
        tenantId,
        strategy: strategyConfig.strategy,
        skipped: true,
        skipReason: `drawdown kill-switch tripped (threshold ${strategyConfig.autoDisableDrawdownPct * 100}%) — auto-trading auto-disabled`,
        recommendations: 0,
        tradesCreated: 0,
        tradesSkipped: 0,
      }
    }
  }

  // Cash accuracy: the snapshot's cash comes from synced signals, which may
  // be stale (the connector syncs every 15 min). For live trades, fetch the
  // broker's actual availableToTrade balance and reserve cash already
  // committed to pending/executing trades. Without this, the rebalance could
  // deploy more cash than the broker actually has available, causing
  // "insufficient funds" rejections.
  if (!strategyConfig.paper_mode) {
    const brokerCash = await fetchBrokerAvailableCash(db, tenantId)
    if (brokerCash !== null) {
      // Reserve cash for pending/executing auto-trades that haven't settled yet.
      const pendingReserve = await sumPendingTradeValue(db, tenantId)
      const effectiveCash = Math.max(0, brokerCash - pendingReserve)
      if (effectiveCash < snapshot.cash) {
        log.info(
          { tenant_id: tenantId, signal_cash: snapshot.cash, broker_cash: brokerCash, pending_reserve: pendingReserve, effective_cash: effectiveCash },
          'Using broker availableToTrade (minus pending reserve) instead of stale signal cash',
        )
      }
      // Override the snapshot's cash with the broker-verified amount.
      snapshot.cash = effectiveCash
    }
  }

  const recommendations = generateMomentumRecommendations(snapshot, marketData, strategyConfig)

  // Turnover reduction (Phase 1.5, review wiring fix PR #220): only act on
  // recommendations whose score changed materially since the last rebalance
  // or whose weight drifted significantly. Sells and reduce_exposure always
  // pass through — risk management is never filtered.
  const minScoreDelta = strategyConfig.minScoreChangeForRebalance ?? 0
  const minWeightDrift = strategyConfig.minWeightDriftForRebalance ?? 0
  const minScoreDeltaEntry = strategyConfig.minScoreChangeForRebalanceEntry ?? 0
  const totalValue = Math.max(snapshot.totalValue, 1)
  const currentWeights = new Map(snapshot.positions.map((p) => [p.ticker, (p.currentPrice * p.quantity / totalValue) * 100]))
  const currentScores = new Map(recommendations.filter((r) => r.ticker).map((r) => [r.ticker as string, r.confidence ?? 0]))

  let filtered = recommendations
  if (minScoreDelta > 0 || minWeightDrift > 0 || minScoreDeltaEntry > 0) {
    const prevState = await loadRebalanceState(db, tenantId)
    const before = recommendations.length
    filtered = filterByTurnover(recommendations, prevState.scores, prevState.weights, currentWeights, minScoreDelta, minWeightDrift, minScoreDeltaEntry)
    if (filtered.length < before) {
      log.info({ tenant_id: tenantId, before, after: filtered.length, minScoreDelta, minWeightDrift, minScoreDeltaEntry }, 'Turnover filter removed low-delta recommendations')
    }
  }
  // Persist this week's state for next week's comparison, regardless of
  // whether the filter is enabled — so enabling it later has a baseline.
  await saveRebalanceState(db, tenantId, currentScores, currentWeights)

  const actionable = filtered.filter((r) => r.action !== 'hold')

  let tradesCreated = 0
  let tradesSkipped = 0

  // Track remaining cash across recommendations in this rebalance batch.
  // The snapshot passed to simulateRecommendation has the FULL cash balance,
  // so without tracking depletion, every deploy_cash recommendation would
  // try to deploy up to maxPositionWeight% of the same cash — 5 × 34% = 170%
  // of the portfolio, which the broker rejects as "insufficient funds".
  // Each buy/deploy_cash/add reduces remainingCash; sells/trims add to it.
  let remainingCash = snapshot.cash

  for (const rec of actionable) {
    if (!rec.ticker) continue

    // Skip if there's already a pending/executing/executed auto-trade for
    // this ticker today — same dedup guard as the detector-driven path.
    // Exception: allow sell/trim/reduce_exposure even if there was a buy
    // earlier today — rotation requires selling a position we just added to.
    const isSellSide = rec.action === 'sell' || rec.action === 'trim' || rec.action === 'reduce_exposure'
    const existing = await findExistingAutoTradeForToday(db, tenantId, rec.ticker)
    if (existing && !isSellSide) {
      tradesSkipped++
      continue
    }

    // Build a working snapshot with the remaining cash so the simulator
    // sizes this trade against what's actually left, not the original balance.
    const workingSnapshot = { ...snapshot, cash: remainingCash }
    const result = simulateRecommendation(workingSnapshot, marketData, rec, strategyConfig)
    if (!result.trade.ticker || result.trade.quantity <= 0) {
      log.info({ tenant_id: tenantId, ticker: rec.ticker, action: rec.action, confidence: rec.confidence, reason: rec.reason, trade_quantity: result.trade.quantity, skippedDueToCost: result.skippedDueToCost, trade_value: result.trade.value }, 'Rebalance recommendation skipped — simulateRecommendation returned 0 quantity')
      tradesSkipped++
      continue
    }

    // Deplete remaining cash by the trade value (buys) or credit it (sells).
    if (result.trade.side === 'buy') {
      remainingCash -= result.trade.value
    } else {
      remainingCash += result.trade.value
    }

    // Resolve the goal this trade is helping to achieve (same as auto-trade.ts).
    const linkedGoal = await getTenantCollection<Record<string, unknown>>(db, 'goals', tenantId).findOne(
      { detector_ids: 'trading_momentum_buy_signal', status: { $nin: ['archived', 'achieved', 'failed'] } },
      { projection: { id: 1 } },
    )

    await createPendingTrade(
      tenantId,
      {
        action: rec.action as 'buy' | 'sell' | 'trim' | 'hold' | 'reduce_exposure' | 'deploy_cash',
        ticker: rec.ticker,
        quantity: result.trade.quantity,
        price: result.trade.price,
        goal_id: linkedGoal?.id as string | undefined,
        connector_id: 'trading-212',
      },
      'auto_workflow',
    )
    tradesCreated++
  }

  log.info({ tenant_id: tenantId, recommendations: filtered.length, actionable: actionable.length, tradesCreated, tradesSkipped, paper_mode: strategyConfig.paper_mode }, 'Momentum rebalance completed')

  return {
    tenantId,
    strategy: strategyConfig.strategy,
    skipped: false,
    recommendations: filtered.length,
    tradesCreated,
    tradesSkipped,
  }
}

/**
 * Run the weekly momentum rebalance across all tenants with the momentum
 * strategy enabled. Called from the server.ts weekly cron.
 */
export async function runMomentumRebalanceSweep(): Promise<{ tenantsProcessed: number; tradesCreated: number }> {
  const tenantIds = await findEnabledMomentumTenantIds()

  let tenantsProcessed = 0
  let tradesCreated = 0

  for (const tenantId of tenantIds) {
    try {
      const result = await runMomentumRebalanceForTenant(tenantId)
      if (!result.skipped) {
        tenantsProcessed++
        tradesCreated += result.tradesCreated
      }
    } catch (err) {
      log.error({ err, tenant_id: tenantId }, 'Momentum rebalance failed for tenant')
    }
  }

  log.info({ tenantsProcessed, tradesCreated }, 'Momentum rebalance sweep completed')
  return { tenantsProcessed, tradesCreated }
}
