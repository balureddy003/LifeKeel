/**
 * Unit tests for ConnectorActionExecutor's HTTP timeout enforcement and
 * error classification.
 *
 * Every connector action's fetch call is bounded by a 30s AbortController
 * deadline so a hung connector call can't block a caller for an unbounded
 * time. The registry is mocked with a single canned connector so these
 * tests exercise executor behavior independently of the registry contents.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Db } from 'mongodb'

vi.mock('../connectors/ConnectorRegistry.js', () => ({
  connectorRegistry: {
    get: vi.fn((id: string) =>
      id === 'test-connector'
        ? {
            id: 'test-connector',
            name: 'Test Connector',
            category: 'internal',
            description: 'Fixture for executor tests',
            icon: '',
            color: '#000000',
            auth: 'basic',
            base_url: 'https://demo.example.com/api',
            live_base_url: 'https://live.example.com/api',
            actions: [
              {
                id: 'do_thing',
                label: 'Do thing',
                description: 'Fixture POST action',
                method: 'POST',
                path: '/things',
                params: [],
                output_schema: { id: 'thing id' },
              },
            ],
            triggers: [],
            tags: [],
          }
        : undefined),
  },
}))

import { ConnectorActionExecutor } from '../connectors/ConnectorActionExecutor.js'

function makeDb(cred?: Record<string, unknown>): Db {
  return {
    collection: () => ({
      findOne: vi.fn(async () => cred ?? null),
    }),
  } as unknown as Db
}

const TEST_CRED = {
  tenant_id: 'tenant-test',
  connector_id: 'test-connector',
  auth_type: 'basic' as const,
  username: 'test-user',
  password: 'test-pass',
  extra: { live_mode: 'false' },
  created_at: new Date(),
  updated_at: new Date(),
}

describe('ConnectorActionExecutor — request timeout', () => {
  beforeEach(() => {
    delete process.env['LIFEKEEL_DEPLOYMENT_MODE']
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

    const executor = new ConnectorActionExecutor(makeDb(TEST_CRED), abortFetch)
    const result = await executor.execute('tenant-test', 'test-connector', 'do_thing', {})

    expect(result.ok).toBe(false)
    expect(result.error).toContain('timed out')
    expect(result.error).not.toContain('Network error')
    // Timeout errors carry errorClass='timeout' so downstream can mark the
    // failure as ambiguous (the request may have completed server-side).
    expect(result.errorClass).toBe('timeout')
  })

  it('returns a generic network error (not timeout) for non-abort fetch failures', async () => {
    const networkFetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })

    const executor = new ConnectorActionExecutor(makeDb(TEST_CRED), networkFetch)
    const result = await executor.execute('tenant-test', 'test-connector', 'do_thing', {})

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Network error')
    expect(result.error).toContain('ECONNREFUSED')
    expect(result.error).not.toContain('timed out')
    // Network errors carry errorClass='network_error'
    expect(result.errorClass).toBe('network_error')
  })

  it('classifies 4xx responses as errorClass=4xx (definitely rejected)', async () => {
    const rejectFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'insufficient_funds' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const executor = new ConnectorActionExecutor(makeDb(TEST_CRED), rejectFetch)
    const result = await executor.execute('tenant-test', 'test-connector', 'do_thing', {})

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.errorClass).toBe('4xx')
  })

  it('classifies 5xx responses as errorClass=5xx (ambiguous — might have completed)', async () => {
    const serverErrorFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'internal_server_error' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const executor = new ConnectorActionExecutor(makeDb(TEST_CRED), serverErrorFetch)
    const result = await executor.execute('tenant-test', 'test-connector', 'do_thing', {})

    expect(result.ok).toBe(false)
    expect(result.status).toBe(503)
    expect(result.errorClass).toBe('5xx')
  })

  it('still succeeds for a normal (fast) fetch — timeout does not interfere with healthy calls', async () => {
    const fastFetch = vi.fn(async () => {
      return new Response(JSON.stringify({ id: 'thing-123', status: 'done' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const executor = new ConnectorActionExecutor(makeDb(TEST_CRED), fastFetch)
    const result = await executor.execute('tenant-test', 'test-connector', 'do_thing', {})

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.state_updates['id']).toBe('thing-123')
    // errorClass is undefined on success
    expect(result.errorClass).toBeUndefined()
  })

  it('passes extraHeaders through to the fetch call', async () => {
    // Callers can send custom headers (e.g. an idempotency key for audit
    // trail); they must appear in the request.
    const capturedHeaders: Record<string, string> = {}
    const capturingFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const h = init?.headers as Record<string, string> | undefined
      if (h) Object.assign(capturedHeaders, h)
      return new Response(JSON.stringify({ id: 'thing-456' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const executor = new ConnectorActionExecutor(makeDb(TEST_CRED), capturingFetch)
    await executor.execute(
      'tenant-test',
      'test-connector',
      'do_thing',
      {},
      { 'X-LifeKeel-Request-Id': 'req-abc-123' },
    )

    expect(capturedHeaders['X-LifeKeel-Request-Id']).toBe('req-abc-123')
  })

  it('uses live_base_url when extra.live_mode=true', async () => {
    const capturedUrls: string[] = []
    const capturingFetch = vi.fn(async (url: string) => {
      capturedUrls.push(url)
      return new Response(JSON.stringify({ id: 'live-thing-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const liveCred = { ...TEST_CRED, extra: { live_mode: 'true' } }
    const executor = new ConnectorActionExecutor(makeDb(liveCred), capturingFetch)
    await executor.execute('tenant-test', 'test-connector', 'do_thing', {})

    expect(capturedUrls.length).toBe(1)
    expect(capturedUrls[0]).toBe('https://live.example.com/api/things')
  })

  it('uses base_url when extra.live_mode=false', async () => {
    const capturedUrls: string[] = []
    const capturingFetch = vi.fn(async (url: string) => {
      capturedUrls.push(url)
      return new Response(JSON.stringify({ id: 'demo-thing-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const executor = new ConnectorActionExecutor(makeDb(TEST_CRED), capturingFetch)
    await executor.execute('tenant-test', 'test-connector', 'do_thing', {})

    expect(capturedUrls.length).toBe(1)
    expect(capturedUrls[0]).toBe('https://demo.example.com/api/things')
  })
})
