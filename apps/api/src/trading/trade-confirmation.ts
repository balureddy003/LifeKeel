/**
 * Shared pending-trade create/confirm logic for the Trading & Investment
 * vertical.
 *
 * Extracted out of the POST /portfolio/trades and POST
 * /portfolio/trades/:id/confirm route bodies in apps/api/src/routes/portfolio.ts
 * so the manual-confirm route and the autonomous-trading cron
 * (runAutoTradeConfirmationSweep, called from apps/api/src/server.ts) share
 * exactly one implementation of the atomic claim, guard evaluation, and audit
 * log — not two copies that can drift apart. Every trade, manual or
 * autonomous, goes through evaluateTradeExecution's full guard chain here;
 * there is no other path to a real broker call.
 */

import { randomUUID, createHash } from 'node:crypto'
import type { Db } from 'mongodb'
import { getDb, getInsightsCollection, getReceiptsCollection } from '../db.js'
import {
  evaluateTradeExecution,
  isWithinCancellationWindow,
  type TradeIntent,
  type TradeReceipt,
  type FeatureHashScorer,
} from '@kairos/engine'
import { createLogger } from '@kairos/platform'
import { createExecuteBrokerTrade } from './broker-execution.js'
import { isLseMarketOpen, getMarketOpenChecker } from './market-hours.js'
import { loadLiveTradingOptIn, isBrokerInLiveMode, loadLatestPrices, tenantCanTrade, MAX_ORDER_VALUE_MINOR, MAX_TRADES_PER_DAY, loadStrategyConfig } from './portfolio-data.js'
import { getAuditLogger, type AuditAction } from '../audit/audit-log.js'
import type { ActionReceipt } from '@kairos/workflows'
import { ConnectorActionExecutor } from '@kairos/workflows'

/**
 * Pre-trade broker position check: fetches the actual portfolio from the
 * broker and verifies we own enough shares before placing a sell order.
 *
 * The synced DB signals can be stale (up to 15 min) or out of sync with the
 * broker (e.g. positions sold manually via the broker app). Placing a sell
 * order for shares we don't own results in a broker rejection like
 * "Selling more equities than owned, owned: 0.0".
 *
 * This function calls the broker's /equity/portfolio endpoint directly to
 * get the true position, then checks if the sell quantity is covered.
 *
 * Returns { ok: true } if the sell can proceed, or { ok: false, error } if
 * the position is insufficient or the check fails.
 */
async function verifyBrokerPositionForSell(
  executor: ConnectorActionExecutor,
  tenantId: string,
  ticker: string,
  sellQuantity: number,
): Promise<{ ok: true; ownedQty: number } | { ok: false; error: string }> {
  try {
    const result = await executor.execute(tenantId, 'trading-212', 'get_portfolio', {})
    if (!result.ok) {
      // Can't verify — let the broker reject if there's an issue
      log.warn({ tenant_id: tenantId, ticker, error: result.error }, 'Broker portfolio fetch failed — proceeding with trade')
      return { ok: true, ownedQty: -1 }
    }
    // The body is the raw response from /equity/portfolio — an array of positions
    const positions = result.body as Array<{ ticker?: string; quantity?: number }>
    if (!Array.isArray(positions)) {
      // Unexpected response shape — let the broker decide
      return { ok: true, ownedQty: -1 }
    }
    const position = positions.find((p) => p.ticker === ticker)
    const ownedQty = position?.quantity ?? 0
    if (ownedQty < sellQuantity) {
      return {
        ok: false,
        error: `Broker position check: owned ${ownedQty} shares of ${ticker}, trying to sell ${sellQuantity}. The synced portfolio is out of sync with the broker — skipping this trade.`,
      }
    }
    return { ok: true, ownedQty }
  } catch (err) {
    // If the check itself fails, don't block the trade — let the broker
    // decide. The check is a safety net, not a gate.
    log.warn({ tenant_id: tenantId, ticker, err }, 'Broker position check failed — proceeding with trade')
    return { ok: true, ownedQty: -1 }
  }
}

const log = createLogger({ service: 'trade-confirmation', version: '0.0.0' })

// Singleton — set by server.ts during init, same pattern as audit-log.ts's
// initAuditLogger/getAuditLogger. Lets confirmPendingTrade feed the same
// positive signal to FeatureHashScorer's online learning that human approval
// does (insights.ts:236-248) without changing confirmPendingTrade's call
// signature for every caller.
let _featureHashScorer: FeatureHashScorer | undefined

export function initTradeFeatureHashScorer(scorer: FeatureHashScorer | undefined): void {
  _featureHashScorer = scorer
}

/**
 * Human-cancellation window for manual trades. 5 minutes is the safety window
 * for a human to cancel a trade they initiated before it auto-confirms.
 */
export const TRADE_CANCELLATION_WINDOW_SECONDS = 300

/**
 * Cancellation window for autonomous (auto-workflow) trades. This is the
 * safety window for a human to review and cancel auto-generated trades before
 * the cron sweep auto-confirms them.
 *
 * Configurable via the `AUTO_TRADE_CANCELLATION_WINDOW_HOURS` env var.
 * Default: 1 hour (reduced from 72h for faster execution while still
 * giving time to cancel). Set to 72 for paper-mode review periods.
 */
const AUTO_TRADE_WINDOW_HOURS = Number(process.env['AUTO_TRADE_CANCELLATION_WINDOW_HOURS'] ?? '1')
export const AUTO_TRADE_CANCELLATION_WINDOW_SECONDS = Math.max(1, AUTO_TRADE_WINDOW_HOURS) * 60 * 60

export type PendingTradeOrigin = 'manual' | 'auto_workflow'

/**
 * Normalizes a trade quantity to a consistent precision for both manual and
 * auto-trade paths.
 *
 * Gap #23 (TRADING_ENGINE_GAPS.md): the manual trade endpoint required
 * `z.number().int().min(1)` (whole shares only), while the auto-trade path
 * sent raw fractional quantities from the simulator (e.g.
 * `3978.01919374` for a full sell of DPW_US_EQ). The two paths disagreed,
 * meaning at least one was wrong for real instruments.
 *
 * Trading 212 supports fractional shares — the API docs show `quantity: 0.1`
 * as an example, and the live data confirms fractional positions. So the fix
 * is to allow fractional quantities on both paths, rounded to 8 decimal
 * places (matching the precision of the live DPW_US_EQ position). This
 * function is the single chokepoint: both manual and auto-trade paths go
 * through createPendingTrade, which calls this.
 */
