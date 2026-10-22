/**
 * User auth — signup / login / me / logout
 *
 * Passwords are hashed with scrypt (Node built-in, production-safe).
 * Users are stored in MongoDB. tenant_id = slugified workspace name.
 *
 * Security features:
 * - Account lockout after failed login attempts
 * - Email verification (optional, can be enabled via env var)
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { AuthService, getCurrencyForCountry, getLocaleForCountry } from '@lifekeel/platform'
import { getDb, getLoginEventsCollection } from '../db.js'
import { checkInviteCode, consumeInviteCode } from '../invite-codes.js'
import { PLAN_QUOTAS, createInitialBilling } from '../billing/billing-constants.js'
import { sendPasswordResetEmail, sendEmailVerificationEmail } from '../auth-email.js'
import { recordLedgerEntry } from '../billing/credit-ledger.js'
import { getPlatformConfig } from '../operator/platform-config.js'
import { attributeReferral } from './referrals.js'
import { setSessionCookie } from '../auth/session-cookie.js'
import {
  generateTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  matchTotpStep,
  otpauthUrl,
} from '../auth/totp.js'
import { decryptEnveloped, encryptForTenant } from '../crypto/envelope.js'
import { sessionsRevokedAt } from '../auth/session-revocation.js'
import { displayNameError } from '../validation/display-name.js'

// Pragmatic (not full RFC 5322) format check for signup specifically —
// unlike login/reset-request, which only ever do a lookup and return a
// generic response either way, a malformed address here becomes a real,
// permanently unreachable account marked email_verified. Requires a local
// part, one '@', and a domain with a dot — catches the obvious cases
// (missing '@', no domain, a second '@') without over-validating.
export const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Exported for family-join.ts (PRD-110): approving a join request creates a
// real users row with this exact shape — password hashing especially must
// never have a second, drifting implementation.
export interface User {
  id: string
  email: string
  name: string
  tenant_id: string
  password_hash: string
  salt: string
  created_at: Date
  avatar_color: string
  roles: string[]
  /** 'removed': taken off the household roster by the organizer (R03). */
  status: 'active' | 'suspended' | 'erased' | 'removed' | undefined
  failed_login_attempts: number | undefined
  locked_until: Date | undefined
  external_id: string | undefined
  external_provider: 'oidc' | 'saml' | undefined
  email_verified: boolean | undefined
  email_verification_token: string | undefined
  email_verification_expires: Date | undefined
  password_reset_token: string | undefined
  password_reset_expires: Date | undefined
  /** SHA-256 of the emailed tokens (R39) — the raw values are never stored. */
  email_verification_token_hash?: string | undefined
  password_reset_token_hash?: string | undefined
  /** Every session token issued at or before this instant is rejected (R06). */
  sessions_revoked_at?: Date | undefined
  updated_at: Date | undefined
  // PRD-130: last authenticated request, throttled to one write per hour
  // per user in the auth middleware. Feeds the continuity check-in — a
  // login timestamp alone can't tell an active-but-long-lived session
  // from a genuinely absent organizer.
  last_seen_at?: Date | undefined
  // First-touch marketing attribution captured by apps/web's attribution.ts
  // — utm_*/referrer/landing_path, all short sanitized strings.
  attribution?: Record<string, string> | undefined
  // TOTP MFA (RFC 6238): pending secret lives on the doc between setup and
  // enable so a half-finished enrollment can't lock the account; recovery
  // codes are stored as SHA-256 hashes only, consumed on use.
  mfa_enabled?: boolean | undefined
  /** PRD-203: set only when the visitor ticked the (unticked-by-default) box. */
  marketing_consent?: { given: true; text_version: string; at: Date } | undefined
  /** Tenant-envelope encrypted (R40); older rows may still hold plaintext, which decryptEnveloped passes through. */
  mfa_secret?: string | undefined
  mfa_pending_secret?: string | undefined
  mfa_recovery_hashes?: string[] | undefined
  /** Last accepted TOTP time step — a code is never accepted twice (R40). */
  mfa_last_step?: number | undefined
  mfa_failed_attempts?: number | undefined
  mfa_locked_until?: Date | undefined
}

// `ref` (PRD-112, friend referral) is deliberately separate from
// `invite_code` above — that's an unrelated platform-wide B2B signup
// gate (see checkInviteCode/consumeInviteCode), not a referral.
interface SignupBody {
  email: string
  password: string
  name: string
  workspace: string
  external_id?: string
  external_provider?: 'oidc' | 'saml'
  tier_hint?: 'developer' | 'team' | 'business' | 'enterprise'
  invite_code?: string
  country?: string
  ref?: string
  attribution?: Record<string, unknown>
}

// Attribution is client-supplied and unverifiable — it's analytics, not
// authorization. Only the known keys survive, each a bounded string.
const ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'referrer',
  'landing_path',
  'captured_at',
] as const
function sanitizeAttribution(
  input: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (!input || typeof input !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const key of ATTRIBUTION_KEYS) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) out[key] = value.slice(0, 300)
  }
  return Object.keys(out).length > 0 ? out : undefined
}
interface LoginBody {
  email: string
  password: string
  rememberMe?: boolean
}
interface UpdateProfileBody {
  name?: string
  email?: string
  avatar_color?: string
}
interface ChangePasswordBody {
  current_password: string
  new_password: string
}
interface RequestResetBody {
  email: string
  app?: 'family' | 'studio' | 'lifekeel'
}
interface ResetPasswordBody {
  token: string
  new_password: string
}

