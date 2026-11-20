/**
 * Household write policy for ordinary documents (ISSUES H01), against a real
 * MongoDB: viewers read but cannot change or delete; an adult with the
 * organizer's edit grant and an owner can; another tenant and vault or
 * deleting rows are never reachable through these routes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerDocumentRoutes } from '../documents.js'

const T = 'family-a'
const OTHER = 'family-b'
let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('documents-write-policy')
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  await db.collection('family_groups').insertOne({
    tenant_id: T,
    members: [
      { id: 'organizer', role: 'organizer', status: 'active' },
      { id: 'viewer', role: 'adult', status: 'active' },
      { id: 'granted', role: 'adult', status: 'active', can_edit: true },
    ],
  })
  await db.collection('documents').insertMany([
    { tenant_id: T, id: 'doc-1', filename: 'home.pdf', category: 'insurance', status: 'stored' },
    { tenant_id: T, id: 'vault-1', filename: 'will.pdf', category: 'estate_vault' },
    { tenant_id: T, id: 'gone-1', filename: 'old.pdf', category: 'insurance', status: 'deleting' },
    { tenant_id: OTHER, id: 'doc-b', filename: 'b.pdf', category: 'insurance', status: 'stored' },
  ])
})

async function appAs(userId: string, roles: string[], tenant = T): Promise<FastifyInstance> {
  const app = Fastify()
  await app.register(multipart)
  app.addHook('onRequest', async (req) => {
    ;(req as unknown as { authContext: unknown }).authContext = {
      tenant_id: tenant,
      user_id: userId,
      roles,
    }
  })
  registerDocumentRoutes(app, db)
  await app.ready()
  return app
}

const MUTATIONS = [
  {
    name: 'PATCH /documents/:id',
    method: 'PATCH',
    url: (id: string) => `/documents/${id}`,
    payload: { renewal_date: '2027-01-31' },
  },
  {
    name: 'POST /documents/:id/confirm-type',
    method: 'POST',
    url: (id: string) => `/documents/${id}/confirm-type`,
    payload: { category: 'insurance' },
  },
  {
    name: 'POST /documents/:id/review',
    method: 'POST',
    url: (id: string) => `/documents/${id}/review`,
    payload: { decisions: [{ key: 'provider', action: 'reject' }] },
  },
  {
    name: 'POST /documents/:id/reprocess',
    method: 'POST',
    url: (id: string) => `/documents/${id}/reprocess`,
    payload: undefined,
  },
  {
    name: 'DELETE /documents/:id',
    method: 'DELETE',
    url: (id: string) => `/documents/${id}`,
    payload: undefined,
  },
] as const

const doc = (id: string) => db.collection('documents').findOne({ id })

describe('ordinary document mutations', () => {
  it.each(MUTATIONS)('a viewer gets 403 on $name and nothing changes', async (m) => {
    const app = await appAs('viewer', ['viewer'])
    const res = await app.inject({ method: m.method, url: m.url('doc-1'), payload: m.payload })
    expect(res.statusCode).toBe(403)
    const after = await doc('doc-1')
    expect(after).toMatchObject({ category: 'insurance', status: 'stored' })
    expect(after?.['renewal_date']).toBeUndefined()
  })

  it('an adult with the edit grant can set the renewal date', async () => {
    const app = await appAs('granted', ['viewer'])
    const res = await app.inject({
      method: 'PATCH',
      url: '/documents/doc-1',
      payload: { renewal_date: '2027-01-31' },
    })
    expect(res.statusCode).toBe(200)
    expect((await doc('doc-1'))?.['renewal_date']).toBe('2027-01-31')
  })

  it('an owner can confirm the type and delete', async () => {
    const app = await appAs('organizer', ['owner'])
    const typed = await app.inject({
      method: 'POST',
      url: '/documents/doc-1/confirm-type',
      payload: { category: 'mortgage' },
    })
    expect(typed.statusCode).toBe(200)
    expect((await doc('doc-1'))?.['category']).toBe('mortgage')
    const del = await app.inject({ method: 'DELETE', url: '/documents/doc-1' })
    expect(del.statusCode).toBe(200)
    expect(await doc('doc-1')).toBeNull()
  })

  it('a vault row is not reachable through the ordinary renewal or type routes', async () => {
    const app = await appAs('organizer', ['owner'])
    const patch = await app.inject({
      method: 'PATCH',
      url: '/documents/vault-1',
      payload: { renewal_date: '2027-01-31' },
    })
    expect(patch.statusCode).toBe(404)
    const typed = await app.inject({
      method: 'POST',
      url: '/documents/vault-1/confirm-type',
      payload: { category: 'insurance' },
    })
    expect(typed.statusCode).toBe(404)
    expect(await doc('vault-1')).toMatchObject({ category: 'estate_vault' })
    expect((await doc('vault-1'))?.['renewal_date']).toBeUndefined()
  })

  it('a row being deleted is not modified', async () => {
    const app = await appAs('organizer', ['owner'])
    const res = await app.inject({
      method: 'PATCH',
      url: '/documents/gone-1',
      payload: { renewal_date: '2027-01-31' },
    })
    expect(res.statusCode).toBe(404)
    expect((await doc('gone-1'))?.['renewal_date']).toBeUndefined()
  })

  it("another tenant's document is a 404 for an editor", async () => {
    const app = await appAs('organizer', ['owner'])
    const res = await app.inject({
      method: 'PATCH',
      url: '/documents/doc-b',
      payload: { renewal_date: '2027-01-31' },
    })
    expect(res.statusCode).toBe(404)
    expect((await doc('doc-b'))?.['renewal_date']).toBeUndefined()
  })
})
