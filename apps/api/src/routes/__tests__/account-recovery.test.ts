/**
 * Password reset and change (R01, R06, R39), against MongoMemoryServer so
 * real query operators are evaluated. The emailed link is captured from
 * the mocked sender: the raw token exists only there.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import fastifyCookie from '@fastify/cookie'
import { AuthService } from '@lifekeel/platform'
import { randomBytes } from 'node:crypto'

const { resetMock } = vi.hoisted(() => ({
  resetMock: vi.fn(async (_to: string, _name: string, _url: string) => {}),
}))
vi.mock('../../auth-email.js', () => ({
  sendPasswordResetEmail: resetMock,
  sendEmailVerificationEmail: vi.fn(async () => {}),
  sendFamilyInviteEmail: vi.fn(async () => {}),
}))

const { registerAuthUserRoutes, hashPassword, hashAuthToken } = await import('../auth-users.js')
const { closeDb, getDb } = await import('../../db.js')

let mongod: MongoMemoryServer
let db: Db
let app: FastifyInstance
const auth = new AuthService('test-secret-that-is-long-enough-123')
const PASSWORD = 'original-password'

function user(id: string, email: string) {
  const salt = randomBytes(16).toString('hex')
  return {
    id,
    email,
    name: 'Reset Person',
    tenant_id: 'tenant-reset',
    roles: ['admin'],
    status: 'active',
    created_at: new Date(),
    salt,
    password_hash: hashPassword(PASSWORD, salt),
  }
}

async function requestReset(email: string): Promise<string> {
  resetMock.mockClear()
  const res = await app.inject({
    method: 'POST',
    url: '/auth/request-password-reset',
    payload: { email, app: 'family' },
  })
  expect(res.statusCode).toBe(200)
  const url = String(resetMock.mock.calls[0]![2])
  expect(url).toContain('/reset-password/confirm#token=')
  return url.split('#token=')[1]!
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  process.env['MONGODB_URL'] = mongod.getUri()
  process.env['MONGODB_DB'] = 'recovery-test'
  app = Fastify()
  await app.register(fastifyCookie)
  app.addHook('onRequest', async (request) => {
    const header = request.headers['authorization']
    if (header?.startsWith('Bearer ')) {
      try {
        request.authContext = await auth.verify(header.slice(7))
      } catch {
        /* unauthenticated */
      }
    }
  })
  await registerAuthUserRoutes(app, auth)
  await app.ready()
  db = await getDb()
})

beforeEach(async () => {
  await db.collection('users').deleteMany({})
  await db
    .collection('users')
    .insertMany([user('victim', 'victim@example.com'), user('other', 'other@example.com')])
})

afterAll(async () => {
  await app.close()
  await closeDb()
  await mongod.stop()
  delete process.env['MONGODB_URL']
  delete process.env['MONGODB_DB']
})

describe('POST /auth/reset-password', () => {
  it('R01: an operator object in place of the token resets nobody', async () => {
    await requestReset('victim@example.com')
    for (const token of [{ $ne: null }, { $exists: true }, { $regex: '.' }, ['x']]) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { token, new_password: 'attacker-password' },
      })
      expect(res.statusCode).toBe(400)
    }
    const victim = await db.collection('users').findOne({ id: 'victim' })
    expect(victim?.['password_hash']).toBe(hashPassword(PASSWORD, String(victim?.['salt'])))
  })

  it('R39: only the hash is stored, the emailed token works once, and every old session ends', async () => {
    const raw = await requestReset('victim@example.com')
    const stored = await db.collection('users').findOne({ id: 'victim' })
    expect(stored?.['password_reset_token_hash']).toBe(hashAuthToken(raw))
    expect(JSON.stringify(stored)).not.toContain(raw)

    const ok = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: raw, new_password: 'brand-new-password' },
    })
    expect(ok.statusCode).toBe(200)
    const after = await db.collection('users').findOne({ id: 'victim' })
    expect(after?.['password_reset_token_hash']).toBeUndefined()
    // R06: a token stolen before the reset dies with it.
    expect(after?.['sessions_revoked_at']).toBeInstanceOf(Date)

    const again = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: raw, new_password: 'third-password' },
    })
    expect(again.statusCode).toBe(400)
  })

  it('an expired token is refused', async () => {
    const raw = await requestReset('victim@example.com')
    await db
      .collection('users')
      .updateOne(
        { id: 'victim' },
        { $set: { password_reset_expires: new Date(Date.now() - 1000) } },
      )
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: raw, new_password: 'brand-new-password' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /auth/change-password', () => {
  it('R06: ends other sessions but keeps the caller signed in on a fresh token', async () => {
    const old = await auth.sign({ sub: 'victim', tenant_id: 'tenant-reset', roles: ['admin'] })
    // Tokens carry second-resolution iat; make the old one strictly older.
    await new Promise((r) => setTimeout(r, 1100))
    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { authorization: `Bearer ${old}` },
      payload: { current_password: PASSWORD, new_password: 'changed-password' },
    })
    expect(res.statusCode).toBe(200)
    const fresh = res.json().token as string
    const stored = await db.collection('users').findOne({ id: 'victim' })
    const cutoff = Math.floor((stored?.['sessions_revoked_at'] as Date).getTime() / 1000)
    const oldIat = (await auth.verify(old)).iat!
    const freshIat = (await auth.verify(fresh)).iat!
    // The auth hook rejects iat <= cutoff.
    expect(oldIat).toBeLessThanOrEqual(cutoff)
    expect(freshIat).toBeGreaterThan(cutoff)
  })
})
