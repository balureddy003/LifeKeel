/**
 * Real broker execution for the Trading & Investment vertical.
 *
 * Bridges packages/engine's pure `evaluateTradeExecution()` (the policy
 * layer — kill-switch, opt-in, live-mode, and order-value guards, no HTTP or
 * DB access) to a real Trading 212 order, via the same ConnectorActionExecutor
 * every other write-capable connector (Slack, LinkedIn, ...) already uses.
 * This function is only ever invoked by `evaluateTradeExecution` after every
 * guard has passed — see packages/engine/src/trading/trade-executor.ts.
 */

import type { Db } from 'mongodb'
import { ConnectorActionExecutor } from '@kairos/workflows'
import { createLogger } from '@kairos/platform'
import type { ExecuteBrokerTrade, TradeIntent, BrokerExecutionResult } from '@kairos/engine'

const log = createLogger({ service: 'broker-execution', version: process.env['npm_package_version'] ?? '0.0.0' })

// ── Per-instrument quantity precision cache ─────────────────────────────────
//
// Trading 212 enforces a per-instrument `quantityPrecision` (exposed via
// /equity/metadata/instruments). Sending more decimals than allowed returns
// HTTP 400 with "invalid quantity precision N" and the order is rejected.
// Most US stocks accept 4 decimal places, but some accept fewer (e.g. INTC
// accepts 3). Hardcoding 4 places caused rejections for those instruments.
//
// The instruments endpoint is rate-limited to 1 req/50s, so we fetch the
// entire instruments list once and cache it for INSTRUMENT_CACHE_TTL_MS. The
// list is ~10k entries but only the ticker→precision mapping is retained.
const INSTRUMENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours
const DEFAULT_QUANTITY_PRECISION = 4 // fallback when lookup fails or cache miss

interface PrecisionCacheEntry {
  precisionByTicker: Map<string, number>
  fetchedAt: number
}

let precisionCache: PrecisionCacheEntry | null = null

/**
 * Fetch the full instrument list from Trading 212 and build a ticker →
 * quantityPrecision map. Cached for INSTRUMENT_CACHE_TTL_MS to respect the
 * 1 req/50s rate limit on the instruments endpoint.
 */
async function loadPrecisionMap(
  executor: ConnectorActionExecutor,
  tenantId: string,
): Promise<Map<string, number>> {
  const now = Date.now()
  if (precisionCache && now - precisionCache.fetchedAt < INSTRUMENT_CACHE_TTL_MS) {
    return precisionCache.precisionByTicker
  }

  const map = new Map<string, number>()
  try {
    // The instruments endpoint isn't a registered connector action (it's a
    // sync resource, not a write action), so we use the executor's generic
    // GET path via a synthetic action. The ConnectorActionExecutor's
    // buildUrl + auth handling works for any registered action; we register
    // a 'get_instruments' action below in the registry for this purpose.
    const result = await executor.execute(tenantId, 'trading-212', 'get_instruments', {})
    if (result.ok && Array.isArray(result.body)) {
      for (const instr of result.body as Record<string, unknown>[]) {
        const ticker = typeof instr['ticker'] === 'string' ? instr['ticker'] as string : undefined
        const precision = typeof instr['quantityPrecision'] === 'number' ? instr['quantityPrecision'] as number : undefined
        if (ticker && precision !== undefined && precision >= 0 && precision <= 8) {
          map.set(ticker, precision)
        }
      }
      log.info({ tenant_id: tenantId, instruments: map.size }, 'Loaded Trading 212 instrument precision map')
    } else {
      log.warn({ tenant_id: tenantId, ok: result.ok, status: result.status }, 'Failed to load instrument precision map — falling back to default precision')
    }
  } catch (err) {
    log.warn({ tenant_id: tenantId, err }, 'Instrument precision map fetch threw — falling back to default precision')
  }

  precisionCache = { precisionByTicker: map, fetchedAt: now }
  return map
}

/**
 * Round a quantity to the per-instrument precision. Falls back to
 * DEFAULT_QUANTITY_PRECISION (4) when the ticker isn't in the cache — this
 * is the max any Trade212 instrument accepts, so it's safe for instruments
 * we haven't looked up yet.
 */
