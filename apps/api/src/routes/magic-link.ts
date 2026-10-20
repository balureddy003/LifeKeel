/**
 * Passwordless "keep this result" (PRD-203).
 *
 *   POST /auth/magic-link/request — the visitor clicked "Keep this result".
 *        Stores a short-lived pending record (the six answers, hashed token,
 *        hashed code) and emails a link plus a 6-digit code. The response is
 *        identical for every well-formed request, and all work happens after
 *        the reply is sent, so neither the body nor the timing says whether
 *        an address already has an account.
 *   POST /auth/magic-link/verify — consumes the token (or email + code),
 *        creates a passwordless account or signs in the existing one, and
 *        appends the snapshot. The email's link only lands on a web page
 *        with a Continue button; nothing here is reachable by GET, so mail
 *        scanners that prefetch links cannot burn the token.
 *
 * Nothing is stored before the request. Tier 0: account creation plus a read
 * model. Existing accounts with MFA get the snapshot but no session.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db, ObjectId } from 'mongodb'
import { AuthService, getCurrencyForCountry, getLocaleForCountry } from '@lifekeel/platform'
import { sendResultSaveEmail } from '../auth-email.js'
import { setSessionCookie } from '../auth/session-cookie.js'
import { PLAN_QUOTAS, createInitialBilling } from '../billing/billing-constants.js'
import { recordLedgerEntry } from '../billing/credit-ledger.js'
import { getPlatformConfig } from '../operator/platform-config.js'
import { getGrowthEventsCollection } from '../db.js'
import { computeReadiness } from '../readiness/score.js'
import { AVATAR_COLORS, EMAIL_FORMAT_RE, hashPassword, slugify, type User } from './auth-users.js'
import { QuizSchema, buildQuizProfile, type QuizAnswers } from './readiness-quiz.js'

export const LINK_TTL_MINUTES = 30
export const RESEND_COOLDOWN_MS = 60_000
export const MAX_SENDS_PER_ADDRESS_PER_HOUR = 3
export const MAX_CODE_ATTEMPTS = 5
/** The answers outlive the link so an expired link can be re-sent by address
 *  alone, without the visitor retaking the quiz. */
export const ANSWERS_RETENTION_HOURS = 24
/** Bump when the marketing-consent wording on the reveal changes; the
 *  consent record stores which version the visitor saw. */
export const MARKETING_CONSENT_VERSION = 'marketing-2026-10-v1'

const PENDING = 'result_save_pending'
const SENDS = 'result_save_sends'
const SNAPSHOTS = 'readiness_quiz_snapshots'
const HISTORY = 'family_readiness_history'

interface PendingDoc {
  _id?: ObjectId
  email: string
  token_hash: string
  code_hash: string
  answers: QuizAnswers
  marketing_consent: boolean
  consent_version: string
  attempts: number
  created_at: Date
  expires_at: Date
  retain_until: Date
  consumed_at: Date | null
}

const RequestSchema = z.object({
  email: z.string().trim().max(254).regex(EMAIL_FORMAT_RE),
  // Omitted when re-sending an expired link for an address that already
  // has a pending record.
  answers: QuizSchema.optional(),
  marketing_consent: z.boolean().optional(),
})

const VerifySchema = z.union([
  z.object({ token: z.string().min(16).max(128) }),
  z.object({
    email: z.string().trim().max(254).regex(EMAIL_FORMAT_RE),
    code: z.string().regex(/^\d{6}$/),
  }),
])

const secret = () => process.env['JWT_SECRET'] ?? 'dev-secret'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const codeHash = (email: string, code: string) =>
  createHmac('sha256', secret()).update(`result-save-code:${email}:${code}`).digest('hex')
const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function continueUrl(token: string): string {
  const appUrl = (process.env['LIFEKEEL_URL'] ?? 'http://localhost:3002').replace(/\/$/, '')
  return `${appUrl}/keep-result?token=${token}`
}

// Work that runs after the reply. Tracked so tests can wait for it; in
// production nothing awaits it and a failure is logged, never surfaced.
const inFlight = new Set<Promise<unknown>>()
export async function drainMagicLinkWork(): Promise<void> {
  await Promise.all([...inFlight])
}

function snapshotOf(answers: QuizAnswers) {
  const readiness = computeReadiness(buildQuizProfile(answers), null)
  return {
    score: readiness.score,
    components: readiness.components
      .filter((c) => !c.gated)
      .map((c) => ({
        key: c.key,
        label: c.label,
        score: c.score,
        weight: c.weight,
        detail: c.detail,
      })),
  }
}

