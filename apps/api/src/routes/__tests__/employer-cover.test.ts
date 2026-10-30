/**
 * PRD-232 employer cover facts: CRUD gates, and the job-change brief's
 * sentence clause when cover may end with the employment.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerEmployerCoverRoutes } from '../family-employer-cover.js'
import { solveCatalogueBrief } from '../../briefs/catalogue.js'

const TENANT = 't-cover'
const CREATOR = 'user-sam'

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
  db = client.db('cover-test')
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
  registerEmployerCoverRoutes(app, db)
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await client.close()
  await mongod.stop()
})
beforeEach(async () => {
  currentUser = CREATOR
  currentRoles = ['admin']
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  await db.collection('family_groups').insertOne({
    tenant_id: TENANT,
    members: [{ id: 'm1', user_id: CREATOR, name: 'Sam', role: 'adult', status: 'active' }],
  })
})

const FACT = {
  member_label: 'Sam',
  type: 'death_in_service',
  name_as_printed: 'Acme Group Life Assurance',
  source: 'HR portal letter',
  last_seen_at: '2026-09-01',
}

describe('employer cover facts', () => {
  it('editor creates, adult reads, viewer refused, tenant-scoped', async () => {
    expect(
      (await app.inject({ method: 'POST', url: '/family/employer-cover', payload: FACT }))
        .statusCode,
    ).toBe(201)
    const r = await app.inject({ method: 'GET', url: '/family/employer-cover' })
    expect(r.json().facts).toHaveLength(1)
    expect(r.json().facts[0].ends_with_employment).toBe(true)
    currentRoles = ['viewer']
    expect(
      (await app.inject({ method: 'POST', url: '/family/employer-cover', payload: FACT }))
        .statusCode,
    ).toBe(403)
    currentUser = null
    expect((await app.inject({ method: 'GET', url: '/family/employer-cover' })).statusCode).toBe(
      401,
    )
  })

  it('update, confirm-off and delete work; bad payloads rejected', async () => {
    const { fact } = (
      await app.inject({ method: 'POST', url: '/family/employer-cover', payload: FACT })
    ).json()
    const up = await app.inject({
      method: 'PUT',
      url: `/family/employer-cover/${fact.id}`,
      payload: { confirmed: false, last_seen_at: '2026-10-01' },
    })
    expect(up.json().fact.confirmed).toBe(false)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/family/employer-cover',
          payload: { member_label: 'x' },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (await app.inject({ method: 'DELETE', url: `/family/employer-cover/${fact.id}` })).statusCode,
    ).toBe(200)
  })
})

describe('the brief sentence clause', () => {
  const base = {
    monthly_income_minor: 500_000,
    monthly_essentials_minor: 300_000,
    liquid_savings_minor: 900_000,
    new_income_minor: 200_000,
    new_essentials_minor: 300_000,
    change_date: '2026-12-01',
  }
  it('states cover may end with the employment when flagged', () => {
    const out = solveCatalogueBrief(
      'job_change',
      {
        ...base,
        recorded_cover: 'Acme Group Life (HR portal)',
        cover_may_end_with_employment: true,
        cover_end_date: '2026-12-01',
      },
      '2026-11-01',
    )
    expect(out.template_sentence).toContain(
      'Cover on file may end with the employment (2026-12-01)',
    )
  })
  it('stays silent without the flag', () => {
    const out = solveCatalogueBrief('job_change', base, '2026-11-01')
    expect(out.template_sentence).not.toContain('may end with the employment')
  })
})