function roundToPrecision(qty: number, precision: number): number {
  const factor = Math.pow(10, precision)
  return Math.round(qty * factor) / factor
}

export function createExecuteBrokerTrade(db: Db): ExecuteBrokerTrade {
  const executor = new ConnectorActionExecutor(db)

  return async (intent: TradeIntent): Promise<BrokerExecutionResult> => {
    if (!intent.ticker) {
      return { ok: false, error: 'Trade intent is missing a ticker; cannot place an order.' }
    }

    // Trading 212 encodes order side via a signed quantity: positive = buy,
    // negative = sell. Deriving the sign from `intent.side` here (rather than
    // trusting a pre-signed quantity from the caller) means a caller that
    // always sends a positive quantity still sells correctly.
    //
    // Fractional shares: round to the per-instrument `quantityPrecision`
    // fetched from /equity/metadata/instruments. Falls back to 4 decimal
    // places (the max any Trade212 instrument accepts) when the ticker isn't
    // in the cache — safe for instruments we haven't looked up yet.
    const precisionMap = await loadPrecisionMap(executor, intent.tenantId)
    const precision = precisionMap.get(intent.ticker) ?? DEFAULT_QUANTITY_PRECISION
    const rawQty = Math.abs(intent.quantity)
    const roundedQty = roundToPrecision(rawQty, precision)
    const signedQuantity = intent.side === 'sell' ? -roundedQty : roundedQty

    // Extract order ID from broker response — accepts both string and number
    // (Trading 212 returns order IDs as numbers, e.g. 55203751789).
    const extractId = (v: unknown): string | undefined => {
      if (typeof v === 'string' && v.length > 0) return v
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return String(v)
      return undefined
    }

    // Phase 2: Use limit orders when specified to save ~5-10 bps per trade.
    // Limit orders sit on the book at a slightly better price than market,
    // capturing the spread instead of crossing it. Falls back to market
    // order if no limitPrice is provided or the order type is 'market'.
    const useLimitOrder = intent.orderType === 'limit' && intent.limitPrice !== undefined && intent.limitPrice > 0
    const actionId = useLimitOrder ? 'place_limit_order' : 'place_market_order'
    const orderParams: Record<string, unknown> = {
      ticker: intent.ticker,
      quantity: signedQuantity,
    }
    if (useLimitOrder) {
      orderParams['limitPrice'] = intent.limitPrice
      orderParams['timeValidity'] = 'DAY' // cancel if not filled by close
    }

    // Gap #22 (TRADING_ENGINE_GAPS.md): Trading 212's API explicitly does NOT
    // support a server-side idempotency key — the docs state "In this beta
    // version, this endpoint is not idempotent. Sending the same request
    // multiple times may result in duplicate orders."
    //
    // We still send the trade_id as a custom X-Kairos-Trade-Id header for
    // audit trail purposes. Trading 212 ignores it, but it appears in our
    // own request logs and in any future broker-side investigation. The
    // actual duplicate prevention is client-side:
    //   - Gap #21's ticker-level dedup blocks same-day duplicates
    //   - Gap #19's ambiguous rejection alert tells the human to verify
    //     before retrying
    //   - The atomic status claim in confirmPendingTrade prevents
    //     double-execution of the same trade_id
    const result = await executor.execute(
      intent.tenantId,
      'trading-212',
      actionId,
      orderParams,
      { 'X-Kairos-Trade-Id': intent.id },
    )

    if (!result.ok) {
      // Retry on "invalid quantity precision" with progressively fewer
      // decimal places. Trading 212's instruments endpoint is rate-limited
      // (1 req/50s) and sometimes unavailable, so the precision cache may
      // be empty or stale. When the broker explicitly tells us the precision
      // is wrong, retry with precision-1 until it accepts or we hit 0
      // (whole shares only). This fixes the INTC rejection (cache miss →
      // fallback to 4 decimals, but INTC only accepts 3).
      const errMsg = result.error ?? ''
      if (/invalid quantity precision/i.test(errMsg) && precision > 0) {
        log.warn(
          { tenant_id: intent.tenantId, ticker: intent.ticker, failed_precision: precision, error: errMsg },
          'Broker rejected quantity precision — retrying with lower precision',
        )
        // Retry with progressively lower precision (3 → 2 → 1 → 0)
        for (let retryPrecision = precision - 1; retryPrecision >= 0; retryPrecision--) {
          const retryQty = roundToPrecision(rawQty, retryPrecision)
          const retrySigned = intent.side === 'sell' ? -retryQty : retryQty
          const retryParams = { ...orderParams, quantity: retrySigned }
          const retryResult = await executor.execute(
            intent.tenantId,
            'trading-212',
            actionId,
            retryParams,
            { 'X-Kairos-Trade-Id': intent.id },
          )
          if (retryResult.ok) {
            const retryBody = retryResult.body as Record<string, unknown> | null
            const retryId = extractId(retryResult.state_updates?.['id']) ?? extractId(retryBody?.['id'])
            if (retryId) {
              // Update the precision cache so future trades for this ticker
              // use the correct precision without retrying.
              precisionMap.set(intent.ticker, retryPrecision)
              log.info(
                { tenant_id: intent.tenantId, ticker: intent.ticker, accepted_precision: retryPrecision, order_id: retryId },
                'Broker accepted order on precision retry',
              )
              return { ok: true, externalId: retryId, externalPlatform: 'trading-212' }
            }
          }
          // If retry also fails with precision error, continue to lower precision
          const retryErr = retryResult.error ?? ''
          if (!/invalid quantity precision/i.test(retryErr)) {
            // Different error — don't keep retrying, return this error
            const retryAmbiguous = retryResult.errorClass === '5xx' || retryResult.errorClass === 'timeout' || retryResult.errorClass === 'network_error'
            return { ok: false, error: retryErr ?? `Broker returned HTTP ${retryResult.status}`, ambiguous: retryAmbiguous }
          }
        }
      }

      // Gap #18 (TRADING_ENGINE_GAPS.md): distinguish "definitely rejected"
      // (4xx — bad request, insufficient funds, market closed) from
      // "ambiguous, might have placed" (5xx, timeout, network error). The
      // ambiguous flag threads through evaluateTradeExecution → TradeReceipt
      // → trade-confirmation, so the reconciliation sweep (gap #13) knows
      // to poll get_order before allowing a retry.
      const ambiguous = result.errorClass === '5xx' || result.errorClass === 'timeout' || result.errorClass === 'network_error'
      return { ok: false, error: result.error ?? `Broker returned HTTP ${result.status}`, ambiguous }
    }

    const body = result.body as Record<string, unknown> | null
    // Trading 212 returns the order id as a NUMBER (e.g. 55203751789), not a
    // string. The previous check only accepted string ids, so every successful
    // order was misclassified as "no order id" and recorded as a rejected
    // ambiguous trade — while the broker actually held a live NEW order. Accept
    // both string and number, and coerce to string for storage/reconciliation.
    const externalId = extractId(result.state_updates?.['id']) ?? extractId(body?.['id'])

    // If the broker responded 2xx but we can't find an order id, treat it as
    // a failure rather than reporting a false "executed" — a missing id on a
    // financial record is worse than an overly-cautious rejection.
    // This is ambiguous: the broker accepted the request (2xx) so the order
    // may have been placed; we just can't find the id to reconcile. See
    // gap #19 for the alert path that handles this specific case.
    if (!externalId) {
      // Log the full broker response so we can see why no order id was found —
      // Trading 212 may return a different shape (e.g. errors inside a 2xx, or
      // a top-level array instead of an object), or the order may have been
      // rejected with a 2xx status (some beta endpoints do this).
      log.warn(
        {
          tenant_id: intent.tenantId,
          ticker: intent.ticker,
          status: result.status,
          state_updates: result.state_updates,
          body: body ? JSON.stringify(body).slice(0, 2000) : null,
        },
        'Broker returned 2xx but no order id found in response',
      )
      return { ok: false, error: 'Broker accepted the order but returned no order id; treating as failed for safety.', ambiguous: true }
    }

    return { ok: true, externalId, externalPlatform: 'trading-212' }
  }
}
