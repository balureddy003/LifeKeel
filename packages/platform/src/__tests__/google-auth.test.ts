import { describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import { googleAccessTokenProvider, parseServiceAccount } from '../google-auth.js'

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const KEY = JSON.stringify({
  client_email: 'reader@proj.iam.gserviceaccount.com',
  private_key: privateKey,
})

function tokenFetch(expiresIn = 3600) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    void init
    return new Response(
      JSON.stringify({ access_token: 'tok-' + Math.random(), expires_in: expiresIn }),
      {
        status: 200,
      },
    )
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

function claimsOf(call: unknown[]): { scope: string; iss: string; aud: string } {
  const body = (call[1] as RequestInit).body as URLSearchParams
  const jwt = body.get('assertion')!
  return JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString())
}

describe('googleAccessTokenProvider', () => {
  it('returns null without a usable key, so callers can report "not configured"', () => {
    expect(googleAccessTokenProvider({ credentialsJson: undefined, scope: 's' })).toBeNull()
    expect(googleAccessTokenProvider({ credentialsJson: '{"nope":1}', scope: 's' })).toBeNull()
    expect(googleAccessTokenProvider({ credentialsJson: 'not json', scope: 's' })).toBeNull()
    expect(parseServiceAccount(KEY)?.client_email).toBe('reader@proj.iam.gserviceaccount.com')
  })

  it('mints a token for exactly the scope asked for, as that service account', async () => {
    const f = tokenFetch()
    const get = googleAccessTokenProvider({
      credentialsJson: KEY,
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      fetchImpl: f,
    })!
    await get()
    const claims = claimsOf((f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!)
    expect(claims.scope).toBe('https://www.googleapis.com/auth/webmasters.readonly')
    expect(claims.iss).toBe('reader@proj.iam.gserviceaccount.com')
    expect(claims.aud).toBe('https://oauth2.googleapis.com/token')
  })

  it('caches until shortly before expiry, then refreshes, and shares one in-flight request', async () => {
    const f = tokenFetch(3600)
    let now = 1_000_000
    const get = googleAccessTokenProvider({
      credentialsJson: KEY,
      scope: 's',
      fetchImpl: f,
      now: () => now,
    })!
    const [a, b] = await Promise.all([get(), get()])
    expect(a).toBe(b)
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)
    await get()
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1)
    now += 3600_000 - 60_000 // inside the 5 minute refresh margin
    await get()
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2)
  })

  it('throws on a failed exchange and names the caller without leaking the key', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 400 })) as unknown as typeof fetch
    const get = googleAccessTokenProvider({
      credentialsJson: KEY,
      scope: 's',
      fetchImpl: f,
      label: 'Search Console',
    })!
    await expect(get()).rejects.toThrow('Search Console token exchange failed: HTTP 400')
    await expect(get()).rejects.not.toThrow(/PRIVATE KEY/)
  })
})