export function normalizeQuantity(qty: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0
  // Round to 8 decimal places — matches the precision of live T212 positions
  // (e.g. 3978.01919374). Avoids floating-point noise like 3978.019193740001.
  return Math.round(qty * 1e8) / 1e8
}

export interface CreatePendingTradeParams {
  action: 'buy' | 'sell' | 'trim' | 'hold' | 'reduce_exposure' | 'deploy_cash' | 'add'
  ticker?: string
  quantity: number
  price: number
  accountType?: string
  /** Id of the detector event that triggered this trade (auto-workflow only). */
  source_event_id?: string
  /** Id of the insight that the triggering event was derived from (auto-workflow only). */
  source_insight_id?: string
  /**
   * Gap #32: Id of the goal that motivated this trade, threaded from the
   * detector's feature_snapshot via the workflow's trade_intent node.
   * Lets the goal dashboard attribute portfolio changes to specific Kairos
   * trades instead of showing only current state with no attribution.
   */
  goal_id?: string
  /**
   * Connector id for the broker that will execute this trade (e.g.
   * 'trading-212'). Used by the market-hours check in confirmPendingTrade
   * to determine which exchange's hours to check. When omitted, the check
   * falls back to LSE hours — wrong for US equity trades.
   */
  connector_id?: string
}

export async function createPendingTrade(
  tenantId: string,
  params: CreatePendingTradeParams,
  origin: PendingTradeOrigin,
): Promise<{ tradeId: string; expiresAt: Date; value: number; side: 'buy' | 'sell' }> {
  const db = await getDb()
  const tradeId = randomUUID()
  // Auto-workflow trades get a longer cancellation window (72h) so paper-mode
  // trades don't expire before human review. Manual trades keep the 5-minute
  // safety window.
  const cancellationWindow = origin === 'auto_workflow'
    ? AUTO_TRADE_CANCELLATION_WINDOW_SECONDS
    : TRADE_CANCELLATION_WINDOW_SECONDS
  const expiresAt = new Date(Date.now() + cancellationWindow * 1000)
  // Gap #23: normalize quantity to 8 decimal places on both paths. A
  // normalized quantity of 0 (from a non-positive or non-finite input) is
  // rejected here — both paths share the same validation.
  const quantity = normalizeQuantity(params.quantity)
  if (quantity === 0) {
    throw new Error(`Invalid trade quantity: ${params.quantity}. Must be a positive finite number.`)
  }
  const value = quantity * params.price
  const side = (['sell', 'trim', 'reduce_exposure'].includes(params.action) ? 'sell' : 'buy') as 'buy' | 'sell'
  const tradeDoc = {
    tenant_id: tenantId,
    trade_id: tradeId,
    status: 'pending' as const,
    ...params,
    quantity,
    value,
    side,
    origin,
    created_at: new Date(),
    expires_at: expiresAt,
  }
  await db.collection('pending_trades').insertOne(tradeDoc)
  return { tradeId, expiresAt, value, side }
}

/**
 * Atomically claims a daily trade slot — increments a per-tenant-per-day
 * counter and returns whether the increment would exceed the limit.
 *
 * Gap #11 (TRADING_ENGINE_GAPS.md): countTradesExecutedToday and the atomic
 * pending→executing claim were not in one transaction. Two trades confirming
 * concurrently could both read the same count before either incremented it,
 * letting maxTradesPerDay be exceeded.
 *
 * This function uses a separate `daily_trade_counters` collection with a
 * per-tenant-per-day document. The findOneAndUpdate with $inc is atomic in
 * MongoDB — if two calls race, one gets the pre-increment value (checked
 * against the limit) and the other gets the post-increment value. If the
 * pre-increment value is already at the limit, the caller rejects and must
 * call releaseDailyTradeSlot to roll back the increment.
 *
 * This counter is authoritative for the daily-limit check; the
 * countTradesExecutedToday function above is kept for backward compatibility
 * and display purposes (GET /portfolio/trades).
 */
async function claimDailyTradeSlot(
  tenantId: string,
  maxTradesPerDay: number,
  dayKey: string,
): Promise<{ allowed: boolean; currentCount: number }> {
  const db = await getDb()
  const result = await db.collection('daily_trade_counters').findOneAndUpdate(
    { tenant_id: tenantId, day: dayKey },
    { $inc: { count: 1 } },
    { upsert: true, returnDocument: 'after' },
  )
  const newCount = (result?.['count'] as number | undefined) ?? 1
  // The increment already happened. If newCount > maxTradesPerDay, the limit
  // was exceeded — the caller must release the slot.
  return { allowed: newCount <= maxTradesPerDay, currentCount: newCount }
}

/** Rolls back a daily trade slot claim when the trade is rejected. */
async function releaseDailyTradeSlot(tenantId: string, dayKey: string): Promise<void> {
  const db = await getDb()
  await db.collection('daily_trade_counters').updateOne(
    { tenant_id: tenantId, day: dayKey },
    { $inc: { count: -1 } },
  ).catch(() => {
    // Best-effort rollback — a failed decrement means the counter is
    // slightly over-conservative (one extra slot consumed), which is
    // safe: the tenant just gets one fewer trade today.
    log.warn({ tenant_id: tenantId, day: dayKey }, 'Failed to release daily trade slot')
  })
}

/**
 * Returns a day key for the daily trade counter (YYYY-MM-DD in Europe/London
 * time, not UTC).
 *
 * Gap #12 (TRADING_ENGINE_GAPS.md): the daily-limit boundary used a fixed UTC
 * calendar day with no BST adjustment, despite the product being
 * GBP/ISA/LSE-focused. During BST the daily-limit reset was off by an hour
 * from the user's actual local trading day. Now computes the day boundary in
 * Europe/London time — the tenant's timezone configuration doesn't exist yet,
 * but London is the correct default for a GBP/ISA product.
 *
 * Exported for unit testing.
 */
export function getDayKey(date: Date = new Date()): string {
  // Format the date in Europe/London time, then extract YYYY-MM-DD.
  // Intl.DateTimeFormat handles DST automatically.
  const londonDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  return londonDate // en-CA locale gives YYYY-MM-DD
}

/**
 * Returns the UTC Date corresponding to the start of the current London
 * trading day (00:00 Europe/London). Used by countTradesExecutedToday to
 * query the DB with a UTC timestamp that aligns with the London day boundary.
 *
 * Exported for unit testing.
 */
