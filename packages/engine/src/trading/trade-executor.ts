/**
 * Trade executor for the Trading & Investment vertical.
 *
 * This module is the policy layer that decides whether an approved trade may
 * be sent to a broker. It is deliberately conservative:
 *
 *   1. A global kill-switch (`LIFEKEEL_ALLOW_LIVE_TRADING`) must be enabled.
 *   2. The tenant must have explicitly opted in via the opt-in record.
 *   3. The tenant's Trading 212 credentials must be in live mode.
 *   4. The order must pass basic guardrails (max order value, etc.).
 *
 * When any guard fails, the trade is recorded as `logged`/`rejected` and no
 * real money is moved. When every guard passes, the caller-supplied
 * `executeBrokerTrade` callback is invoked to actually place the order.
 *
 * That callback is injected rather than called directly from here on
 * purpose: this package stays free of HTTP/DB dependencies (it's the MIT,
 * network-side-effect-free half of the trading stack — see the CI license
 * boundary check), so the real broker call — credential lookup, the
 * ConnectorActionExecutor HTTP request — lives in apps/api and is passed in
 * by the caller. This file can still be fully unit-tested by injecting a
 * fake.
 */

import type { PortfolioSnapshot, StrategyRecommendation } from './types.js'

export interface LiveTradingOptIn {
  enabled: boolean
  confirmedAt: Date
  method: 'email' | 'totp' | 'manual'
  maxOrderValueMinor?: number
  maxTradesPerDay?: number
}

export interface TradeIntent {
  id: string
  tenantId: string
  action: StrategyRecommendation['action']
  ticker?: string
  quantity: number
  price: number
  value: number
  side: 'buy' | 'sell'
  accountType?: 'isa' | 'invest' | 'cfd'
  /**
   * Order type for broker execution. 'market' (default) executes immediately
   * at the current market price. 'limit' places a limit order at the
   * specified limitPrice, saving ~5-10 bps on liquid stocks but with the
   * risk of non-execution if the price moves away.
   */
  orderType?: 'market' | 'limit'
  /** Limit price for limit orders (in minor currency units). Required when orderType = 'limit'. */
  limitPrice?: number
}

export type TradeStatus = 'pending' | 'cancelled' | 'executed' | 'logged' | 'rejected'

export interface TradeReceipt {
  tradeId: string
  tenantId: string
  status: TradeStatus
  reason: string
  executedAt?: Date
  externalId?: string
  externalPlatform?: string
  dryRun: boolean
  /**
   * True when a broker failure is ambiguous — the order may or may not have
   * been placed (5xx, timeout, network error). False for confirmed rejections
   * (4xx) and for successful executions. See TRADING_ENGINE_GAPS.md gap #18.
   * Downstream reconciliation (gap #13) uses this to decide whether to poll
   * get_order before allowing a retry.
   */
  ambiguous?: boolean
}

export interface TradeExecutionGuard {
  /** Global environment kill-switch. */
  allowLiveTrading: boolean
  /** Tenant opt-in record. */
  optIn: LiveTradingOptIn | null
  /** Whether the connected broker credentials are in live mode. */
  brokerLiveMode: boolean
  /** Guardrails from strategy config. */
  maxOrderValueMinor?: number
  /**
   * Number of trades already executed today (computed by the caller — this
   * package makes no DB calls, see module docstring). Compared against
   * `optIn.maxTradesPerDay`.
   */
  tradesExecutedToday?: number
}

/** Result of actually placing (or failing to place) an order with the broker. */
export type BrokerExecutionResult =
  | { ok: true; externalId: string; externalPlatform?: string }
  | { ok: false; error: string; ambiguous?: boolean }

/**
 * Places the real order. Injected by the caller so this package makes no
 * HTTP/DB calls itself — see the module docstring. Only invoked after every
 * guard in `evaluateTradeExecution` has passed.
 */
export type ExecuteBrokerTrade = (intent: TradeIntent) => Promise<BrokerExecutionResult>

export function buildTradeReceipt(
  intent: TradeIntent,
  status: TradeStatus,
  reason: string,
  dryRun = false,
): TradeReceipt {
  return {
    tradeId: intent.id,
    tenantId: intent.tenantId,
    status,
    reason,
    dryRun,
  }
}

