/**
 * Email OTP (CLOUDFLARE_INTEGRATION.md §6, tests §11.2). Real MongoDB
 * (MongoMemoryServer) so the atomic operations are exercised, including
 * parallel requests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { randomBytes } from 'node:crypto'
import { AuthService } from '@lifekeel/platform'

const sent: Array<{ to: string; code: string; purpose: string }> = []
let nextDelivery: 'sent' | 'failed' | 'unknown' = 'sent'
vi.mock('../../auth-email.js', async (orig) => {
  const real = await orig<typeof import('../../auth-email.js')>()
  return {
    ...real,
    sendOtpEmail: vi.fn(async (to: string, _name: string, code: string, purpose: string) => {
      sent.push({ to, code, purpose })
      return nextDelivery
    }),
    sendEmailVerificationEmail: vi.fn(async () => {}),
  }
})

const { registerAuthUserRoutes, hashPassword } = await import('../auth-users.js')
const { registerAuthOtpRoutes } = await import('../auth-otp.js')
const { closeDb, getDb } = await import('../../db.js')
const { ensureOtpIndexes, OTP_MAX_PER_HOUR } = await import('../../auth/otp.js')
const { verifyOtpPending } = await import('../../auth/otp-token.js')
const { generateTotpSecret } = await import('../../auth/totp.js')
const { sweepPendingRegistrations } = await import('../../jobs/pending-registrations.js')

let mongod: MongoMemoryServer
let db: Db
let app: FastifyInstance
const auth = new AuthService('otp-test-secret-0123456789abcdef0123')
const PASSWORD = 'correct-horse-battery'

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  process.env['MONGODB_URL'] = mongod.getUri()
  process.env['MONGODB_DB'] = 'otp-test'
  process.env['AUTH_OTP_MODE'] = 'signup_login'
  process.env['TURNSTILE_MODE'] = 'off'
  app = Fastify()
  await app.register(fastifyCookie)
  await registerAuthUserRoutes(app, auth)
  await registerAuthOtpRoutes(app, auth)
  await app.ready()
  db = await getDb()
  await ensureOtpIndexes(db)
})

afterAll(async () => {
  await app.close()
  await closeDb()
  await mongod.stop()
  for (const k of ['MONGODB_URL', 'MONGODB_DB', 'AUTH_OTP_MODE', 'TURNSTILE_MODE', 'INVITE_CODE_REQUIRED'])
    delete process.env[k]
})

beforeEach(async () => {
  sent.length = 0
  nextDelivery = 'sent'
  for (const c of ['users', 'tenants', 'otp_chains', 'otp_send_windows', 'login_events', 'invite_codes'])
    await db.collection(c).deleteMany({})
})

const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, payload })

let n = 0
async function signup(email = `u${++n}@example.com`, extra: Record<string, unknown> = {}) {
  const res = await post('/auth/signup', {
    email,
    password: PASSWORD,
    name: 'Jo Bloggs',
    // Letters only: digit runs read as a phone number to displayNameError.
    workspace: `ws-${Array.from(randomBytes(8), (b) => String.fromCharCode(97 + (b % 26))).join('')}`,
    ...extra,
  })
  return { res, body: res.json(), email }
}
const lastCode = () => sent[sent.length - 1]!.code
/** Lets the next send through the 60 s cooldown without waiting. */
const skipCooldown = () =>
  db.collection('otp_send_windows').updateMany({ _id: /:cool$/ as never }, { $set: { next_send_at: new Date(0) } })

