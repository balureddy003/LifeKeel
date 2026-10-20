/**
 * PRD-141 perceived protection + digest-click value events: adults only, first
 * answer wins, a skip is not an answer, and a signed-in digest click is
 * recorded against the tenant while an anonymous one is not.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerPerceivedProtectionRoutes } from '../perceived-protection.js'
import { registerGrowthEventRoutes } from '../growth-events.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
const T = 't1'

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('pp-test')
})
beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  await db.collection('family_groups').insertOne({
    tenant_id: T,
    members: [
      {
        id: 'm1',
        user_id: 'u1',
        name: 'A',
        email: 'a@x.test',
        role: 'organizer',
        status: 'active',
      },
    ],
  })
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

const appFor = async (userId: string | null) => {
  const app = Fastify()
  app.addHook('onRequest', async (req) => {
    if (userId)
      (req as unknown as { authContext: unknown }).authContext = { tenant_id: T, user_id: userId }
  })
  registerPerceivedProtectionRoutes(app, db)
  await registerGrowthEventRoutes(app, db)
  await app.ready()
  return app
}

describe('perceived protection', () => {
  it('asks an adult once a quarter and stops asking after an answer', async () => {
    const app = await appFor('u1')
    expect(
      (await app.inject({ method: 'GET', url: '/family/perceived-protection' })).json().due,
    ).toBe(true)
    const post = await app.inject({
      method: 'POST',
      url: '/family/perceived-protection',
      payload: { score: 4 },
    })
    expect(post.statusCode).toBe(204)
    expect(
      (await app.inject({ method: 'GET', url: '/family/perceived-protection' })).json().due,
    ).toBe(false)
  })

  it('keeps the first answer for the quarter', async () => {
    const app = await appFor('u1')
    await app.inject({ method: 'POST', url: '/family/perceived-protection', payload: { score: 2 } })
    await app.inject({ method: 'POST', url: '/family/perceived-protection', payload: { score: 5 } })
    const rows = await db.collection('perceived_protection').find({}).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]!['score']).toBe(2)
  })

  it('a skip stops the prompt but is stored without a score', async () => {
    const app = await appFor('u1')
    await app.inject({
      method: 'POST',
      url: '/family/perceived-protection',
      payload: { skipped: true },
    })
    expect(
      (await app.inject({ method: 'GET', url: '/family/perceived-protection' })).json().due,
    ).toBe(false)
    expect((await db.collection('perceived_protection').findOne({}))?.['score']).toBeUndefined()
  })

  it('rejects out-of-range answers and non-adults', async () => {
    const app = await appFor('u1')
    for (const score of [0, 6, 2.5]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/family/perceived-protection',
            payload: { score },
          })
        ).statusCode,
      ).toBe(400)
    }
    const stranger = await appFor('stranger')
    expect(
      (await stranger.inject({ method: 'GET', url: '/family/perceived-protection' })).statusCode,
    ).toBe(403)
  })
})

describe('digest_click event', () => {
  const click = (app: Awaited<ReturnType<typeof appFor>>, meta: unknown) =>
    app.inject({
      method: 'POST',
      url: '/growth/events',
      payload: { event: 'digest_click', anon_id: 'a', meta },
    })

  it('keeps only a known variant in meta', async () => {
    const app = await appFor(null)
    await click(app, { v: 'note', email: 'leak@x.test' })
    await click(app, { v: 'made-up' })
    const rows = await db.collection('growth_events').find({ event: 'digest_click' }).toArray()
    expect(rows.map((r) => r['meta'])).toEqual([{ v: 'note' }, null])
  })

  it('records received value against the tenant only when signed in', async () => {
    await click(await appFor(null), { v: 'all_clear' })
    expect(await db.collection('value_events').countDocuments()).toBe(0)
    await click(await appFor('u1'), { v: 'all_clear' })
    expect(
      await db
        .collection('value_events')
        .find({}, { projection: { _id: 0, at: 0 } })
        .toArray(),
    ).toEqual([{ tenant_id: T, kind: 'digest_click' }])
  })
})

describe('alert_click event (PRD-139)', () => {
  const click = (app: Awaited<ReturnType<typeof appFor>>, meta: unknown) =>
    app.inject({
      method: 'POST',
      url: '/growth/events',
      payload: { event: 'alert_click', anon_id: 'a', meta },
    })

  it('records a response against the tenant only when signed in, and never stores the insight id in growth events', async () => {
    await click(await appFor(null), { i: 'ins-1' })
    expect(await db.collection('value_events').countDocuments()).toBe(0)
    await click(await appFor('u1'), { i: 'ins-1' })
    expect(
      await db
        .collection('value_events')
        .find({}, { projection: { _id: 0, at: 0 } })
        .toArray(),
    ).toEqual([{ tenant_id: T, kind: 'alert_click', key: 'ins-1' }])
    const events = await db.collection('growth_events').find({ event: 'alert_click' }).toArray()
    expect(events).toHaveLength(2)
    expect(JSON.stringify(events)).not.toContain('ins-1')
  })

  it('ignores a missing or oversized id', async () => {
    const app = await appFor('u1')
    await click(app, {})
    await click(app, { i: 'x'.repeat(65) })
    expect(await db.collection('value_events').countDocuments()).toBe(0)
  })
})
