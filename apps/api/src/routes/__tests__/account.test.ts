/**
 * GET /account/export and POST /account/delete — self-service data rights
 * (remediation item 26). Export bundles the tenant's own data; delete wipes
 * every tenant-tagged family collection + GridFS blobs, then marks the
 * tenant 'deleted' so outstanding JWTs die at the auth middleware's
 * active/trial check. audit_log and the tenants row are retained by design.
 */

import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { registerAccountRoutes } from '../account.js'

const TENANT = 'tenant-account-test'
const USER = { id: 'user-1', tenant_id: TENANT, email: 'Parent@Example.com', name: 'Pat', password_hash: 'h', salt: 's' }

interface FakeCollection {
  docs: Record<string, unknown>[]
  findOne: ReturnType<typeof vi.fn>
  find: ReturnType<typeof vi.fn>
  deleteMany: ReturnType<typeof vi.fn>
  updateOne: ReturnType<typeof vi.fn>
}

function makeCol(docs: Record<string, unknown>[]): FakeCollection {
  return {
    docs,
    findOne: vi.fn(async (filter: Record<string, unknown>) =>
      docs.find((d) => Object.entries(filter).every(([k, v]) => d[k] === v)) ?? null),
    find: vi.fn((filter: Record<string, unknown>) => ({
      project: () => ({ toArray: async () => docs.filter((d) => {
        const meta = d['metadata'] as Record<string, unknown> | undefined
        return Object.entries(filter).every(([k, v]) =>
          k === 'metadata.tenant_id' ? meta?.['tenant_id'] === v : d[k] === v)
      }).map((d) => ({ _id: d['_id'] })) }),
      toArray: async () => docs.filter((d) => Object.entries(filter).every(([k, v]) => d[k] === v)),
    })),
    deleteMany: vi.fn(async (filter: Record<string, unknown>) => {
      const before = docs.length
      for (let i = docs.length - 1; i >= 0; i--) {
        if (Object.entries(filter).every(([k, v]) => docs[i]![k] === v)) docs.splice(i, 1)
      }
      return { deletedCount: before - docs.length }
    }),
    updateOne: vi.fn(async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const doc = docs.find((d) => Object.entries(filter).every(([k, v]) => d[k] === v))
      if (!doc) return { matchedCount: 0 }
      Object.assign(doc, (update['$set'] as Record<string, unknown>) ?? {})
      return { matchedCount: 1 }
    }),
  }
}

function makeDb() {
  const cols: Record<string, FakeCollection> = {
    users: makeCol([USER, { id: 'u2', tenant_id: 'other', email: 'x@y.z' }]),
    family_groups: makeCol([{ tenant_id: TENANT, name: 'Fam' }]),
    family_financial_profile: makeCol([{ tenant_id: TENANT, employment: {} }]),
    documents: makeCol([{ tenant_id: TENANT, id: 'doc1', file_id: 'f1' }]),
    'documents.files': makeCol([{ _id: 'f1', metadata: { tenant_id: TENANT, document_id: 'doc1' } }]),
    signals: makeCol([{ tenant_id: TENANT, signal_type: 'family.life_event' }]),
    insights: makeCol([{ tenant_id: TENANT, id: 'i1' }]),
    audit_log: makeCol([{ tenant_id: TENANT, action: 'insight.approve' }]),
    tenants: makeCol([{ tenant_id: TENANT, status: 'active' }]),
    connector_credentials: makeCol([{ tenant_id: TENANT, connector_id: 'c1' }]),
  }
  const db = {
    cols,
    collection: (name: string) => cols[name] ?? (cols[name] = makeCol([])),
  }
  return db as unknown as { collection: (n: string) => FakeCollection } & { cols: Record<string, FakeCollection> }
}

async function buildApp(db: ReturnType<typeof makeDb>) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: 'user-1' }
  })
  registerAccountRoutes(app, db as never)
  return app
}

describe('GET /account/export', () => {
  it('bundles the tenant data and strips auth material from the user record', async () => {
    const db = makeDb()
    const app = await buildApp(db)
    const res = await app.inject({ method: 'GET', url: '/account/export' })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.tenant_id).toBe(TENANT)
    expect(body.user.email).toBe('Parent@Example.com')
    expect(body.user.password_hash).toBeUndefined()
    expect(body.user.salt).toBeUndefined()
    expect(body.family_group.name).toBe('Fam')
    expect(body.documents[0].id).toBe('doc1')
    expect(body.documents[0].file_id).toBeUndefined() // blob pointer stays out of the bundle
    expect(body.insights).toHaveLength(1)
    expect(body.audit_log).toHaveLength(1)
  })
})

describe('POST /account/delete', () => {
  it('rejects when the typed confirmation is not the account email', async () => {
    const db = makeDb()
    const app = await buildApp(db)
    const res = await app.inject({ method: 'POST', url: '/account/delete', payload: { confirmation: 'wrong@x.com' } })
    expect(res.statusCode).toBe(400)
    expect(db.cols['users']!.docs.some((d) => d['tenant_id'] === TENANT)).toBe(true) // nothing deleted
  })

  it('rejects a missing confirmation entirely', async () => {
    const db = makeDb()
    const app = await buildApp(db)
    const res = await app.inject({ method: 'POST', url: '/account/delete', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('deletes tenant data, keeps audit_log, and marks the tenant deleted (case-insensitive email match)', async () => {
    const db = makeDb()
    const app = await buildApp(db)
    const res = await app.inject({
      method: 'POST',
      url: '/account/delete',
      payload: { confirmation: 'parent@example.com' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().deleted).toBe(true)

    // Tenant-tagged family data gone
    for (const name of ['family_groups', 'family_financial_profile', 'documents', 'signals', 'insights', 'connector_credentials']) {
      expect(db.cols[name]!.docs.filter((d) => d['tenant_id'] === TENANT)).toHaveLength(0)
    }
    // The account's users rows are gone; another tenant's row survives
    expect(db.cols['users']!.docs.some((d) => d['tenant_id'] === TENANT)).toBe(false)
    expect(db.cols['users']!.docs.some((d) => d['tenant_id'] === 'other')).toBe(true)
    // audit_log retained by design (7-yr compliance TTL)
    expect(db.cols['audit_log']!.docs).toHaveLength(1)
    // tenants row kept but dead — auth middleware only admits active/trial
    expect(db.cols['tenants']!.docs[0]).toMatchObject({ status: 'deleted' })
    expect(db.cols['tenants']!.docs[0]!['deleted_at']).toBeInstanceOf(Date)
  })
})
