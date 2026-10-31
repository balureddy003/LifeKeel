/**
 * PRD-231 single-point-of-failure map: obligation CRUD, the summary line,
 * and the creator's-estimate rule — a row naming the other adult stays
 * unconfirmed until that adult (not the creator) confirms it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db, type Document } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerHouseholdObligationRoutes } from '../household-obligations.js'

const TENANT = 't-map'
const CREATOR = 'user-sam'
const PARTNER = 'user-alex'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance
let currentUser: string | null = CREATOR
let currentRoles: string[] = ['admin']

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('obligations-test')
  app = Fastify()
  app.addHook('onRequest', async (request) => {
    if (currentUser) {
      ;(request as unknown as Record<string, unknown>)['authContext'] = {
        tenant_id: TENANT,
        user_id: currentUser,
        roles: currentRoles,
      }
    }
  })
  registerHouseholdObligationRoutes(app, db)
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await client.close()
  await mongod.stop()
})

const ROW = {
  label: 'Mortgage payment',
  named_person: 'Sam',
  pays_from: "Sam's card",
  next_due_date: '2026-12-14',
  recurrence: 'monthly',
}

beforeEach(async () => {
  currentUser = CREATOR
  currentRoles = ['admin']
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  // Two active adults: Sam (the creator) and Alex.
  await db.collection('family_groups').insertOne({
    tenant_id: TENANT,
    members: [
      { id: 'm-sam', user_id: CREATOR, name: 'Sam', role: 'adult', status: 'active' },
      { id: 'm-alex', user_id: PARTNER, name: 'Alex', role: 'adult', status: 'active' },
    ],
  })
})

const create = (body: Record<string, unknown> = ROW) =>
  app.inject({ method: 'POST', url: '/family/obligations', payload: body })
const map = () => app.inject({ method: 'GET', url: '/family/obligations/map' })

/** Add a third active adult with the viewer role (read-only user). */
const addViewer = async () => {
  const g = await db.collection<Document>('family_groups').findOne({ tenant_id: TENANT })
  const members = (g?.['members'] as Document[] | undefined) ?? []
  await db.collection('family_groups').updateOne(
    { tenant_id: TENANT },
    {
      $set: {
        members: [
          ...members,
          { id: 'm-v', user_id: 'user-viewer', name: 'Vik', role: 'adult', status: 'active' },
        ],
      },
    },
  )
}

describe('gates', () => {
  it('needs a session and an adult for reads, an editor for writes', async () => {
    currentUser = null
    expect((await map()).statusCode).toBe(401)
    expect((await create()).statusCode).toBe(401)
    currentUser = 'user-viewer'
    currentRoles = ['viewer']
    await addViewer()
    expect((await create()).statusCode).toBe(403)
    expect((await map()).statusCode).toBe(200)
  })

  it('is tenant-scoped', async () => {
    await create()
    const docs = await db.collection('household_obligations').find({}).toArray()
    expect(docs.every((d) => d['tenant_id'] === TENANT)).toBe(true)
  })
})

describe('the map and summary', () => {
  it('counts rows and reports the earliest due date', async () => {
    await create()
    await create({
      ...ROW,
      label: 'Council tax',
      named_person: 'Alex',
      next_due_date: '2026-11-01',
    })
    const r = await map()
    expect(r.statusCode).toBe(200)
    const { summary, obligations } = r.json()
    expect(summary.dependent_count).toBe(2)
    expect(summary.earliest_due_date).toBe('2026-11-01')
    expect(summary.earliest_due_label).toBe('Council tax')
    expect(obligations[0].label).toBe('Council tax') // sorted by due date
  })

  it('empty household gets an empty summary, not an error', async () => {
    const { summary } = (await map()).json()
    expect(summary).toEqual({
      dependent_count: 0,
      total_count: 0,
      earliest_due_date: null,
      earliest_due_label: null,
    })
  })
})

describe("creator's estimate", () => {
  it('a row naming the other adult is pending until they confirm', async () => {
    const r = await create({ ...ROW, named_person: 'Alex' })
    expect(r.statusCode).toBe(201)
    const row = r.json().obligation
    expect(row.pending_confirmation).toBe(true)
    // The creator cannot confirm a row naming someone else.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/family/obligations/${row.id}/confirm`,
        })
      ).statusCode,
    ).toBe(403)
    // The named adult can.
    currentUser = PARTNER
    const ok = await app.inject({ method: 'POST', url: `/family/obligations/${row.id}/confirm` })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().obligation.pending_confirmation).toBe(false)
    expect(ok.json().obligation.confirmed_by).toBe(PARTNER)
  })

  it('a row naming the creator needs no confirmation', async () => {
    const r = await create({ ...ROW, named_person: 'Sam' })
    expect(r.json().obligation.pending_confirmation).toBe(false)
    expect(r.json().obligation.confirmed_by).toBe(CREATOR)
  })
})

describe('guards', () => {
  it('rejects secret-shaped free text', async () => {
    const r = await create({ ...ROW, notices_to: 'pin 4821' })
    expect(r.statusCode).toBe(400)
    expect(r.json().error).toMatch(/password or code/)
  })

  it('update and delete are editor-gated; rename re-opens the estimate', async () => {
    const { obligation } = (await create({ ...ROW, named_person: 'Sam' })).json()
    currentUser = 'user-viewer'
    currentRoles = ['viewer']
    await addViewer()
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/family/obligations/${obligation.id}`,
          payload: { label: 'x' },
        })
      ).statusCode,
    ).toBe(403)
    currentUser = CREATOR
    currentRoles = ['admin']
    const renamed = await app.inject({
      method: 'PUT',
      url: `/family/obligations/${obligation.id}`,
      payload: { named_person: 'Alex' },
    })
    expect(renamed.json().obligation.pending_confirmation).toBe(true)
    expect(
      (await app.inject({ method: 'DELETE', url: `/family/obligations/${obligation.id}` }))
        .statusCode,
    ).toBe(200)
    expect(
      (await app.inject({ method: 'DELETE', url: `/family/obligations/${obligation.id}` }))
        .statusCode,
    ).toBe(404)
  })
})
