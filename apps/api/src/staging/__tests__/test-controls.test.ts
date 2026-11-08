/**
 * Staging-only test controls: age a join request, and run the digest with a
 * chosen date. They let an agent reach the 14-day expiry and the monthly digest
 * without waiting. Like the mail sink they must be impossible to switch on
 * outside staging, need the test token, and touch only fictional addresses.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { type Db, MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerStagingControlRoutes, resolveStagingControls } from '../test-controls.js'

const TOKEN = 'a-long-random-staging-test-token-0123'
const ON = {
  STAGING_MAIL_SINK: 'on',
  STAGING_TEST_CONTROLS: 'on',
  LIFEKEEL_ENVIRONMENT: 'staging',
  STAGING_TEST_TOKEN: TOKEN,
  LIFEKEEL_URL: 'https://staging.lifekeel.example',
} as NodeJS.ProcessEnv
const H = { 'x-staging-token': TOKEN }
const DAY = 86_400_000

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = await MongoClient.connect(mongod.getUri())
  db = client.db('staging-controls')
}, 60_000)
afterAll(async () => {
  await client?.close()
  await mongod?.stop()
})
afterEach(async () => {
  for (const c of ['family_join_requests', 'job_runs', 'family_groups'])
    await db.collection(c).deleteMany({})
})

async function app(env: NodeJS.ProcessEnv = ON) {
  const a = Fastify()
  registerStagingControlRoutes(a, async () => db, env)
  await a.ready()
  return a
}

describe('resolveStagingControls: cannot be switched on outside staging', () => {
  it('is off unless asked for', () => {
    expect(resolveStagingControls({} as NodeJS.ProcessEnv)).toBeNull()
    expect(resolveStagingControls({ ...ON, STAGING_TEST_CONTROLS: 'off' })).toBeNull()
  })
  it('refuses outside staging, on a production host, or without a long token', () => {
    expect(() => resolveStagingControls({ ...ON, LIFEKEEL_ENVIRONMENT: 'production' })).toThrow(
      /staging/i,
    )
    expect(() =>
      resolveStagingControls({ ...ON, LIFEKEEL_URL: 'https://app.lifekeel.co.uk' }),
    ).toThrow(/production host/)
    expect(() => resolveStagingControls({ ...ON, STAGING_TEST_TOKEN: 'short' })).toThrow(/token/i)
  })
  it('needs the mail sink too, so mail can never really be sent while controls run', () => {
    expect(() => resolveStagingControls({ ...ON, STAGING_MAIL_SINK: 'off' })).toThrow(/mail sink/i)
  })
})

describe('routes', () => {
  it('do not exist when the controls are off', async () => {
    const a = await app({ ...ON, STAGING_TEST_CONTROLS: 'off' })
    const r = await a.inject({
      method: 'POST',
      url: '/staging/control/age-join-request',
      headers: H,
      payload: {},
    })
    expect(r.statusCode).toBe(404)
  })
  it('refuse a missing or wrong token', async () => {
    const a = await app()
    for (const headers of [{}, { 'x-staging-token': 'x'.repeat(40) }])
      for (const url of ['/staging/control/age-join-request', '/staging/control/run-digest'])
        expect((await a.inject({ method: 'POST', url, headers, payload: {} })).statusCode).toBe(401)
  })
})

describe('age-join-request', () => {
  const seed = (email: string, ageDays = 0) =>
    db.collection('family_join_requests').insertOne({
      id: `r-${email}`,
      tenant_id: 't1',
      name: 'Test Person',
      email,
      status: 'pending',
      requested_at: new Date(Date.now() - ageDays * DAY),
    })
  const call = async (payload: Record<string, unknown>) =>
    await (
      await app()
    ).inject({ method: 'POST', url: '/staging/control/age-join-request', headers: H, payload })

  it('moves a pending request back, so the 14-day expiry can be reached', async () => {
    await seed('kai@example.test')
    const r = await call({ email: 'KAI@example.test', days: 15 })
    expect(r.statusCode).toBe(200)
    expect(r.json().matched).toBe(1)
    const doc = await db.collection('family_join_requests').findOne({ email: 'kai@example.test' })
    const age = (Date.now() - (doc!['requested_at'] as Date).getTime()) / DAY
    expect(age).toBeGreaterThan(14.9)
    expect(age).toBeLessThan(15.1)
  })
  it('refuses an address that is not obviously fictional', async () => {
    await seed('real.person@gmail.com')
    expect((await call({ email: 'real.person@gmail.com', days: 15 })).statusCode).toBe(400)
    const doc = await db
      .collection('family_join_requests')
      .findOne({ email: 'real.person@gmail.com' })
    expect(Date.now() - (doc!['requested_at'] as Date).getTime()).toBeLessThan(DAY)
  })
  it('refuses silly day counts and reports no match for unknown people', async () => {
    for (const days of [0, -3, 400, 'ten', null])
      expect((await call({ email: 'a@example.test', days })).statusCode).toBe(400)
    expect((await call({ email: 'nobody@example.test', days: 15 })).json().matched).toBe(0)
  })
})

describe('run-digest', () => {
  const call = async (payload: Record<string, unknown>) =>
    await (
      await app()
    ).inject({ method: 'POST', url: '/staging/control/run-digest', headers: H, payload })

  it('refuses a bad cadence or a bad date', async () => {
    expect((await call({ cadence: 'daily' })).statusCode).toBe(400)
    expect((await call({ cadence: 'monthly', now: 'last tuesday' })).statusCode).toBe(400)
    expect((await call({ cadence: 'monthly', now: '1999-01-01T00:00:00Z' })).statusCode).toBe(400)
  })
  it('records a sweep at the chosen date (the digest refuses to send without one) and returns counts', async () => {
    const r = await call({ cadence: 'monthly', now: '2027-03-01T08:00:00Z' })
    expect(r.statusCode).toBe(200)
    expect(r.json().result).toMatchObject({ tenants: 0, sent: 0, failed: 0 })
    const sweep = await db.collection('job_runs').findOne({ job: 'stale-profile-evaluation' })
    expect((sweep!['ran_at'] as Date).toISOString()).toBe('2027-03-01T08:00:00.000Z')
  })
  it('can be limited to one family, so a test does not send a digest to every family on staging', async () => {
    const adult = (id: string) => ({
      id,
      user_id: id,
      name: id,
      email: `${id}@example.test`,
      role: 'organizer',
      status: 'active',
    })
    await db.collection('family_groups').insertMany([
      { id: 'f1', tenant_id: 't1', name: 'One', members: [adult('a1')] },
      { id: 'f2', tenant_id: 't2', name: 'Two', members: [adult('a2')] },
    ])
    const all = await call({ cadence: 'monthly', now: '2027-03-01T08:00:00Z' })
    expect(all.json().result.tenants).toBe(2)
    const one = await call({ cadence: 'monthly', now: '2027-03-01T08:00:00Z', tenant_id: 't2' })
    expect(one.json().result.tenants).toBe(1)
    const none = await call({
      cadence: 'monthly',
      now: '2027-03-01T08:00:00Z',
      tenant_id: 'nobody',
    })
    expect(none.json().result.tenants).toBe(0)
  })
  it('refuses a tenant_id that is not text', async () => {
    expect((await call({ cadence: 'monthly', tenant_id: 42 })).statusCode).toBe(400)
  })
  it('can skip the sweep to prove the digest holds back without one', async () => {
    await db.collection('family_groups').insertOne({
      tenant_id: 't1',
      members: [{ id: 'a', user_id: 'u1', name: 'A', role: 'organizer', status: 'active' }],
    })
    const r = await call({ cadence: 'monthly', now: '2027-03-01T08:00:00Z', fresh_sweep: false })
    expect(r.statusCode).toBe(200)
    expect(
      await db.collection('job_runs').countDocuments({ job: 'stale-profile-evaluation' }),
    ).toBe(0)
  })
})