export function startOfLondonTradingDay(now: Date = new Date()): Date {
  const dayKey = getDayKey(now)
  // Parse the London-local midnight as a UTC time, then convert.
  // London is at UTC+0 (GMT) or UTC+1 (BST), so London midnight is
  // 23:00 UTC the previous day during BST, or 00:00 UTC during GMT.
  // We can compute this by formatting the London date as "YYYY-MM-DDT00:00:00"
  // and treating it as London time, then converting to UTC.
  const londonMidnight = `${dayKey}T00:00:00`
  // Use Intl to find the offset: format the current time in London with
  // timeZoneName to get the offset, then subtract.
  // Simpler: just parse the London midnight string as if it were UTC, then
  // adjust by the current London offset.
  const asUtc = new Date(londonMidnight + 'Z')
  // Get the London offset in minutes for the current time
  const londonParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/London',
    timeZoneName: 'short',
  }).formatToParts(now)
  const tzPart = londonParts.find((p) => p.type === 'timeZoneName')
  const isBst = tzPart?.value === 'GMT+1' || tzPart?.value === 'BST'
  // During BST, London is UTC+1, so London midnight = 23:00 UTC previous day.
  // During GMT, London is UTC+0, so London midnight = 00:00 UTC same day.
  return isBst ? new Date(asUtc.getTime() - 60 * 60 * 1000) : asUtc
}

async function countTradesExecutedToday(tenantId: string): Promise<number> {
  const db = await getDb()
  // Gap #12: use the London trading day boundary, not raw UTC.
  const startOfDay = startOfLondonTradingDay()
  return db.collection('pending_trades').countDocuments({
    tenant_id: tenantId,
    status: 'executed',
    updated_at: { $gte: startOfDay },
  })
}

export type ConfirmActor =
  | { type: 'user'; userId: string; ip: string; userAgent: string }
  | { type: 'system'; label: string }

export interface ConfirmPendingTradeResult {
  status: 'not_found' | 'expired' | 'conflict' | 'cancelled' | 'market_closed' | TradeReceipt['status']
  receipt?: TradeReceipt
  error?: string
}

