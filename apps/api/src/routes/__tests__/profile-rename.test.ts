/**
 * A person changes their name or email in their profile, and the family list must follow
 * (found by the UK household simulation, H30). Written from the family's side:
 *  - Aisha Khan becomes Aisha Raza: the family list shows Aisha Raza, once, with no old copy;
 *  - the family's digests go to her current email, not an address she has left;
 *  - nobody else's entry changes, and a person in another family is untouched.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import fastifyCookie from '@fastify/cookie'
import { AuthService } from '@lifekeel/platform'
import { registerAuthUserRoutes } from '../auth-users.js'
import { closeDb, getDb } from '../../db.js'

let mongod: MongoMemoryServer
let db: Db
let app: FastifyInstance
const auth = new AuthService('test-secret')

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  process.env['MONGODB_URL'] = mongod.getUri()
  process.env['MONGODB_DB'] = 'profile-rename-test'
  app = Fastify()
  await app.register(fastifyCookie)
  app.addHook('onRequest', async (request) => {
    const header = request.headers['authorization']
    if (header?.startsWith('Bearer ')) {
      try {
        request.authContext = await auth.verify(header.slice(7))
      } catch {
        /* unauthenticated */
      }
    }
  })
  await registerAuthUserRoutes(app, auth)
  await app.ready()
  db = await getDb()
})
afterAll(async () => {
  await app.close()
  await closeDb()
  await mongod.stop()
  delete process.env['MONGODB_URL']
  delete process.env['MONGODB_DB']
})

const user = (id: string, tenant: string, name: string) => ({
  id,
  email: `${id}@example.com`,
  name,
  tenant_id: tenant,
  roles: ['viewer'],
  status: 'active',
  created_at: new Date(),
  email_verified: true,
})
const member = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  email: `${id}@example.com`,
  role: 'adult',
  status: 'active',
  joined_at: '2026-01-01',
  ...extra,
})

beforeEach(async () => {
  for (const c of ['users', 'family_groups']) await db.collection(c).deleteMany({})
  await db
    .collection('users')
    .insertMany([
      user('aisha', 't1', 'Aisha Khan'),
      user('ben', 't1', 'Ben Khan'),
      user('zoe', 't2', 'Zoe Other'),
    ])
  await db.collection('family_groups').insertMany([
    {
      id: 'f1',
      tenant_id: 't1',
      name: 'Khans',
      invite_code: 'C1',
      members: [
        member('ben', 'Ben Khan', { role: 'organizer' }),
        // Joined through a member invite: the roster id predates the account.
        member('roster-aisha', 'Aisha Khan', { user_id: 'aisha', email: 'aisha@example.com' }),
      ],
    },
    {
      id: 'f2',
      tenant_id: 't2',
      name: 'Others',
      invite_code: 'C2',
      members: [member('zoe', 'Zoe Other', { role: 'organizer' })],
    },
  ])
})

const put = async (sub: string, tenant: string, payload: object) =>
  app.inject({
    method: 'PUT',
    url: '/auth/profile',
    headers: {
      authorization: `Bearer ${await auth.sign({ sub, tenant_id: tenant, roles: ['viewer'] })}`,
    },
    payload,
  })
const roster = async (tenant: string) =>
  (await db.collection('family_groups').findOne({ tenant_id: tenant }))!['members'] as {
    id: string
    name: string
    email: string
  }[]

describe('profile changes reach the family list', () => {
  it('a new name shows on the family list, once, with no old copy', async () => {
    expect((await put('aisha', 't1', { name: 'Aisha Raza' })).statusCode).toBe(200)
    const names = (await roster('t1')).map((m) => m.name)
    expect(names).toContain('Aisha Raza')
    expect(names).not.toContain('Aisha Khan')
    expect(names.filter((n) => /Aisha/.test(n))).toHaveLength(1)
  })

  it('works for a member whose roster id is the account id too', async () => {
    await put('ben', 't1', { name: 'Ben Raza' })
    expect((await roster('t1')).map((m) => m.name)).toContain('Ben Raza')
  })

  it('a new email goes to the family list, so digests reach her current address', async () => {
    expect((await put('aisha', 't1', { email: 'aisha.new@example.com' })).statusCode).toBe(200)
    const aisha = (await roster('t1')).find((m) => m.id === 'roster-aisha')!
    expect(aisha.email).toBe('aisha.new@example.com')
  })

  it('does not change anyone else, in this family or another', async () => {
    await put('aisha', 't1', { name: 'Aisha Raza', email: 'aisha.new@example.com' })
    const ben = (await roster('t1')).find((m) => m.id === 'ben')!
    expect(ben.name).toBe('Ben Khan')
    expect(ben.email).toBe('ben@example.com')
    expect((await roster('t2'))[0]!.name).toBe('Zoe Other')
  })

  it('a refused change (name too long) leaves the family list alone', async () => {
    const r = await put('aisha', 't1', { name: 'N'.repeat(300) })
    expect(r.statusCode).toBe(400)
    expect((await roster('t1')).find((m) => m.id === 'roster-aisha')!.name).toBe('Aisha Khan')
  })
})
