/**
 * Domain packs, pilot: the cover matrix is derived from existing stores, every
 * adult confirms the exact version they saw, and an edit asks for it again.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerFamilyDomainRoutes } from '../family-domains.js'
import { DOMAINS } from '../../domains/registry.js'
import { DomainPackSchema } from '../../domains/types.js'

const TENANT = 't-dom'
const SAM = 'user-sam'
const ALEX = 'user-alex'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance
let currentUser: string | null = SAM
let currentRoles: string[] = ['admin']

const carPack = DomainPackSchema.parse({
  id: 'car',
  title: 'Car and transport',
  summary: 'Which vehicles are on file.',
  records: [
    {
      key: 'vehicle',
      label: 'Vehicle',
      person_attribution: 'holder',
      source: { kind: 'store' },
      fields: [
        { key: 'reg', label: 'Registration', kind: 'text' },
        { key: 'mot_due', label: 'MOT due', kind: 'date' },
      ],
    },
  ],
  confirm: 'both_adults',
  external: { enabled: false, permitted: { vehicle: ['reg'] } },
})

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('domains-test')
  app = Fastify()
  app.addHook('onRequest', async (request) => {
    if (currentUser)
      (request as unknown as Record<string, unknown>)['authContext'] = {
        tenant_id: TENANT,
        user_id: currentUser,
        roles: currentRoles,
      }
  })
  registerFamilyDomainRoutes(app, db, [...DOMAINS, carPack])
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await client.close()
  await mongod.stop()
})

const policies = (extra: Record<string, unknown>[] = []) => [
  {
    id: 'pol_1',
    type: 'life',
    provider: 'Provider A',
    member_id: 'sam',
    beneficiary_member_id: 'alex',
  },
  {
    id: 'pol_2',
    type: 'life',
    provider: 'Provider B',
    member_id: 'alex',
    beneficiary_member_id: 'sam',
  },
  { id: 'pol_3', type: 'car', provider: 'Motor Co', member_id: 'sam' },
  ...extra,
]

beforeEach(async () => {
  currentUser = SAM
  currentRoles = ['admin']
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  await db.collection('family_groups').insertOne({
    tenant_id: TENANT,
    members: [
      { id: 'sam', user_id: SAM, name: 'Sam', role: 'organizer', status: 'active' },
      { id: 'alex', user_id: ALEX, name: 'Alex', role: 'adult', status: 'active' },
      { id: 'kid', name: 'Kit', role: 'child', status: 'active' },
    ],
  })
  await db
    .collection('family_financial_profile')
    .insertOne({ tenant_id: TENANT, policies: policies() })
})

const get = async () =>
  (await app.inject({ method: 'GET', url: '/family/domains/life_protection' })).json()
const confirm = (v: string) =>
  app.inject({
    method: 'POST',
    url: '/family/domains/life_protection/confirm',
    payload: { result_version: v },
  })

describe('life protection domain', () => {
  it('builds the matrix from existing policies and leaves non-protection types out', async () => {
    const v = await get()
    expect(v.rows.map((r: { id: string }) => r.id).sort()).toEqual(['pol_1', 'pol_2'])
    const row = v.matrix.rows.find((r: { id: string }) => r.id === 'pol_1')
    expect(row.cells).toMatchObject({ sam: 'holds', alex: 'covers', kid: null })
    expect(row.label).toBe('Policy · Provider A')
    expect(v.gaps).toEqual([])
  })

  it('reads employer cover by full name and flags an unmatched name as a fact, not a judgement', async () => {
    await db.collection('employer_cover_facts').insertMany([
      {
        tenant_id: TENANT,
        id: 'ec_1',
        member_label: 'Alex',
        type: 'death_in_service',
        name_as_printed: 'Group Life',
        ends_with_employment: true,
      },
      {
        tenant_id: TENANT,
        id: 'ec_2',
        member_label: 'Pat',
        type: 'income_protection',
        name_as_printed: 'Group IP',
        ends_with_employment: false,
      },
    ])
    const v = await get()
    const ec1 = v.rows.find((r: { id: string }) => r.id === 'ec_1')
    expect(ec1.holder_member_id).toBe('alex')
    expect(v.gaps).toContainEqual({ row_id: 'ec_2', note: 'Not yet matched to a family member' })
  })

  it('needs every adult to confirm the version they saw; a child is not required', async () => {
    const v1 = await get()
    expect(v1.confirmation.required.map((r: { id: string }) => r.id).sort()).toEqual([
      'alex',
      'sam',
    ])
    const first = (await confirm(v1.result_version)).json()
    expect(first.confirmation.both_confirmed).toBe(false)
    expect(first.confirmation.viewer_confirmed).toBe(true)
    currentUser = ALEX
    expect((await get()).confirmation.viewer_confirmed).toBe(false)
    currentUser = SAM
    currentUser = ALEX
    currentRoles = ['viewer']
    const done = (await confirm(v1.result_version)).json()
    expect(done.confirmation.both_confirmed).toBe(true)
  })

  it('is idempotent for the same adult', async () => {
    const v = await get()
    await confirm(v.result_version)
    await confirm(v.result_version)
    expect(await db.collection('domain_confirmations').countDocuments({})).toBe(1)
  })

  it('changes the version on an edit, so both adults must confirm again', async () => {
    const v1 = await get()
    await confirm(v1.result_version)
    await db.collection('family_financial_profile').updateOne(
      { tenant_id: TENANT },
      {
        $set: {
          policies: policies([
            { id: 'pol_4', type: 'critical_illness', provider: 'Provider C', member_id: 'alex' },
          ]),
        },
      },
    )
    const v2 = await get()
    expect(v2.result_version).not.toBe(v1.result_version)
    expect(v2.confirmation.confirmed).toEqual([])
    expect((await confirm(v1.result_version)).statusCode).toBe(409)
  })

  it('refuses a child, a signed-out caller and a malformed body', async () => {
    currentUser = 'kid'
    expect(
      (await app.inject({ method: 'GET', url: '/family/domains/life_protection' })).statusCode,
    ).toBe(401)
    currentUser = null
    expect((await app.inject({ method: 'GET', url: '/family/domains' })).statusCode).toBe(401)
    currentUser = SAM
    expect((await confirm('short')).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/family/domains/nope' })).statusCode).toBe(404)
  })

  it('does not expose the external declaration', async () => {
    const r = (await app.inject({ method: 'GET', url: '/family/domains' })).json()
    expect(JSON.stringify(r)).not.toContain('external')
  })

  it('is tenant-scoped', async () => {
    await db.collection('family_financial_profile').insertOne({
      tenant_id: 'other',
      policies: [{ id: 'x', type: 'life', provider: 'Other', member_id: 'z' }],
    })
    expect((await get()).rows.map((r: { id: string }) => r.id)).not.toContain('x')
  })
})

describe('store-backed records (extension proof: a pack added as data)', () => {
  const add = (values: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: '/family/domains/car/records/vehicle',
      payload: { holder_member_id: 'sam', values },
    })

  it('stores, lists and removes a household-entered record', async () => {
    const r = await add({ reg: 'AB12 CDE', mot_due: '2027-02-01' })
    expect(r.statusCode).toBe(201)
    const v = (await app.inject({ method: 'GET', url: '/family/domains/car' })).json()
    expect(v.rows).toHaveLength(1)
    expect(v.rows[0].values.reg).toBe('AB12 CDE')
    expect(v.matrix).toBeNull()
    await app.inject({ method: 'DELETE', url: `/family/domains/car/records/${r.json().id}` })
    expect((await app.inject({ method: 'GET', url: '/family/domains/car' })).json().rows).toEqual(
      [],
    )
  })

  it('rejects unknown fields, secret-shaped text and read-only records; viewers cannot write', async () => {
    expect((await add({ nope: 'x' })).statusCode).toBe(400)
    expect((await add({ reg: 'password: hunter2' })).statusCode).toBe(400)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/family/domains/life_protection/records/policy',
          payload: { values: {} },
        })
      ).statusCode,
    ).toBe(400)
    currentRoles = ['viewer']
    expect((await add({ reg: 'AB12 CDE' })).statusCode).toBe(403)
  })
})