describe('signup with email OTP', () => {
  it('returns otp_required, no session, a pending user, and emails a code', async () => {
    const { res, body, email } = await signup()
    expect(res.statusCode).toBe(200)
    expect(body.otp_required).toBe(true)
    expect(body.token).toBeUndefined()
    expect(res.headers['set-cookie']).toBeUndefined()
    expect(body.email_hint).toMatch(/^u\*\*\*@example\.com$/)
    expect(body.delivery).toBe('sent')
    const user = await db.collection('users').findOne({ email })
    expect(user?.['registration_status']).toBe('pending')
    expect(user?.['email_verified']).toBe(false)
    expect(sent).toHaveLength(1)
    expect(lastCode()).toMatch(/^\d{6}$/)
    const chain = await db.collection('otp_chains').findOne({})
    expect(chain?.['code_hash']).not.toContain(lastCode())
  })

  it('verifying the code activates the account and issues the session', async () => {
    const { body, email } = await signup()
    const res = await post('/auth/otp/verify', { otp_token: body.otp_token, code: lastCode() })
    expect(res.statusCode).toBe(200)
    expect(res.json().token).toBeTruthy()
    expect(res.json().user.email).toBe(email)
    expect(String(res.headers['set-cookie'])).toContain('lifekeel_session=')
    const user = await db.collection('users').findOne({ email })
    expect(user?.['registration_status']).toBe('active')
    expect(user?.['email_verified']).toBe(true)
    expect(user?.['registration_version']).toBeUndefined()
  })

  it('a consumed code cannot be replayed', async () => {
    const { body } = await signup()
    const code = lastCode()
    expect((await post('/auth/otp/verify', { otp_token: body.otp_token, code })).statusCode).toBe(200)
    const again = await post('/auth/otp/verify', { otp_token: body.otp_token, code })
    expect(again.statusCode).toBe(400)
    expect(again.json().error).toBe('otp_expired')
  })

  it('counts attempts and locks after five wrong codes', async () => {
    const { body } = await signup()
    const wrong = lastCode() === '000000' ? '111111' : '000000'
    const first = await post('/auth/otp/verify', { otp_token: body.otp_token, code: wrong })
    expect(first.json()).toEqual({ error: 'otp_invalid', attempts_left: 4 })
    for (let i = 0; i < 3; i++) await post('/auth/otp/verify', { otp_token: body.otp_token, code: wrong })
    const fifth = await post('/auth/otp/verify', { otp_token: body.otp_token, code: wrong })
    expect(fifth.statusCode).toBe(429)
    const right = await post('/auth/otp/verify', { otp_token: body.otp_token, code: lastCode() })
    expect(right.json().error).toBe('otp_locked')
  })

  it('rejects an expired code', async () => {
    const { body } = await signup()
    await db.collection('otp_chains').updateMany({}, { $set: { code_expires_at: new Date(Date.now() - 1000) } })
    const res = await post('/auth/otp/verify', { otp_token: body.otp_token, code: lastCode() })
    expect(res.json().error).toBe('otp_expired')
  })

  it('rejects non-string codes (no operator injection)', async () => {
    const { body } = await signup()
    const res = await post('/auth/otp/verify', { otp_token: body.otp_token, code: { $ne: null } })
    expect(res.statusCode).toBe(400)
  })

  it('keeps the 409 for a verified account and for a legacy unverified row', async () => {
    await db.collection('users').insertMany([
      { id: 'v1', email: 'verified@example.com', tenant_id: 't-v', email_verified: true },
      { id: 'l1', email: 'legacy@example.com', tenant_id: 't-l', email_verified: false },
    ])
    expect((await signup('verified@example.com')).res.statusCode).toBe(409)
    const legacy = await signup('legacy@example.com')
    expect(legacy.res.statusCode, legacy.res.body).toBe(409)
    expect(sent).toHaveLength(0)
  })

  it('re-signup supersedes the older chain: its code can no longer activate', async () => {
    const first = await signup('re@example.com')
    const firstCode = lastCode()
    await skipCooldown()
    const second = await signup('re@example.com')
    expect(second.res.statusCode).toBe(200)
    const stale = await post('/auth/otp/verify', { otp_token: first.body.otp_token, code: firstCode })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error).toBe('otp_superseded')
    const fresh = await post('/auth/otp/verify', { otp_token: second.body.otp_token, code: lastCode() })
    expect(fresh.statusCode).toBe(200)
    expect(await db.collection('users').countDocuments({ email: 're@example.com' })).toBe(1)
  })

  it('consumes the invite code only when the code verifies', async () => {
    process.env['INVITE_CODE_REQUIRED'] = 'true'
    try {
      await db.collection('invite_codes').insertOne({
        code: 'BETA1',
        grant_credits: 0,
        max_uses: 1,
        used_count: 0,
        active: true,
        created_at: new Date(),
      })
      const { body } = await signup(undefined, { invite_code: 'BETA1' })
      expect((await db.collection('invite_codes').findOne({ code: 'BETA1' }))?.['used_count']).toBe(0)
      await post('/auth/otp/verify', { otp_token: body.otp_token, code: lastCode() })
      expect((await db.collection('invite_codes').findOne({ code: 'BETA1' }))?.['used_count']).toBe(1)
    } finally {
      delete process.env['INVITE_CODE_REQUIRED']
    }
  })
})

