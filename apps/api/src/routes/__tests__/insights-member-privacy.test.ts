/**
 * Intent 82 / PRD-234: member-scoped private insights are visible only to
 * the roster member they name. The default /insights list must hide them
 * from every other viewer — verified end to end through the route.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import path from 'node:path'
import { Engine } from '@lifekeel/engine'
import { registerInsightRoutes } from '../insights.js'
import { vi } from 'vitest'

let insightsCol: import('mongodb').Collection
vi.mock('../../db.js', async (orig) => {
  const mod = await orig<object>()
  return {
    ...mod,
    getInsightsCollection: async () => insightsCol,
  }
})

const TENANT = 't-privacy'
const SAM = 'user-sam'
const ALEX = 'user-alex'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance
let currentUser: string | null = SAM

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('privacy-test')
  insightsCol = db.collection('insights')
  app = Fastify()
  app.addHook('onRequest', async (request) => {
    if (currentUser) {
      ;(request as unknown as Record<string, unknown>)['authContext'] = {
        tenant_id: TENANT,
        user_id: currentUser,
        roles: ['admin'],
      }
    }
  })
  const engine = new Engine({
    detectorsDir: path.resolve(__dirname, '..', '..', '..', '..', 'detectors'),
    strictValidation: false,
  })
  await registerInsightRoutes(app, engine, undefined, db)
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await client.close()
  await mongod.stop()
})
beforeEach(async () => {
  currentUser = SAM
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  await db.collection('family_groups').insertOne({
    tenant_id: TENANT,
    members: [
      { id: 'm-sam', user_id: SAM, name: 'Sam', role: 'adult', status: 'active' },
      { id: 'm-alex', user_id: ALEX, name: 'Alex', role: 'adult', status: 'active' },
    ],
  })
  await db.collection('insights').insertMany([
    {
      tenant_id: TENANT,
      detector_id: 'family_policy_review',
      rule_id: 'nomination_names_ex_partner',
      title: 'Nomination names a person recorded as an ex-partner',
      feature_snapshot: { member_id: 'm-alex', member_private: true },
    },
    {
      tenant_id: TENANT,
      detector_id: 'family_policy_review',
      rule_id: 'premium_increased',
      title: 'Recorded premium went up',
      feature_snapshot: {},
    },
  ])
})

const list = () => app.inject({ method: 'GET', url: '/insights' })

describe('member-scoped private insights', () => {
  it('the named adult sees the flag; the other adult does not', async () => {
    currentUser = ALEX
    const mine = (await list()).json()
    expect(
      mine.insights.some((i: { rule_id: string }) => i.rule_id === 'nomination_names_ex_partner'),
    ).toBe(true)
    currentUser = SAM
    const other = (await list()).json()
    expect(
      other.insights.some((i: { rule_id: string }) => i.rule_id === 'nomination_names_ex_partner'),
    ).toBe(false)
    expect(other.insights.some((i: { rule_id: string }) => i.rule_id === 'premium_increased')).toBe(
      true,
    )
  })
})
