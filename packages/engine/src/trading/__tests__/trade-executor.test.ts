/**
 * Trade executor policy tests.
 */

import { describe, expect, it } from 'vitest'
import { evaluateTradeExecution, isWithinCancellationWindow, type TradeIntent, type TradeExecutionGuard, type ExecuteBrokerTrade } from '../trade-executor.js'

function makeIntent(value = 1_000_00): TradeIntent {
  return {
    id: 'trade-1',
    tenantId: 'tenant-1',
    action: 'buy',
    ticker: 'AAPL',
    quantity: 10,
    price: 100_00,
    value: value,
    side: 'buy',
  }
}

function makeGuard(patch: Partial<TradeExecutionGuard> = {}): TradeExecutionGuard {
  return {
    allowLiveTrading: true,
    optIn: { enabled: true, confirmedAt: new Date(), method: 'manual' },
    brokerLiveMode: true,
    ...patch,
  }
}

describe('evaluateTradeExecution', () => {
  it('logs when global kill-switch is off', async () => {
    const receipt = await evaluateTradeExecution(makeIntent(), makeGuard({ allowLiveTrading: false }))
    expect(receipt.status).toBe('logged')
    expect(receipt.reason).toContain('kill-switch')
  })

  it('logs when tenant has not opted in', async () => {
    const receipt = await evaluateTradeExecution(makeIntent(), makeGuard({ optIn: null }))
    expect(receipt.status).toBe('logged')
    expect(receipt.reason).toContain('not opted in')
  })

  it('logs when broker is not in live mode', async () => {
    const receipt = await evaluateTradeExecution(makeIntent(), makeGuard({ brokerLiveMode: false }))
    expect(receipt.status).toBe('logged')
    expect(receipt.reason).toContain('not in live mode')
  })

  it('rejects when order exceeds max value', async () => {
    const receipt = await evaluateTradeExecution(makeIntent(10_000_00), makeGuard({ maxOrderValueMinor: 5_000_00 }))
    expect(receipt.status).toBe('rejected')
    expect(receipt.reason).toContain('exceeds')
  })

  it('logs when all guards pass but no broker execution handler is supplied', async () => {
    const receipt = await evaluateTradeExecution(makeIntent(), makeGuard())
    expect(receipt.status).toBe('logged')
    expect(receipt.dryRun).toBe(true)
    expect(receipt.reason).toContain('No broker execution handler')
  })

  it('executes and returns the broker externalId when every guard passes and the broker call succeeds', async () => {
    const execute: ExecuteBrokerTrade = async () => ({ ok: true, externalId: 'order-123' })
    const receipt = await evaluateTradeExecution(makeIntent(), makeGuard(), execute)
    expect(receipt.status).toBe('executed')
    expect(receipt.dryRun).toBe(false)
    expect(receipt.externalId).toBe('order-123')
    expect(receipt.externalPlatform).toBe('trading-212')
    expect(receipt.executedAt).toBeInstanceOf(Date)
  })

  it('rejects when the broker call reports failure', async () => {
    const execute: ExecuteBrokerTrade = async () => ({ ok: false, error: 'insufficient funds' })
    const receipt = await evaluateTradeExecution(makeIntent(), makeGuard(), execute)
    expect(receipt.status).toBe('rejected')
    expect(receipt.reason).toContain('insufficient funds')
  })

  it('rejects when the broker call throws', async () => {
    const execute: ExecuteBrokerTrade = async () => { throw new Error('network timeout') }
    const receipt = await evaluateTradeExecution(makeIntent(), makeGuard(), execute)
    expect(receipt.status).toBe('rejected')
    expect(receipt.reason).toContain('network timeout')
  })

  it('never calls the broker when a guard fails', async () => {
    let called = false
    const execute: ExecuteBrokerTrade = async () => { called = true; return { ok: true, externalId: 'x' } }
    await evaluateTradeExecution(makeIntent(), makeGuard({ allowLiveTrading: false }), execute)
    expect(called).toBe(false)
  })

  it('rejects when the daily trade limit has already been reached', async () => {
    const execute: ExecuteBrokerTrade = async () => ({ ok: true, externalId: 'order-123' })
    const receipt = await evaluateTradeExecution(
      makeIntent(),
      makeGuard({ optIn: { enabled: true, confirmedAt: new Date(), method: 'manual', maxTradesPerDay: 1 }, tradesExecutedToday: 1 }),
      execute,
    )
    expect(receipt.status).toBe('rejected')
    expect(receipt.reason).toContain('Daily trade limit')
  })

  it('executes when trades executed today is under the daily limit', async () => {
    const execute: ExecuteBrokerTrade = async () => ({ ok: true, externalId: 'order-123' })
    const receipt = await evaluateTradeExecution(
      makeIntent(),
      makeGuard({ optIn: { enabled: true, confirmedAt: new Date(), method: 'manual', maxTradesPerDay: 3 }, tradesExecutedToday: 2 }),
      execute,
    )
    expect(receipt.status).toBe('executed')
  })

  it('never calls the broker when the daily trade limit is reached', async () => {
    let called = false
    const execute: ExecuteBrokerTrade = async () => { called = true; return { ok: true, externalId: 'x' } }
    await evaluateTradeExecution(
      makeIntent(),
      makeGuard({ optIn: { enabled: true, confirmedAt: new Date(), method: 'manual', maxTradesPerDay: 1 }, tradesExecutedToday: 1 }),
      execute,
    )
    expect(called).toBe(false)
  })

  it('does not enforce a daily limit when maxTradesPerDay is unset', async () => {
    const execute: ExecuteBrokerTrade = async () => ({ ok: true, externalId: 'order-123' })
    const receipt = await evaluateTradeExecution(
      makeIntent(),
      makeGuard({ tradesExecutedToday: 1000 }),
      execute,
    )
    expect(receipt.status).toBe('executed')
  })

  it('gap #18: carries ambiguous=true on the receipt when the broker failure is ambiguous', async () => {
    // 5xx/timeout/network errors are ambiguous — the order may have been
    // placed. The receipt should carry ambiguous=true so downstream
    // reconciliation (gap #13) knows to poll get_order before retrying.
    const execute: ExecuteBrokerTrade = async () => ({ ok: false, error: 'Server error', ambiguous: true })
    const receipt = await evaluateTradeExecution(makeIntent(), makeGuard(), execute)
    expect(receipt.status).toBe('rejected')
    expect(receipt.ambiguous).toBe(true)
  })

  it('gap #18: does not set ambiguous when the broker failure is a confirmed rejection (4xx)', async () => {
    // 4xx errors are definite rejections — the order was not placed.
    const execute: ExecuteBrokerTrade = async () => ({ ok: false, error: 'Insufficient funds' })
    const receipt = await evaluateTradeExecution(makeIntent(), makeGuard(), execute)
    expect(receipt.status).toBe('rejected')
    expect(receipt.ambiguous).toBeUndefined()
  })
})

describe('isWithinCancellationWindow', () => {
  it('returns true within the window', () => {
    expect(isWithinCancellationWindow(new Date(Date.now() - 30_000))).toBe(true)
  })

  it('returns false after the window', () => {
    expect(isWithinCancellationWindow(new Date(Date.now() - 120_000))).toBe(false)
  })
})
