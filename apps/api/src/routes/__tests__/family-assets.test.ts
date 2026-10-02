/**
 * /family/assets + /family/context (gap 8's non-sensitive slice) — the
 * declared-asset register and the organizer's context note for Ask Oak.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyAssetRoutes } from '../family-assets.js'
import { registerFamilyGroupRoutes } from '../family-group.js'

const TENANT = 't-gap8'
const ADULT = 'adult-1'
const CHILD = 'child-1'

let assets: Record<string, unknown>[]
let familyGroup: Record<string, unknown> | null

function match(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => doc[k] === v)
}

function col(store: Record<string, unknown>[]) {
  return {
    find: (filter: Record<string, unknown> = {}) => ({ toArray: async () => store.filter((d) => match(d, filter)) }),
    findOne: async (filter: Record<string, unknown> = {}) => store.find((d) => match(d, filter)) ?? null,
    insertOne: async (doc: Record<string, unknown>) => { store.push(doc); return { insertedId: doc['id'] } },
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const doc = store.find((d) => match(d, filter))
      if (!doc) return { modifiedCount: 0 }
      Object.assign(doc, (update['$set'] ?? {}) as Record<string, unknown>)
      for (const k of Object.keys((update['$unset'] ?? {}) as Record<string, unknown>)) delete doc[k]
      return { modifiedCount: 1 }
    },
    findOneAndUpdate: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const doc = store.find((d) => match(d, filter))
      if (!doc) return null
      Object.assign(doc, (update['$set'] ?? {}) as Record<string, unknown>)
      for (const k of Object.keys((update['$unset'] ?? {}) as Record<string, unknown>)) delete doc[k]
      return doc
    },
    deleteOne: async (filter: Record<string, unknown>) => {
      const idx = store.findIndex((d) => match(d, filter))
      if (idx >= 0) store.splice(idx, 1)
      return { deletedCount: idx >= 0 ? 1 : 0 }
    },
    createIndex: async () => ({}),
  }
}

function makeDb(userStore: Record<string, unknown>[]) {
  return {
    collection: (name: string) =>
      name === 'family_assets' ? col(assets)
        : name === 'family_groups' ? col(familyGroup ? [familyGroup] : [])
          : col(userStore),
  } as never
}

async function buildApp(userId: string) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as { authContext?: unknown }).authContext = { tenant_id: TENANT, user_id: userId }
  })
  const db = makeDb([])
  registerFamilyAssetRoutes(app, db)
  registerFamilyGroupRoutes(app, db)
  return app
}

beforeEach(() => {
  assets = []
  familyGroup = {
    tenant_id: TENANT,
    id: 'fam-1',
    name: 'Test Family',
    invite_code: 'ABC123',
    members: [
      { id: ADULT, name: 'Sam', email: 's@x.co', role: 'organizer', status: 'active', joined_at: 'x' },
      { id: CHILD, name: 'Kid', email: '', role: 'child', status: 'active', joined_at: 'x' },
    ],
    created_at: new Date(),
    updated_at: new Date(),
  }
})

describe('GET /family/assets', () => {
  it('adults see the register with a total/by-kind summary; children get 403', async () => {
    const app = await buildApp(ADULT)
    await app.inject({ method: 'POST', url: '/family/assets', payload: { kind: 'property', name: 'House', value_minor: 35_000_000 } })
    await app.inject({ method: 'POST', url: '/family/assets', payload: { kind: 'vehicle', name: 'Car', value_minor: 1_200_000 } })
    const res = await app.inject({ method: 'GET', url: '/family/assets' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.assets).toHaveLength(2)
    expect(body.summary.total_minor).toBe(36_200_000)
    expect(body.summary.by_kind.property).toBe(35_000_000)

    const childApp = await buildApp(CHILD)
    expect((await childApp.inject({ method: 'GET', url: '/family/assets' })).statusCode).toBe(403)
    await app.close()
    await childApp.close()
  })
})

describe('asset mutations', () => {
  it('PATCH updates value, DELETE removes, both 404 on strangers', async () => {
    const app = await buildApp(ADULT)
    const created = (await app.inject({ method: 'POST', url: '/family/assets', payload: { kind: 'vehicle', name: 'Car', value_minor: 1_000_000 } })).json().asset
    const patched = await app.inject({ method: 'PATCH', url: `/family/assets/${created.id}`, payload: { value_minor: 900_000 } })
    expect(patched.json().asset.value_minor).toBe(900_000)
    expect((await app.inject({ method: 'PATCH', url: '/family/assets/nope', payload: { value_minor: 1 } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/family/assets/${created.id}` })).statusCode).toBe(204)
    expect((await app.inject({ method: 'DELETE', url: `/family/assets/${created.id}` })).statusCode).toBe(404)
    await app.close()
  })

  it('validates kind and requires a name', async () => {
    const app = await buildApp(ADULT)
    expect((await app.inject({ method: 'POST', url: '/family/assets', payload: { kind: 'castle', name: 'X', value_minor: 1 } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/family/assets', payload: { kind: 'property', value_minor: 1 } })).statusCode).toBe(400)
    await app.close()
  })
})

describe('PATCH /family/context', () => {
  it('organizer sets the note, it rides the family response, empty clears it', async () => {
    const app = await buildApp(ADULT)
    const res = await app.inject({ method: 'PATCH', url: '/family/context', payload: { note: 'Blended family, two teens' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().family.contextNote).toBe('Blended family, two teens')
    expect(familyGroup!['context_note']).toBe('Blended family, two teens')

    const cleared = await app.inject({ method: 'PATCH', url: '/family/context', payload: { note: '' } })
    expect(cleared.json().family.contextNote).toBeUndefined()
    expect(familyGroup!['context_note']).toBeUndefined()
    await app.close()
  })

  it('a non-organizer adult or child cannot set it', async () => {
    const childApp = await buildApp(CHILD)
    expect((await childApp.inject({ method: 'PATCH', url: '/family/context', payload: { note: 'x' } })).statusCode).toBe(403)
    await childApp.close()
  })
})
