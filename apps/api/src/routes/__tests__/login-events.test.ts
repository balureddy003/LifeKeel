/**
 * Login telemetry — every /auth/login outcome writes a fire-and-forget doc
 * to login_events for the operator security view. These tests run a real
 * MongoMemoryServer via MONGODB_URL (getDb is a lazy singleton; vitest
 * isolates modules per test file so no other suite shares the connection).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { AuthService } from '@agentoak/platform'
import { registerAuthUserRoutes, hashPassword } from '../auth-users.js'
import { closeDb, getDb, getLoginEventsCollection } from '../../db.js'
import { randomBytes } from 'node:crypto'

let mongod: MongoMemoryServer
let db: Db
let app: FastifyInstance

const PASSWORD = 'correct-horse-battery'
const USER = {
  id: 'user-1',
  email: 'person@example.com',
  name: 'Person',
  tenant_id: 'tenant-1',
  roles: ['admin'],
  status: 'active',
  created_at: new Date(),
  failed_login_attempts: 0,
  locked_until: undefined,
  salt: randomBytes(16).toString('hex'),
  password_hash: '',
}
USER.password_hash = hashPassword(PASSWORD, USER.salt)

async function waitForEvents(filter: Record<string, unknown>, expected: number, timeoutMs = 3000): Promise<Record<string, unknown>[]> {
  const col = getLoginEventsCollection(db)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const docs = await col.find(filter).toArray()
    if (docs.length >= expected) return docs
    await new Promise((r) => setTimeout(r, 50))
  }
  return col.find(filter).toArray()
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  process.env['MONGODB_URL'] = mongod.getUri()
  process.env['MONGODB_DB'] = 'login-events-test'

  app = Fastify()
  await registerAuthUserRoutes(app, new AuthService('test-secret'))
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

describe('POST /auth/login records login_events', () => {
  it('records unknown_email for a nonexistent account', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ghost@example.com', password: 'whatever12' } })
    expect(res.statusCode).toBe(401)
    const events = await waitForEvents({ email: 'ghost@example.com' }, 1)
    expect(events[0]).toMatchObject({ success: false, reason: 'unknown_email' })
    expect(events[0]?.['user_id']).toBeUndefined()
  })

  it('records bad_password with the user id, then success', async () => {
    const bad = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: USER.email, password: 'wrong-password' } })
    expect(bad.statusCode).toBe(401)
    const failures = await waitForEvents({ email: USER.email, success: false }, 1)
    expect(failures[0]).toMatchObject({ reason: 'bad_password', user_id: USER.id, tenant_id: USER.tenant_id })

    const ok = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: USER.email, password: PASSWORD } })
    expect(ok.statusCode).toBe(200)
    const successes = await waitForEvents({ email: USER.email, success: true }, 1)
    expect(successes[0]).toMatchObject({ user_id: USER.id, tenant_id: USER.tenant_id })
    expect(successes[0]?.['reason']).toBeUndefined()
  })

  it('records suspended and locked outcomes', async () => {
    await db.collection('users').insertOne({
      ...USER, id: 'user-2', email: 'locked@example.com',
      locked_until: new Date(Date.now() + 10 * 60 * 1000),
    })
    const locked = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'locked@example.com', password: PASSWORD } })
    expect(locked.statusCode).toBe(429)
    const lockEvents = await waitForEvents({ email: 'locked@example.com' }, 1)
    expect(lockEvents[0]).toMatchObject({ success: false, reason: 'locked', user_id: 'user-2' })

    await db.collection('users').updateOne({ id: 'user-2' }, { $set: { status: 'suspended', locked_until: undefined } })
    const suspended = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'locked@example.com', password: PASSWORD } })
    expect(suspended.statusCode).toBe(403)
    const suspEvents = await waitForEvents({ email: 'locked@example.com', reason: 'suspended' }, 1)
    expect(suspEvents[0]).toMatchObject({ success: false, user_id: 'user-2' })
  })

  it('denies erased accounts with a generic invalid-credentials response', async () => {
    // The erase path strips password_hash — the guard must run before the
    // password check and must not reveal that the account was erased.
    await db.collection('users').updateOne(
      { id: USER.id },
      { $set: { status: 'erased', email: 'erased-x@erased.invalid', name: 'Erased user' }, $unset: { password_hash: '', salt: '' } },
    )
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'erased-x@erased.invalid', password: PASSWORD } })
    expect(res.statusCode).toBe(401)
    expect(res.json().error).toBe('Invalid email or password')
    const events = await waitForEvents({ reason: 'erased' }, 1)
    expect(events[0]).toMatchObject({ success: false, user_id: USER.id })
  })
})