export async function confirmPendingTrade(
  tenantId: string,
  tradeId: string,
  actor: ConfirmActor,
): Promise<ConfirmPendingTradeResult> {
  const db = await getDb()
  const trade = await db.collection('pending_trades').findOne({ tenant_id: tenantId, trade_id: tradeId, status: 'pending' })
  if (!trade) {
    return { status: 'not_found', error: 'Pending trade not found' }
  }

  // The cancellation window means opposite things for the two origins:
  // a MANUAL confirm must happen inside it (waiting past it means the human
  // never clicked — the trade goes stale and expires); an AUTO_WORKFLOW
  // confirm is only ever called by the cron sweep for trades whose window
  // has already elapsed (that elapsed window *is* the human's chance to
  // cancel). Applying the manual expiry rule to auto trades would expire
  // every single one of them before they could ever confirm.
  if (trade['origin'] !== 'auto_workflow') {
    const createdAt = trade.created_at as Date
    if (!isWithinCancellationWindow(createdAt, TRADE_CANCELLATION_WINDOW_SECONDS)) {
      await db.collection('pending_trades').updateOne({ _id: trade._id }, { $set: { status: 'expired', updated_at: new Date() } })
      return { status: 'expired', error: 'Cancellation window expired' }
    }
  }

  // Gap #24 (TRADING_ENGINE_GAPS.md): check market hours before the atomic
  // claim. If the trade will reach the broker (live trading globally enabled,
  // tenant opted in, broker in live mode) and the LSE is closed, defer the
  // trade — leave it pending so the auto-trade cron retries when the market
  // opens, and return a clear "market closed" error for manual confirms
  // instead of a generic broker rejection. Trades that will only be logged
  // (not reaching the broker) are unaffected — logging doesn't need the
  // market to be open.
  const globalAllowedEarly = process.env['KAIROS_ALLOW_LIVE_TRADING'] === 'true'
  if (globalAllowedEarly) {
    const optInEarly = await loadLiveTradingOptIn(tenantId)
    const brokerLiveEarly = await isBrokerInLiveMode(tenantId)
    // Use the connector + ticker-specific market-hours check. Trading 212
    // instruments encode their exchange via a suffix (e.g. AAPL_US_EQ →
    // NYSE). The previous implementation hardcoded LSE for Trading 212,
    // which was wrong — the live account trades US equities, so the check
    // used the wrong exchange's hours and holidays.
    const connectorId = (trade as Record<string, unknown>)['connector_id'] as string | undefined
    const tradeTicker = trade['ticker'] as string | undefined
    const isMarketOpenForConnector = connectorId
      ? getMarketOpenChecker(connectorId, tradeTicker)
      : isLseMarketOpen
    if (optInEarly?.enabled && brokerLiveEarly && !isMarketOpenForConnector()) {
      // Derive a human-readable exchange name for the error message.
      const exchangeName = tradeTicker?.endsWith('_US_EQ')
        ? 'NYSE/NASDAQ'
        : connectorId === 'zerodha'
          ? 'NSE'
          : 'LSE'
      return {
        status: 'market_closed',
        error: `${exchangeName} is currently closed (outside trading hours or a holiday). The trade remains pending and will be retried when the market opens.`,
      }
    }
  }

  // Idempotency guard: Trading 212's beta order endpoints are explicitly
  // documented as non-idempotent, so a double-click, client retry, or the
  // cron racing a manual confirm must not double-place an order. This atomic
  // claim is the actual guard — if two confirms race, only the one that
  // flips status pending → executing proceeds.
  const claimed = await db.collection('pending_trades').findOneAndUpdate(
    { _id: trade._id, status: 'pending' },
    { $set: { status: 'executing', updated_at: new Date() } },
    { returnDocument: 'after' },
  )
  if (!claimed) {
    return { status: 'conflict', error: 'Trade is already being processed' }
  }

  // Autonomous trades only: re-check the tenant's autoTradingEnabled flag at
  // confirm time, not just at creation — turning the toggle off cancels
  // anything still pending in the cancellation window instead of letting it
  // execute anyway.
  if (trade['origin'] === 'auto_workflow') {
    const optInCheck = await loadLiveTradingOptIn(tenantId)
    if (!optInCheck?.autoTradingEnabled) {
      await db.collection('pending_trades').updateOne(
        { _id: trade._id },
        { $set: { status: 'cancelled', updated_at: new Date(), cancel_reason: 'auto_trading_disabled' } },
      )
      return { status: 'cancelled', error: 'Auto-trading was disabled before this trade could confirm' }
    }

    // Backend vertical gate (defense in depth): autonomous trading is only
    // valid for the trading-investment vertical. If the tenant switched
    // verticals after a trade was queued, cancel it rather than executing.
    const canTrade = await tenantCanTrade(tenantId)
    if (!canTrade) {
      await db.collection('pending_trades').updateOne(
        { _id: trade._id },
        { $set: { status: 'cancelled', updated_at: new Date(), cancel_reason: 'vertical_not_trading' } },
      )
      return { status: 'cancelled', error: 'Auto-trading is not available for this vertical' }
    }
  }

  const optIn = await loadLiveTradingOptIn(tenantId)
  const brokerLive = await isBrokerInLiveMode(tenantId)
  const globalAllowed = process.env['KAIROS_ALLOW_LIVE_TRADING'] === 'true'

  // Gap #11 (TRADING_ENGINE_GAPS.md): the daily trade-count check was a
  // non-atomic read (countTradesExecutedToday) followed by a separate atomic
  // claim — two concurrent confirms could both read the same count and both
  // proceed, exceeding maxTradesPerDay. Now uses an atomic per-tenant-per-day
  // counter (claimDailyTradeSlot) that increments first, then checks. If the
  // trade doesn't execute (guard holds it back or broker rejects), the slot
  // is released.
  //
  // The slot is only claimed when the trade will actually reach the broker —
  // if globalAllowed is off or the tenant hasn't opted in, the trade is
  // logged only and no slot is consumed.
  const willReachBroker = globalAllowed && optIn?.enabled && brokerLive
  // Defense in depth: clamp the stored caps to the platform ceiling in case
  // an old opt-in record was saved before the schema enforced a maximum.
  // This prevents a stale record from bypassing the platform guardrail.
  const maxTradesPerDay = optIn?.maxTradesPerDay !== undefined
    ? Math.min(optIn.maxTradesPerDay, MAX_TRADES_PER_DAY)
    : undefined
  let dailySlotClaimed = false
  const dayKey = getDayKey()
  if (willReachBroker && maxTradesPerDay !== undefined) {
    const slot = await claimDailyTradeSlot(tenantId, maxTradesPerDay, dayKey)
    if (!slot.allowed) {
      // Over the limit — release the slot we just consumed and reject
      await releaseDailyTradeSlot(tenantId, dayKey)
      await db.collection('pending_trades').updateOne(
        { _id: trade._id },
        { $set: { status: 'rejected', updated_at: new Date(), receipt: { status: 'rejected', reason: `Daily trade limit reached (${slot.currentCount}/${maxTradesPerDay}). Trade rejected.` } } },
      )
      return {
        status: 'rejected',
        receipt: { tradeId, tenantId, status: 'rejected', reason: `Daily trade limit reached (${slot.currentCount}/${maxTradesPerDay}). Trade rejected.`, dryRun: false },
      }
    }
    dailySlotClaimed = true
  }

  // For the evaluateTradeExecution guard, pass the pre-claim count (which
  // the atomic counter already accounts for). The engine's own daily-limit
  // check is now redundant but kept as a defense-in-depth backstop.
  const tradesExecutedToday = dailySlotClaimed ? 0 : await countTradesExecutedToday(tenantId)

  // Gap #26 (TRADING_ENGINE_GAPS.md): the order-value guard in
  // evaluateTradeExecution checks intent.value against maxOrderValueMinor.
  // Previously, intent.value was always the creation-time snapshot
  // (price * quantity from when the pending_trade was created), which can
  // be several minutes stale by confirm time — for a fast-moving
  // instrument, the real order value at execution could exceed the cap the
  // guard believes it's enforcing.
  //
  // Re-fetch the latest price for the ticker and recompute the value. If
  // no current price is available (e.g. market data hasn't synced yet),
  // fall back to the creation-time price — the staleness bound is the
  // 5-minute cancellation window, which is documented and acceptable for
  // a fallback, but not as the primary path.
  let currentPrice = trade['price'] as number
  let currentValue = trade['value'] as number
  const ticker = trade['ticker'] as string | undefined
  if (ticker) {
    const latestPrices = await loadLatestPrices(tenantId, [ticker])
    const freshPrice = latestPrices.get(ticker)
    if (freshPrice !== undefined && freshPrice > 0) {
      currentPrice = freshPrice
      currentValue = (trade['quantity'] as number) * freshPrice
    }
  }

  const intent: TradeIntent = {
    id: tradeId,
    tenantId,
    action: trade['action'],
    ticker: trade['ticker'],
    quantity: trade['quantity'],
    price: currentPrice,
    value: currentValue,
    side: trade['side'],
    accountType: trade['accountType'],
  }

  // Paper mode: when the tenant's strategy is 'momentum' and paper_mode = true
  // (the default), the confirmation sweep logs what would have executed but
  // does NOT call the broker. This lets tenants validate the momentum
  // strategy's decisions for 4-8 weeks before flipping to live execution.
  // The pending trade is marked 'logged' (same status used when guards
  // hold back a trade) and the receipt records the would-be execution.
  // Defensive trades are unaffected — they have their own guard chain
  // (kill-switch, opt-in, market hours) and paper_mode doesn't apply.
  if (trade['origin'] === 'auto_workflow') {
    const strategyConfig = await loadStrategyConfig(tenantId)
    if (strategyConfig.strategy === 'momentum' && strategyConfig.paper_mode) {
      const paperReceipt: TradeReceipt = {
        tradeId,
        tenantId,
        status: 'logged',
        reason: 'Paper mode: trade logged but not executed (strategy_config.paper_mode = true)',
        dryRun: true,
        executedAt: new Date(),
      }
      await db.collection('pending_trades').updateOne(
        { _id: trade._id },
        { $set: { status: 'logged', receipt: paperReceipt, updated_at: new Date() } },
      )
      log.info({ tenant_id: tenantId, trade_id: tradeId, ticker: trade['ticker'], action: trade['action'], side: trade['side'], quantity: trade['quantity'], value: currentValue }, 'Paper-mode auto-trade logged (not executed)')
      return { status: 'logged', receipt: paperReceipt }
    }
  }

  // Pre-trade broker position check for SELL orders: the synced DB signals
  // can be stale or out of sync with the broker (e.g. positions sold
  // manually via the broker app). Fetch the actual broker portfolio and
  // verify we own enough shares before placing the sell order. This
  // prevents "Selling more equities than owned" rejections.
  if (willReachBroker && intent.side === 'sell' && intent.ticker) {
    const executor = new ConnectorActionExecutor(db)
    const positionCheck = await verifyBrokerPositionForSell(
      executor,
      tenantId,
      intent.ticker,
      Math.abs(intent.quantity),
    )
    if (!positionCheck.ok) {
      const rejectedReceipt: TradeReceipt = {
        tradeId,
        tenantId,
        status: 'rejected',
        reason: positionCheck.error,
        dryRun: false,
        executedAt: new Date(),
      }
      await db.collection('pending_trades').updateOne(
        { _id: trade._id },
        { $set: { status: 'rejected', receipt: rejectedReceipt, updated_at: new Date() } },
      )
      log.warn({ tenant_id: tenantId, trade_id: tradeId, ticker: intent.ticker, sell_qty: intent.quantity, error: positionCheck.error }, 'Sell trade rejected — broker position check failed')
      return { status: 'rejected', receipt: rejectedReceipt, error: positionCheck.error }
    }
    log.info({ tenant_id: tenantId, trade_id: tradeId, ticker: intent.ticker, sell_qty: intent.quantity, owned_qty: positionCheck.ownedQty }, 'Broker position check passed — proceeding with sell')
  }

  const receipt = await evaluateTradeExecution(
    intent,
    {
      allowLiveTrading: globalAllowed,
      optIn: optIn
        ? {
            enabled: optIn.enabled,
            confirmedAt: new Date(optIn.confirmedAt ?? Date.now()),
            method: optIn.method,
            // Clamp to platform ceiling (defense in depth — same as the
            // maxTradesPerDay clamp above).
            maxOrderValueMinor: Math.min(optIn.maxOrderValueMinor, MAX_ORDER_VALUE_MINOR),
            maxTradesPerDay: maxTradesPerDay ?? Math.min(optIn.maxTradesPerDay, MAX_TRADES_PER_DAY),
          }
        : null,
      brokerLiveMode: brokerLive,
      tradesExecutedToday,
    },
    createExecuteBrokerTrade(db),
  )

  // Pass the real status through — 'executed' when the broker call
  // succeeded, 'logged' when a guard held it back, 'rejected' on failure.
  const finalStatus = receipt.status
  if (finalStatus !== 'executed') {
    log.warn(
      { tenant_id: tenantId, trade_id: tradeId, ticker: trade['ticker'], action: trade['action'], side: trade['side'], quantity: trade['quantity'], value: currentValue, final_status: finalStatus, reason: receipt.reason, will_reach_broker: willReachBroker, opt_in_enabled: optIn?.enabled, broker_live: brokerLive, global_allowed: globalAllowed },
      'Trade was NOT executed — guard blocked or broker rejected',
    )
  } else {
    log.info(
      { tenant_id: tenantId, trade_id: tradeId, ticker: trade['ticker'], action: trade['action'], side: trade['side'], quantity: trade['quantity'], value: currentValue, external_id: receipt.externalId },
      'Trade executed successfully',
    )
  }
  await db.collection('pending_trades').updateOne(
    { _id: trade._id },
    {
      $set: {
        status: finalStatus,
        receipt,
        updated_at: new Date(),
        ...(receipt.externalId && { external_id: receipt.externalId, external_platform: receipt.externalPlatform }),
      },
    },
  )

  // Gap #11: release the daily trade slot if the trade didn't execute.
  // 'executed' consumes the slot; 'logged' (guard held it back) and
  // 'rejected' (broker refused) release it back.
  if (dailySlotClaimed && finalStatus !== 'executed') {
    await releaseDailyTradeSlot(tenantId, dayKey)
  }

  // Gap #27 (TRADING_ENGINE_GAPS.md): the trade.execute audit-log entry was
  // fire-and-forget — a transient DB error silently dropped the audit record
  // for a real financial action. Now uses logWithRetry (3 retries with
  // exponential backoff) for the trade.execute entry specifically. The
  // trade.confirm and trade.reject entries stay fire-and-forget — they're
  // not financial actions, so a dropped record is less critical.
  const auditAction: AuditAction = finalStatus === 'executed' ? 'trade.execute' : finalStatus === 'rejected' ? 'trade.reject' : 'trade.confirm'
  const auditEntry = {
    tenant_id: tenantId,
    user_id: actor.type === 'user' ? actor.userId : `system:${actor.label}`,
    action: auditAction,
    resource_type: 'pending_trade',
    resource_id: tradeId,
    metadata: {
      ticker: trade['ticker'],
      quantity: trade['quantity'],
      value_minor: trade['value'],
      side: trade['side'],
      status: finalStatus,
      external_id: receipt.externalId,
      origin: trade['origin'],
    },
    ip: actor.type === 'user' ? actor.ip : 'internal',
    user_agent: actor.type === 'user' ? actor.userAgent : `kairos-${actor.label}`,
    timestamp: new Date(),
  }
  if (finalStatus === 'executed') {
    // Financial action — use the retrying path
    await getAuditLogger()?.logWithRetry(auditEntry)
  } else {
    // Non-financial — fire-and-forget is acceptable
    getAuditLogger()?.log(auditEntry)
  }

  // Gap #19 (TRADING_ENGINE_GAPS.md): when a broker call fails ambiguously
  // (5xx, timeout, network error, or 2xx-with-no-order-id), the order may
  // have been placed even though we recorded it as rejected. This is the
  // one failure path where "no confirmation" doesn't guarantee "no order."
  // Raise a distinct audit alert (separate from the normal trade.reject
  // entry above) so a human knows to manually verify their broker account
  // for that ticker/timeframe. The reconciliation sweep (gap #13, Phase 3)
  // will eventually automate this via get_order, but until then the alert
  // is the only way to catch a real position change that escaped the
  // pending_trades record.
  if (finalStatus === 'rejected' && receipt.ambiguous) {
    log.warn(
      { trade_id: tradeId, tenant_id: tenantId, ticker: trade['ticker'], reason: receipt.reason },
      'Ambiguous broker rejection — order may have been placed. Manual broker account verification required.',
    )
    // Gap #27: use logWithRetry for the ambiguous_rejection alert too —
    // this is a financial safety alert that must not be silently dropped.
    await getAuditLogger()?.logWithRetry({
      tenant_id: tenantId,
      user_id: actor.type === 'user' ? actor.userId : `system:${actor.label}`,
      action: 'trade.ambiguous_rejection',
      resource_type: 'pending_trade',
      resource_id: tradeId,
      metadata: {
        ticker: trade['ticker'],
        quantity: trade['quantity'],
        value_minor: trade['value'],
        side: trade['side'],
        reason: receipt.reason,
        origin: trade['origin'],
        alert: 'MANUAL_BROKER_VERIFICATION_REQUIRED',
        message: `Broker call for ${trade['ticker']} failed ambiguously. The order may have been placed — manually verify your broker account for this ticker/timeframe.`,
      },
      ip: actor.type === 'user' ? actor.ip : 'internal',
      user_agent: actor.type === 'user' ? actor.userAgent : `kairos-${actor.label}`,
      timestamp: new Date(),
    })
  }

  // Gap #4 (TRADING_ENGINE_GAPS.md): auto-executed trades never updated the
  // originating Insight, so Calibration was blind to auto-trading activity —
  // the tool built to answer "is Kairos good at this" couldn't see the
  // majority of real activity once auto-trading became the primary mode.
  //
  // This is a deliberately minimal write-back — NOT the full
  // /insights/:id/approve pipeline. It sets only the two fields Calibration
  // reads (state + approved_at), marks the actor as 'system:auto_trading'
  // (mirroring ConfirmActor's 'system:'+label convention so nothing
  // downstream mistakes it for a real user), feeds the same positive signal
  // to FeatureHashScorer's online learning that human approval does, and
  // writes an ActionReceipt with outcome 'auto_approved' (the existing
  // vocabulary for system-acted approvals).
  //
  // Explicitly skipped (each is a separate product decision): quota/credit
  // gate, ActionExecutor.execute (the trade IS the action), workflow
  // trust-level increment, and causal-experiment kickoff.
  if (
    trade['origin'] === 'auto_workflow' &&
    (finalStatus === 'executed' || finalStatus === 'logged') &&
    typeof trade['source_insight_id'] === 'string'
  ) {
    await markInsightCompletedByAutoTrade(
      tenantId,
      trade['source_insight_id'],
      trade['detector_id'] as string | undefined,
      tradeId,
      finalStatus,
    ).catch((err) => {
      // Fire-and-forget with error log — a failed insight write-back must
      // never fail the trade confirmation itself. The trade is already
      // persisted; the insight link is a calibration nicety, not a
      // financial-correctness requirement.
      log.error({ trade_id: tradeId, source_insight_id: trade['source_insight_id'], err }, 'auto-trade insight write-back failed')
    })
  }

  return { status: finalStatus, receipt }
}

