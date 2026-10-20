/**
 * provider-gateway — the shared deadline/retry/breaker/idempotency policy
 * for calls that can create public or irreversible effects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { providerFetch, resetProviderBreakers, ProviderError } from '../provider-gateway.js'

function res(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const OPTS = { breakerKey: 'test:acct' }

beforeEach(() => {
  vi.restoreAllMocks()
  resetProviderBreakers()
})

describe('providerFetch', () => {
  it('returns ok responses without touching the breaker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res({ id: '1' })),
    )
    const out = await providerFetch('https://x.example/post', { method: 'POST' }, OPTS)
    expect(out.status).toBe(200)
  })

  it('retries 5xx with backoff and succeeds', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (calls++ < 1 ? res('oops', 500) : res({ id: 'ok' }))),
    )
    const out = await providerFetch('https://x.example/post', { method: 'POST' }, OPTS)
    expect(out.status).toBe(200)
    expect(calls).toBe(2)
  })

  it('never retries client 4xx — a rejected post is a decision, not a flake', async () => {
    const fetchMock = vi.fn(async () => res('forbidden', 403))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      providerFetch('https://x.example/post', { method: 'POST' }, OPTS),
    ).rejects.toMatchObject({ kind: 'client', retriable: false, status: 403 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a timeout without a honoured idempotency key is NOT retried — the write may have landed', async () => {
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((_, reject) =>
          setTimeout(() => {
            const e = new Error('aborted')
            e.name = 'TimeoutError'
            reject(e)
          }, 5),
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      providerFetch('https://x.example/post', { method: 'POST' }, OPTS),
    ).rejects.toMatchObject({ kind: 'timeout', retriable: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a timed-out call when timeoutRetriable (provider dedupes)', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve, reject) =>
            setTimeout(() => {
              if (calls++ === 0) {
                const e = new Error('aborted')
                e.name = 'TimeoutError'
                reject(e)
              } else {
                resolve(res({ id: 'deduped' }))
              }
            }, 5),
          ),
      ),
    )
    const out = await providerFetch(
      'https://x.example/post',
      { method: 'POST' },
      { ...OPTS, timeoutRetriable: true, idempotencyKey: 'post-1' },
    )
    expect(out.status).toBe(200)
    expect(calls).toBe(2)
  })

  it('forwards the idempotency key as the Idempotency-Key header', async () => {
    const fetchMock = vi.fn(async () => res({ id: '1' }))
    vi.stubGlobal('fetch', fetchMock)
    await providerFetch(
      'https://x.example/post',
      { method: 'POST' },
      { ...OPTS, idempotencyKey: 'post-42' },
    )
    const headers = fetchMock.mock.calls[0]![1]!.headers as Headers
    expect(headers.get('Idempotency-Key')).toBe('post-42')
  })

  it('opens the circuit after repeated provider failures and refuses fast', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res('down', 503)),
    )
    for (let i = 0; i < 5; i += 1) {
      await expect(
        providerFetch('https://x.example/post', { method: 'POST' }, OPTS),
      ).rejects.toBeInstanceOf(ProviderError)
    }
    // Circuit open — fail fast without touching the network.
    const fetchMock = vi.fn(async () => res({ id: '1' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      providerFetch('https://x.example/post', { method: 'POST' }, OPTS),
    ).rejects.toMatchObject({ kind: 'circuit_open' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a healthy neighbour is unaffected by an open circuit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res('down', 503)),
    )
    for (let i = 0; i < 5; i += 1) {
      await expect(
        providerFetch('https://x.example/post', { method: 'POST' }, OPTS),
      ).rejects.toBeInstanceOf(ProviderError)
    }
    const fetchMock = vi.fn(async () => res({ id: '1' }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await providerFetch(
      'https://y.example/post',
      { method: 'POST' },
      { breakerKey: 'test:other' },
    )
    expect(out.status).toBe(200)
  })
})
