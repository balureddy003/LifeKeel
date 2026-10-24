/**
 * Email OTP routes (CLOUDFLARE_INTEGRATION.md §6).
 *
 *   POST /auth/otp/verify  { otp_token, code }  → session (same shape as login)
 *   POST /auth/otp/resend  { otp_token }        → new code in the same chain
 *
 * Both sit on the open-routes list ('/auth/otp/'): they authenticate the
 * pending token themselves, with a key that can never verify as a session.
 * Resend is Turnstile-gated (action otp_resend); verify is bounded by the
 * per-code attempt cap instead.
 *
 * `startOtpChallenge` is the single issuance path used by signup, login and
 * the pending-registration login, so every issuance spends the same
 * account-wide send budget.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from 'mongodb'
import type { AuthService } from '@lifekeel/platform'
import { getDb } from '../db.js'
import { sendOtpEmail } from '../auth-email.js'
import { consumeInviteCode } from '../invite-codes.js'
import { setSessionCookie } from '../auth/session-cookie.js'
import { checkAccountLiveness } from '../auth/liveness.js'
import { signOtpPending, verifyOtpPending, type OtpPurpose } from '../auth/otp-token.js'
import {
  emailHint,
  issueChain,
  recordDelivery,
  releaseCooldown,
  reserveSend,
  resendInChain,
  verifyChain,
  type OtpChain,
} from '../auth/otp.js'
import {
  recordOtpBudgetDenied,
  recordOtpDelivery,
  recordOtpIssued,
  recordOtpVerify,
} from '../observability/security-metrics.js'
import { getAuditLogger } from '../audit/audit-log.js'

export interface OtpUser {
  id: string
  email: string
  name: string
  tenant_id: string
}

type Delivery = 'sent' | 'failed' | 'unknown'

async function deliver(
  db: Db,
  user: OtpUser,
  chain: OtpChain,
  code: string,
  purpose: OtpPurpose,
): Promise<{ delivery: Delivery; resendAvailableAt: Date | null }> {
  const started = performance.now()
  const delivery = await sendOtpEmail(user.email, user.name, code, purpose)
  recordOtpDelivery(delivery, (performance.now() - started) / 1000)
  await recordDelivery(db, chain.chain_id, chain.code_version, delivery)
  if (delivery === 'failed') {
    // Definite rejection: let the user resend at once. Budget stays spent.
    await releaseCooldown(db, user.id)
    return { delivery, resendAvailableAt: new Date() }
  }
  return { delivery, resendAvailableAt: null }
}

/** Never the code or the token: chain id, purpose and outcome only. */
function audit(
  request: FastifyRequest,
  action: 'auth.otp_issued' | 'auth.otp_failed' | 'auth.otp_locked' | 'auth.otp_succeeded',
  user: { id: string; tenant_id: string },
  meta: Record<string, unknown>,
) {
  getAuditLogger()?.log({
    tenant_id: user.tenant_id,
    user_id: user.id,
    action,
    resource_type: 'otp_chain',
    resource_id: String(meta['chain_id'] ?? ''),
    metadata: meta,
    ip: request.ip,
    user_agent: (request.headers['user-agent'] ?? '').slice(0, 300),
    timestamp: new Date(),
  })
}

function budgetRefusal(
  reply: FastifyReply,
  result: { reason: 'cooldown'; retryAfterS: number } | { reason: 'hourly' | 'daily' },
) {
  recordOtpBudgetDenied(result.reason)
  if (result.reason === 'cooldown') {
    return reply
      .status(429)
      .header('Retry-After', String(result.retryAfterS))
      .send({ error: 'otp_cooldown', retry_after_s: result.retryAfterS })
  }
  return reply.status(429).send({ error: 'otp_send_limit' })
}

/**
 * Reserve budget → create chain → sign pending token → send. The chain and
 * token exist before the send, so a failed send still leaves the user a
 * resend control (§6.8). Always 200 with a usable token once past the budget.
 */