/**
 * Minimal insight write-back for auto-executed trades (gap #4 resolution).
 *
 * Sets state='completed' + approved_at on the insight (the two fields
 * Calibration reads), marks approved_by='system:auto_trading' so nothing
 * downstream mistakes it for a human approval, feeds the same positive
 * signal to FeatureHashScorer's online SGD update that human approval feeds
 * (outcome=1), and writes an ActionReceipt with outcome='auto_approved'.
 *
 * Does NOT run the quota/credit gate, ActionExecutor, workflow trust-level
 * increment, or causal-experiment kickoff — each of those is a separate
 * product decision, not part of "make Calibration see auto-trades."
 */
async function markInsightCompletedByAutoTrade(
  tenantId: string,
  insightId: string,
  detectorId: string | undefined,
  tradeId: string,
  tradeStatus: string,
): Promise<void> {
  const insightsCol = await getInsightsCollection()
  const result = await insightsCol.findOneAndUpdate(
    { id: insightId, tenant_id: tenantId, state: 'identified' },
    {
      $set: {
        state: 'completed',
        approved_at: new Date(),
        approved_by: 'system:auto_trading',
      },
    },
    { returnDocument: 'after' },
  )
  if (!result) {
    // Insight already moved past 'identified' (e.g. human dismissed it
    // before the auto-trade confirmed, or it was already completed by a
    // previous cycle). Not an error — just nothing to do.
    log.debug({ insight_id: insightId, tenant_id: tenantId }, 'auto-trade insight write-back: insight not in identified state, skipping')
    return
  }

  // Feed the same positive signal to FeatureHashScorer's online learning
  // that human approval feeds (insights.ts:236-248). Skipping this would
  // make auto-trading's calibration data invisible to the learning loop
  // too, not just the dashboard.
  if (_featureHashScorer && result.detector_id) {
    const features = (result.feature_snapshot as Record<string, unknown> | undefined)
      ?? { hypothesis: result.hypothesis, urgency: result.urgency, category: result.category }
    await _featureHashScorer.update(
      tenantId,
      result.detector_id,
      features,
      1,
      { features: Object.keys(features).map((k) => `data.${k}`) },
    )
  }

  // ActionReceipt with the existing 'auto_approved' outcome — the
  // codebase's established vocabulary for system-acted approvals (see
  // ActionReceiptOutcome in packages/workflows/src/types.ts:287-293).
  const receiptsCol = await getReceiptsCollection()
  const receipt: ActionReceipt = {
    id: randomUUID(),
    tenant_id: tenantId,
    insight_id: insightId,
    detector_id: detectorId ?? result.detector_id,
    action_type: 'trade.auto_confirm',
    outcome: 'auto_approved',
    outcome_reason: `auto-trade ${tradeId} confirmed as ${tradeStatus}`,
    executed_at: new Date(),
    approved_by: 'system:auto_trading',
    payload_hash: createHash('sha256').update(JSON.stringify({ tradeId, insightId, tradeStatus })).digest('hex'),
    dry_run: tradeStatus === 'logged',
  }
  await receiptsCol.insertOne(receipt)
}

