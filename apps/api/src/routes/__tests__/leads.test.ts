import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerLeadRoutes } from '../leads.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('leads')
  app = Fastify()
  await registerLeadRoutes(app, db)
  await app.ready()
})

beforeEach(async () => {
  await db.collection('leads').deleteMany({})
  await db.collection('growth_events').deleteMany({})
})

afterAll(async () => {
  await app.close()
  await client.close()
  await mongod.stop()
})

describe('POST /leads', () => {
  it('captures a consented lead into the leads collection', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: { email: 'Parent@Example.com', name: 'Alex', source: 'readiness_quiz', score_band: '60-70', consent_marketing: true },
    })
    expect(res.statusCode).toBe(200)
    const lead = await db.collection('leads').findOne({ email: 'parent@example.com' })
    expect(lead).toMatchObject({ stage: 'new', source: 'readiness_quiz', score_band: '60-70', suppressed: false })
    expect(lead?.['consent']).toMatchObject({ marketing: true, source: 'readiness_quiz' })
    const event = await db.collection('growth_events').findOne({ event: 'lead_captured' })
    expect(event?.['meta']).toEqual({ source: 'readiness_quiz', score_band: '60-70' })
  })

  it('rejects submissions without marketing consent or a valid email', async () => {
    const noConsent = await app.inject({ method: 'POST', url: '/leads', payload: { email: 'a@b.com', consent_marketing: false } })
    expect(noConsent.statusCode).toBe(400)
    const badEmail = await app.inject({ method: 'POST', url: '/leads', payload: { email: 'not-an-email', consent_marketing: true } })
    expect(badEmail.statusCode).toBe(400)
    expect(await db.collection('leads').countDocuments({})).toBe(0)
  })

  it('upserts repeat submissions without resetting stage or suppression', async () => {
    await db.collection('leads').insertOne({
      id: 'lead-1', email: 'repeat@example.com', stage: 'contacted', suppressed: true, notes: [],
      consent: { marketing: false }, created_at: new Date(),
    })
    const res = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: { email: 'repeat@example.com', name: 'New Name', source: 'blog', consent_marketing: true },
    })
    expect(res.statusCode).toBe(200)
    expect(await db.collection('leads').countDocuments({})).toBe(1)
    const lead = await db.collection('leads').findOne({ email: 'repeat@example.com' })
    expect(lead?.['stage']).toBe('contacted')
    expect(lead?.['suppressed']).toBe(true)
    expect(lead?.['name']).toBe('New Name')
    expect(lead?.['consent']?.['marketing']).toBe(true)
  })

  it('stores first-touch attribution on create and never overwrites it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: {
        email: 'attr@example.com', consent_marketing: true,
        attribution: { utm_source: 'linkedin', utm_campaign: 'launch', landing_path: '/readiness/', evil: 'x'.repeat(5000) },
      },
    })
    expect(res.statusCode).toBe(200)
    const lead = await db.collection('leads').findOne({ email: 'attr@example.com' })
    expect(lead?.['attribution']).toMatchObject({ utm_source: 'linkedin', utm_campaign: 'launch' })
    expect(lead?.['attribution']).not.toHaveProperty('evil')

    // Second capture from a different campaign keeps the original source.
    await app.inject({
      method: 'POST',
      url: '/leads',
      payload: { email: 'attr@example.com', consent_marketing: true, attribution: { utm_source: 'google' } },
    })
    const after = await db.collection('leads').findOne({ email: 'attr@example.com' })
    expect(after?.['attribution']?.['utm_source']).toBe('linkedin')
  })
})