export const AVATAR_COLORS = [
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ef4444',
  '#06b6d4',
  '#f97316',
]

// Security configuration
const EMAIL_VERIFICATION_ENABLED = process.env['EMAIL_VERIFICATION_ENABLED'] === 'true'

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workspace'
  )
}

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex')
}

function generateEmailVerificationToken(): string {
  return randomBytes(32).toString('hex')
}

/** Recovery and verification tokens are stored and looked up by this hash only (R39). */
export function hashAuthToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * JSON bodies are untyped at runtime. A value used in a MongoDB filter must
 * be a plain bounded string, or `{ "$ne": null }` would match any user (R01).
 */
function str(value: unknown, max = 512): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
}

function passwordMatches(user: Pick<User, 'salt' | 'password_hash'>, password: string): boolean {
  if (!user.salt || !user.password_hash) return false
  const expected = Buffer.from(hashPassword(password, user.salt), 'hex')
  const actual = Buffer.from(user.password_hash, 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** Per email+IP and per email, over this window (R42). */
const LOGIN_THROTTLE_WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES_PER_EMAIL_AND_IP = 5
const MAX_FAILURES_PER_EMAIL = 50
const MFA_MAX_FAILURES = 5
const MFA_LOCK_MS = 15 * 60 * 1000
const GENERIC_LOGIN_ERROR = 'Invalid email or password'
const THROTTLED_LOGIN_ERROR = 'Too many sign-in attempts. Wait a few minutes or reset your password.'

/** The link in the verification email — goes to the web /verify-email
 *  page, which POSTs the token back to /auth/verify-email. Never logged:
 *  possession of this URL proves mailbox ownership. The token rides in the
 *  fragment, which browsers never send to servers, analytics or Referer (R39). */
function verificationUrl(token: string): string {
  const appUrl = (process.env['LIFEKEEL_URL'] ?? 'http://localhost:3002').replace(/\/$/, '')
  return `${appUrl}/verify-email#token=${token}`
}

export async function getUsersCollection() {
  const db = await getDb()
  const col = db.collection<User>('users')
  await col.createIndex({ email: 1 }, { unique: true })
  await col.createIndex({ external_id: 1, external_provider: 1 }, { sparse: true })
  await col.createIndex({ email_verification_token_hash: 1 }, { sparse: true })
  await col.createIndex({ password_reset_token_hash: 1 }, { sparse: true })
  return col
}

/** Security telemetry for the operator security view — one doc per login
 *  outcome. Fire-and-forget on purpose: a logging failure must never change
 *  a login's outcome, so the insert is intentionally not awaited. */
function recordLoginEvent(
  request: FastifyRequest,
  event: { email: string; success: boolean; reason?: string; user_id?: string; tenant_id?: string },
): void {
  void getDb()
    .then((db) =>
      getLoginEventsCollection(db).insertOne({
        ...event,
        ip: request.ip,
        user_agent: (request.headers['user-agent'] ?? '').slice(0, 300),
        created_at: new Date(),
      }),
    )
    .catch(() => {})
}

export async function registerAuthUserRoutes(
  app: FastifyInstance,
  auth: AuthService,
): Promise<void> {
  /** GET /auth/signup-config — lets the signup form render accurate copy
   * instead of hardcoding "required" regardless of deployment config. */
  app.get('/auth/signup-config', async () => ({
    invite_code_required: process.env['INVITE_CODE_REQUIRED'] === 'true',
  }))

  /** POST /auth/signup */
  app.post<{ Body: SignupBody }>(
    '/auth/signup',
    // KEEL-025: the 409 on an existing email is a genuine UX need (a user
    // needs to know why signup failed) — making it generic would break
    // that without meaningfully stopping a determined attacker. This
    // route-level limit raises the cost of a bulk enumeration sweep
    // without changing the honest per-request error message.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const {
        email,
        password,
        name,
        workspace,
        external_id,
        external_provider,
        tier_hint,
        invite_code,
        country,
        ref,
        attribution,
      } = request.body

      if (!str(email, 320) || !EMAIL_FORMAT_RE.test(email.trim()))
        return reply.status(400).send({ error: 'Valid email required' })
      if (!str(password, 1024) || password.length < 8)
        return reply.status(400).send({ error: 'Password must be at least 8 characters' })
      const nameError = displayNameError(name)
      if (nameError) return reply.status(400).send({ error: nameError })
      if (workspace !== undefined) {
        const workspaceError = displayNameError(workspace, 'Workspace name')
        if (workspaceError) return reply.status(400).send({ error: workspaceError })
      }
      if (external_id !== undefined && !str(external_id, 256))
        return reply.status(400).send({ error: 'Invalid external_id' })

      const db = await getDb()

      // Operator-controlled switch: signups can be paused platform-wide
      // (e.g. incident, migration) without taking the API down.
      if (!(await getPlatformConfig(db)).signups_enabled) {
        return reply.status(503).send({ error: 'Signups are temporarily disabled' })
      }

      // Validate invite code early, but do not consume it until we know the signup will succeed.
      const inviteCheck = await checkInviteCode(db, invite_code)
      if (!inviteCheck.ok) {
        return reply.status(400).send({ error: inviteCheck.reason ?? 'Invalid invite code' })
      }

      const col = await getUsersCollection()

      // Check for existing user by email or external ID before consuming the invite code.
      const existingByEmail = await col.findOne({ email: email.toLowerCase() })
      if (existingByEmail) return reply.status(409).send({ error: 'Email already registered' })

      if (external_id && external_provider) {
        const existingByExternal = await col.findOne({ external_id, external_provider })
        if (existingByExternal)
          return reply.status(409).send({ error: 'External ID already registered' })
      }

      // Security: the workspace slug is a shared, guessable identifier (e.g.
      // "acme-corp") — nothing about self-serve signup implies authorization to
      // join a workspace someone else already created. There is no invite
      // mechanism scoped to a specific tenant (checkInviteCode/consumeInviteCode
      // above are platform-wide, gating signup at all, not which tenant you
      // land in) and no admin-approval step, so an unclaimed collision must be
      // rejected outright rather than silently admitting a second, unrelated
      // admin into an existing tenant.
      let tenant_id = workspace ? slugify(workspace) : slugify(email.split('@')[0]!)
      const existingTenant = await db.collection('tenants').findOne({ tenant_id })
      if (existingTenant && existingTenant['status'] !== 'deleted') {
        return reply
          .status(409)
          .send({ error: 'That workspace name is already taken. Choose another.' })
      }
      if (existingTenant) {
        // A deleted tenant's row is kept for the audit trail (its slug
        // stays taken), so the same email can't reclaim it — mint a
        // suffixed slug instead of a permanent 409 (UAT D16). 'deleting'
        // still blocks: the wipe may be mid-flight.
        let free = false
        for (let i = 2; i <= 10; i++) {
          const candidate = `${tenant_id}-${i}`
          const clash = await db.collection('tenants').findOne({ tenant_id: candidate })
          if (!clash) {
            tenant_id = candidate
            free = true
            break
          }
        }
        if (!free) {
          return reply
            .status(409)
            .send({ error: 'That workspace name is already taken. Choose another.' })
        }
      }

      // Now that the signup is valid, consume the invite code.
      const invite = await consumeInviteCode(db, invite_code)
      if (!invite.ok) {
        return reply.status(400).send({ error: invite.reason ?? 'Invalid invite code' })
      }

      const salt = randomBytes(16).toString('hex')
      const avatar_color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!

      const user: User = {
        id: randomBytes(8).toString('hex'),
        email: email.toLowerCase(),
        name: name.trim(),
        tenant_id,
        password_hash: hashPassword(password, salt),
        salt,
        created_at: new Date(),
        avatar_color,
        roles: ['admin'],
        status: undefined,
        failed_login_attempts: 0,
        locked_until: undefined,
        external_id,
        external_provider,
        email_verified: !EMAIL_VERIFICATION_ENABLED, // Auto-verify if verification disabled
        email_verification_token: undefined,
        email_verification_expires: undefined,
        password_reset_token: undefined,
        password_reset_expires: undefined,
        updated_at: undefined,
        attribution: sanitizeAttribution(attribution),
      }

      // Generate email verification token if enabled
      const verificationToken = EMAIL_VERIFICATION_ENABLED
        ? generateEmailVerificationToken()
        : undefined
      if (verificationToken) {
        user.email_verification_token_hash = hashAuthToken(verificationToken)
        user.email_verification_expires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      }

      await col.insertOne(user)

      // Send only after the account exists — a failed insert must not
      // leave a recipient holding a token that can never verify.
      if (verificationToken) {
        await sendEmailVerificationEmail(user.email, user.name, verificationUrl(verificationToken))
      }

      // Create the tenant record — tenant_id is a slug no live tenant holds
      // (either free outright or minted with a suffix past a 'deleted'
      // tombstone, whose slug stays reserved). The tenants.tenant_id unique
      // index is the last-resort guard against the narrow race of two
      // concurrent signups claiming the same slug at the same instant.
      const billing = createInitialBilling({
        currency: getCurrencyForCountry(country),
        inviteGrantCredits: invite.grant_credits,
      })
      await db.collection('tenants').insertOne({
        tenant_id,
        name: workspace || email.split('@')[0],
        plan: 'free',
        tier_hint: tier_hint ?? 'business',
        quotas: PLAN_QUOTAS['free'],
        billing: {
          ...billing,
          invite_code: invite_code?.trim().toUpperCase() ?? null,
        },
        country: country?.trim().toUpperCase() || 'GB',
        locale: getLocaleForCountry(country),
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
      })

      // PRD-112: silent no-op on an invalid/missing ref — never fails signup.
      await attributeReferral(db, tenant_id, ref)

      // Record trial grant in the append-only credit ledger
      if (billing.credits_balance > 0) {
        await recordLedgerEntry(db, {
          tenantId: tenant_id,
          type: 'trial_grant',
          amount: billing.credits_balance,
          reference: 'signup',
          reason: `Trial credits granted at signup${invite.grant_credits ? ' + invite code bonus' : ''}`,
          actor: 'system',
        }).catch(() => {})
      }

      const token = await auth.sign({ sub: user.id, tenant_id: user.tenant_id, roles: user.roles })
      setSessionCookie(reply, token, 7 * 24 * 60 * 60)

      // New users have no active_vertical yet — null is correct here (they
      // should see onboarding). Include it explicitly so the client's user
      // object shape matches /auth/me and the login response.
      const settings = await db.collection('tenant_settings').findOne({ tenant_id: user.tenant_id })

      return reply.status(201).send({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          tenant_id: user.tenant_id,
          avatar_color: user.avatar_color,
          email_verified: user.email_verified,
          requires_verification: EMAIL_VERIFICATION_ENABLED && !user.email_verified,
          active_vertical: (settings?.['active_vertical'] as string | undefined) ?? null,
          onboarding_skipped: (settings?.['onboarding_skipped'] as boolean | undefined) ?? false,
        },
      })
    },
  )

  /** POST /auth/login — per-route limit on top of the global bucket and the
   *  per-account lockout; credential stuffing is an IP-level problem the
   *  account lock can't see across many accounts. */
  app.post<{ Body: LoginBody }>(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { rememberMe } = request.body
      const email = str(request.body.email, 320)
      const password = str(request.body.password, 1024)

      if (!email || !password)
        return reply.status(400).send({ error: 'Email and password required' })

      const col = await getUsersCollection()
      const emailKey = email.toLowerCase()

      // Throttle by email+IP, with a much higher per-email ceiling for
      // distributed guessing (R42). Unknown emails go through the same
      // counts, so the response never reveals whether an account exists,
      // and one person can no longer lock someone else out from their own IP.
      const since = new Date(Date.now() - LOGIN_THROTTLE_WINDOW_MS)
      const loginEvents = getLoginEventsCollection(await getDb())
      const [ipFailures, emailFailures] = await Promise.all([
        loginEvents.countDocuments({ email: emailKey, ip: request.ip, success: false, created_at: { $gte: since } }),
        loginEvents.countDocuments({ email: emailKey, success: false, created_at: { $gte: since } }),
      ])
      if (ipFailures >= MAX_FAILURES_PER_EMAIL_AND_IP || emailFailures >= MAX_FAILURES_PER_EMAIL) {
        recordLoginEvent(request, { email: emailKey, success: false, reason: 'throttled' })
        return reply.status(429).send({ error: THROTTLED_LOGIN_ERROR })
      }

      const user = await col.findOne({ email: emailKey })

      if (!user || user.status === 'erased' || user.status === 'removed') {
        // Timing-safe: still hash even on miss to prevent user enumeration.
        // Erased accounts and members removed from their household read the same.
        scryptSync(password, randomBytes(16).toString('hex'), 32)
        recordLoginEvent(request, {
          email: emailKey,
          success: false,
          reason: user ? (user.status ?? 'inactive') : 'unknown_email',
          ...(user ? { user_id: user.id, tenant_id: user.tenant_id } : {}),
        })
        return reply.status(401).send({ error: GENERIC_LOGIN_ERROR })
      }

      if (!passwordMatches(user, password)) {
        recordLoginEvent(request, {
          email: emailKey,
          success: false,
          reason: 'bad_password',
          user_id: user.id,
          tenant_id: user.tenant_id,
        })
        return reply.status(401).send({ error: GENERIC_LOGIN_ERROR })
      }

      // Suspension is only revealed to someone who knows the password.
      if (user.status === 'suspended') {
        recordLoginEvent(request, {
          email: emailKey,
          success: false,
          reason: 'suspended',
          user_id: user.id,
          tenant_id: user.tenant_id,
        })
        return reply.status(403).send({ error: 'User suspended' })
      }

      recordLoginEvent(request, {
        email: emailKey,
        success: true,
        user_id: user.id,
        tenant_id: user.tenant_id,
      })

      // MFA gate: the password was correct, but the session token isn't
      // issued until the TOTP/recovery code verifies at /auth/mfa/verify.
      // The pending token carries mfa_pending — the auth middleware rejects
      // it everywhere else, so it can't be replayed as a session.
      if (user.mfa_enabled) {
        const mfaToken = await auth.sign(
          {
            sub: user.id,
            tenant_id: user.tenant_id,
            roles: user.roles ?? ['viewer'],
            mfa_pending: true,
          },
          '5m',
        )
        return reply.send({ mfa_required: true, mfa_token: mfaToken })
      }

      // "Remember me" controls actual session length, not just UI copy: checked
      // keeps the token's own literal promise (30 days), unchecked falls back
      // to the shorter default so a shared/public device doesn't stay signed
      // in for a month by default.
      const token = await auth.sign(
        { sub: user.id, tenant_id: user.tenant_id, roles: user.roles ?? ['viewer'] },
        rememberMe ? '30d' : '7d',
      )
      setSessionCookie(reply, token, rememberMe ? 30 * 24 * 60 * 60 : 7 * 24 * 60 * 60)

      // Include active_vertical so the client can decide whether to redirect
      // to onboarding without waiting for /auth/me. Without this, the login
      // response has active_vertical: undefined, the AuthContext redirect
      // effect fires before /auth/me resolves, and the user sees the
      // "Welcome to LifeKeel" onboarding screen on every login.
      const db = await getDb()
      const settings = await db.collection('tenant_settings').findOne({ tenant_id: user.tenant_id })

      return reply.send({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          tenant_id: user.tenant_id,
          avatar_color: user.avatar_color,
          email_verified: user.email_verified,
          active_vertical: (settings?.['active_vertical'] as string | undefined) ?? null,
          onboarding_skipped: (settings?.['onboarding_skipped'] as boolean | undefined) ?? false,
        },
      })
    },
  )

  /** GET /auth/me — return current user from JWT */
  app.get('/auth/me', async (request, reply) => {
    const { tenant_id, user_id } = request.authContext
    const col = await getUsersCollection()
    const user = await col.findOne({ id: user_id })

    // Get tenant tier_hint
    const db = await getDb()
    const tenant = await db.collection('tenants').findOne({ tenant_id })
    const settings = await db.collection('tenant_settings').findOne({ tenant_id })

    return reply.send({
      user_id,
      tenant_id,
      ...(user
        ? {
            name: user.name,
            email: user.email,
            avatar_color: user.avatar_color,
            email_verified: user.email_verified,
            external_provider: user.external_provider,
          }
        : {}),
      tier_hint: tenant?.['tier_hint'] ?? 'business',
      active_vertical: (settings?.['active_vertical'] as string | undefined) ?? null,
      onboarding_skipped: (settings?.['onboarding_skipped'] as boolean | undefined) ?? false,
      country: (tenant?.['country'] as string | undefined) ?? 'GB',
      locale: (tenant?.['locale'] as string | undefined) ?? getLocaleForCountry('GB'),
      currency:
        (tenant?.['billing']?.['currency'] as string | undefined) ?? getCurrencyForCountry('GB'),
    })
  })

  /** POST /auth/verify-email — verify email with token */
  app.post<{ Body: { token?: unknown } }>('/auth/verify-email', async (request, reply) => {
    const token = str(request.body?.token, 256)

    if (!token) return reply.status(400).send({ error: 'Verification token required' })

    // Hash lookup, mandatory expiry and consumption in one atomic step (R01, R39).
    const col = await getUsersCollection()
    const user = await col.findOneAndUpdate(
      {
        email_verification_token_hash: hashAuthToken(token),
        email_verification_expires: { $gt: new Date() },
      },
      {
        $set: { email_verified: true },
        $unset: {
          email_verification_token_hash: '',
          email_verification_token: '',
          email_verification_expires: '',
        },
      },
    )

    if (!user) return reply.status(400).send({ error: 'Invalid or expired verification token' })

    return reply.send({ verified: true })
  })

  /** POST /auth/resend-verification — resend verification email (public endpoint) */
  app.post<{ Body: { email?: unknown } }>(
    '/auth/resend-verification',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const col = await getUsersCollection()

      const issue = async (user: User): Promise<void> => {
        const newToken = generateEmailVerificationToken()
        await col.updateOne(
          { id: user.id },
          {
            $set: {
              email_verification_token_hash: hashAuthToken(newToken),
              email_verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            $unset: { email_verification_token: '' },
          },
        )
        await sendEmailVerificationEmail(user.email, user.name, verificationUrl(newToken))
      }

      // If authenticated, use user_id from context
      if (request.authContext) {
        const user = await col.findOne({ id: request.authContext.user_id })
        if (!user) return reply.status(404).send({ error: 'User not found' })
        if (user.email_verified) return reply.status(400).send({ error: 'Email already verified' })
        await issue(user)
        return reply.send({ sent: true })
      }

      // Unauthenticated: the same answer whether or not the address has an
      // account, or is already verified (R42).
      const email = str(request.body?.email, 320)
      if (!email?.includes('@')) {
        return reply.status(400).send({ error: 'Valid email required' })
      }
      const user = await col.findOne({ email: email.toLowerCase() })
      if (user && !user.email_verified && user.status !== 'erased') await issue(user)
      return reply.send({ sent: true })
    },
  )

  /** PUT /auth/profile — update user profile */
  app.put<{ Body: UpdateProfileBody }>('/auth/profile', async (request, reply) => {
    const { user_id, tenant_id } = request.authContext
    const { name, email, avatar_color } = request.body

    const col = await getUsersCollection()
    const user = await col.findOne({ id: user_id, tenant_id })

    if (!user) return reply.status(404).send({ error: 'User not found' })

    const updateData: Partial<User> = {}
    if (name !== undefined) {
      const nameError = displayNameError(name)
      if (nameError) return reply.status(400).send({ error: nameError })
      updateData.name = name.trim()
    }
    if (avatar_color) {
      if (!str(avatar_color, 16) || !AVATAR_COLORS.includes(avatar_color))
        return reply.status(400).send({ error: 'Invalid avatar colour' })
      updateData.avatar_color = avatar_color
    }

    let newVerificationToken: string | undefined
    if (email && email !== user.email) {
      if (!str(email, 320) || !EMAIL_FORMAT_RE.test(email.trim()))
        return reply.status(400).send({ error: 'Valid email required' })

      // Emails are globally unique (see the unique index above), so check
      // every tenant, not just this one.
      const existing = await col.findOne({ email: email.toLowerCase() })
      if (existing) return reply.status(409).send({ error: 'Email already in use' })

      updateData.email = email.toLowerCase()
      updateData.email_verified = false // Require re-verification on email change

      // Generate new verification token
      if (EMAIL_VERIFICATION_ENABLED) {
        newVerificationToken = generateEmailVerificationToken()
        updateData.email_verification_token_hash = hashAuthToken(newVerificationToken)
        updateData.email_verification_expires = new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    }

    if (Object.keys(updateData).length === 0) {
      return reply.status(400).send({ error: 'No fields to update' })
    }

    await col.updateOne({ id: user_id, tenant_id }, { $set: updateData })

    // New address must prove ownership — the link goes to the new inbox,
    // never the old one. Send only after the update lands so a failure
    // can't strand a token.
    if (updateData.email && newVerificationToken) {
      const displayName = updateData.name ?? user.name
      await sendEmailVerificationEmail(
        updateData.email,
        displayName,
        verificationUrl(newVerificationToken),
      )
    }

    const updatedUser = await col.findOne({ id: user_id, tenant_id })

    return reply.send({
      user: {
        id: updatedUser!.id,
        email: updatedUser!.email,
        name: updatedUser!.name,
        tenant_id: updatedUser!.tenant_id,
        avatar_color: updatedUser!.avatar_color,
        email_verified: updatedUser!.email_verified,
      },
    })
  })

  /** POST /auth/change-password — change user password */
  app.post<{ Body: ChangePasswordBody }>(
    '/auth/change-password',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { user_id, tenant_id } = request.authContext
      const current_password = str(request.body?.current_password, 1024)
      const new_password = str(request.body?.new_password, 1024)

      if (!current_password || !new_password) {
        return reply.status(400).send({ error: 'Current and new password required' })
      }

      if (new_password.length < 8) {
        return reply.status(400).send({ error: 'New password must be at least 8 characters' })
      }

      const col = await getUsersCollection()
      const user = await col.findOne({ id: user_id, tenant_id })

      if (!user) return reply.status(404).send({ error: 'User not found' })

      if (!passwordMatches(user, current_password)) {
        return reply.status(401).send({ error: 'Current password is incorrect' })
      }

      const newSalt = randomBytes(16).toString('hex')

      // Every other session ends (R06); this one continues on a fresh token.
      await col.updateOne(
        { id: user_id, tenant_id },
        {
          $set: {
            password_hash: hashPassword(new_password, newSalt),
            salt: newSalt,
            updated_at: new Date(),
            sessions_revoked_at: sessionsRevokedAt(true),
          },
        },
      )
      const token = await auth.sign({
        sub: user.id,
        tenant_id: user.tenant_id,
        roles: user.roles ?? ['viewer'],
      })
      setSessionCookie(reply, token, 7 * 24 * 60 * 60)

      return reply.send({ success: true, token })
    },
  )

  /** POST /auth/request-password-reset — request password reset (public endpoint) */
  app.post<{ Body: RequestResetBody }>(
    '/auth/request-password-reset',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
    const { app: originApp } = request.body
    const email = str(request.body.email, 320)

    if (!email?.includes('@')) {
      return reply.status(400).send({ error: 'Valid email required' })
    }

    const col = await getUsersCollection()
    const user = await col.findOne({ email: email.toLowerCase() })

    // Always return success to prevent email enumeration
    // Only send email if user exists
    if (user && user.status !== 'erased') {
      const resetToken = generateEmailVerificationToken()
      const expires = new Date(Date.now() + 1 * 60 * 60 * 1000) // 1 hour expiry

      await col.updateOne(
        { id: user.id },
        {
          $set: {
            password_reset_token_hash: hashAuthToken(resetToken),
            password_reset_expires: expires,
          },
          $unset: { password_reset_token: '' },
        },
      )

      // Only apps with a page that actually consumes this token get a real
      // email — family (apps/family/src/app/reset-password/confirm) and now
      // lifekeel (apps/lifekeel/src/app/reset-password/confirm). Studio's
      // /reset-password is request-only with no completion step, so sending
      // a Studio link here would just be a dead end. Skip sending (keeping
      // prior behavior) until Studio has a matching confirm page.
      if (originApp === 'family') {
        const appUrl = (process.env['LIFEKEEL_URL'] ?? 'http://localhost:3002').replace(/\/$/, '')
        const resetUrl = `${appUrl}/reset-password/confirm#token=${resetToken}`
        await sendPasswordResetEmail(user.email, user.name, resetUrl)
      } else if (originApp === 'lifekeel') {
        const appUrl = (process.env['LIFEKEEL_URL'] ?? 'http://localhost:3003').replace(/\/$/, '')
        const resetUrl = `${appUrl}/reset-password/confirm#token=${resetToken}`
        await sendPasswordResetEmail(user.email, user.name, resetUrl)
      }
    }

    return reply.send({ sent: true })
    },
  )

  /** POST /auth/reset-password — reset password with token (public endpoint) */
  app.post<{ Body: ResetPasswordBody }>(
    '/auth/reset-password',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const token = str(request.body?.token, 256)
      const new_password = str(request.body?.new_password, 1024)

      if (!token || !new_password) {
        return reply.status(400).send({ error: 'Token and new password required' })
      }

      if (new_password.length < 8) {
        return reply.status(400).send({ error: 'Password must be at least 8 characters' })
      }

      const newSalt = randomBytes(16).toString('hex')

      // One atomic step: match the token's hash with an unexpired deadline,
      // set the password, consume the token and end every existing session
      // (R01, R06, R39). A second use of the same link matches nothing.
      const col = await getUsersCollection()
      const user = await col.findOneAndUpdate(
        {
          password_reset_token_hash: hashAuthToken(token),
          password_reset_expires: { $gt: new Date() },
          status: { $ne: 'erased' },
        },
        {
          $set: {
            password_hash: hashPassword(new_password, newSalt),
            salt: newSalt,
            updated_at: new Date(),
            sessions_revoked_at: sessionsRevokedAt(false),
          },
          $unset: {
            password_reset_token_hash: '',
            password_reset_token: '',
            password_reset_expires: '',
            failed_login_attempts: '',
            locked_until: '',
          },
        },
      )

      if (!user) {
        return reply.status(400).send({ error: 'Invalid or expired reset token' })
      }

      return reply.send({ success: true })
    },
  )

  // ─── TOTP MFA (RFC 6238) ────────────────────────────────────────────────
  // Enroll: setup (issues pending secret) → enable (first code proves the
  //   device scanned it → recovery codes shown once, stored as hashes).
  // Login: /auth/login returns { mfa_required, mfa_token } when enabled;
  //   /auth/mfa/verify exchanges it for the real session. The pending
  //   token's mfa_pending claim is rejected by the auth middleware for
  //   every other route, so it can't be replayed as a session.

  /** GET /auth/mfa/status — settings UI reads whether MFA is on. */
  app.get('/auth/mfa/status', async (request, reply) => {
    const { user_id } = request.authContext
    const col = await getUsersCollection()
    const user = await col.findOne(
      { id: user_id },
      { projection: { mfa_enabled: 1, mfa_recovery_hashes: 1 } },
    )
    return reply.send({
      enabled: user?.mfa_enabled === true,
      recovery_codes_remaining: user?.mfa_recovery_hashes?.length ?? 0,
    })
  })

  /**
   * Accepts a code for `secret` only if its time step is newer than the
   * last accepted one, recorded atomically so two requests can't both
   * spend the same code (R40).
   */
  const consumeTotp = async (user: User, secret: string, code: unknown): Promise<boolean> => {
    const step = matchTotpStep(secret, code)
    if (step === null) return false
    const col = await getUsersCollection()
    const res = await col.updateOne(
      {
        id: user.id,
        $or: [{ mfa_last_step: { $exists: false } }, { mfa_last_step: { $lt: step } }],
      },
      { $set: { mfa_last_step: step } },
    )
    return res.modifiedCount === 1
  }

  /** Single-use recovery code, consumed atomically. */
  const consumeRecoveryCode = async (user: User, code: unknown): Promise<boolean> => {
    const value = str(code, 64)
    if (!value) return false
    const col = await getUsersCollection()
    const hash = hashRecoveryCode(value)
    const res = await col.updateOne(
      { id: user.id, mfa_recovery_hashes: hash },
      { $pull: { mfa_recovery_hashes: hash } },
    )
    return res.modifiedCount === 1
  }

  /** POST /auth/mfa/setup — issue a pending secret + otpauth:// URI for QR/manual entry.
   *  Needs the password, and the current factor when one is already on, so
   *  a stolen session can neither enrol nor swap in its own authenticator (R02). */
  app.post<{ Body: { password?: unknown; code?: unknown } }>(
    '/auth/mfa/setup',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { user_id } = request.authContext
      const col = await getUsersCollection()
      const user = await col.findOne({ id: user_id })
      if (!user) return reply.status(404).send({ error: 'User not found' })
      const password = str(request.body?.password, 1024)
      if (!password || !passwordMatches(user, password)) {
        return reply.status(401).send({ error: 'Password required to change two-factor settings' })
      }
      if (user.mfa_enabled) {
        const current = await decryptEnveloped(await getDb(), user.mfa_secret)
        const ok =
          (current && (await consumeTotp(user, current, request.body?.code))) ||
          (await consumeRecoveryCode(user, request.body?.code))
        if (!ok) {
          return reply
            .status(401)
            .send({ error: 'Enter a code from your current authenticator to replace it' })
        }
      }
      const secret = generateTotpSecret()
      const db = await getDb()
      await col.updateOne(
        { id: user_id },
        { $set: { mfa_pending_secret: await encryptForTenant(db, user.tenant_id, secret) } },
      )
      return reply.send({ secret, otpauth_url: otpauthUrl(secret, user.email) })
    },
  )

  /** POST /auth/mfa/enable — first valid code confirms enrollment; returns
   *  the one-time recovery codes (hashes only are stored). Replacing an
   *  existing factor ends every other session (R02). */
  app.post<{ Body: { code?: unknown } }>(
    '/auth/mfa/enable',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { user_id } = request.authContext
      const code = request.body?.code
      if (!code) return reply.status(400).send({ error: 'Code required' })
      const col = await getUsersCollection()
      const user = await col.findOne({ id: user_id })
      if (!user?.mfa_pending_secret) return reply.status(400).send({ error: 'Run setup first' })
      const pending = await decryptEnveloped(await getDb(), user.mfa_pending_secret)
      const step = pending ? matchTotpStep(pending, code) : null
      if (step === null) {
        return reply
          .status(400)
          .send({ error: 'That code did not match — check your authenticator app and try again' })
      }
      const replacing = user.mfa_enabled === true
      const { codes, hashes } = generateRecoveryCodes()
      await col.updateOne(
        { id: user_id },
        {
          $set: {
            mfa_enabled: true,
            mfa_secret: user.mfa_pending_secret,
            mfa_recovery_hashes: hashes,
            mfa_last_step: step,
            mfa_failed_attempts: 0,
            ...(replacing ? { sessions_revoked_at: sessionsRevokedAt(true) } : {}),
          },
          $unset: { mfa_pending_secret: '', mfa_locked_until: '' },
        },
      )
      if (!replacing) return reply.send({ recovery_codes: codes })
      const token = await auth.sign({
        sub: user.id,
        tenant_id: user.tenant_id,
        roles: user.roles ?? ['viewer'],
      })
      setSessionCookie(reply, token, 7 * 24 * 60 * 60)
      return reply.send({ recovery_codes: codes, token })
    },
  )

  /** POST /auth/mfa/disable — requires the account password, so a stolen
   *  session alone can't quietly strip the second factor. */
  app.post<{ Body: { password?: unknown } }>(
    '/auth/mfa/disable',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { user_id } = request.authContext
      const password = str(request.body?.password, 1024)
      if (!password) return reply.status(400).send({ error: 'Password required' })
      const col = await getUsersCollection()
      const user = await col.findOne({ id: user_id })
      if (!user) return reply.status(404).send({ error: 'User not found' })
      if (!passwordMatches(user, password)) {
        return reply.status(401).send({ error: 'Incorrect password' })
      }
      await col.updateOne(
        { id: user_id },
        {
          $set: { mfa_enabled: false },
          $unset: {
            mfa_secret: '',
            mfa_pending_secret: '',
            mfa_recovery_hashes: '',
            mfa_last_step: '',
            mfa_failed_attempts: '',
            mfa_locked_until: '',
          },
        },
      )
      return reply.send({ ok: true })
    },
  )

  /** POST /auth/mfa/verify — second step of login. Accepts a TOTP code or a
   *  recovery code (single-use: its hash is consumed on success). Issues the
   *  real session token + httpOnly cookie on success. Five wrong codes lock
   *  the second step for 15 minutes, whatever IP they come from (R40). */
  app.post<{ Body: { mfa_token?: unknown; code?: unknown } }>(
    '/auth/mfa/verify',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const mfa_token = str(request.body?.mfa_token, 4096)
      const code = str(request.body?.code, 64)
      if (!mfa_token || !code)
        return reply.status(400).send({ error: 'mfa_token and code required' })

      let pending
      try {
        pending = await auth.verify(mfa_token)
      } catch {
        return reply.status(401).send({ error: 'MFA session expired — sign in again' })
      }
      if (!pending.mfa_pending) return reply.status(401).send({ error: 'Invalid MFA token' })

      const col = await getUsersCollection()
      const user = await col.findOne({ id: pending.user_id, tenant_id: pending.tenant_id })
      if (!user?.mfa_enabled || !user.mfa_secret) {
        return reply.status(400).send({ error: 'MFA is not enabled for this account' })
      }
      if (user.mfa_locked_until && user.mfa_locked_until > new Date()) {
        return reply
          .status(429)
          .send({ error: 'Too many incorrect codes. Sign in again in 15 minutes.' })
      }

      const secret = await decryptEnveloped(await getDb(), user.mfa_secret)
      const ok =
        (secret !== undefined && (await consumeTotp(user, secret, code))) ||
        (await consumeRecoveryCode(user, code))
      if (!ok) {
        recordLoginEvent(request, {
          email: user.email,
          success: false,
          reason: 'mfa_bad_code',
          user_id: user.id,
          tenant_id: user.tenant_id,
        })
        const after = await col.findOneAndUpdate(
          { id: user.id },
          { $inc: { mfa_failed_attempts: 1 } },
          { returnDocument: 'after' },
        )
        if ((after?.mfa_failed_attempts ?? 0) >= MFA_MAX_FAILURES) {
          await col.updateOne(
            { id: user.id },
            {
              $set: { mfa_locked_until: new Date(Date.now() + MFA_LOCK_MS), mfa_failed_attempts: 0 },
            },
          )
          return reply
            .status(429)
            .send({ error: 'Too many incorrect codes. Sign in again in 15 minutes.' })
        }
        return reply
          .status(401)
          .send({ error: 'Incorrect code — try again or use a recovery code' })
      }
      // Rows enrolled before secrets were encrypted get encrypted on first use.
      const encryptedSecret =
        secret && !user.mfa_secret.startsWith('dek:')
          ? { mfa_secret: await encryptForTenant(await getDb(), user.tenant_id, secret) }
          : {}
      await col.updateOne({ id: user.id }, { $set: { mfa_failed_attempts: 0, ...encryptedSecret } })
      recordLoginEvent(request, {
        email: user.email,
        success: true,
        reason: 'mfa_verified',
        user_id: user.id,
        tenant_id: user.tenant_id,
      })

      const token = await auth.sign(
        { sub: user.id, tenant_id: user.tenant_id, roles: user.roles ?? ['viewer'] },
        '7d',
      )
      setSessionCookie(reply, token, 7 * 24 * 60 * 60)

      const db = await getDb()
      const settings = await db.collection('tenant_settings').findOne({ tenant_id: user.tenant_id })
      return reply.send({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          tenant_id: user.tenant_id,
          avatar_color: user.avatar_color,
          email_verified: user.email_verified,
          active_vertical: (settings?.['active_vertical'] as string | undefined) ?? null,
          onboarding_skipped: (settings?.['onboarding_skipped'] as boolean | undefined) ?? false,
        },
      })
    },
  )
}