/**
 * Evaluate whether a trade may execute under the current guard configuration,
 * and execute it if so.
 *
 * Every guard below must pass before `executeBrokerTrade` is ever called —
 * that ordering is the actual safety mechanism, not a formality:
 *   1. `allowLiveTrading` — a machine-level env flag, not a per-tenant DB row,
 *      so a compromised or buggy tenant setting alone can't enable trading.
 *   2. `optIn` — the tenant explicitly enabled live trading (separate from
 *      picking a risk tier).
 *   3. `brokerLiveMode` — the stored credential is explicitly marked live,
 *      not the demo/paper environment.
 *   4. Order value under the configured cap.
 *   5. Trades executed today under the configured daily limit.
 * If `executeBrokerTrade` is omitted (e.g. in tests, or a caller not yet
 * ready to wire the real broker call), a trade that clears every guard is
 * still only `logged`, never `executed` — omitting the callback is itself a
 * safe default.
 */
export async function evaluateTradeExecution(
  intent: TradeIntent,
  guard: TradeExecutionGuard,
  executeBrokerTrade?: ExecuteBrokerTrade,
): Promise<TradeReceipt> {
  if (!guard.allowLiveTrading) {
    return buildTradeReceipt(intent, 'logged', 'Global live-trading kill-switch is off. Trade logged only.', true)
  }

  if (!guard.optIn?.enabled) {
    return buildTradeReceipt(intent, 'logged', 'Tenant has not opted in to live trading. Trade logged only.', true)
  }

  if (!guard.brokerLiveMode) {
    return buildTradeReceipt(intent, 'logged', 'Broker credentials are not in live mode. Trade logged only.', true)
  }

  // Gap #10 (TRADING_ENGINE_GAPS.md): maxOrderValueMinor and maxTradesPerDay
  // are now required in LiveTradingOptInSchema with server-side defaults
  // (5000 minor / 1 trade per day). The guard-level override
  // (guard.maxOrderValueMinor) is still checked first for strategy-level
  // caps, but the optIn fallback is no longer Number.MAX_SAFE_INTEGER — if
  // the optIn exists and is enabled, both caps are guaranteed present.
  const maxOrder = guard.maxOrderValueMinor ?? guard.optIn?.maxOrderValueMinor
  if (maxOrder !== undefined && intent.value > maxOrder) {
    return buildTradeReceipt(
      intent,
      'rejected',
      `Order value ${intent.value} exceeds max allowed ${maxOrder}. Trade rejected.`,
    )
  }

  const maxTradesPerDay = guard.optIn?.maxTradesPerDay
  if (maxTradesPerDay !== undefined && (guard.tradesExecutedToday ?? 0) >= maxTradesPerDay) {
    return buildTradeReceipt(
      intent,
      'rejected',
      `Daily trade limit reached (${guard.tradesExecutedToday}/${maxTradesPerDay}). Trade rejected.`,
    )
  }

  if (!executeBrokerTrade) {
    return buildTradeReceipt(intent, 'logged', 'No broker execution handler configured. Trade logged only.', true)
  }

  let result: BrokerExecutionResult
  try {
    result = await executeBrokerTrade(intent)
  } catch (err) {
    return buildTradeReceipt(intent, 'rejected', `Broker call failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!result.ok) {
    const receipt = buildTradeReceipt(intent, 'rejected', `Broker rejected the order: ${result.error}`)
    // Gap #18: carry the ambiguous flag so downstream (trade-confirmation,
    // reconciliation sweep) can distinguish "definitely didn't place" (4xx)
    // from "unknown, might have placed" (5xx/timeout/network error).
    if (result.ambiguous) receipt.ambiguous = true
    return receipt
  }

  const receipt = buildTradeReceipt(intent, 'executed', 'Order placed with broker.', false)
  receipt.executedAt = new Date()
  receipt.externalId = result.externalId
  receipt.externalPlatform = result.externalPlatform ?? 'trading-212'
  return receipt
}

/**
 * Check whether a trade is still within its cancellation window.
 */
export function isWithinCancellationWindow(createdAt: Date, windowSeconds = 60): boolean {
  return Date.now() - createdAt.getTime() < windowSeconds * 1000
}
