import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerOperatorEngineRoutes } from '../operator-engine.js'
import { ENGINE_METRICS_COLLECTION } from '../../resilience/engine-metrics.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('test')
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

beforeEach(async () => {
  await db.collection('platform_operators').deleteMany({})
  await db.collection(ENGINE_METRICS_COLLECTION).deleteMany({})
  await db.collection('platform_operators').insertOne({
    user_id: 'op-1',
    status: 'active',
    roles: ['operations'],
  })
})

async function buildApp(roles: string[] = ['operations']): Promise<FastifyInstance> {
  await db.collection('platform_operators').deleteMany({})
  await db.collection('platform_operators').insertOne({
    user_id: 'op-1',
    status: 'active',
    roles,
  })
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    request.authContext = { user_id: 'op-1', tenant_id: 't', roles: ['admin'], iat: 1 }
  })
  await registerOperatorEngineRoutes(app, db)
  await app.ready()
  return app
}

const event = (over: Record<string, unknown>) => ({
  tenant_id: 'tenant-a',
  field_class: 'none',
  document_category: 'none',
  check: 'none',
  reason: 'none',
  bucket: 'none',
  at: new Date(),
  ...over,
})

describe('GET /operator/engine-metrics (intent 97, slice 9)', () => {
  it('requires an operator with operations.read', async () => {
    const app = await buildApp(['billing']) // no operations.read
    const res = await app.inject({ method: 'GET', url: '/operator/engine-metrics' })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('aggregates content-free counts over the window', async () => {
    await db.collection(ENGINE_METRICS_COLLECTION).insertMany([
      event({ event: 'extraction_suggested', document_category: 'banking' }),
      event({ event: 'extraction_suggested', document_category: 'banking' }),
      event({ event: 'extraction_confirmed_unchanged', field_class: 'provider' }),
      event({ event: 'extraction_corrected', field_class: 'provider' }),
      event({
        event: 'extraction_check_failed',
        field_class: 'closing_minor',
        check: 'balance_does_not_reconcile',
      }),
      event({ event: 'extraction_run_dead' }),
      // outside the default 30d window — must not be counted
      event({ event: 'extraction_suggested', at: new Date(Date.now() - 40 * 86_400_000) }),
    ])
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/operator/engine-metrics' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.window_days).toBe(30)
    expect(body.by_event.extraction_suggested).toBe(2)
    expect(body.by_event.extraction_run_dead).toBe(1)
    expect(
      body.per_field_class.find((r: { field_class: string }) => r.field_class === 'provider'),
    ).toMatchObject({ confirmed_unchanged: 1, corrected: 1 })
    expect(body.check_failures_by_code.balance_does_not_reconcile).toBe(1)
    // no tenant ids, values or text anywhere in the payload
    expect(JSON.stringify(body)).not.toContain('tenant-a')
    await app.close()
  })

  it('honours a bounded ?days= parameter', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/operator/engine-metrics?days=7' })
    expect(res.statusCode).toBe(200)
    expect(res.json().window_days).toBe(7)
    const tooBig = await app.inject({ method: 'GET', url: '/operator/engine-metrics?days=9999' })
    expect(tooBig.json().window_days).toBe(90)
    await app.close()
  })
})
