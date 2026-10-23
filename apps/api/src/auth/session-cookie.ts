/**
 * HttpOnly session cookie — the JS-invisible counterpart to the Bearer token
 * the web app used to keep in localStorage (SECURITY.md's documented XSS
 * exposure). The API returns the same JWT in the body as before for legacy
 * clients, but also sets it here so browsers never need to persist it where
 * script can read it.
 *
 * Cookie shape varies by deployment:
 * - cloud/accountant: the web app lives on a different origin (Firebase
 *   Hosting → Cloud Run), so SameSite=None;Secure is required for the
 *   browser to send it at all. The CSRF hole that SameSite=None opens is
 *   closed by the Origin allowlist check in server.ts's auth hook.
 * - dev: both apps are localhost (same-site), so Lax works and Secure must
 *   stay off or http://localhost rejects the cookie entirely.
 */

import type { FastifyReply, FastifyRequest } from 'fastify'
import { deploymentConfig } from '../config/deployment.js'

export const SESSION_COOKIE = 'lifekeel_session'

const IS_CLOUD = deploymentConfig.mode === 'cloud' || deploymentConfig.mode === 'accountant'

/** seconds → cookie maxAge; mirrors the TTLs auth.sign is called with.
 *  No-ops when @fastify/cookie isn't registered — the real server always
 *  registers it (server.ts), this exists for test apps that mount the
 *  auth routes on a bare Fastify instance. */
export function setSessionCookie(reply: FastifyReply, token: string, maxAgeSeconds: number): void {
  if (typeof reply.setCookie !== 'function') return
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: IS_CLOUD,
    sameSite: IS_CLOUD ? 'none' : 'lax',
    maxAge: maxAgeSeconds,
  })
}

export function clearSessionCookie(reply: FastifyReply): void {
  if (typeof reply.clearCookie !== 'function') return
  reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    secure: IS_CLOUD,
    sameSite: IS_CLOUD ? 'none' : 'lax',
  })
}

export function readSessionCookie(request: FastifyRequest): string | null {
  const value = request.cookies?.[SESSION_COOKIE]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Origins allowed to make credentialed (cookie-authed) mutations. With
 * SameSite=None the browser attaches the cookie to cross-site requests, so
 * the Origin header is the CSRF boundary — a request authenticated only by
 * cookie (no Bearer) and mutating state must come from a known app origin.
 * Cookie-authenticated mutations require an allowed Origin. A missing Origin
 * is not proof of a non-browser client: browsers can omit or suppress it in
 * some navigation, redirect, sandbox, or privacy scenarios. Server-to-server
 * clients should use Authorization: Bearer instead of a browser session cookie.
 */
// Localhost defaults exist only outside production: in a cloud deployment an
// Origin allowlist that includes localhost would let a local page (or anything
// else a developer machine runs) ride the SameSite=None cookie boundary.
// Dev/airgap still gets them because that's where the local apps live.
const DEV_ORIGINS = IS_CLOUD
  ? []
  : ['http://localhost:3000', 'http://localhost:3002', 'http://localhost:3001']

const ALLOWED_ORIGINS = new Set(
  [
    process.env['CORS_ORIGIN'] ?? '',
    process.env['LIFEKEEL_URL'] ?? '',
    process.env['STUDIO_URL'] ?? '',
    // The API itself is a credentialed origin: it serves the /a/ signed-link
    // confirmation forms that POST session-authed approvals back to it.
    process.env['API_BASE_URL'] ?? '',
    ...DEV_ORIGINS,
  ]
    .flatMap((s) => s.split(','))
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
)

export function isOriginAllowedForCookieAuth(request: FastifyRequest): boolean {
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true
  const origin = request.headers.origin
  if (!origin) return false // fail closed for cookie-only state changes
  return ALLOWED_ORIGINS.has(origin.replace(/\/$/, ''))
}
