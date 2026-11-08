/**
 * One car per registration (found by the UK household simulation, H38). Written from the
 * family's side: saving the same car twice, by a double tap on a slow connection or by two
 * adults, leaves it on the list once and says so plainly. A different car, another family's
 * car and a car removed and added back are all fine. Records with no natural identity
 * (a pack opts in) keep allowing repeats.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerFamilyGroupRoutes } from '../family-group.js'
import { registerFamilyDomainRoutes } from '../family-domains.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance
let tenant = 't-one'

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('domain-identity')
  app = Fastify()
  app.addHook('onRequest', async (req) => {
    ;(req as unknown as Record<string, unknown>)['authContext'] = {
      tenant_id: tenant,
      user_id: 'sam',
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
beforeEach(async () => {
  tenant = 't-one'
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  for (const t of ['t-one', 't-two'])
    await db.collection('family_groups').insertOne({
      id: `fam-${t}`,
      tenant_id: t,
      name: 'Fam',
      invite_code: `C-${t}`,
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
      ],
    })
})

const addCar = (reg: string | undefined, extra: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: '/family/domains/car/records/vehicle',
    payload: {
      values: { ...(reg === undefined ? {} : { reg }), make_model: 'Hatchback', ...extra },
    },
  })
const regs = async () =>
  (
    (await app.inject({ method: 'GET', url: '/family/domains/car' })).json().rows as {
      values: { reg?: string }
    }[]
  ).map((r) => r.values.reg)

describe('one car per registration', () => {
  it('saving the same car twice leaves it on the list once, and says so', async () => {
    expect((await addCar('AB12 CDE')).statusCode).toBe(201)
    const again = await addCar('AB12 CDE')
    expect(again.statusCode).toBe(409)
    expect(again.json().error).toMatch(/already on the list/i)
    expect(await regs()).toEqual(['AB12 CDE'])
  })

  it('ignores spaces, dashes and capitals when deciding it is the same car', async () => {
    await addCar('AB12 CDE')
    expect((await addCar('ab12cde')).statusCode).toBe(409)
    expect((await addCar('AB-12-CDE')).statusCode).toBe(409)
  })

  it('a double tap (two saves at once) leaves exactly one', async () => {
    const [a, b, c] = await Promise.all([
      addCar('XY99 ZZZ'),
      addCar('XY99 ZZZ'),
      addCar('XY99 ZZZ'),
    ])
    expect([a, b, c].filter((r) => r.statusCode === 201)).toHaveLength(1)
    expect([a, b, c].filter((r) => r.statusCode === 409)).toHaveLength(2)
    expect(await regs()).toEqual(['XY99 ZZZ'])
  })

  it('a different car is fine, and so is another family with the same registration', async () => {
    await addCar('AB12 CDE')
    expect((await addCar('ZZ11 AAA')).statusCode).toBe(201)
    tenant = 't-two'
    expect((await addCar('AB12 CDE')).statusCode).toBe(201)
  })

  it('a car with no registration given can be saved more than once', async () => {
    expect((await addCar(undefined)).statusCode).toBe(201)
    expect((await addCar(undefined)).statusCode).toBe(201)
    expect((await addCar('   ')).statusCode).toBe(201)
  })

  it('removing a car lets it be added back', async () => {
    const first = await addCar('AB12 CDE')
    await app.inject({ method: 'DELETE', url: `/family/domains/car/records/${first.json().id}` })
    expect((await addCar('AB12 CDE')).statusCode).toBe(201)
  })

  it('also catches a car saved before this rule existed', async () => {
    await db.collection('domain_records').insertOne({
      tenant_id: 't-one',
      id: 'dr_old',
      domain_id: 'car',
      record: 'vehicle',
      holder_member_id: null,
      covers_member_id: null,
      values: { reg: 'OLD 123' },
      created_by: 'sam',
      created_at: new Date(),
      updated_at: new Date(),
    })
    expect((await addCar('old123')).statusCode).toBe(409)
  })
})