describe('resend', () => {
  it('replaces the code inside the same chain; the same token keeps working', async () => {
    const { body } = await signup()
    const old = lastCode()
    await skipCooldown()
    const res = await post('/auth/otp/resend', { otp_token: body.otp_token })
    expect(res.statusCode).toBe(200)
    expect(res.json().otp_token).toBeUndefined()
    expect(res.json().chain_expires_at).toBe(body.chain_expires_at)
    const fresh = lastCode()
    if (fresh !== old) {
      const stale = await post('/auth/otp/verify', { otp_token: body.otp_token, code: old })
      expect(stale.statusCode).toBe(400)
    }
    const ok = await post('/auth/otp/verify', { otp_token: body.otp_token, code: fresh })
    expect(ok.statusCode).toBe(200)
  })

  it('enforces the 60 s cooldown', async () => {
    const { body } = await signup()
    const res = await post('/auth/otp/resend', { otp_token: body.otp_token })
    expect(res.statusCode).toBe(429)
    expect(res.json().error).toBe('otp_cooldown')
    expect(res.json().retry_after_s).toBeGreaterThan(0)
  })

  it('20 parallel resends spend at most the hourly budget', async () => {
    const { body } = await signup()
    await skipCooldown()
    // Remove the cooldown entirely so only the hourly cap applies.
    await db.collection('otp_send_windows').deleteMany({ _id: /:cool$/ as never })
    const results = await Promise.all(
      Array.from({ length: 20 }, async () => {
        await skipCooldown()
        return post('/auth/otp/resend', { otp_token: body.otp_token })
      }),
    )
    const ok = results.filter((r) => r.statusCode === 200).length
    expect(ok).toBeLessThanOrEqual(OTP_MAX_PER_HOUR - 1) // signup already spent one
    expect(sent.length).toBeLessThanOrEqual(OTP_MAX_PER_HOUR)
  })

  it('the budget survives restarting signup', async () => {
    const email = 'budget@example.com'
    for (let i = 0; i < OTP_MAX_PER_HOUR; i++) {
      await skipCooldown()
      expect((await signup(email)).res.statusCode).toBe(200)
    }
    await skipCooldown()
    const over = await signup(email)
    expect(over.res.statusCode).toBe(429)
    expect(over.body.error).toBe('otp_send_limit')
  })

  it('a definite send failure returns 200 delivery:failed and allows an immediate resend', async () => {
    nextDelivery = 'failed'
    const { res, body } = await signup()
    expect(res.statusCode).toBe(200)
    expect(body.delivery).toBe('failed')
    nextDelivery = 'sent'
    const again = await post('/auth/otp/resend', { otp_token: body.otp_token })
    expect(again.statusCode).toBe(200)
    expect(again.json().delivery).toBe('sent')
  })

  it('an expired chain cannot be resent', async () => {
    const { body } = await signup()
    await db.collection('otp_chains').updateMany({}, { $set: { chain_expires_at: new Date(Date.now() - 1) } })
    await skipCooldown()
    const res = await post('/auth/otp/resend', { otp_token: body.otp_token })
    expect(res.json().error).toBe('otp_expired')
  })
})

describe('login with email OTP', () => {
  async function seedUser(extra: Record<string, unknown> = {}) {
    const salt = randomBytes(16).toString('hex')
    const id = randomBytes(6).toString('hex')
    const user = {
      id,
      email: `${id}@example.com`,
      name: 'Pat',
      tenant_id: `t-${id}`,
      roles: ['admin'],
      salt,
      password_hash: hashPassword(PASSWORD, salt),
      email_verified: true,
      created_at: new Date(),
      ...extra,
    }
    await db.collection('users').insertOne(user)
    await db.collection('tenants').insertOne({ tenant_id: user.tenant_id, status: 'active' })
    return user
  }

  it('a password-only user gets otp_required, then a session from the code', async () => {
    const user = await seedUser()
    const res = await post('/auth/login', { email: user.email, password: PASSWORD })
    expect(res.json().otp_required).toBe(true)
    expect(res.headers['set-cookie']).toBeUndefined()
    expect(sent[0]?.purpose).toBe('login')
    const ok = await post('/auth/otp/verify', { otp_token: res.json().otp_token, code: lastCode() })
    expect(ok.statusCode).toBe(200)
    expect(await auth.verify(ok.json().token)).toMatchObject({ user_id: user.id })
  })

  it('a TOTP user gets mfa_required and no OTP email', async () => {
    const user = await seedUser({ mfa_enabled: true, mfa_secret: generateTotpSecret() })
    const res = await post('/auth/login', { email: user.email, password: PASSWORD })
    expect(res.json().mfa_required).toBe(true)
    expect(sent).toHaveLength(0)
  })

  it('a pending registration finishes its signup check at login', async () => {
    const { email } = await signup()
    await skipCooldown()
    const res = await post('/auth/login', { email, password: PASSWORD })
    expect(res.json().otp_required).toBe(true)
    expect(sent[sent.length - 1]?.purpose).toBe('signup')
  })

  it('no session if the user is suspended after the chain began', async () => {
    const user = await seedUser()
    const res = await post('/auth/login', { email: user.email, password: PASSWORD })
    await db.collection('users').updateOne({ id: user.id }, { $set: { status: 'suspended' } })
    const v = await post('/auth/otp/verify', { otp_token: res.json().otp_token, code: lastCode() })
    expect(v.statusCode).toBe(401)
  })

  it('no session if sessions were revoked after the chain began', async () => {
    const user = await seedUser()
    const res = await post('/auth/login', { email: user.email, password: PASSWORD })
    await db.collection('users').updateOne({ id: user.id }, { $set: { sessions_revoked_at: new Date() } })
    const v = await post('/auth/otp/verify', { otp_token: res.json().otp_token, code: lastCode() })
    expect(v.statusCode).toBe(401)
  })

  it('concurrency: 10 parallel wrong guesses spend at most 5 attempts', async () => {
    const user = await seedUser()
    const res = await post('/auth/login', { email: user.email, password: PASSWORD })
    const wrong = lastCode() === '999999' ? '888888' : '999999'
    const results = await Promise.all(
      Array.from({ length: 10 }, () => post('/auth/otp/verify', { otp_token: res.json().otp_token, code: wrong })),
    )
    expect(results.filter((r) => r.json().error === 'otp_invalid').length).toBeLessThanOrEqual(4)
    const chain = await db.collection('otp_chains').findOne({ user_id: user.id })
    expect(chain?.['attempts']).toBe(5)
  })

  it('concurrency: two parallel correct submissions yield exactly one session', async () => {
    const user = await seedUser()
    const res = await post('/auth/login', { email: user.email, password: PASSWORD })
    const code = lastCode()
    const results = await Promise.all([
      post('/auth/otp/verify', { otp_token: res.json().otp_token, code }),
      post('/auth/otp/verify', { otp_token: res.json().otp_token, code }),
    ])
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1)
  })
})

