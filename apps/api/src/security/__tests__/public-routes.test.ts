/**
 * Public surface tripwire (API9). Changing the open-route list means
 * changing this snapshot in the same diff, so a reviewer sees every new
 * unauthenticated prefix and its protection group.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { openPrefixes, publicRoutes } from '../public-routes.js'
import { isOriginAllowedForCookieAuth } from '../../auth/session-cookie.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverSrc = readFileSync(path.resolve(here, '../../server.ts'), 'utf8')

describe('public route inventory', () => {
  it('is pinned (update this snapshot deliberately, with a §4.1 group)', () => {
    expect(publicRoutes({ docsEnabled: false }).map((r) => `${r.group} ${r.prefix}`))
      .toMatchInlineSnapshot(`
        [
          "A /health",
          "A /engine/health",
          "A /status",
          "A /metrics",
          "F /auth/token",
          "F /auth/demo-token",
          "B /auth/signup",
          "B /auth/login",
          "C /auth/logout",
          "C /auth/mfa/verify",
          "D /auth/otp/",
          "E /auth/sso/",
          "E /auth/google/",
          "E /auth/github/",
          "B /auth/request-password-reset",
          "C /auth/reset-password",
          "C /auth/verify-email",
          "B /auth/resend-verification",
          "G /entitlements/plans",
          "G /blog/posts",
          "H /a/",
          "H /why/",
          "H /verify/",
          "I /webhooks/",
          "I /inbound/",
          "I /insights/cleanup-stale-all",
          "I /billing/webhook",
          "G /growth/events",
          "G /trust",
          "G /leads",
          "G2 /users/unsubscribe",
          "G2 /heartbeat/unsubscribe",
          "J /family/join",
          "J /family/invite/",
        ]
      `)
  })

  it('lists /documentation only when docs are enabled', () => {
    expect(openPrefixes({ docsEnabled: false }).some((p) => p.startsWith('/documentation'))).toBe(false)
    expect(openPrefixes({ docsEnabled: true })).toContain('/documentation/json')
  })

  it('never exposes the organizer-only access-request routes', () => {
    const prefixes = openPrefixes({ docsEnabled: true })
    for (const url of ['/family/access-requests', '/family/access-requests/x/approve']) {
      expect(prefixes.some((p) => url.startsWith(p))).toBe(false)
    }
  })

  it('server.ts takes its open list from this module, not a local literal', () => {
    expect(serverSrc).toContain('openPrefixes({ docsEnabled: DOCS_ENABLED })')
    expect(serverSrc).not.toMatch(/const open = \[/)
  })
})


describe('cookie-only mutation CSRF policy', () => {
  const originAllowed = (method: string, origin?: string) =>
    isOriginAllowedForCookieAuth({
      method,
      headers: origin ? { origin } : {},
    } as Parameters<typeof isOriginAllowedForCookieAuth>[0])

  it('denies state changes with no Origin', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(originAllowed(method)).toBe(false)
    }
  })

  it('denies untrusted origins but permits safe reads', () => {
    expect(originAllowed('POST', 'https://untrusted.example')).toBe(false)
    expect(originAllowed('GET')).toBe(true)
    expect(originAllowed('HEAD')).toBe(true)
  })

  it('applies the cookie CSRF gate before the public-route bypass', () => {
    const gate = serverSrc.indexOf('!isOriginAllowedForCookieAuth(request)')
    const publicBypass = serverSrc.indexOf('if (OPEN_ROUTE_PREFIXES.some(')
    expect(gate).toBeGreaterThan(0)
    expect(gate).toBeLessThan(publicBypass)
  })
})
