/**
 * Passwordless result save (PRD-203): pending record on consent, single-use
 * link that a GET can never consume, link-or-code verify, uniform responses,
 * send caps, existing-account append, MFA accounts never signed in.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'

const sent: { to: string; url: string; code: string }[] = []
vi.mock('../../auth-email.js', async (orig) => ({
  ...(await orig<typeof import('../../auth-email.js')>()),
  sendResultSaveEmail: async (to: string, url: string, code: string) => {
    sent.push({ to, url, code })
    return true
  },
}))

import {
  MARKETING_CONSENT_VERSION,
  MAX_CODE_ATTEMPTS,
  MAX_SENDS_PER_ADDRESS_PER_HOUR,
  drainMagicLinkWork,
  registerMagicLinkRoutes,
} from '../magic-link.js'

const ANSWERS = {
  monthly_salary_minor: 300000,
  emergency_savings_minor: 500000,
  monthly_expenses_minor: 200000,
  mortgage_outstanding_minor: 15000000,
  life_cover_minor: 0,
  dependents: 2,
}

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('magic-link-test')
})

beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  sent.length = 0
  app = Fastify()
  await registerMagicLinkRoutes(app, db, { sign: async () => 'jwt' } as never)
  await app.ready()
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

const request = async (email: string, extra: Record<string, unknown> = {}) => {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/magic-link/request',
    payload: { email, answers: ANSWERS, ...extra },
  })
  await drainMagicLinkWork()
  return res
}
const verify = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/auth/magic-link/verify', payload })
const tokenOf = (url: string) => new URL(url).searchParams.get('token')!

describe('POST /auth/magic-link/request', () => {
  it('stores nothing and sends nothing until asked; then stores only a hashed token', async () => {
    expect(await db.collection('result_save_pending').countDocuments()).toBe(0)
    await request('Ada@Example.com')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('ada@example.com')
    const doc = await db.collection('result_save_pending').findOne({})
    expect(JSON.stringify(doc)).not.toContain(tokenOf(sent[0]!.url))
    expect(JSON.stringify(doc)).not.toContain(sent[0]!.code)
    expect(await db.collection('users').countDocuments()).toBe(0)
  })

  it('gives the same response for a new and an existing address', async () => {
    await db
      .collection('users')
      .insertOne({ id: 'u1', email: 'known@example.com', tenant_id: 't1' })
    const a = await request('known@example.com')
    const b = await request('new@example.com')
    expect(a.statusCode).toBe(202)
    expect(b.statusCode).toBe(202)
    expect(a.body).toBe(b.body)
  })

  it('rejects malformed input and keeps the link host server-side', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/auth/magic-link/request',
      payload: { email: 'nope', answers: ANSWERS },
    })
    expect(bad.statusCode).toBe(400)
    await request('a@example.com', { host: 'https://evil.test' })
    expect(sent[0]!.url.startsWith('http://localhost:3002/keep-result?token=')).toBe(true)
  })

  it('applies a resend cooldown, then a per-address hourly cap', async () => {
    await request('cap@example.com')
    await request('cap@example.com')
    expect(sent).toHaveLength(1)
    for (let i = 0; i < MAX_SENDS_PER_ADDRESS_PER_HOUR + 2; i++) {
      await db
        .collection('result_save_pending')
        .updateMany({}, { $set: { created_at: new Date(0) } })
      await request('cap@example.com')
    }
    expect(sent).toHaveLength(MAX_SENDS_PER_ADDRESS_PER_HOUR)
  })
})

describe('POST /auth/magic-link/verify', () => {
  it('creates a passwordless account and appends the snapshot; the token works once', async () => {
    await request('new@example.com', { marketing_consent: true })
    const token = tokenOf(sent[0]!.url)
    const res = await verify({ token })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.signed_in).toBe(true)
    expect(body.snapshot.score).toBeTypeOf('number')
    const user = await db.collection('users').findOne({ email: 'new@example.com' })
    expect(user?.['email_verified']).toBe(true)
    expect(user?.['marketing_consent']).toMatchObject({
      given: true,
      text_version: MARKETING_CONSENT_VERSION,
    })
    expect(
      await db
        .collection('readiness_quiz_snapshots')
        .countDocuments({ tenant_id: user?.['tenant_id'] }),
    ).toBe(1)
    expect(
      await db
        .collection('family_readiness_history')
        .countDocuments({ tenant_id: user?.['tenant_id'] }),
    ).toBe(1)
    // Password login is impossible: the stored hash is of a random secret.
    expect(user?.['password_hash']).toMatch(/^[0-9a-f]{64}$/)
    expect((await verify({ token })).statusCode).toBe(400)
  })

  it('does not store marketing consent unless it was given', async () => {
    await request('quiet@example.com')
    await verify({ token: tokenOf(sent[0]!.url) })
    const user = await db.collection('users').findOne({ email: 'quiet@example.com' })
    expect(user?.['marketing_consent']).toBeUndefined()
  })

  it('accepts email + code from another device and locks after too many wrong codes', async () => {
    await request('code@example.com')
    const { code } = sent[0]!
    expect((await verify({ email: 'code@example.com', code })).statusCode).toBe(200)

    await request('lock@example.com')
    const real = sent[1]!.code
    const wrong = real === '000000' ? '111111' : '000000'
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      expect((await verify({ email: 'lock@example.com', code: wrong })).statusCode).toBe(400)
    }
    expect((await verify({ email: 'lock@example.com', code: real })).statusCode).toBe(400)
  })

  it('rejects an expired link and a wrong token with the same body', async () => {
    await request('late@example.com')
    await db.collection('result_save_pending').updateMany({}, { $set: { expires_at: new Date(1) } })
    const expired = await verify({ token: tokenOf(sent[0]!.url) })
    const wrong = await verify({ token: 'f'.repeat(64) })
    expect(expired.statusCode).toBe(400)
    expect(expired.body).toBe(wrong.body)
  })

  it('appends to an existing account without overwriting and never creates a second user', async () => {
    await db.collection('users').insertOne({
      id: 'u1',
      email: 'old@example.com',
      name: 'Old',
      tenant_id: 'tenant-old',
      roles: ['admin'],
      email_verified: true,
    })
    const today = new Date().toISOString().slice(0, 10)
    await db
      .collection('family_readiness_history')
      .insertOne({ tenant_id: 'tenant-old', date: today, score: 91 })
    await request('old@example.com')
    const res = await verify({ token: tokenOf(sent[0]!.url) })
    expect(res.json().user.tenant_id).toBe('tenant-old')
    expect(await db.collection('users').countDocuments()).toBe(1)
    expect(await db.collection('tenants').countDocuments()).toBe(0)
    expect(
      (await db.collection('family_readiness_history').findOne({ tenant_id: 'tenant-old' }))?.[
        'score'
      ],
    ).toBe(91)
    expect(
      await db.collection('readiness_quiz_snapshots').countDocuments({ tenant_id: 'tenant-old' }),
    ).toBe(1)
  })

  it('does not sign in an account with MFA, and refuses suspended accounts', async () => {
    await db.collection('users').insertMany([
      {
        id: 'u1',
        email: 'mfa@example.com',
        tenant_id: 't-mfa',
        roles: ['admin'],
        mfa_enabled: true,
      },
      {
        id: 'u2',
        email: 'gone@example.com',
        tenant_id: 't-gone',
        roles: ['admin'],
        status: 'suspended',
      },
    ])
    await request('mfa@example.com')
    const mfa = await verify({ token: tokenOf(sent[0]!.url) })
    expect(mfa.json()).toMatchObject({ signed_in: false, reason: 'mfa_required' })
    expect(mfa.headers['set-cookie']).toBeUndefined()

    await request('gone@example.com')
    expect((await verify({ token: tokenOf(sent[1]!.url) })).statusCode).toBe(400)
  })

  it('re-sends an expired link from the address alone, keeping the answers', async () => {
    await request('again@example.com')
    await db
      .collection('result_save_pending')
      .updateMany({}, { $set: { expires_at: new Date(1), created_at: new Date(0) } })
    expect((await verify({ token: tokenOf(sent[0]!.url) })).statusCode).toBe(400)
    const res = await app.inject({
      method: 'POST',
      url: '/auth/magic-link/request',
      payload: { email: 'again@example.com' },
    })
    await drainMagicLinkWork()
    expect(res.statusCode).toBe(202)
    expect(sent).toHaveLength(2)
    const ok = await verify({ token: tokenOf(sent[1]!.url) })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().snapshot.score).toBeTypeOf('number')
  })

  it('sends nothing for an answerless request when no pending record exists', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/magic-link/request',
      payload: { email: 'nobody@example.com' },
    })
    await drainMagicLinkWork()
    expect(res.statusCode).toBe(202)
    expect(sent).toHaveLength(0)
  })

  it('has no GET route, so a prefetching scanner cannot consume the token', async () => {
    await request('scan@example.com')
    const get = await app.inject({
      method: 'GET',
      url: `/auth/magic-link/verify?token=${tokenOf(sent[0]!.url)}`,
    })
    expect(get.statusCode).toBe(404)
    expect((await verify({ token: tokenOf(sent[0]!.url) })).statusCode).toBe(200)
  })
})
