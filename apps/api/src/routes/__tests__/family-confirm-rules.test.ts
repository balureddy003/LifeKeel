/**
 * Who must confirm the family list. Found by the UK household simulation
 * (H09, H10), expectations written from the family's side:
 *  - an adult who is on the list but has not joined yet still has to see it, so
 *    the list is not called "seen by every adult" while they have not;
 *  - the organizer can say a person does not need to confirm (someone they care
 *    for), and then the list does not wait for them;
 *  - children, and anyone under 18, are never asked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerFamilyGroupRoutes } from '../family-group.js'
import { registerFamilyDomainRoutes } from '../family-domains.js'

const T = 't-confirm'
let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance
let user = 'sam'

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('confirm-rules')
  app = Fastify()
  app.addHook('onRequest', async (req) => {
    ;(req as unknown as Record<string, unknown>)['authContext'] = {
      tenant_id: T,
      user_id: user,
      roles: ['admin'],
    }
  })
  registerFamilyGroupRoutes(app, db)
  registerFamilyDomainRoutes(app, db)
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await client.close()
  await mongod.stop()
})

const member = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  email: `${id}@x.test`,
  role: 'adult',
  status: 'active',
  joined_at: '2026-01-01',
  ...extra,
})

beforeEach(async () => {
  user = 'sam'
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  await db.collection('family_groups').insertOne({
    id: 'fam',
    tenant_id: T,
    name: 'Fam',
    invite_code: 'CODE01',
    members: [
      member('sam', { role: 'organizer', user_id: 'sam' }),
      member('alex', { user_id: 'alex' }),
      member('grandad', { status: 'pending' }),
      member('kid', { role: 'child', status: 'pending' }),
      member('teen', { user_id: 'teen', date_of_birth: '2012-01-01' }),
    ],
  })
  await db.collection('domain_records').insertOne({
    tenant_id: T,
    id: 'dr1',
    domain_id: 'car',
    record: 'vehicle',
    holder_member_id: null,
    covers_member_id: null,
    values: { reg: 'AB12' },
    created_by: 'sam',
    created_at: new Date(),
    updated_at: new Date(),
  })
})

async function confirmAs(u: string) {
  user = u
  const v = (await app.inject({ method: 'GET', url: '/family/domains/car' })).json()
  return app.inject({
    method: 'POST',
    url: '/family/domains/car/confirm',
    payload: { result_version: v.result_version },
  })
}
async function state() {
  user = 'sam'
  const r = await app.inject({ method: 'GET', url: '/family/domains/car' })
  return r.json().confirmation as {
    required: { id: string }[]
    both_confirmed: boolean
  }
}

describe('who has to confirm', () => {
  it('an adult who has not joined yet still has to see it, and is named', async () => {
    await confirmAs('sam')
    await confirmAs('alex')
    const c = await state()
    expect(c.required.map((r) => r.id)).toContain('grandad')
    expect(c.both_confirmed).toBe(false)
  })

  it('children and anyone under 18 are never asked, joined or not', async () => {
    const c = await state()
    const ids = c.required.map((r) => r.id)
    expect(ids).not.toContain('kid')
    expect(ids).not.toContain('teen')
  })

  it('once the organizer says someone does not need to confirm, the list stops waiting for them', async () => {
    user = 'sam'
    const put = await app.inject({
      method: 'PUT',
      url: '/family/members/grandad/confirm-exempt',
      payload: { exempt: true },
    })
    expect(put.statusCode).toBe(200)
    await confirmAs('sam')
    await confirmAs('alex')
    const c = await state()
    expect(c.required.map((r) => r.id)).not.toContain('grandad')
    expect(c.both_confirmed).toBe(true)
  })

  it('turning it back on makes the list wait for them again', async () => {
    user = 'sam'
    await app.inject({
      method: 'PUT',
      url: '/family/members/grandad/confirm-exempt',
      payload: { exempt: true },
    })
    await app.inject({
      method: 'PUT',
      url: '/family/members/grandad/confirm-exempt',
      payload: { exempt: false },
    })
    const c = await state()
    expect(c.required.map((r) => r.id)).toContain('grandad')
  })
})

describe('PUT /family/members/:id/confirm-exempt', () => {
  const put = (id: string, payload: unknown) =>
    app.inject({
      method: 'PUT',
      url: `/family/members/${id}/confirm-exempt`,
      payload: payload as object,
    })

  it('is for the organizer only', async () => {
    user = 'alex'
    expect((await put('grandad', { exempt: true })).statusCode).toBe(403)
  })
  it('the organizer always confirms', async () => {
    user = 'sam'
    expect((await put('sam', { exempt: true })).statusCode).toBe(409)
  })
  it('children are never asked, so there is nothing to switch', async () => {
    user = 'sam'
    expect((await put('kid', { exempt: true })).statusCode).toBe(400)
  })
  it('refuses a missing person and a non-boolean', async () => {
    user = 'sam'
    expect((await put('nobody', { exempt: true })).statusCode).toBe(404)
    expect((await put('grandad', { exempt: 'yes' })).statusCode).toBe(400)
  })
  it('shows the setting on the roster', async () => {
    user = 'sam'
    await put('grandad', { exempt: true })
    const fam = (await app.inject({ method: 'GET', url: '/family' })).json().family
    expect(fam.members.find((m: { id: string }) => m.id === 'grandad').confirmExempt).toBe(true)
  })
})
