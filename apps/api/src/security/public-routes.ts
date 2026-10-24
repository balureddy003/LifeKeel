/**
 * Inventory of routes reachable without a session (API9, CLOUDFLARE_INTEGRATION.md §4.1).
 *
 * server.ts's onRequest hook matches these by `startsWith`. Every prefix
 * carries the protection group it belongs to, so adding a public route
 * forces a classification decision in the diff. `public-routes.test.ts`
 * pins the exact list: changing it means changing that test too, which
 * puts the new public surface in front of a reviewer.
 *
 * Groups (see the plan's table for the per-group controls):
 *   A  health and ops           B  account creation and recovery
 *   C  token consumption        D  email OTP
 *   E  social and SSO           F  dev and demo (403 outside dev)
 *   G  marketing / lead capture G2 one-click opt-outs
 *   H  signed-link landings     I  machine callers (signature / secret)
 *   J  family invites
 */

export type PublicRouteGroup = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'G2' | 'H' | 'I' | 'J'

export interface PublicRoute {
  prefix: string
  group: PublicRouteGroup
  /** Human-initiated mutation gated by Turnstile (enforced per route, not here). */
  turnstile?: boolean
  note?: string
}

const ALWAYS: PublicRoute[] = [
  { prefix: '/health', group: 'A' },
  { prefix: '/engine/health', group: 'A' },
  { prefix: '/status', group: 'A' },
  { prefix: '/metrics', group: 'A', note: 'route checks METRICS_SCRAPE_TOKEN itself' },
  { prefix: '/auth/token', group: 'F' },
  { prefix: '/auth/demo-token', group: 'F' },
  { prefix: '/auth/signup', group: 'B', turnstile: true },
  { prefix: '/auth/login', group: 'B', turnstile: true },
  { prefix: '/auth/logout', group: 'C' },
  { prefix: '/auth/mfa/verify', group: 'C' },
  {
    prefix: '/auth/otp/',
    group: 'D',
    note: 'resend is Turnstile-gated; verify uses the pending token',
  },
  { prefix: '/auth/sso/', group: 'E' },
  { prefix: '/auth/google/', group: 'E' },
  { prefix: '/auth/github/', group: 'E' },
  { prefix: '/auth/request-password-reset', group: 'B', turnstile: true },
  { prefix: '/auth/reset-password', group: 'C', turnstile: true },
  { prefix: '/auth/verify-email', group: 'C' },
  { prefix: '/auth/resend-verification', group: 'B', turnstile: true },
  { prefix: '/entitlements/plans', group: 'G' },
  { prefix: '/blog/posts', group: 'G' },
  { prefix: '/a/', group: 'H', note: 'GET renders only; approve needs a same-tenant session' },
  { prefix: '/why/', group: 'H' },
  { prefix: '/verify/', group: 'H' },
  { prefix: '/webhooks/', group: 'I' },
  { prefix: '/inbound/', group: 'I' },
  { prefix: '/insights/cleanup-stale-all', group: 'I' },
  { prefix: '/billing/webhook', group: 'I' },
  { prefix: '/growth/events', group: 'G', note: 'volume; rate limit only' },
  // PRD-219: HMAC-signed card images — signature proves the URL was minted
  // server-side; wrong/missing `s` gets a 404, nothing else is served here.
  { prefix: '/public/social-card/', group: 'G', note: 'signed GETs; rate limit only' },
  { prefix: '/trust', group: 'G' },
  { prefix: '/leads', group: 'G', turnstile: true, note: 'POST gated; unsubscribe is G2' },
  { prefix: '/users/unsubscribe', group: 'G2' },
  { prefix: '/heartbeat/unsubscribe', group: 'G2' },
  // PRD-110: '/family/join' is deliberately NOT a prefix of the organizer-only
  // '/family/access-requests*' endpoints — this list is matched by
  // startsWith, so '/family/join-requests' would have made those public too.
  { prefix: '/family/join', group: 'J', turnstile: true },
  { prefix: '/family/invite/', group: 'J' },
]

const DOCS: PublicRoute[] = [
  { prefix: '/documentation', group: 'A' },
  { prefix: '/documentation/json', group: 'A' },
  { prefix: '/documentation/uiOptions', group: 'A' },
  { prefix: '/documentation/static', group: 'A' },
]

export function publicRoutes(opts: { docsEnabled: boolean }): PublicRoute[] {
  return opts.docsEnabled ? [...ALWAYS, ...DOCS] : [...ALWAYS]
}

export function openPrefixes(opts: { docsEnabled: boolean }): string[] {
  return publicRoutes(opts).map((r) => r.prefix)
}
