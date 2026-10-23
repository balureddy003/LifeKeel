/**
 * Session-cookie helpers — the Origin allowlist is the CSRF boundary that
 * makes SameSite=None;Secure safe, so it's the part worth pinning down:
 * credentialed mutations from an unknown browser origin must be refused.
 */
import { describe, expect, it } from 'vitest'
import type { FastifyRequest } from 'fastify'
import {
  isOriginAllowedForCookieAuth,
  readSessionCookie,
  SESSION_COOKIE,
} from '../session-cookie.js'

function fakeRequest(
  method: string,
  origin?: string,
  cookies: Record<string, string> = {},
): FastifyRequest {
  return { method, headers: origin ? { origin } : {}, cookies } as unknown as FastifyRequest
}

describe('isOriginAllowedForCookieAuth', () => {
  it('always allows safe methods', () => {
    expect(isOriginAllowedForCookieAuth(fakeRequest('GET', 'https://evil.example'))).toBe(true)
    expect(isOriginAllowedForCookieAuth(fakeRequest('HEAD', 'https://evil.example'))).toBe(true)
  })

  it('fails closed on a missing Origin (non-browser clients use Bearer, not cookies)', () => {
    expect(isOriginAllowedForCookieAuth(fakeRequest('POST'))).toBe(false)
  })

  it('allows a known app origin', () => {
    expect(isOriginAllowedForCookieAuth(fakeRequest('POST', 'http://localhost:3002'))).toBe(true)
  })

  it('rejects an unknown origin on a mutation', () => {
    expect(isOriginAllowedForCookieAuth(fakeRequest('POST', 'https://evil.example'))).toBe(false)
    expect(isOriginAllowedForCookieAuth(fakeRequest('DELETE', 'https://evil.example'))).toBe(false)
  })

  it('ignores a trailing slash on the incoming origin', () => {
    expect(isOriginAllowedForCookieAuth(fakeRequest('POST', 'http://localhost:3002/'))).toBe(true)
  })
})

describe('readSessionCookie', () => {
  it('returns the cookie value when present', () => {
    expect(readSessionCookie(fakeRequest('GET', undefined, { [SESSION_COOKIE]: 'tok123' }))).toBe(
      'tok123',
    )
  })

  it('returns null when absent or empty', () => {
    expect(readSessionCookie(fakeRequest('GET'))).toBeNull()
    expect(readSessionCookie(fakeRequest('GET', undefined, { [SESSION_COOKIE]: '' }))).toBeNull()
  })
})
