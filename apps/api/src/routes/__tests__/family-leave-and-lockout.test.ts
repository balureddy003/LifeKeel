/**
 * Safety rules for who can leave, and who can remove whom (found by the UK household
 * simulation, H23 and H25). Written from the family's side:
 *  - an adult who needs to get out can leave on their own, without the organizer;
 *  - an organizer cannot leave and strand the family with nobody in charge;
 *  - whoever is made an organizer can never remove the person who made them one, so a
 *    handover made under pressure cannot lock the victim out, and the victim can always
 *    take control back.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerFamilyGroupRoutes } from '../family-group.js'

const T = 't-leave'
let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance
let user = 'ife'
let roles: string[] = ['owner']

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('leave-lockout')
  app = Fastify()
  app.addHook('onRequest', async (req) => {
    ;(req as unknown as Record<string, unknown>)['authContext'] = {
      tenant_id: T,
      user_id: user,
      roles,
    }
  })
  registerFamilyGroupRoutes(app, db)
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await client.close()
  await mongod.stop()
})

const m = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  user_id: id,
  name: id,
  email: `${id}@x.test`,
  role: 'adult',
  status: 'active',
  joined_at: '2026-01-01',
  ...extra,
})

beforeEach(async () => {
  user = 'ife'
  roles = ['owner']
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  await db
    .collection('users')
    .insertMany(
      ['ife', 'marcus', 'ned', 'teen'].map((id) => ({
        tenant_id: T,
        id,
        email: `${id}@x.test`,
        status: 'active',
        roles: ['viewer'],
      })),
    )
  await db.collection('family_groups').insertOne({
    id: 'fam',
    tenant_id: T,
    name: 'Fam',
    invite_code: 'CODE01',
    members: [
      m('ife', { role: 'organizer' }),
      m('marcus'),
      m('ned'),
      m('teen', { role: 'child', date_of_birth: '2012-01-01' }),
    ],
  })
})

const del = (id: string) => app.inject({ method: 'DELETE', url: `/family/members/${id}` })
const patch = (id: string, payload: object) =>
  app.inject({ method: 'PATCH', url: `/family/members/${id}`, payload })
const members = async () =>
  (await app.inject({ method: 'GET', url: '/family' })).json().family.members as {
    id: string
    role: string
  }[]
const userStatus = async (id: string) => (await db.collection('users').findOne({ id }))?.['status']

describe('leaving on your own', () => {
  it('an adult can leave without the organizer, and is cut off', async () => {
    user = 'ned'
    roles = ['viewer']
    const r = await del('ned')
    expect(r.statusCode).toBe(200)
    expect((await members()).some((x) => x.id === 'ned')).toBe(false)
    expect(await userStatus('ned')).toBe('removed')
  })

  it('an adult still cannot remove someone else', async () => {
    user = 'ned'
    roles = ['viewer']
    expect((await del('marcus')).statusCode).toBe(403)
  })

  it('a child cannot remove themselves; that is for a parent to decide', async () => {
    user = 'teen'
    roles = ['viewer']
    expect((await del('teen')).statusCode).toBe(403)
  })

  it('the account owner cannot leave (ownership has to be handed over first)', async () => {
    user = 'ife'
    expect((await del('ife')).statusCode).toBe(409)
  })

  it('an organizer who is the only one cannot leave and strand the family', async () => {
    await db
      .collection('family_groups')
      .updateOne(
        { id: 'fam' },
        { $set: { 'members.1.role': 'organizer', 'members.0.role': 'adult' } },
      )
    user = 'marcus'
    roles = ['viewer']
    const r = await del('marcus')
    expect(r.statusCode).toBe(409)
    expect(r.json().error).toMatch(/hand over/i)
  })

  it('an organizer can leave once there is another organizer', async () => {
    await db
      .collection('family_groups')
      .updateOne({ id: 'fam' }, { $set: { 'members.1.role': 'organizer' } })
    user = 'marcus'
    roles = ['viewer']
    expect((await del('marcus')).statusCode).toBe(200)
  })
})

describe('a handover cannot lock the person out', () => {
  it('records who made someone an organizer', async () => {
    user = 'ife'
    expect((await patch('marcus', { role: 'organizer' })).statusCode).toBe(200)
    const doc = await db.collection('family_groups').findOne({ id: 'fam' })
    expect(
      (doc!['members'] as { id: string; made_organizer_by?: string }[]).find(
        (x) => x.id === 'marcus',
      )!.made_organizer_by,
    ).toBe('ife')
  })

  it('the person who was made organizer cannot remove the one who made them', async () => {
    user = 'ife'
    await patch('marcus', { role: 'organizer' })
    user = 'marcus'
    roles = ['viewer']
    expect((await del('ife')).statusCode).toBe(409)
    expect((await members()).some((x) => x.id === 'ife')).toBe(true)
  })

  it('and cannot take their organizer role away either', async () => {
    user = 'ife'
    await patch('marcus', { role: 'organizer' })
    user = 'marcus'
    roles = ['viewer']
    expect((await patch('ife', { role: 'adult' })).statusCode).toBe(409)
  })

  it('the one who handed over can always take control back', async () => {
    user = 'ife'
    await patch('marcus', { role: 'organizer' })
    expect((await del('marcus')).statusCode).toBe(200)
    expect((await members()).some((x) => x.id === 'marcus')).toBe(false)
  })

  it('or demote them without removing them', async () => {
    user = 'ife'
    await patch('marcus', { role: 'organizer' })
    expect((await patch('marcus', { role: 'adult' })).statusCode).toBe(200)
    const doc = await db.collection('family_groups').findOne({ id: 'fam' })
    const row = (
      doc!['members'] as { id: string; role: string; made_organizer_by?: string }[]
    ).find((x) => x.id === 'marcus')!
    expect(row.role).toBe('adult')
    expect(row.made_organizer_by).toBeUndefined()
  })

  it('an organizer can step down once there is another', async () => {
    user = 'ife'
    await patch('marcus', { role: 'organizer' })
    user = 'marcus'
    roles = ['viewer']
    expect((await patch('marcus', { role: 'adult' })).statusCode).toBe(200)
  })

  it('a sole organizer cannot step down and leave nobody in charge', async () => {
    user = 'ife'
    expect((await patch('ife', { role: 'adult' })).statusCode).toBe(409)
  })
})