/**
 * Confirms every due autonomous pending trade — called on a per-minute cron
 * from apps/api/src/server.ts. "Due" means the auto-trade cancellation window
 * has elapsed (expires_at has passed); anything still `pending` and younger
 * is left alone so the human has time to review/cancel.
 *
 * Uses the trade's expires_at field rather than a hardcoded cutoff, so the
 * 72-hour auto-trade window is respected. The previous implementation used
 * the 5-minute manual-trade window, causing auto-trades to be confirmed
 * before anyone could review them — especially problematic in paper mode
 * where human oversight is the entire point.
 */
export async function runAutoTradeConfirmationSweep(): Promise<{ processed: number }> {
  const db = await getDb()
  const now = new Date()
  const due = await db.collection('pending_trades')
    .find({ origin: 'auto_workflow', status: 'pending', expires_at: { $lte: now } })
    .toArray()

  if (due.length > 0) {
    log.info({ due_count: due.length, tickers: due.map((t) => t['ticker']) }, 'Auto-trade confirmation sweep found due trades')
  }

  let processed = 0
  for (const trade of due) {
    try {
      const result = await confirmPendingTrade(trade['tenant_id'] as string, trade['trade_id'] as string, { type: 'system', label: 'cron' })
      // Gap #24: market_closed means the trade was deferred (left pending),
      // not processed — the sweep will retry on the next cycle when the
      // market opens. Don't count it as processed.
      if (result.status !== 'market_closed') processed++
    } catch (err) {
      log.error({ trade_id: trade['trade_id'], err }, 'Auto-trade confirmation sweep failed for trade')
    }
  }
  return { processed }
}