describe('pending token boundary (D11)', () => {
  it('never verifies as a session token', async () => {
    const { body } = await signup()
    await expect(auth.verify(body.otp_token)).rejects.toThrow()
    expect((await verifyOtpPending(body.otp_token)).purpose).toBe('signup')
  })

  it('/auth/otp/verify rejects session and mfa_pending tokens', async () => {
    const session = await auth.sign({ sub: 'x', tenant_id: 't-x', roles: ['admin'] })
    const mfa = await auth.sign({ sub: 'x', tenant_id: 't-x', roles: [], mfa_pending: true }, '5m')
    for (const otp_token of [session, mfa, 'garbage']) {
      const res = await post('/auth/otp/verify', { otp_token, code: '123456' })
      expect(res.statusCode).toBe(401)
    }
  })

  it('/auth/mfa/verify rejects an OTP pending token', async () => {
    const { body } = await signup()
    const res = await post('/auth/mfa/verify', { mfa_token: body.otp_token, code: '123456' })
    expect(res.statusCode).toBe(401)
  })
})

describe('pending-registration sweep', () => {
  it('deletes only stale pending rows with no sign-in, and their own tenant', async () => {
    const old = new Date(Date.now() - 8 * 86_400_000)
    await db.collection('users').insertMany([
      { id: 'p1', email: 'p1@x.io', tenant_id: 't-p1', registration_status: 'pending', email_verified: false, registration_created_at: old },
      { id: 'p2', email: 'p2@x.io', tenant_id: 't-p2', registration_status: 'pending', email_verified: false, registration_created_at: new Date() },
      { id: 'l1', email: 'l1@x.io', tenant_id: 't-l1', email_verified: false, created_at: old },
      { id: 'a1', email: 'a1@x.io', tenant_id: 't-a1', registration_status: 'active', email_verified: true, registration_created_at: old },
      { id: 'p3', email: 'p3@x.io', tenant_id: 't-p3', registration_status: 'pending', email_verified: false, registration_created_at: old },
    ])
    await db.collection('tenants').insertMany([
      { tenant_id: 't-p1', created_by_registration: 'p1' },
      { tenant_id: 't-p3', created_by_registration: 'p3' },
    ])
    await db.collection('login_events').insertOne({ user_id: 'p3', success: true })
    await db.collection('otp_chains').insertOne({ chain_id: 'c', user_id: 'p1' })
    const out = await sweepPendingRegistrations(db)
    expect(out.pending_users).toBe(1)
    expect(out.pending_tenants).toBe(1)
    expect(out.otp_chains).toBe(1)
    const left = (await db.collection('users').find({}).toArray()).map((u) => u['id']).sort()
    expect(left).toEqual(['a1', 'l1', 'p2', 'p3'])
  })
})
