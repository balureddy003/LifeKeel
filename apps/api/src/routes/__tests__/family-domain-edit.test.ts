/** A stored record can be corrected in place, under the same rules as adding one. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerFamilyDomainRoutes } from '../family-domains.js'
import { DOMAINS } from '../../domains/registry.js'

const TENANT = 't-edit'
let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance
let roles = ['admin']

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('edit-test')
  app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as unknown as Record<string, unknown>)['authContext'] = {
      tenant_id: TENANT,
      user_id: 'user-sam',
      roles,
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
  roles = ['admin']
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  await db.collection('family_groups').insertOne({
    tenant_id: TENANT,
    members: [
      { id: 'sam', user_id: 'user-sam', name: 'Sam', role: 'organizer', status: 'active' },
      { id: 'alex', name: 'Alex', role: 'adult', status: 'active' },
    ],
  })
})

const add = async (values: Record<string, string>) =>
  (
    await app.inject({
      method: 'POST',
      url: '/family/domains/car/records/vehicle',
      payload: { values },
    })
  ).json().id as string
const edit = (id: string, payload: object) =>
  app.inject({ method: 'PUT', url: `/family/domains/car/records/${id}`, payload })
const rows = async () =>
  (await app.inject({ method: 'GET', url: '/family/domains/car' })).json().rows

describe('editing a stored record', () => {
  it('replaces the values and the holder, keeping the same record', async () => {
    const id = await add({ reg: 'AB12 CDE', mot_due: '2027-01-01' })
    const res = await edit(id, {
      holder_member_id: 'alex',
      values: { reg: 'AB12 CDE', mot_due: '2027-02-02', make_model: 'Fictional Estate' },
    })
    expect(res.statusCode).toBe(200)
    const r = (await rows()).find((x: { id: string }) => x.id === id)
    expect(r.values).toEqual({
      reg: 'AB12 CDE',
      mot_due: '2027-02-02',
      make_model: 'Fictional Estate',
    })
    expect(r.holder_member_id).toBe('alex')
    expect(await rows()).toHaveLength(1)
  })

  it('refuses the same checks as adding: bad date, unknown field, secret-looking value, unknown person', async () => {
    const id = await add({ reg: 'AB12 CDE' })
    expect(
      (await edit(id, { values: { reg: 'AB12 CDE', mot_due: '2027-02-31' } })).statusCode,
    ).toBe(400)
    expect((await edit(id, { values: { nope: 'x' } })).statusCode).toBe(400)
    expect(
      (await edit(id, { values: { reg: 'AB12 CDE', recovery_contact: 'password: hunter2' } }))
        .statusCode,
    ).toBe(400)
    expect(
      (await edit(id, { holder_member_id: 'ghost', values: { reg: 'AB12 CDE' } })).statusCode,
    ).toBe(400)
  })

  it('will not make two records the same thing, but allows keeping its own identity', async () => {
    await add({ reg: 'AB12 CDE' })
    const other = await add({ reg: 'ZZ99 ZZZ' })
    expect((await edit(other, { values: { reg: 'ab12-cde' } })).statusCode).toBe(409)
    expect(
      (await edit(other, { values: { reg: 'zz99 zzz', mot_due: '2027-03-03' } })).statusCode,
    ).toBe(200)
  })

  it('needs a household editor, and 404s for a record that is not there or is read from elsewhere', async () => {
    const id = await add({ reg: 'AB12 CDE' })
    expect((await edit('dr_missing', { values: { reg: 'X' } })).statusCode).toBe(404)
    roles = ['member']
    expect(
      (await edit(id, { values: { reg: 'AB12 CDE', mot_due: '2027-01-01' } })).statusCode,
    ).toBe(403)
  })
})
