/** PRD-218: /operator/marketing/post-stats is gated on marketing.read and
 *  returns aggregate-only rows — never user ids or emails. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'

const perms: string[] = []
vi.mock('../../operator/operator-auth.js', () => ({
  requireOperator: (_db: unknown, permission: string) => {
    perms.push(permission)
    return async (req: { operatorContext?: unknown }) => {
      req.operatorContext = { user_id: 'op1', roles: ['marketing_operator'], source: 'database' }
    }
  },
}))

import { registerOperatorRoutes } from '../operator.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('post-stats-route')
})
beforeEach(async () => {
  await db.dropDatabase()
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

async function buildApp() {
  const app = Fastify()
  app.addHook('onRequest', async (req) => {
    req.authContext = { user_id: 'op1', tenant_id: 't1', roles: ['admin'] } as never
  })
  await registerOperatorRoutes(app, db)
  await app.ready()
  return app
}

describe('GET /operator/marketing/post-stats', () => {
  it('serves grouped, aggregate-only stats to marketing.read', async () => {
    const now = new Date()
    await db.collection('marketing_posts').insertOne({
      id: 'p1',
      tenant_id: 't1',
      channel: 'x',
      content: 'post',
      post_tag: 'p1234abc',
      state: 'published',
      published_at: now,
      created_at: now,
      features: {
        format: 'myth_vs_file',
        hook: 'question',
        pillar: 'chart',
        channel: 'x',
        length_bucket: 'short',
        hour_bucket: 'morning',
        has_media: false,
      },
    })
    await db.collection('growth_events').insertOne({
      event: 'landing_view',
      meta: { utm_content: 'p1234abc' },
      created_at: now,
    })
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/operator/marketing/post-stats' })
    expect(res.statusCode).toBe(200)
    expect(perms).toContain('marketing.read')
    const body = res.json()
    const row = body.rows.find((r: { post_tag?: string }) => r.post_tag === 'p1234abc')
    expect(row.visits).toBe(1)
    expect(row.tagged).toBe(true)
    // No identity fields anywhere in the payload.
    expect(JSON.stringify(body)).not.toMatch(/email|user_id|tenant_id/)
  })
})
