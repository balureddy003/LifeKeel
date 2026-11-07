/**
 * Decision (owner, 2026-11-07): the organizer can let a second adult add and
 * edit household records. The grant lives on the roster member, so it applies
 * at once on the adult's existing session and ends when they are removed or
 * become a child. Only the organizer can change it; the organizer, children
 * and people who have not joined cannot be targeted.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerFamilyGroupRoutes } from '../family-group.js'
import { registerFamilyDomainRoutes } from '../family-domains.js'
import { isHouseholdEditor } from '../../family/family-permissions.js'

const T = 't-edit'
let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance
let user = 'sam'
let roles: string[] = ['admin']

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('edit-access')
  app = Fastify()
  app.addHook('onRequest', async (req) => {
    ;(req as unknown as Record<string, unknown>)['authContext'] = {
      tenant_id: T,
      user_id: user,
      roles,
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
beforeEach(async () => {
  user = 'sam'
  roles = ['admin']
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  await db.collection('family_groups').insertOne({
    id: 'fam',
    tenant_id: T,
    name: 'Fam',
    invite_code: 'CODE01',
    members: [
      {
        id: 'sam',
        user_id: 'sam',
        name: 'Sam',
        email: 's@x.test',
        role: 'organizer',
        status: 'active',
        joined_at: '2026-01-01',
      },
      {
        id: 'alex',
        user_id: 'alex',
        name: 'Alex',
        email: 'a@x.test',
        role: 'adult',
        status: 'active',
        joined_at: '2026-01-01',
      },
      {
        id: 'pat',
        name: 'Pat',
        email: 'p@x.test',
        role: 'adult',
        status: 'pending',
        joined_at: '2026-01-01',
      },
      {
        id: 'kit',
        name: 'Kit',
        email: 'k@x.test',
        role: 'child',
        status: 'active',
        joined_at: '2026-01-01',
      },
    ],
    created_at: new Date(),
    updated_at: new Date(),
  })
})

const grant = (id: string, enabled: unknown = true) =>
  app.inject({ method: 'PUT', url: `/family/members/${id}/edit-access`, payload: { enabled } })
const addVehicle = () =>
  app.inject({
    method: 'POST',
    url: '/family/domains/car/records/vehicle',
    payload: { values: { reg: 'AB12 CDE' } },
  })
const alexMember = async () =>
  (await db.collection('family_groups').findOne({ tenant_id: T }))!['members'].find(
    (m: { id: string }) => m.id === 'alex',
  )

describe('organizer grants edit access', () => {
  it('lets the organizer grant and revoke, and says so on the member', async () => {
    const on = await grant('alex')
    expect(on.statusCode).toBe(200)
    expect(on.json().family.members.find((m: { id: string }) => m.id === 'alex').canEdit).toBe(true)
    const off = await grant('alex', false)
    expect(off.statusCode).toBe(200)
    expect(
      off.json().family.members.find((m: { id: string }) => m.id === 'alex').canEdit,
    ).toBeUndefined()
    expect((await alexMember()).can_edit).toBeUndefined()
  })

  it('takes effect at once on the second adult’s existing viewer session, and ends on revoke', async () => {
    user = 'alex'
    roles = ['viewer']
    expect((await addVehicle()).statusCode).toBe(403)
    user = 'sam'
    roles = ['admin']
    await grant('alex')
    user = 'alex'
    roles = ['viewer']
    expect((await addVehicle()).statusCode).toBe(201)
    user = 'sam'
    roles = ['admin']
    await grant('alex', false)
    user = 'alex'
    roles = ['viewer']
    expect((await addVehicle()).statusCode).toBe(403)
  })

  it('only the organizer can change it', async () => {
    user = 'alex'
    roles = ['viewer']
    expect((await grant('alex')).statusCode).toBe(403)
    expect((await alexMember()).can_edit).toBeUndefined()
  })

  it('refuses the organizer, a child, someone who has not joined, an unknown member and a non-boolean', async () => {
    expect((await grant('sam')).statusCode).toBe(409)
    expect((await grant('kit')).statusCode).toBe(400)
    expect((await grant('pat')).statusCode).toBe(400)
    expect((await grant('nobody')).statusCode).toBe(404)
    expect((await grant('alex', 'yes')).statusCode).toBe(400)
    expect((await grant('alex', null)).statusCode).toBe(400)
  })

  it('is dropped when the adult becomes a child', async () => {
    await grant('alex')
    const r = await app.inject({
      method: 'PATCH',
      url: '/family/members/alex',
      payload: { role: 'child' },
    })
    expect(r.statusCode).toBe(200)
    expect((await alexMember()).can_edit).toBeUndefined()
  })
})

describe('isHouseholdEditor with the grant', () => {
  const setMember = (over: Record<string, unknown>) =>
    db.collection('family_groups').updateOne(
      { tenant_id: T, 'members.id': 'alex' },
      {
        $set: Object.fromEntries(Object.entries(over).map(([k, v]) => [`members.$.${k}`, v])),
      },
    )

  it('needs the grant, an active member and an adult', async () => {
    expect(await isHouseholdEditor(db, T, 'alex', ['viewer'])).toBe(false)
    await setMember({ can_edit: true })
    expect(await isHouseholdEditor(db, T, 'alex', ['viewer'])).toBe(true)
    await setMember({ status: 'pending' })
    expect(await isHouseholdEditor(db, T, 'alex', ['viewer'])).toBe(false)
    await setMember({ status: 'active', date_of_birth: '2015-01-01' })
    expect(await isHouseholdEditor(db, T, 'alex', ['viewer'])).toBe(false)
  })

  it('does not grant anything to a stranger on the same tenant', async () => {
    expect(await isHouseholdEditor(db, T, 'stranger', ['viewer'])).toBe(false)
  })
})