export async function startOtpChallenge(
  request: FastifyRequest,
  reply: FastifyReply,
  user: OtpUser,
  purpose: OtpPurpose,
  opts: { registration_version?: string | null; remember_me?: boolean } = {},
) {
  const db = await getDb()
  const budget = await reserveSend(db, user.id)
  if (!budget.ok) return budgetRefusal(reply, budget)

  const { chain, code } = await issueChain(db, {
    user_id: user.id,
    tenant_id: user.tenant_id,
    purpose,
    registration_version: opts.registration_version ?? null,
    remember_me: opts.remember_me === true,
  })
  const otp_token = await signOtpPending(
    { user_id: user.id, tenant_id: user.tenant_id, chain_id: chain.chain_id, purpose },
    chain.chain_expires_at,
  )
  recordOtpIssued(purpose, 'first')
  const sent = await deliver(db, user, chain, code, purpose)
  audit(request, 'auth.otp_issued', user, {
    chain_id: chain.chain_id,
    purpose,
    delivery: sent.delivery,
  })

  // No Set-Cookie and no session token here.
  return reply.status(200).send({
    otp_required: true,
    otp_token,
    email_hint: emailHint(user.email),
    delivery: sent.delivery,
    code_expires_at: chain.code_expires_at.toISOString(),
    chain_expires_at: chain.chain_expires_at.toISOString(),
    resend_available_at: (sent.resendAvailableAt ?? budget.resendAvailableAt).toISOString(),
  })
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null

async function readPending(request: FastifyRequest) {
  const token = str((request.body as { otp_token?: unknown } | undefined)?.otp_token, 4096)
  if (!token) return null
  try {
    return await verifyOtpPending(token)
  } catch {
    return null
  }
}

export async function registerAuthOtpRoutes(
  app: FastifyInstance,
  auth: AuthService,
): Promise<void> {
  app.post<{ Body: { otp_token?: unknown; code?: unknown } }>(
    '/auth/otp/verify',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const pending = await readPending(request)
      if (!pending) return reply.status(401).send({ error: 'otp_token_invalid' })
      // Typed filter input: a code is exactly six digits, never an object (A03).
      const code = request.body?.code
      if (typeof code !== 'string' || !/^\d{6}$/.test(code))
        return reply.status(400).send({ error: 'otp_invalid', attempts_left: null })

      const db = await getDb()
      const ids = { chain_id: pending.chain_id, user_id: pending.user_id, purpose: pending.purpose }
      const result = await verifyChain(db, ids, code)
      if (!result.ok) {
        recordOtpVerify(pending.purpose, result.reason)
        audit(
          request,
          result.reason === 'locked' ? 'auth.otp_locked' : 'auth.otp_failed',
          {
            id: pending.user_id,
            tenant_id: pending.tenant_id,
          },
          { chain_id: pending.chain_id, purpose: pending.purpose, reason: result.reason },
        )
        if (result.reason === 'invalid')
          return reply
            .status(400)
            .send({ error: 'otp_invalid', attempts_left: result.attemptsLeft })
        if (result.reason === 'locked') return reply.status(429).send({ error: 'otp_locked' })
        return reply.status(400).send({ error: 'otp_expired' })
      }
      const chain = result.chain
      const users = db.collection('users')

      if (chain.purpose === 'signup') {
        // Step 4: activate only the registration this chain was issued for.
        const activated = await users.findOneAndUpdate(
          {
            id: chain.user_id,
            tenant_id: chain.tenant_id,
            registration_status: 'pending',
            registration_version: chain.registration_version,
          },
          { $set: { email_verified: true, registration_status: 'active', updated_at: new Date() } },
          { returnDocument: 'after' },
        )
        if (!activated) {
          recordOtpVerify('signup', 'superseded')
          return reply.status(409).send({ error: 'otp_superseded' })
        }
        const inviteCode = activated['registration_invite_code'] as string | undefined
        if (inviteCode) {
          const invite = await consumeInviteCode(db, inviteCode)
          if (!invite.ok) {
            await users.updateOne(
              {
                id: chain.user_id,
                registration_status: 'active',
                registration_version: chain.registration_version,
              },
              { $set: { registration_status: 'pending', email_verified: false } },
            )
            recordOtpVerify('signup', 'invite_unavailable')
            return reply.status(409).send({ error: 'invite_unavailable' })
          }
        }
        await users.updateOne(
          { id: chain.user_id, registration_version: chain.registration_version },
          { $unset: { registration_version: '', registration_invite_code: '' } },
        )
      }

      // Step 5: liveness recheck. A revoke after the chain began wins.
      const live = await checkAccountLiveness(
        db,
        { tenant_id: chain.tenant_id, user_id: chain.user_id },
        { issuedAtMs: chain.created_at.getTime() },
      )
      if (!live.ok) {
        recordOtpVerify(chain.purpose, 'not_live')
        return reply.status(401).send({ error: 'Invalid or expired sign-in' })
      }
      const user = await users.findOne({ id: chain.user_id, tenant_id: chain.tenant_id })
      if (!user) return reply.status(401).send({ error: 'Invalid or expired sign-in' })

      const roles = (user['roles'] as string[] | undefined) ?? ['viewer']
      const ttl = chain.remember_me ? '30d' : '7d'
      const token = await auth.sign({ sub: chain.user_id, tenant_id: chain.tenant_id, roles }, ttl)
      setSessionCookie(reply, token, (chain.remember_me ? 30 : 7) * 24 * 60 * 60)
      recordOtpVerify(chain.purpose, 'ok')
      audit(
        request,
        'auth.otp_succeeded',
        { id: chain.user_id, tenant_id: chain.tenant_id },
        {
          chain_id: chain.chain_id,
          purpose: chain.purpose,
        },
      )
      void db
        .collection('login_events')
        .insertOne({
          email: user['email'],
          success: true,
          reason: chain.purpose === 'signup' ? 'otp_signup_verified' : 'otp_verified',
          user_id: chain.user_id,
          tenant_id: chain.tenant_id,
          ip: request.ip,
          user_agent: (request.headers['user-agent'] ?? '').slice(0, 300),
          created_at: new Date(),
        })
        .catch(() => {})

      const settings = await db
        .collection('tenant_settings')
        .findOne({ tenant_id: chain.tenant_id })
      return reply.send({
        token,
        user: {
          id: chain.user_id,
          email: user['email'],
          name: user['name'],
          tenant_id: chain.tenant_id,
          avatar_color: user['avatar_color'],
          email_verified: true,
          active_vertical: (settings?.['active_vertical'] as string | undefined) ?? null,
          onboarding_skipped: (settings?.['onboarding_skipped'] as boolean | undefined) ?? false,
        },
      })
    },
  )

  app.post<{ Body: { otp_token?: unknown } }>(
    '/auth/otp/resend',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' }, turnstile: 'otp_resend' } },
    async (request, reply) => {
      const pending = await readPending(request)
      if (!pending) return reply.status(401).send({ error: 'otp_token_invalid' })
      const db = await getDb()
      const ids = { chain_id: pending.chain_id, user_id: pending.user_id, purpose: pending.purpose }

      // Cheap pre-check so an expired chain doesn't spend budget.
      const live = await db.collection<OtpChain>('otp_chains').findOne({
        chain_id: ids.chain_id,
        user_id: ids.user_id,
        consumed_at: null,
        chain_expires_at: { $gt: new Date() },
      })
      if (!live) return reply.status(400).send({ error: 'otp_expired' })

      const budget = await reserveSend(db, pending.user_id)
      if (!budget.ok) return budgetRefusal(reply, budget)

      const resent = await resendInChain(db, ids)
      if (!resent.ok) return reply.status(400).send({ error: 'otp_expired' })
      const user = await db
        .collection('users')
        .findOne({ id: pending.user_id, tenant_id: pending.tenant_id })
      if (!user) return reply.status(401).send({ error: 'otp_token_invalid' })

      recordOtpIssued(pending.purpose, 'resend')
      const sent = await deliver(
        db,
        {
          id: pending.user_id,
          tenant_id: pending.tenant_id,
          email: user['email'],
          name: user['name'],
        },
        resent.issued.chain,
        resent.issued.code,
        pending.purpose,
      )
      audit(
        request,
        'auth.otp_issued',
        { id: pending.user_id, tenant_id: pending.tenant_id },
        {
          chain_id: pending.chain_id,
          purpose: pending.purpose,
          delivery: sent.delivery,
          resend: true,
        },
      )
      // Same otp_token stays valid until chain_expires_at.
      return reply.send({
        delivery: sent.delivery,
        code_expires_at: resent.issued.chain.code_expires_at.toISOString(),
        chain_expires_at: resent.issued.chain.chain_expires_at.toISOString(),
        resend_available_at: (sent.resendAvailableAt ?? budget.resendAvailableAt).toISOString(),
      })
    },
  )
}
