/**
 * After an organizer declines a request, the same person cannot keep putting requests
 * in front of them (found by the UK household simulation, H26; a safeguarding case:
 * someone the family is avoiding). From the family's side:
 *  - the organizer never sees that person's request again for a long while;
 *  - the person is not told they were declined or blocked, which could provoke them: the
 *    reply looks exactly like any other waiting request;
 *  - a request that merely lapsed after 14 days is not a decline and does not block;
 *  - the organizer can still bring the person in on purpose, by inviting them by name.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerFamilyJoinRoutes } from '../family-join.js'

const T = 't-declined'
let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('join-declined')
  app = Fastify()
  app.addHook('onRequest', async (req) => {
    ;(req as unknown as Record<string, unknown>)['authContext'] = {
      tenant_id: T,
      user_id: 'ife',
      roles: ['owner'],
    }
  })
  registerFamilyJoinRoutes(app, db)
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await client.close()
  await mongod.stop()
})
beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  await db.collection('family_groups').insertOne({
    id: 'fam',
    tenant_id: T,
    name: 'The Coker family',
    invite_code: 'CODE01',
    members: [
      {
        id: 'ife',
        user_id: 'ife',
        name: 'Ife',
        email: 'ife@x.test',
        role: 'organizer',
        status: 'active',
        joined_at: '2026-01-01',
      },
    ],
  })
})

const ask = (email = 'marcus@x.test') =>
  app.inject({
    method: 'POST',
    url: '/family/join',
    payload: { invite_code: 'CODE01', name: 'Marcus', email, password: 'password123' },
  })
const pending = async () =>
  (await app.inject({ method: 'GET', url: '/family/access-requests' })).json().requests as {
    id: string
    email: string
  }[]
async function decline(email = 'marcus@x.test') {
  const r = (await pending()).find((x) => x.email === email)!
  return app.inject({ method: 'POST', url: `/family/access-requests/${r.id}/deny` })
}

describe('a declined requester', () => {
  it('cannot put another request in front of the organizer', async () => {
    await ask()
    expect((await decline()).statusCode).toBe(200)
    await ask()
    expect((await pending()).some((r) => r.email === 'marcus@x.test')).toBe(false)
  })

  it('is not told they were declined: the reply is the same as for any waiting request', async () => {
    const first = await ask()
    await decline()
    const again = await ask()
    expect(again.statusCode).toBe(first.statusCode)
    expect(again.json()).toEqual(first.json())
  })

  it('stays blocked however many times they try, and in other letter case', async () => {
    await ask()
    await decline()
    await ask()
    await ask('MARCUS@x.test')
    expect(await pending()).toEqual([])
  })

  it('does not stop other people asking', async () => {
    await ask()
    await decline()
    await ask('someone.else@x.test')
    expect((await pending()).map((r) => r.email)).toEqual(['someone.else@x.test'])
  })

  it('does not block someone whose request only lapsed after 14 days', async () => {
    await ask()
    await db
      .collection('family_join_requests')
      .updateMany({}, { $set: { requested_at: new Date(Date.now() - 15 * 86_400_000) } })
    await ask()
    expect((await pending()).some((r) => r.email === 'marcus@x.test')).toBe(true)
  })

  it('the block ends on its own after a long while', async () => {
    await ask()
    await decline()
    await db
      .collection('family_join_blocks')
      .updateMany({}, { $set: { until: new Date(Date.now() - 1000) } })
    await ask()
    expect((await pending()).some((r) => r.email === 'marcus@x.test')).toBe(true)
  })
})
