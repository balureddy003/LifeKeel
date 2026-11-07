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

const TENANT = 't-dom'
const SAM = 'user-sam'
const ALEX = 'user-alex'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance
let currentUser: string | null = SAM
let currentRoles: string[] = ['admin']

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
  registerFamilyDomainRoutes(app, db, DOMAINS)
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

const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

describe('planning dates', () => {
  it('lists renewals inside the lead time or already past, soonest first, and nothing later', async () => {
    await db.collection('family_financial_profile').updateOne(
      { tenant_id: TENANT },
      {
        $set: {
          policies: [
            {
              id: 'a',
              type: 'life',
              provider: 'Soon',
              member_id: 'sam',
              renewal_date: daysFromNow(10),
            },
            {
              id: 'b',
              type: 'life',
              provider: 'Past',
              member_id: 'sam',
              renewal_date: daysFromNow(-3),
            },
            {
              id: 'c',
              type: 'life',
              provider: 'Far',
              member_id: 'sam',
              renewal_date: daysFromNow(200),
            },
            { id: 'd', type: 'life', provider: 'None', member_id: 'sam' },
            {
              id: 'e',
              type: 'car',
              provider: 'Motor',
              member_id: 'sam',
              renewal_date: daysFromNow(5),
            },
          ],
        },
      },
    )
    const v = await get()
    expect(v.upcoming.map((u: { row_id: string }) => u.row_id)).toEqual(['b', 'a'])
    expect(v.upcoming[0]).toMatchObject({ trigger: 'renewal', days: -3 })
    expect(v.upcoming[1].days).toBe(10)
  })

  it('does not change the version the adults confirm', async () => {
    const a = await get()
    expect(a.upcoming).toEqual([])
    expect(a.result_version).toHaveLength(64)
  })
})

describe('bereavement playbook binding', () => {
  const pb = async (member?: string) =>
    app.inject({
      method: 'GET',
      url: `/family/domains/life_protection/playbook${member ? `?member=${member}` : ''}`,
    })

  it('shows only what is relevant to the named person, and leaves other people alone', async () => {
    await db.collection('family_financial_profile').updateOne(
      { tenant_id: TENANT },
      {
        $set: {
          policies: [
            {
              id: 'p_sam',
              type: 'life',
              provider: 'Own A',
              member_id: 'sam',
              contact_phone: '0800 111',
            },
            {
              id: 'p_alex_covers_sam',
              type: 'life',
              provider: 'Alex B',
              member_id: 'alex',
              beneficiary_member_id: 'sam',
            },
            { id: 'p_alex_own', type: 'income_protection', provider: 'Alex C', member_id: 'alex' },
            { id: 'p_unk', type: 'life', provider: 'Unknown D' },
            { id: 'p_car', type: 'car', provider: 'Motor', member_id: 'sam' },
          ],
        },
      },
    )
    await db.collection('employer_cover_facts').insertOne({
      tenant_id: TENANT,
      id: 'ec_sam',
      member_label: 'Sam',
      type: 'death_in_service',
      name_as_printed: 'Group Life',
      ends_with_employment: true,
    })
    const r = await pb('sam')
    expect(r.statusCode).toBe(200)
    const by = Object.fromEntries(
      r
        .json()
        .groups.map((g: { key: string; rows: { id: string }[] }) => [
          g.key,
          g.rows.map((x) => x.id),
        ]),
    )
    expect(by['theirs'].sort()).toEqual(['ec_sam', 'p_sam'])
    expect(by['covers']).toEqual(['p_alex_covers_sam'])
    expect(by['to_check']).toEqual(['p_unk'])
    expect(by['others']).toEqual(['p_alex_own'])
    expect(JSON.stringify(r.json())).not.toContain('p_car')
    expect(
      r.json().groups[0].rows.find((x: { id: string }) => x.id === 'p_sam').claims_contact,
    ).toBe('0800 111')
  })

  it('needs a named person on the roster, and adults only', async () => {
    expect((await pb()).statusCode).toBe(400)
    expect((await pb('stranger')).statusCode).toBe(400)
    currentUser = 'kid'
    expect((await pb('sam')).statusCode).toBe(401)
  })

  it('is not offered for an unknown domain', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/family/domains/nope/playbook?member=sam' }))
        .statusCode,
    ).toBe(404)
  })
})

describe('car and transport: a second domain added as data only', () => {
  const car = async () => (await app.inject({ method: 'GET', url: '/family/domains/car' })).json()

  it('reads car policies from the profile, takes vehicles from the household, and has no matrix', async () => {
    await app.inject({
      method: 'POST',
      url: '/family/domains/car/records/vehicle',
      payload: { holder_member_id: 'sam', values: { reg: 'AB12 CDE', mot_due: daysFromNow(12) } },
    })
    const v = await car()
    expect(v.matrix).toBeNull()
    expect(v.rows.map((r: { id: string }) => r.id)).toContain('pol_3')
    expect(v.rows.map((r: { id: string }) => r.id)).not.toContain('pol_1')
    expect(v.upcoming).toHaveLength(1)
    expect(v.upcoming[0]).toMatchObject({ trigger: 'mot', days: 12 })
  })

  it('tells a generic page what to draw: the pack, the roster and edit rights', async () => {
    const v = await car()
    expect(v.pack.title).toBe('Car and transport')
    expect(v.pack.records.map((r: { key: string }) => r.key)).toEqual(['vehicle', 'policy'])
    expect(v.pack.external).toBeUndefined()
    expect(v.roster.map((r: { id: string }) => r.id)).toContain('sam')
    expect(v.can_edit).toBe(true)
    currentRoles = ['viewer']
    expect((await car()).can_edit).toBe(false)
  })

  it('confirms like any pack, and the vehicle list is part of the version', async () => {
    const v1 = await car()
    await app.inject({
      method: 'POST',
      url: '/family/domains/car/records/vehicle',
      payload: { values: { reg: 'ZZ99 ZZZ' } },
    })
    const v2 = await car()
    expect(v2.result_version).not.toBe(v1.result_version)
    const done = await app.inject({
      method: 'POST',
      url: '/family/domains/car/confirm',
      payload: { result_version: v2.result_version },
    })
    expect(done.json().confirmation.viewer_confirmed).toBe(true)
    expect(done.json().pack.id).toBe('car')
  })

  it('binds its own first-steps label and records for a named person', async () => {
    const r = await app.inject({ method: 'GET', url: '/family/domains/car/playbook?member=sam' })
    expect(r.statusCode).toBe(200)
    expect(r.json().playbook).toBe('car')
    expect(r.json().groups[0].rows.map((x: { id: string }) => x.id)).toContain('pol_3')
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
    const vehicles = v.rows.filter((r: { record: string }) => r.record === 'vehicle')
    expect(vehicles).toHaveLength(1)
    expect(vehicles[0].values.reg).toBe('AB12 CDE')
    expect(v.matrix).toBeNull()
    await app.inject({ method: 'DELETE', url: `/family/domains/car/records/${r.json().id}` })
    const after = (await app.inject({ method: 'GET', url: '/family/domains/car' })).json()
    expect(after.rows.filter((x: { record: string }) => x.record === 'vehicle')).toEqual([])
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