/**
 * Checks whether an auto-trade for the given ticker already exists today —
 * either still pending/executing, or already completed (executed/logged)
 * within the current UTC trading day. Used by the createPendingTradeFn
 * closure in server.ts to prevent duplicate auto-trades for the same ticker.
 *
 * Gap #21 (TRADING_ENGINE_GAPS.md): the original check only matched
 * status: 'pending'. The moment a trade transitioned to 'executing' or
 * 'executed', the check no longer saw it — a second detector cycle firing
 * for the same ticker later the same day created an independent duplicate.
 * Now widens to also match 'executing' (in-flight) and 'executed'/'logged'
 * (completed today). Rejected/cancelled/expired trades don't block — those
 * didn't execute.
 *
 * Gap #29 (TRADING_ENGINE_GAPS.md): the day boundary was originally computed
 * with raw setUTCHours(0,0,0,0), which disagreed with countTradesExecutedToday's
 * Europe/London boundary (gap #12) during BST by one hour. Now uses the same
 * startOfLondonTradingDay() helper so both functions agree on which trading
 * day a trade belongs to.
 *
 * Exported so it can be unit-tested independently of the server.ts closure.
 */
export async function findExistingAutoTradeForToday(
  db: Db,
  tenantId: string,
  ticker: string,
): Promise<{ trade_id: string; status: string } | null> {
  const startOfTradingDay = startOfLondonTradingDay()
  const existing = await db.collection('pending_trades').findOne({
    tenant_id: tenantId,
    ticker,
    origin: 'auto_workflow',
    $or: [
      // Still pending or in-flight — always block
      { status: { $in: ['pending', 'executing'] } },
      // Already completed today — block duplicates within the same trading day.
      // 'logged' trades did NOT actually execute (paper mode or guards held
      // them back), so they should NOT block a live re-run — otherwise a
      // paper-mode run followed by a live run on the same day would skip
      // every ticker that was logged.
      { status: 'executed', updated_at: { $gte: startOfTradingDay } },
    ],
  })
  if (!existing) return null
  return { trade_id: String(existing['trade_id']), status: String(existing['status']) }
}

/**
 * Stale threshold for orphaned `executing` trades — if a trade has been in
 * `executing` status for longer than this, it's likely a partial write
 * failure (gap #13) and needs reconciliation.
 */
const STALE_EXECUTING_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Reconciliation sweep — handles three related gaps:
 *
 * Gap #13: Orphaned `executing` trades on partial write failure. If the
 * broker call succeeds but the subsequent Mongo updateOne throws, the trade
 * is stuck at `status: 'executing'` forever. This sweep finds trades that
 * have been in `executing` for longer than STALE_EXECUTING_THRESHOLD_MS and
 * reconciles them against the broker via `get_order`.
 *
 * Gap #14: No sweep for stale manual pending trades. The cron only queried
 * `origin: 'auto_workflow'`. A manual pending trade a user never confirmed
 * or cancelled just sat at `status: 'pending'` indefinitely. This sweep
 * lazily expires manual pending trades past their cancellation window.
 *
 * Gap #15: Broker fill price is never captured. The `get_order` action is
 * fully defined in the connector registry but never invoked. This sweep
 * calls `get_order` for recently-executed trades that don't yet have a
 * `fill_price` recorded, and persists the fill price/status.
 *
 * Designed to run on the same per-minute cron as runAutoTradeConfirmationSweep.
 */