export async function registerMagicLinkRoutes(
  app: FastifyInstance,
  db: Db,
  auth: AuthService,
): Promise<void> {
  const pending = db.collection<PendingDoc>(PENDING)
  const sends = db.collection(SENDS)
  await Promise.all([
    pending.createIndex({ retain_until: 1 }, { expireAfterSeconds: 0 }).catch(() => {}),
    pending.createIndex({ token_hash: 1 }).catch(() => {}),
    pending.createIndex({ email: 1 }).catch(() => {}),
    sends.createIndex({ at: 1 }, { expireAfterSeconds: 3600 }).catch(() => {}),
  ])

  async function sendLink(email: string, body: z.infer<typeof RequestSchema>): Promise<void> {
    const now = Date.now()
    const existing = await pending.findOne({ email })
    if (existing && now - existing.created_at.getTime() < RESEND_COOLDOWN_MS) return
    const emailKey = sha256(email)
    const recent = await sends.countDocuments({
      email_hash: emailKey,
      at: { $gt: new Date(now - 3_600_000) },
    })
    if (recent >= MAX_SENDS_PER_ADDRESS_PER_HOUR) return

    const answers = body.answers ?? existing?.answers
    if (!answers) return
    const token = randomBytes(32).toString('hex')
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    await pending.deleteMany({ email })
    await pending.insertOne({
      email,
      token_hash: sha256(token),
      code_hash: codeHash(email, code),
      answers,
      marketing_consent: body.marketing_consent ?? existing?.marketing_consent ?? false,
      consent_version:
        body.marketing_consent === undefined
          ? (existing?.consent_version ?? MARKETING_CONSENT_VERSION)
          : MARKETING_CONSENT_VERSION,
      attempts: 0,
      created_at: new Date(now),
      expires_at: new Date(now + LINK_TTL_MINUTES * 60_000),
      retain_until: new Date(now + ANSWERS_RETENTION_HOURS * 3_600_000),
      consumed_at: null,
    })
    await sends.insertOne({ email_hash: emailKey, at: new Date(now) })
    await sendResultSaveEmail(email, continueUrl(token), code, LINK_TTL_MINUTES)
  }

  app.post(
    '/auth/magic-link/request',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const parsed = RequestSchema.safeParse(req.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Valid email and answers required' })

      // Deployment-wide switches, not per-address facts, so answering them
      // leaks nothing about who has an account.
      if (
        process.env['INVITE_CODE_REQUIRED'] === 'true' ||
        !(await getPlatformConfig(db)).signups_enabled
      ) {
        return reply.status(503).send({ error: 'Saving results is unavailable right now.' })
      }

      const body = { ...parsed.data, email: parsed.data.email.toLowerCase() }
      const work: Promise<unknown> = sendLink(body.email, body)
        .catch((err) => req.log.warn({ err }, 'magic-link request failed'))
        .finally(() => inFlight.delete(work))
      inFlight.add(work)
      // Funnel event with no identifier: nothing here ties to the visitor.
      void getGrowthEventsCollection(db)
        .insertOne({ event: 'result_save_requested', meta: {}, created_at: new Date() })
        .catch(() => {})

      return reply.status(202).send({ ok: true })
    },
  )

  const INVALID = { error: 'This link or code is invalid or has expired.' }

  app.post(
    '/auth/magic-link/verify',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = VerifySchema.safeParse(req.body)
      if (!parsed.success) return reply.status(400).send(INVALID)
      const now = new Date()

      let doc: PendingDoc | null
      if ('token' in parsed.data) {
        doc = await pending.findOne({ token_hash: sha256(parsed.data.token) })
      } else {
        const email = parsed.data.email.toLowerCase()
        doc = await pending.findOne({ email })
        if (doc) {
          if (doc.attempts >= MAX_CODE_ATTEMPTS) {
            await pending.deleteOne({ _id: doc._id })
            doc = null
          } else if (!safeEqual(doc.code_hash, codeHash(email, parsed.data.code))) {
            await pending.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } })
            doc = null
          }
        }
      }
      if (!doc || doc.consumed_at || doc.expires_at <= now) return reply.status(400).send(INVALID)

      // Atomic single-use claim: of two concurrent requests, one wins.
      const claimed = await pending.findOneAndUpdate(
        { _id: doc._id, consumed_at: null, expires_at: { $gt: now } },
        { $set: { consumed_at: now } },
      )
      if (!claimed) return reply.status(400).send(INVALID)

      const release = () => pending.updateOne({ _id: doc!._id }, { $set: { consumed_at: null } })
      try {
        const snap = snapshotOf(doc.answers)
        const users = db.collection<User>('users')
        const found = await users.findOne({ email: doc.email })
        let user: User
        const consent = doc.marketing_consent
          ? { given: true as const, text_version: doc.consent_version, at: now }
          : undefined

        if (found && (found.status === 'suspended' || found.status === 'erased')) {
          await pending.deleteOne({ _id: doc._id })
          return reply.status(400).send(INVALID)
        }

        if (!found) {
          const local = doc.email.split('@')[0]!
          let tenant_id = ''
          for (let i = 0; i < 5 && !tenant_id; i++) {
            const candidate = `${slugify(local)}-${randomBytes(3).toString('hex')}`
            if (!(await db.collection('tenants').findOne({ tenant_id: candidate }))) {
              tenant_id = candidate
            }
          }
          if (!tenant_id) throw new Error('could not allocate a tenant id')

          const salt = randomBytes(16).toString('hex')
          user = {
            id: randomBytes(8).toString('hex'),
            email: doc.email,
            name: local,
            tenant_id,
            // No one knows this password: the account is reachable only by
            // magic link until the owner sets one through password reset.
            password_hash: hashPassword(randomBytes(32).toString('hex'), salt),
            salt,
            created_at: now,
            avatar_color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!,
            roles: ['admin'],
            status: undefined,
            failed_login_attempts: 0,
            locked_until: undefined,
            external_id: undefined,
            external_provider: undefined,
            email_verified: true,
            email_verification_token: undefined,
            email_verification_expires: undefined,
            password_reset_token: undefined,
            password_reset_expires: undefined,
            updated_at: undefined,
            attribution: undefined,
            ...(consent ? { marketing_consent: consent } : {}),
          } as User
          await users.insertOne(user)

          const billing = createInitialBilling({ currency: getCurrencyForCountry(undefined) })
          await db.collection('tenants').insertOne({
            tenant_id,
            name: local,
            plan: 'free',
            tier_hint: 'family',
            quotas: PLAN_QUOTAS['free'],
            billing: { ...billing, invite_code: null },
            country: 'GB',
            locale: getLocaleForCountry(undefined),
            status: 'active',
            created_at: now,
            updated_at: now,
          })
          if (billing.credits_balance > 0) {
            await recordLedgerEntry(db, {
              tenantId: tenant_id,
              type: 'trial_grant',
              amount: billing.credits_balance,
              reference: 'magic-link',
              reason: 'Trial credits granted at signup',
              actor: 'system',
            }).catch(() => {})
          }
        } else {
          user = found
          if (!user.email_verified || consent) {
            // Opening the link proves the mailbox; consent is only ever added.
            await users.updateOne(
              { id: user.id },
              {
                $set: { email_verified: true, ...(consent ? { marketing_consent: consent } : {}) },
              },
            )
          }
        }

        // Append, never overwrite: the snapshot has its own collection, and the
        // history row is insert-only so an existing same-day entry is kept.
        const snapshot_id = randomBytes(8).toString('hex')
        const date = now.toISOString().slice(0, 10)
        await db.collection(SNAPSHOTS).insertOne({
          tenant_id: user.tenant_id,
          id: snapshot_id,
          score: snap.score,
          components: snap.components,
          answers: doc.answers,
          saved_at: now,
        })
        if (snap.score !== null) {
          await db.collection(HISTORY).updateOne(
            { tenant_id: user.tenant_id, date },
            {
              $setOnInsert: {
                tenant_id: user.tenant_id,
                date,
                score: snap.score,
                components: Object.fromEntries(
                  snap.components.filter((c) => c.score !== null).map((c) => [c.key, c.score]),
                ),
                computed_at: now,
                source: 'quiz',
              },
            },
            { upsert: true },
          )
        }
        await pending.deleteOne({ _id: doc._id })
        void getGrowthEventsCollection(db)
          .insertOne({ event: 'result_save_verified', meta: {}, created_at: new Date() })
          .catch(() => {})

        const snapshot = {
          id: snapshot_id,
          score: snap.score,
          components: snap.components,
          saved_at: now,
        }
        if (user.mfa_enabled) {
          return reply.send({ signed_in: false, reason: 'mfa_required', snapshot })
        }
        const token = await auth.sign({
          sub: user.id,
          tenant_id: user.tenant_id,
          roles: user.roles,
        })
        setSessionCookie(reply, token, 7 * 24 * 60 * 60)
        return reply.send({
          signed_in: true,
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            tenant_id: user.tenant_id,
            avatar_color: user.avatar_color,
            email_verified: true,
          },
          snapshot,
        })
      } catch (err) {
        req.log.error({ err }, 'magic-link verify failed')
        await release().catch(() => {})
        return reply.status(500).send({ error: 'Something went wrong. Please try the link again.' })
      }
    },
  )
}
