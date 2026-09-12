/**
 * Unit tests for ConnectorActionExecutor's HTTP timeout enforcement.
 *
 * Coverage for gap #20 (TRADING_ENGINE_GAPS.md): no request timeout anywhere
 * in the fetch chain — a hung broker call leaves a trade claimed at
 * status: 'executing' for an unbounded time. The fix adds a 30s
 * AbortController deadline to every connector action's fetch call, including
 * the broker path (which creates its own executor in broker-execution.ts,
 * bypassing ConnectorSandbox's timeout).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ConnectorActionExecutor } from '../connectors/ConnectorActionExecutor.js'
import type { Db } from 'mongodb'

function makeDb(cred?: Record<string, unknown>): Db {
  return {
    collection: () => ({
      findOne: vi.fn(async () => cred ?? null),
    }),
  } as unknown as Db
}

const TRADING_212_CRED = {
  tenant_id: 'tenant-test',
  connector_id: 'trading-212',
  auth_type: 'basic' as const,
  username: 'test-user',
  password: 'test-pass',
  extra: { live_mode: 'false' },
  created_at: new Date(),
  updated_at: new Date(),
}

describe('ConnectorActionExecutor — gap #20 request timeout', () => {
  beforeEach(() => {
    delete process.env['KAIROS_DEPLOYMENT_MODE']
  })

  it('distinguishes a timeout (AbortError) from a generic network error in the error message', async () => {
    // A fetch that rejects with an AbortError (as the AbortController would
    // produce when the 30s deadline fires) should produce "timed out" in
    // the error message, not "Network error".
    const abortFetch = vi.fn(async () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      throw err
    })

    const executor = new ConnectorActionExecutor(makeDb(TRADING_212_CRED), abortFetch)
    const result = await executor.execute('tenant-test', 'trading-212', 'place_market_order', {
      ticker: 'AAPL_US_EQ',
      quantity: 5,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('timed out')
    expect(result.error).not.toContain('Network error')
    // Gap #18: timeout errors carry errorClass='timeout' so downstream can
    // mark the failure as ambiguous (the order may have been placed).
    expect(result.errorClass).toBe('timeout')
  })

  it('returns a generic network error (not timeout) for non-abort fetch failures', async () => {
    const networkFetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })

    const executor = new ConnectorActionExecutor(makeDb(TRADING_212_CRED), networkFetch)
    const result = await executor.execute('tenant-test', 'trading-212', 'place_market_order', {
      ticker: 'AAPL_US_EQ',
      quantity: 5,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Network error')
    expect(result.error).toContain('ECONNREFUSED')
    expect(result.error).not.toContain('timed out')
    // Gap #18: network errors carry errorClass='network_error'
    expect(result.errorClass).toBe('network_error')
  })

  it('classifies 4xx responses as errorClass=4xx (definitely rejected)', async () => {
    const rejectFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'insufficient_funds' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const executor = new ConnectorActionExecutor(makeDb(TRADING_212_CRED), rejectFetch)
    const result = await executor.execute('tenant-test', 'trading-212', 'place_market_order', {
      ticker: 'AAPL_US_EQ',
      quantity: 5,
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.errorClass).toBe('4xx')
  })

  it('classifies 5xx responses as errorClass=5xx (ambiguous — might have placed)', async () => {
    const serverErrorFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'internal_server_error' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const executor = new ConnectorActionExecutor(makeDb(TRADING_212_CRED), serverErrorFetch)
    const result = await executor.execute('tenant-test', 'trading-212', 'place_market_order', {
      ticker: 'AAPL_US_EQ',
      quantity: 5,
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(503)
    expect(result.errorClass).toBe('5xx')
  })

  it('still succeeds for a normal (fast) fetch — timeout does not interfere with healthy calls', async () => {
    const fastFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ id: 'order-123', status: 'filled' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const executor = new ConnectorActionExecutor(makeDb(TRADING_212_CRED), fastFetch)
    const result = await executor.execute('tenant-test', 'trading-212', 'place_market_order', {
      ticker: 'AAPL_US_EQ',
      quantity: 5,
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.state_updates['id']).toBe('order-123')
    // Gap #18: errorClass is undefined on success
    expect(result.errorClass).toBeUndefined()
  })

  it('gap #22: passes extraHeaders through to the fetch call', async () => {
    // The broker path sends X-Kairos-Trade-Id as a custom header for audit
    // trail. Trading 212 ignores it, but it must appear in the request.
    const capturedHeaders: Record<string, string> = {}
    const capturingFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const h = init?.headers as Record<string, string> | undefined
      if (h) Object.assign(capturedHeaders, h)
      return new Response(JSON.stringify({ id: 'order-456' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const executor = new ConnectorActionExecutor(makeDb(TRADING_212_CRED), capturingFetch)
    await executor.execute(
      'tenant-test',
      'trading-212',
      'place_market_order',
      { ticker: 'AAPL_US_EQ', quantity: 5 },
      { 'X-Kairos-Trade-Id': 'trade-abc-123' },
    )

    expect(capturedHeaders['X-Kairos-Trade-Id']).toBe('trade-abc-123')
  })

  it('uses live_base_url when extra.live_mode=true', async () => {
    const capturedUrls: string[] = []
    const capturingFetch = vi.fn(async (url: string) => {
      capturedUrls.push(url)
      return new Response(JSON.stringify({ id: 'live-order-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const liveCred = { ...TRADING_212_CRED, extra: { live_mode: 'true' } }
    const executor = new ConnectorActionExecutor(makeDb(liveCred), capturingFetch)
    await executor.execute('tenant-test', 'trading-212', 'place_market_order', {
      ticker: 'AAPL_US_EQ',
      quantity: 5,
    })

    expect(capturedUrls.length).toBe(1)
    expect(capturedUrls[0]).toBe('https://live.trading212.com/api/v0/equity/orders/market')
  })

  it('uses base_url when extra.live_mode=false', async () => {
    const capturedUrls: string[] = []
    const capturingFetch = vi.fn(async (url: string) => {
      capturedUrls.push(url)
      return new Response(JSON.stringify({ id: 'demo-order-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const executor = new ConnectorActionExecutor(makeDb(TRADING_212_CRED), capturingFetch)
    await executor.execute('tenant-test', 'trading-212', 'place_market_order', {
      ticker: 'AAPL_US_EQ',
      quantity: 5,
    })

    expect(capturedUrls.length).toBe(1)
    expect(capturedUrls[0]).toBe('https://demo.trading212.com/api/v0/equity/orders/market')
  })
})
