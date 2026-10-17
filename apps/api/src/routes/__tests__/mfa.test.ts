/**
 * TOTP MFA — the second login step. Covers the pending-token contract
 * (mfa_required → mfa/verify → session + cookie), code rejection, and
 * single-use recovery codes. Runs against MongoMemoryServer like the
 * sibling login-events suite; the minimal onRequest hook below mirrors
 * server.ts's authContext wiring for the routes that need it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import fastifyCookie from '@fastify/cookie'
import { AuthService } from '@lifekeel/platform'
import { registerAuthUserRoutes, hashPassword } from '../auth-users.js'
import { closeDb, getDb } from '../../db.js'
import { generateTotpSecret, generateRecoveryCodes, hashRecoveryCode, totp } from '../../lib/totp.js'
import { randomBytes } from 'node:crypto'

let mongod: MongoMemoryServer
let db: Db
let app: FastifyInstance

const PASSWORD = 'correct-horse-battery'
const SECRET = generateTotpSecret()
const RECOVERY = generateRecoveryCodes()
const USER = {
  id: 'mfa-user',
  email: 'mfa@example.com',
  name: 'MFA User',
  tenant_id: 'tenant-mfa',
  roles: ['admin'],
  status: 'active',
  created_at: new Date(),
  failed_login_attempts: 0,
  locked_until: undefined,
  salt: randomBytes(16).toString('hex'),
  password_hash: '',
  mfa_enabled: true,
  mfa_secret: SECRET,
  mfa_recovery_hashes: [...RECOVERY.hashes],
}
USER.password_hash = hashPassword(PASSWORD, USER.salt)

const auth = new AuthService('test-secret')

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  process.env['MONGODB_URL'] = mongod.getUri()
  process.env['MONGODB_DB'] = 'mfa-test'

  app = Fastify()
  await app.register(fastifyCookie)
  // Minimal stand-in for server.ts's onRequest auth hook — only the
  // authenticated MFA management routes need authContext populated.
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]!
    const open = ['/auth/login', '/auth/signup', '/auth/mfa/verify']
    const header = request.headers['authorization']
    const token = header?.startsWith('Bearer ') ? header.slice(7) : request.cookies['lifekeel_session']
    if (token) {
      try { request.authContext = await auth.verify(token) } catch { /* fall through */ }
    }
    if (!request.authContext && !open.includes(path)) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
  })
  await registerAuthUserRoutes(app, auth)
  await app.ready()

  db = await getDb()
  await db.collection('users').insertOne({ ...USER })
})

afterAll(async () => {
  await app.close()
  await closeDb()
  await mongod.stop()
  delete process.env['MONGODB_URL']
  delete process.env['MONGODB_DB']
})

describe('MFA login flow', () => {
  it('returns mfa_required + pending token instead of a session', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: USER.email, password: PASSWORD } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.mfa_required).toBe(true)
    expect(body.mfa_token).toBeTruthy()
    expect(body.token).toBeUndefined()
    expect(body.user).toBeUndefined()
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('exchanges a valid TOTP code for a session token + httpOnly cookie', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: USER.email, password: PASSWORD } })
    const { mfa_token } = login.json()
    const res = await app.inject({ method: 'POST', url: '/auth/mfa/verify', payload: { mfa_token, code: totp(SECRET) } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.token).toBeTruthy()
    expect(body.user.email).toBe(USER.email)
    const cookie = res.headers['set-cookie']
    expect(cookie).toBeTruthy()
    expect(String(cookie)).toContain('lifekeel_session=')
    expect(String(cookie)).toContain('HttpOnly')
  })

  it('rejects a wrong code', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: USER.email, password: PASSWORD } })
    const { mfa_token } = login.json()
    const res = await app.inject({ method: 'POST', url: '/auth/mfa/verify', payload: { mfa_token, code: '000000' } })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a non-pending token at mfa/verify', async () => {
    const sessionToken = await auth.sign({ sub: USER.id, tenant_id: USER.tenant_id, roles: USER.roles })
    const res = await app.inject({ method: 'POST', url: '/auth/mfa/verify', payload: { mfa_token: sessionToken, code: totp(SECRET) } })
    expect(res.statusCode).toBe(401)
  })

  it('accepts a recovery code exactly once', async () => {
    const login1 = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: USER.email, password: PASSWORD } })
    const res1 = await app.inject({ method: 'POST', url: '/auth/mfa/verify', payload: { mfa_token: login1.json().mfa_token, code: RECOVERY.codes[0] } })
    expect(res1.statusCode).toBe(200)

    const login2 = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: USER.email, password: PASSWORD } })
    const res2 = await app.inject({ method: 'POST', url: '/auth/mfa/verify', payload: { mfa_token: login2.json().mfa_token, code: RECOVERY.codes[0] } })
    expect(res2.statusCode).toBe(401)
  })
})

describe('MFA management routes', () => {
  let sessionToken: string

  beforeAll(async () => {
    sessionToken = await auth.sign({ sub: USER.id, tenant_id: USER.tenant_id, roles: USER.roles })
  })

  it('reports status', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/mfa/status', headers: { authorization: `Bearer ${sessionToken}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().enabled).toBe(true)
  })

  it('enrolls via setup → enable, returning recovery codes', async () => {
    await db.collection('users').insertOne({ ...USER, id: 'enrol-user', email: 'enrol@example.com', mfa_enabled: false, mfa_secret: undefined, mfa_recovery_hashes: undefined })
    const enrolToken = await auth.sign({ sub: 'enrol-user', tenant_id: USER.tenant_id, roles: USER.roles })
    const bearer = { authorization: `Bearer ${enrolToken}` }

    const setup = await app.inject({ method: 'POST', url: '/auth/mfa/setup', headers: bearer })
    expect(setup.statusCode).toBe(200)
    const { secret, otpauth_url } = setup.json()
    expect(secret).toBeTruthy()
    expect(otpauth_url).toContain('otpauth://totp/')
    expect(otpauth_url).toContain('issuer=LifeKeel')

    const badEnable = await app.inject({ method: 'POST', url: '/auth/mfa/enable', headers: bearer, payload: { code: '000000' } })
    expect(badEnable.statusCode).toBe(400)

    const enable = await app.inject({ method: 'POST', url: '/auth/mfa/enable', headers: bearer, payload: { code: totp(secret) } })
    expect(enable.statusCode).toBe(200)
    expect(enable.json().recovery_codes).toHaveLength(8)
    // Secret material is never echoed back or persisted in plaintext recovery form
    const stored = await db.collection('users').findOne({ id: 'enrol-user' })
    expect(stored?.['mfa_enabled']).toBe(true)
    expect(stored?.['mfa_pending_secret']).toBeUndefined()
    expect(stored?.['mfa_recovery_hashes']?.[0]).toBe(hashRecoveryCode(enable.json().recovery_codes[0]))
  })

  it('requires the account password to disable', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/mfa/disable', headers: { authorization: `Bearer ${sessionToken}` }, payload: { password: 'wrong-password' } })
    expect(res.statusCode).toBe(401)

    const ok = await app.inject({ method: 'POST', url: '/auth/mfa/disable', headers: { authorization: `Bearer ${sessionToken}` }, payload: { password: PASSWORD } })
    expect(ok.statusCode).toBe(200)
    const stored = await db.collection('users').findOne({ id: USER.id })
    expect(stored?.['mfa_enabled']).toBe(false)
  })
})
