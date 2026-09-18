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

import type { FastifyInstance } from 'fastify'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { AuthService, getCurrencyForCountry, getLocaleForCountry } from '@agentoak/platform'
import { getDb } from '../db.js'
import { checkInviteCode, consumeInviteCode } from '../invite-codes.js'
import { PLAN_QUOTAS, createInitialBilling } from '../billing/billing-constants.js'
import { sendPasswordResetEmail } from '../auth-email.js'
import { recordLedgerEntry } from '../billing/credit-ledger.js'

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
  status: 'active' | 'suspended' | undefined
  failed_login_attempts: number | undefined
  locked_until: Date | undefined
  external_id: string | undefined
  external_provider: 'oidc' | 'saml' | undefined
  email_verified: boolean | undefined
  email_verification_token: string | undefined
  email_verification_expires: Date | undefined
  password_reset_token: string | undefined
  password_reset_expires: Date | undefined
  updated_at: Date | undefined
}

interface SignupBody { email: string; password: string; name: string; workspace: string; external_id?: string; external_provider?: 'oidc' | 'saml'; tier_hint?: 'developer' | 'team' | 'business' | 'enterprise'; invite_code?: string; country?: string }
interface LoginBody  { email: string; password: string; rememberMe?: boolean }
interface UpdateProfileBody { name?: string; email?: string; avatar_color?: string }
interface ChangePasswordBody { current_password: string; new_password: string }
interface RequestResetBody { email: string; app?: 'family' | 'studio' | 'kairos' }
interface ResetPasswordBody { token: string; new_password: string }

export const AVATAR_COLORS = ['#f59e0b','#10b981','#3b82f6','#8b5cf6','#ef4444','#06b6d4','#f97316']

// Security configuration
const MAX_FAILED_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes
const EMAIL_VERIFICATION_ENABLED = process.env['EMAIL_VERIFICATION_ENABLED'] === 'true'

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace'
}

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex')
}

function generateEmailVerificationToken(): string {
  return randomBytes(32).toString('hex')
}

