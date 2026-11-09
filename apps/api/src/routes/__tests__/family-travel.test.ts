/**
 * Travel on the family list: a trip is an on-file fact (dates, country, the policy
 * the family says applies, the assistance line as printed), its dates show under
 * "coming up", and an empty list says "no travel policy on file" as a fact.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerFamilyDomainRoutes } from '../family-domains.js'
import { DOMAINS } from '../../domains/registry.js'

const TENANT = 't-travel'
let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('travel-test')
  app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as unknown as Record<string, unknown>)['authContext'] = {
      tenant_id: TENANT,
      user_id: 'user-sam',
      roles: ['admin'],
    }
  })
  registerFamilyDomainRoutes(app, db, DOMAINS)
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
    tenant_id: TENANT,
    members: [{ id: 'sam', user_id: 'user-sam', name: 'Sam', role: 'organizer', status: 'active' }],
  })
})

const iso = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
const view = async () => (await app.inject({ method: 'GET', url: '/family/domains/travel' })).json()
const addTrip = (values: Record<string, string>) =>
  app.inject({
    method: 'POST',
    url: '/family/domains/travel/records/trip',
    payload: { values },
  })

describe('travel area', () => {
  it('is on the list of areas', async () => {
    const r = await app.inject({ method: 'GET', url: '/family/domains' })
    expect(r.json().domains.map((d: { id: string }) => d.id)).toContain('travel')
  })

  it('says "No travel policy on file." as a fact when none is on file, and stops saying it once one is', async () => {
    expect((await view()).absent).toEqual(['No travel policy on file.'])
    await db.collection('family_financial_profile').insertOne({
      tenant_id: TENANT,
      policies: [{ id: 'p1', type: 'travel', provider: 'Northwind Mutual', member_id: 'sam' }],
    })
    expect((await view()).absent).toEqual([])
  })

  it('holds a trip with dates, country, policy and the assistance line as printed', async () => {
    const res = await addTrip({
      destination: 'Portugal',
      departs: iso(10),
      returns: iso(17),
      policy: 'Northwind annual travel',
      assistance_line: '+44 20 7946 0000',
    })
    expect(res.statusCode).toBe(201)
    const v = await view()
    expect(v.rows).toHaveLength(1)
    expect(v.rows[0].values).toMatchObject({
      destination: 'Portugal',
      assistance_line: '+44 20 7946 0000',
    })
  })

  it('shows the dates of a trip under coming up, and drops them once the trip has ended', async () => {
    await addTrip({ destination: 'Portugal', departs: iso(10), returns: iso(17) })
    await addTrip({ destination: 'Spain', departs: iso(-30), returns: iso(-23) })
    const labels = (await view()).upcoming.map((u: { label: string; row_label: string }) => [
      u.label,
      u.row_label,
    ])
    expect(labels).toContainEqual(['A trip starts', 'Trip · Portugal'])
    expect(labels).toContainEqual(['A trip ends', 'Trip · Portugal'])
    expect(JSON.stringify(labels)).not.toContain('Spain')
  })

  it('rejects a trip date that is not a real date', async () => {
    expect((await addTrip({ destination: 'Portugal', departs: '2026-02-31' })).statusCode).toBe(400)
  })

  it('removes a trip', async () => {
    const { id } = (await addTrip({ destination: 'Portugal', departs: iso(5) })).json()
    expect(
      (await app.inject({ method: 'DELETE', url: `/family/domains/travel/records/${id}` }))
        .statusCode,
    ).toBe(204)
    expect((await view()).rows).toHaveLength(0)
  })

  it('keeps its own words free of advice', () => {
    const travel = DOMAINS.find((d) => d.id === 'travel')!
    const words = JSON.stringify([travel.summary, travel.none_on_file, travel.playbook?.label])
    expect(words).not.toMatch(/\b(should|recommend|buy|best|switch|enough|adequate)\b/i)
  })
})