export async function runTradeReconciliationSweep(): Promise<{
  expiredManual: number
  reconciledExecuting: number
  fillPricesCaptured: number
}> {
  const db = await getDb()
  const now = Date.now()
  let expiredManual = 0
  let reconciledExecuting = 0
  let fillPricesCaptured = 0

  // --- Gap #14: Expire stale manual pending trades ---
  // Manual trades have a 5-minute cancellation window. If the user never
  // confirmed or cancelled, the trade should be expired — not left pending
  // indefinitely. The existing cron only processed auto_workflow trades.
  const manualCutoff = new Date(now - TRADE_CANCELLATION_WINDOW_SECONDS * 1000)
  const staleManual = await db.collection('pending_trades')
    .find({
      origin: 'manual',
      status: 'pending',
      created_at: { $lte: manualCutoff },
    })
    .toArray()
  for (const trade of staleManual) {
    try {
      await db.collection('pending_trades').updateOne(
        { _id: trade._id, status: 'pending' },
        { $set: { status: 'expired', updated_at: new Date(), expire_reason: 'cancellation_window_elapsed' } },
      )
      expiredManual++
    } catch (err) {
      log.error({ trade_id: trade['trade_id'], err }, 'Failed to expire stale manual trade')
    }
  }

  // --- Gap #13: Reconcile orphaned `executing` trades ---
  // If the broker call succeeded but the Mongo write failed, the trade is
  // stuck at `executing`. Find trades that have been in this state for
  // longer than the threshold and try to reconcile.
  const executingCutoff = new Date(now - STALE_EXECUTING_THRESHOLD_MS)
  const staleExecuting = await db.collection('pending_trades')
    .find({
      status: 'executing',
      updated_at: { $lte: executingCutoff },
    })
    .toArray()
  for (const trade of staleExecuting) {
    try {
      const externalId = trade['external_id'] as string | undefined
      const tenantId = trade['tenant_id'] as string

      if (externalId) {
        // Gap #15: call get_order to check the real broker status and
        // capture the fill price if available.
        const orderResult = await fetchOrderFromBroker(tenantId, externalId)
        if (orderResult) {
          const finalStatus = mapBrokerOrderStatus(orderResult.status, trade['side'] as string)
          await db.collection('pending_trades').updateOne(
            { _id: trade._id },
            {
              $set: {
                status: finalStatus,
                updated_at: new Date(),
                receipt: { ...((trade['receipt'] as Record<string, unknown>) ?? {}), status: finalStatus, reconciled: true },
                ...(orderResult.fillPrice !== undefined && { fill_price: orderResult.fillPrice }),
                ...(orderResult.filledQuantity !== undefined && { filled_quantity: orderResult.filledQuantity }),
              },
            },
          )
          reconciledExecuting++
          if (orderResult.fillPrice !== undefined) fillPricesCaptured++
        } else {
          // get_order failed — mark as ambiguous so a human can verify
          await db.collection('pending_trades').updateOne(
            { _id: trade._id },
            {
              $set: {
                status: 'rejected',
                updated_at: new Date(),
                receipt: { ...((trade['receipt'] as Record<string, unknown>) ?? {}), status: 'rejected', reason: 'Reconciliation failed: unable to fetch order status from broker', reconciled: true, ambiguous: true },
              },
            },
          )
          reconciledExecuting++
          // Raise an audit alert — same pattern as gap #19
          await getAuditLogger()?.logWithRetry({
            tenant_id: tenantId,
            user_id: 'system:reconciliation_sweep',
            action: 'trade.ambiguous_rejection',
            resource_type: 'pending_trade',
            resource_id: String(trade['trade_id']),
            metadata: {
              ticker: trade['ticker'],
              external_id: externalId,
              alert: 'RECONCILIATION_FAILED',
              message: `Reconciliation sweep could not verify order ${externalId} for ${trade['ticker']}. Manual broker account verification required.`,
            },
            ip: 'internal',
            user_agent: 'kairos-reconciliation-sweep',
            timestamp: new Date(),
          })
        }
      } else {
        // No external_id — the broker call likely never succeeded. Mark
        // as rejected so it drops out of the executing state.
        await db.collection('pending_trades').updateOne(
          { _id: trade._id },
          {
            $set: {
              status: 'rejected',
              updated_at: new Date(),
              receipt: { status: 'rejected', reason: 'Reconciliation: no external order id — broker call likely never succeeded', reconciled: true },
            },
          },
        )
        reconciledExecuting++
      }
    } catch (err) {
      log.error({ trade_id: trade['trade_id'], err }, 'Reconciliation sweep failed for stale executing trade')
    }
  }

  // --- Gap #15: Capture fill prices for recently executed trades ---
  // Even for trades that transitioned to `executed` normally, the fill
  // price was never captured. Poll get_order for trades that executed
  // recently (within the last 10 minutes) and don't yet have a fill_price.
  const fillCheckCutoff = new Date(now - 10 * 60 * 1000)
  const recentExecuted = await db.collection('pending_trades')
    .find({
      status: 'executed',
      external_id: { $exists: true, $ne: null },
      fill_price: { $exists: false },
      updated_at: { $gte: fillCheckCutoff },
    })
    .limit(20) // Cap per sweep to avoid hammering the broker API
    .toArray()
  for (const trade of recentExecuted) {
    try {
      const externalId = trade['external_id'] as string
      const tenantId = trade['tenant_id'] as string
      const orderResult = await fetchOrderFromBroker(tenantId, externalId)
      if (orderResult?.fillPrice !== undefined) {
        await db.collection('pending_trades').updateOne(
          { _id: trade._id },
          {
            $set: {
              fill_price: orderResult.fillPrice,
              ...(orderResult.filledQuantity !== undefined && { filled_quantity: orderResult.filledQuantity }),
              fill_captured_at: new Date(),
            },
          },
        )
        fillPricesCaptured++
      }
    } catch (err) {
      // Best-effort — don't fail the sweep for a single fill-price lookup
      log.debug({ trade_id: trade['trade_id'], err }, 'Fill price lookup failed for executed trade')
    }
  }

  if (expiredManual > 0 || reconciledExecuting > 0 || fillPricesCaptured > 0) {
    log.info({ expiredManual, reconciledExecuting, fillPricesCaptured }, 'Trade reconciliation sweep completed')
  }

  return { expiredManual, reconciledExecuting, fillPricesCaptured }
}

/**
 * Fetches an order's status and fill details from the broker via the
 * `get_order` connector action (gap #15 — this action was fully defined
 * but never invoked anywhere in the codebase).
 */
async function fetchOrderFromBroker(
  tenantId: string,
  externalOrderId: string,
): Promise<{ status: string; fillPrice?: number; filledQuantity?: number } | null> {
  const db = await getDb()

  try {
    const executor = new ConnectorActionExecutor(db)
    const result = await executor.execute(tenantId, 'trading-212', 'get_order', { id: externalOrderId })
    if (result.ok && result.body) {
      const data = result.body as {
        status?: string
        filledValue?: number
        filledQuantity?: number
        // Trading 212 order response fields (from the Order resource mapping)
        orderType?: string
        status_code?: string
      }
      // Map the broker's order status to our internal status
      const brokerStatus = String(data.status ?? data.status_code ?? 'unknown')
      // Extract fill price — Trading 212 returns filledValue (total value)
      // and filledQuantity, so per-share price = filledValue / filledQuantity.
      // The field mapping in trading-212.yaml notes that filledValue/
      // filledQuantity semantics aren't confirmed to always be per-share,
      // so we store both raw values and compute the per-share price only
      // if both are present and filledQuantity > 0.
      let fillPrice: number | undefined
      if (data.filledValue !== undefined && data.filledQuantity !== undefined && data.filledQuantity > 0) {
        // filledValue is in minor units (pence), filledQuantity is in shares.
        // Per-share price in minor units = filledValue / filledQuantity.
        // Round to nearest integer pence to avoid floating-point noise.
        fillPrice = Math.round(data.filledValue / data.filledQuantity)
      }
      return {
        status: brokerStatus,
        fillPrice,
        filledQuantity: data.filledQuantity !== undefined ? Number(data.filledQuantity) : undefined,
      }
    }
    return null
  } catch (err) {
    log.warn({ tenant_id: tenantId, externalOrderId, err }, 'get_order broker call failed during reconciliation')
    return null
  }
}

/**
 * Maps a Trading 212 broker order status to our internal trade status.
 *
 * Trading 212 order statuses (from API docs):
 * - "confirmed" / "filled" → executed
 * - "rejected" → rejected
 * - "cancelled" → cancelled
 * - "new" / "pending" → still executing (leave as-is for next sweep)
 * - anything else → rejected (conservative — better to flag than to assume)
 */
function mapBrokerOrderStatus(brokerStatus: string, _side: string): string {
  const normalized = brokerStatus.toLowerCase().trim()
  if (normalized.includes('confirm') || normalized.includes('fill')) return 'executed'
  if (normalized.includes('reject')) return 'rejected'
  if (normalized.includes('cancel')) return 'cancelled'
  if (normalized.includes('new') || normalized.includes('pending')) return 'executing'
  // Unknown status — conservative: mark as rejected so it drops out of
  // the stuck `executing` state. The audit alert from the caller will
  // prompt human verification.
  return 'rejected'
}
