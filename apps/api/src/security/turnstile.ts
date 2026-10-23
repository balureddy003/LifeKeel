/**
 * Cloudflare Turnstile verification (CLOUDFLARE_INTEGRATION.md §5).
 *
 * Routes opt in with `config: { turnstile: '<action>' }`. `registerTurnstile`
 * installs an onRoute hook that appends the verifier to that route's
 * preHandler chain. It must be registered after @fastify/rate-limit so the
 * (cheap) rate limit runs first and floods never reach siteverify.
 *
 * The token travels in the `cf-turnstile-token` header (D1), so request
 * body schemas are unchanged. The siteverify URL is a constant, never built
 * from request data (API7). The token itself is never logged.
 *
 * Modes (D2): `off` skips, `monitor` verifies and logs but lets the request
 * through, `enforce` refuses. Default is `off` in dev and `enforce`
 * everywhere else; a non-dev downgrade is logged at boot.
 */
import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Env } from './boot-guards.js'
import { recordTurnstileVerify } from '../observability/security-metrics.js'

export type TurnstileAction =
  | 'signup'
  | 'login'
  | 'otp_resend'
  | 'password_reset_request'
  | 'reset_password'
  | 'resend_verification'
  | 'lead'
  | 'family_join'

export type TurnstileMode = 'off' | 'monitor' | 'enforce'

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Require a Turnstile token minted for this action. */
    turnstile?: TurnstileAction
  }
}

export const TURNSTILE_HEADER = 'cf-turnstile-token'
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const MAX_TOKEN_LENGTH = 2048
const TIMEOUT_MS = 3000

export interface TurnstileConfig {
  mode: TurnstileMode
  secret: string
  allowedHostnames: string[]
}

export function turnstileConfig(env: Env, deploymentMode: string): TurnstileConfig {
  const raw = env['TURNSTILE_MODE']
  const mode: TurnstileMode =
    raw === 'off' || raw === 'monitor' || raw === 'enforce'
      ? raw
      : deploymentMode === 'dev'
        ? 'off'
        : 'enforce'
  return {
    mode,
    secret: env['TURNSTILE_SECRET_KEY'] ?? '',
    // Defaults to the app hosts the deploy already sets (LIFEKEEL_APP_HOSTS).
    allowedHostnames: (env['TURNSTILE_ALLOWED_HOSTNAMES'] ?? env['LIFEKEEL_APP_HOSTS'] ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  }
}

/** Boot-time check, merged into the server's boot guards. */
export function evaluateTurnstileBoot(
  env: Env,
  deploymentMode: string,
): { violations: string[]; exceptions: string[] } {
  const cfg = turnstileConfig(env, deploymentMode)
  const violations: string[] = []
  const exceptions: string[] = []
  if (cfg.mode !== 'off') {
    if (!cfg.secret) violations.push(`TURNSTILE_MODE=${cfg.mode} requires TURNSTILE_SECRET_KEY`)
    if (cfg.allowedHostnames.length === 0)
      violations.push(`TURNSTILE_MODE=${cfg.mode} requires TURNSTILE_ALLOWED_HOSTNAMES`)
  }
  if (deploymentMode !== 'dev' && cfg.mode !== 'enforce') {
    exceptions.push(`TURNSTILE_MODE=${cfg.mode} (bot challenge not enforced)`)
  }
  return { violations, exceptions }
}

const SiteverifySchema = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).optional().default([]),
  hostname: z.string().optional(),
  action: z.string().optional(),
})

export type VerifyOutcome =
  | { result: 'ok' }
  | { result: 'missing' }
  | { result: 'failed'; codes: string[] }
  | { result: 'unavailable' }

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/** One siteverify call with a single retry on network error or 5xx. */
export async function verifyTurnstileToken(
  token: string | undefined,
  remoteip: string,
  action: TurnstileAction,
  cfg: TurnstileConfig,
  fetchImpl: FetchLike = fetch,
): Promise<VerifyOutcome> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return { result: 'missing' }
  const idempotencyKey = randomUUID()
  const body = new URLSearchParams({
    secret: cfg.secret,
    response: token,
    remoteip,
    idempotency_key: idempotencyKey,
  })

  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response
    try {
      res = await fetchImpl(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      continue
    }
    if (res.status >= 500) continue
    let parsed: z.infer<typeof SiteverifySchema>
    try {
      parsed = SiteverifySchema.parse(await res.json())
    } catch {
      // A malformed answer is not a pass (API10).
      return { result: 'failed', codes: ['malformed-response'] }
    }
    if (!parsed.success) return { result: 'failed', codes: parsed['error-codes'] }
    // Only Cloudflare's view of the hostname counts, never the client's.
    if (!parsed.hostname || !cfg.allowedHostnames.includes(parsed.hostname.toLowerCase()))
      return { result: 'failed', codes: ['hostname-mismatch'] }
    // A token minted for the login form must not unlock signup.
    if (parsed.action !== action) return { result: 'failed', codes: ['action-mismatch'] }
    return { result: 'ok' }
  }
  return { result: 'unavailable' }
}

export interface TurnstileDeps {
  config: () => TurnstileConfig
  fetch?: FetchLike
}

export function requireTurnstile(action: TurnstileAction, deps: TurnstileDeps) {
  return async function turnstileGate(request: FastifyRequest, reply: FastifyReply) {
    const cfg = deps.config()
    if (cfg.mode === 'off') return
    // Dual-mode routes (e.g. /auth/resend-verification from settings) are
    // also called with a live session; the challenge is for anonymous callers.
    if (request.authContext) return
    const header = request.headers[TURNSTILE_HEADER]
    const token = typeof header === 'string' ? header : undefined
    const outcome = await verifyTurnstileToken(token, request.ip, action, cfg, deps.fetch)
    recordTurnstileVerify(action, outcome.result)
    if (outcome.result === 'ok') return

    request.log.warn(
      {
        turnstile_action: action,
        turnstile_result: outcome.result,
        turnstile_mode: cfg.mode,
        ...(outcome.result === 'failed' ? { error_codes: outcome.codes } : {}),
      },
      'Turnstile check did not pass',
    )
    if (cfg.mode === 'monitor') return

    if (outcome.result === 'missing') return reply.status(400).send({ error: 'captcha_required' })
    if (outcome.result === 'unavailable')
      return reply.status(503).send({ error: 'captcha_unavailable' })
    return reply.status(403).send({ error: 'captcha_failed' })
  }
}

/**
 * Attach the gate to every route declaring `config.turnstile`. Register
 * after @fastify/rate-limit and before the routes.
 */
export function registerTurnstile(app: FastifyInstance, deps: TurnstileDeps): void {
  app.addHook('onRoute', (routeOptions) => {
    const action = (routeOptions.config as { turnstile?: TurnstileAction } | undefined)?.turnstile
    if (!action) return
    const gate = requireTurnstile(action, deps)
    const existing = routeOptions.preHandler
    routeOptions.preHandler = Array.isArray(existing)
      ? [...existing, gate]
      : existing
        ? [existing, gate]
        : [gate]
  })
}