export async function getUsersCollection() {
  const db = await getDb()
  const col = db.collection<User>('users')
  await col.createIndex({ email: 1 }, { unique: true })
  await col.createIndex({ external_id: 1, external_provider: 1 }, { sparse: true })
  await col.createIndex({ email_verification_token: 1 }, { sparse: true, expireAfterSeconds: 86400 }) // 24h TTL
  return col
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
    // OAK-025: the 409 on an existing email is a genuine UX need (a user
    // needs to know why signup failed) — making it generic would break
    // that without meaningfully stopping a determined attacker. This
    // route-level limit raises the cost of a bulk enumeration sweep
    // without changing the honest per-request error message.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { email, password, name, workspace, external_id, external_provider, tier_hint, invite_code, country } = request.body

      if (!email || !EMAIL_FORMAT_RE.test(email.trim())) return reply.status(400).send({ error: 'Valid email required' })
      if (!password || password.length < 8) return reply.status(400).send({ error: 'Password must be at least 8 characters' })
      if (!name?.trim()) return reply.status(400).send({ error: 'Name required' })

      const db = await getDb()

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
        if (existingByExternal) return reply.status(409).send({ error: 'External ID already registered' })
      }

      // Security: the workspace slug is a shared, guessable identifier (e.g.
      // "acme-corp") — nothing about self-serve signup implies authorization to
      // join a workspace someone else already created. There is no invite
      // mechanism scoped to a specific tenant (checkInviteCode/consumeInviteCode
      // above are platform-wide, gating signup at all, not which tenant you
      // land in) and no admin-approval step, so an unclaimed collision must be
      // rejected outright rather than silently admitting a second, unrelated
      // admin into an existing tenant.
      const tenant_id = workspace ? slugify(workspace) : slugify(email.split('@')[0]!)
      const existingTenant = await db.collection('tenants').findOne({ tenant_id })
      if (existingTenant) {
        return reply.status(409).send({ error: 'That workspace name is already taken. Choose another.' })
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
      }

      // Generate email verification token if enabled
      if (EMAIL_VERIFICATION_ENABLED) {
        user.email_verification_token = generateEmailVerificationToken()
        user.email_verification_expires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
        // TODO: Send verification email here
      }

      await col.insertOne(user)

      // Create the tenant record — existingTenant was already confirmed null
      // above, so this always creates a fresh tenant here (the tenants.tenant_id
      // unique index is the last-resort guard against the narrow race of two
      // concurrent signups claiming the same slug at the same instant).
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

  /** POST /auth/login */
  app.post<{ Body: LoginBody }>('/auth/login', async (request, reply) => {
    const { email, password, rememberMe } = request.body

    if (!email || !password) return reply.status(400).send({ error: 'Email and password required' })

    const col = await getUsersCollection()
    const user = await col.findOne({ email: email.toLowerCase() })

    if (!user) {
      // Timing-safe: still hash even on miss to prevent user enumeration
      scryptSync(password, randomBytes(16).toString('hex'), 32)
      return reply.status(401).send({ error: 'Invalid email or password' })
    }
    if (user.status === 'suspended') return reply.status(403).send({ error: 'User suspended' })

    // Check if account is locked
    if (user.locked_until && user.locked_until > new Date()) {
      const remainingMinutes = Math.ceil((user.locked_until.getTime() - Date.now()) / 60000)
      return reply.status(429).send({ 
        error: 'Account locked due to too many failed login attempts',
        retry_after_minutes: remainingMinutes
      })
    }

    const expected = Buffer.from(hashPassword(password, user.salt), 'hex')
    const actual   = Buffer.from(user.password_hash, 'hex')

    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      // Increment failed login attempts
      const failedAttempts = (user.failed_login_attempts || 0) + 1
      const updateData: Partial<User> = { failed_login_attempts: failedAttempts }

      // Lock account if max attempts reached
      if (failedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        updateData.locked_until = new Date(Date.now() + LOCKOUT_DURATION_MS)
      }

      await col.updateOne({ email: email.toLowerCase() }, { $set: updateData })

      if (failedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        return reply.status(429).send({ 
          error: 'Account locked due to too many failed login attempts',
          retry_after_minutes: LOCKOUT_DURATION_MS / 60000
        })
      }

      return reply.status(401).send({ error: 'Invalid email or password' })
    }

    // Reset failed login attempts on successful login
    await col.updateOne({ email: email.toLowerCase() }, { 
      $set: { failed_login_attempts: 0, locked_until: undefined } 
    })

    // "Remember me" controls actual session length, not just UI copy: checked
    // keeps the token's own literal promise (30 days), unchecked falls back
    // to the shorter default so a shared/public device doesn't stay signed
    // in for a month by default.
    const token = await auth.sign({ sub: user.id, tenant_id: user.tenant_id, roles: user.roles ?? ['viewer'] }, rememberMe ? '30d' : '7d')

    // Include active_vertical so the client can decide whether to redirect
    // to onboarding without waiting for /auth/me. Without this, the login
    // response has active_vertical: undefined, the AuthContext redirect
    // effect fires before /auth/me resolves, and the user sees the
    // "Welcome to Kairos" onboarding screen on every login.
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
  })

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
      ...(user ? {
        name: user.name,
        email: user.email,
        avatar_color: user.avatar_color,
        email_verified: user.email_verified,
        external_provider: user.external_provider
      } : {}),
      tier_hint: tenant?.['tier_hint'] ?? 'business',
      active_vertical: (settings?.['active_vertical'] as string | undefined) ?? null,
      onboarding_skipped: (settings?.['onboarding_skipped'] as boolean | undefined) ?? false,
      country: (tenant?.['country'] as string | undefined) ?? 'GB',
      locale: (tenant?.['locale'] as string | undefined) ?? getLocaleForCountry('GB'),
      currency: (tenant?.['billing']?.['currency'] as string | undefined) ?? getCurrencyForCountry('GB'),
    })
  })

  /** POST /auth/verify-email — verify email with token */
  app.post<{ Body: { token: string } }>('/auth/verify-email', async (request, reply) => {
    const { token } = request.body

    if (!token) return reply.status(400).send({ error: 'Verification token required' })

    const col = await getUsersCollection()
    const user = await col.findOne({ email_verification_token: token })

    if (!user) return reply.status(400).send({ error: 'Invalid or expired verification token' })

    if (user.email_verification_expires && user.email_verification_expires < new Date()) {
      return reply.status(400).send({ error: 'Verification token expired' })
    }

    await col.updateOne(
      { email_verification_token: token },
      { 
        $set: { 
          email_verified: true,
          email_verification_token: undefined,
          email_verification_expires: undefined
        } 
      }
    )

    return reply.send({ verified: true })
  })

  /** POST /auth/resend-verification — resend verification email (public endpoint) */
  app.post<{ Body: { email?: string } }>('/auth/resend-verification', async (request, reply) => {
    const { email } = request.body
    const col = await getUsersCollection()

    // If authenticated, use user_id from context
    if (request.authContext) {
      const { user_id } = request.authContext
      const user = await col.findOne({ id: user_id })

      if (!user) return reply.status(404).send({ error: 'User not found' })

      if (user.email_verified) return reply.status(400).send({ error: 'Email already verified' })

      const newToken = generateEmailVerificationToken()
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000)

      await col.updateOne(
        { id: user_id },
        {
          $set: {
            email_verification_token: newToken,
            email_verification_expires: expires
          }
        }
      )

      // TODO: Send verification email here

      return reply.send({ sent: true })
    }

    // If not authenticated, require email in body
    if (!email?.includes('@')) {
      return reply.status(400).send({ error: 'Valid email required' })
    }

    const user = await col.findOne({ email: email.toLowerCase() })

    if (!user) {
      // Return success to prevent email enumeration
      return reply.send({ sent: true })
    }

    if (user.email_verified) return reply.status(400).send({ error: 'Email already verified' })

    const newToken = generateEmailVerificationToken()
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000)

    await col.updateOne(
      { email: email.toLowerCase() },
      {
        $set: {
          email_verification_token: newToken,
          email_verification_expires: expires
        }
      }
    )

    // TODO: Send verification email here

    return reply.send({ sent: true })
  })

  /** PUT /auth/profile — update user profile */
  app.put<{ Body: UpdateProfileBody }>('/auth/profile', async (request, reply) => {
    const { user_id, tenant_id } = request.authContext
    const { name, email, avatar_color } = request.body

    const col = await getUsersCollection()
    const user = await col.findOne({ id: user_id, tenant_id })

    if (!user) return reply.status(404).send({ error: 'User not found' })

    const updateData: Partial<User> = {}
    if (name) updateData.name = name.trim()
    if (avatar_color) updateData.avatar_color = avatar_color
    
    if (email && email !== user.email) {
      if (!EMAIL_FORMAT_RE.test(email.trim())) return reply.status(400).send({ error: 'Valid email required' })

      // Check if new email is already taken
      const existing = await col.findOne({ email: email.toLowerCase(), tenant_id })
      if (existing) return reply.status(409).send({ error: 'Email already in use' })
      
      updateData.email = email.toLowerCase()
      updateData.email_verified = false // Require re-verification on email change
      
      // Generate new verification token
      if (EMAIL_VERIFICATION_ENABLED) {
        updateData.email_verification_token = generateEmailVerificationToken()
        updateData.email_verification_expires = new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    }

    if (Object.keys(updateData).length === 0) {
      return reply.status(400).send({ error: 'No fields to update' })
    }

    await col.updateOne(
      { id: user_id, tenant_id },
      { $set: updateData }
    )

    const updatedUser = await col.findOne({ id: user_id, tenant_id })
    
    return reply.send({
      user: {
        id: updatedUser!.id,
        email: updatedUser!.email,
        name: updatedUser!.name,
        tenant_id: updatedUser!.tenant_id,
        avatar_color: updatedUser!.avatar_color,
        email_verified: updatedUser!.email_verified,
      }
    })
  })

  /** POST /auth/change-password — change user password */
  app.post<{ Body: ChangePasswordBody }>('/auth/change-password', async (request, reply) => {
    const { user_id, tenant_id } = request.authContext
    const { current_password, new_password } = request.body

    if (!current_password || !new_password) {
      return reply.status(400).send({ error: 'Current and new password required' })
    }

    if (new_password.length < 8) {
      return reply.status(400).send({ error: 'New password must be at least 8 characters' })
    }

    const col = await getUsersCollection()
    const user = await col.findOne({ id: user_id, tenant_id })

    if (!user) return reply.status(404).send({ error: 'User not found' })

    // Verify current password
    const expected = Buffer.from(hashPassword(current_password, user.salt), 'hex')
    const actual = Buffer.from(user.password_hash, 'hex')

    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return reply.status(401).send({ error: 'Current password is incorrect' })
    }

    // Generate new salt and hash
    const newSalt = randomBytes(16).toString('hex')
    const newPasswordHash = hashPassword(new_password, newSalt)

    await col.updateOne(
      { id: user_id, tenant_id },
      { 
        $set: { 
          password_hash: newPasswordHash,
          salt: newSalt,
          updated_at: new Date()
        } 
      }
    )

    return reply.send({ success: true })
  })

  /** POST /auth/request-password-reset — request password reset (public endpoint) */
  app.post<{ Body: RequestResetBody }>('/auth/request-password-reset', async (request, reply) => {
    const { email, app: originApp } = request.body

    if (!email?.includes('@')) {
      return reply.status(400).send({ error: 'Valid email required' })
    }

    const col = await getUsersCollection()
    const user = await col.findOne({ email: email.toLowerCase() })

    // Always return success to prevent email enumeration
    // Only send email if user exists
    if (user) {
      const resetToken = generateEmailVerificationToken()
      const expires = new Date(Date.now() + 1 * 60 * 60 * 1000) // 1 hour expiry

      await col.updateOne(
        { email: email.toLowerCase() },
        {
          $set: {
            password_reset_token: resetToken,
            password_reset_expires: expires
          }
        }
      )

      // Only apps with a page that actually consumes this token get a real
      // email — family (apps/family/src/app/reset-password/confirm) and now
      // kairos (apps/kairos/src/app/reset-password/confirm). Studio's
      // /reset-password is request-only with no completion step, so sending
      // a Studio link here would just be a dead end. Skip sending (keeping
      // prior behavior) until Studio has a matching confirm page.
      if (originApp === 'family') {
        const appUrl = (process.env['AGENT_OAK_URL'] ?? 'http://localhost:3002').replace(/\/$/, '')
        const resetUrl = `${appUrl}/reset-password/confirm?token=${resetToken}`
        await sendPasswordResetEmail(user.email, user.name, resetUrl)
      } else if (originApp === 'kairos') {
        const appUrl = (process.env['KAIROS_URL'] ?? 'http://localhost:3003').replace(/\/$/, '')
        const resetUrl = `${appUrl}/reset-password/confirm?token=${resetToken}`
        await sendPasswordResetEmail(user.email, user.name, resetUrl)
      }
    }

    return reply.send({ sent: true })
  })

  /** POST /auth/reset-password — reset password with token (public endpoint) */
  app.post<{ Body: ResetPasswordBody }>('/auth/reset-password', async (request, reply) => {
    const { token, new_password } = request.body

    if (!token || !new_password) {
      return reply.status(400).send({ error: 'Token and new password required' })
    }

    if (new_password.length < 8) {
      return reply.status(400).send({ error: 'Password must be at least 8 characters' })
    }

    const col = await getUsersCollection()
    const user = await col.findOne({ password_reset_token: token })

    if (!user) {
      return reply.status(400).send({ error: 'Invalid or expired reset token' })
    }

    if (user.password_reset_expires && user.password_reset_expires < new Date()) {
      return reply.status(400).send({ error: 'Reset token has expired' })
    }

    // Generate new salt and hash
    const newSalt = randomBytes(16).toString('hex')
    const newPasswordHash = hashPassword(new_password, newSalt)

    await col.updateOne(
      { password_reset_token: token },
      { 
        $set: { 
          password_hash: newPasswordHash,
          salt: newSalt,
          password_reset_token: undefined,
          password_reset_expires: undefined,
          failed_login_attempts: 0,
          locked_until: undefined
        } 
      }
    )

    return reply.send({ success: true })
  })
}
