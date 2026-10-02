import { describe, expect, it, vi } from 'vitest'
import { audienceFor, cloudRunIdTokenProvider } from '../cloud-run-auth.js'

const jwt = (expSeconds: number) =>
  `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url')}.sig`

describe('cloudRunIdTokenProvider', () => {
  it('uses the service origin as the audience, whatever path the base URL has', () => {
    expect(audienceFor('https://judge-abc-uc.a.run.app/')).toBe('https://judge-abc-uc.a.run.app')
    expect(audienceFor('https://judge-abc-uc.a.run.app/v1/x')).toBe('https://judge-abc-uc.a.run.app')
  })

  it('asks the metadata server for a token for that audience and sends it as a bearer', async () => {
    const fetchImpl = vi.fn(async () => new Response(jwt(2_000_000_000)))
    const headers = await cloudRunIdTokenProvider('https://judge.run.app/', { fetchImpl, now: () => 1_000_000_000_000 })()
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('metadata.google.internal')
    expect(url).toContain('audience=https%3A%2F%2Fjudge.run.app')
    expect((init.headers as Record<string, string>)['Metadata-Flavor']).toBe('Google')
    expect(headers['Authorization']).toBe(`Bearer ${jwt(2_000_000_000)}`)
  })

  it('reuses the cached token until 5 minutes before expiry, then refreshes', async () => {
    let t = 1_000_000_000_000
    const exp = t / 1000 + 3600 // expires in an hour
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(jwt(exp)))
      .mockResolvedValueOnce(new Response(jwt(exp + 3600)))
    const get = cloudRunIdTokenProvider('https://judge.run.app', { fetchImpl, now: () => t })

    await get(); await get()
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    t += 54 * 60_000 // 6 minutes left: still inside the margin's far side
    await get()
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    t += 2 * 60_000 // 4 minutes left: inside the 5-minute margin
    const refreshed = await get()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(refreshed['Authorization']).toBe(`Bearer ${jwt(exp + 3600)}`)
  })

  it('shares one metadata request between concurrent callers', async () => {
    const fetchImpl = vi.fn(async () => { await new Promise(r => setTimeout(r, 20)); return new Response(jwt(2_000_000_000)) })
    const get = cloudRunIdTokenProvider('https://judge.run.app', { fetchImpl, now: () => 1_000_000_000_000 })
    await Promise.all([get(), get(), get()])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('throws, and does not cache the failure, when the metadata server fails', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(new Response(jwt(2_000_000_000)))
    const get = cloudRunIdTokenProvider('https://judge.run.app', { fetchImpl, now: () => 1_000_000_000_000 })
    await expect(get()).rejects.toThrow(/HTTP 500/)
    await expect(get()).resolves.toHaveProperty('Authorization')
  })

  it('rejects an empty token rather than sending a blank bearer', async () => {
    const get = cloudRunIdTokenProvider('https://judge.run.app', { fetchImpl: vi.fn(async () => new Response('  ')) })
    await expect(get()).rejects.toThrow(/empty token/)
  })

  it('falls back to a 30-minute cache when the token has no readable expiry', async () => {
    let t = 1_000_000_000_000
    const fetchImpl = vi.fn(async () => new Response('opaque-token'))
    const get = cloudRunIdTokenProvider('https://judge.run.app', { fetchImpl, now: () => t })
    await get(); t += 20 * 60_000; await get()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    t += 10 * 60_000; await get()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
