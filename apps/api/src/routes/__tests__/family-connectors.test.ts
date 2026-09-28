/**
 * /connectors/open-banking/* (PRD-133) — read-only account-info connector
 * plumbing: credential storage, provider validation, sync into
 * external_accounts, and the credential-health flags.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyConnectorRoutes } from '../family-connectors.js'

const TENANT = 't-connectors'

let credentials: Record<string, unknown>[]
let accounts: Record<string, unknown>[]

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$nin' in (v as Record<string, unknown>)) {
      return !(v as { $nin: unknown[] }).$nin.includes(doc[k])
    }
    return doc[k] === v
  })
}

function col(store: Record<string, unknown>[]) {
  return {
    find: (filter: Record<string, unknown> = {}) => ({ toArray: async () => store.filter((d) => matches(d, filter)) }),
    findOne: async (filter: Record<string, unknown> = {}) => store.find((d) => matches(d, filter)) ?? null,
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>, opts?: { upsert?: boolean }) => {
      const doc = store.find((d) => matches(d, filter))
      const set = (update['$set'] ?? {}) as Record<string, unknown>
      if (doc) {
        Object.assign(doc, set)
        return { modifiedCount: 1 }
      }
      if (opts?.upsert) {
        store.push({ ...set })
        return { upsertedCount: 1 }
      }
      return { modifiedCount: 0 }
    },
    deleteOne: async (filter: Record<string, unknown>) => {
      const idx = store.findIndex((d) => matches(d, filter))
      if (idx >= 0) store.splice(idx, 1)
      return { deletedCount: idx >= 0 ? 1 : 0 }
    },
    deleteMany: async (filter: Record<string, unknown>) => {
      const before = store.length
      for (let i = store.length - 1; i >= 0; i--) {
        if (matches(store[i]!, filter)) store.splice(i, 1)
      }
      return { deletedCount: before - store.length }
    },
    createIndex: async () => ({}),
  }
}

function makeDb() {
  return {
    collection: (name: string) =>
      name === 'connector_credentials' ? col(credentials) : name === 'external_accounts' ? col(accounts) : col([]),
  } as never
}

async function buildApp() {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as { authContext?: unknown }).authContext = { tenant_id: TENANT, user_id: 'u1' }
  })
  registerFamilyConnectorRoutes(app, makeDb())
  return app
}

beforeEach(() => {
  credentials = []
  accounts = []
})

describe('POST /connectors/open-banking/credentials', () => {
  it('connects the sandbox provider and syncs accounts immediately', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/connectors/open-banking/credentials', payload: { provider: 'sandbox' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().accounts).toBe(3)
    expect(credentials[0]).toMatchObject({ connector_id: 'open-banking', provider: 'sandbox', needs_reauth: false })
    expect(accounts).toHaveLength(3)
    expect(accounts.every((a) => a['tenant_id'] === TENANT)).toBe(true)
    await app.close()
  })

  it('rejects an unknown provider', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/connectors/open-banking/credentials', payload: { provider: 'nope-bank' } })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejects truelayer while the aggregator onboarding is absent', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/connectors/open-banking/credentials', payload: { provider: 'truelayer', accessToken: 'x' } })
    expect(res.statusCode).toBe(503)
    await app.close()
  })

  it('fails validation before saving when the provider rejects the credential', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/connectors/open-banking/credentials', payload: { provider: 'sandbox', accessToken: 'reject-me' } })
    expect(res.statusCode).toBe(422)
    expect(res.json().code).toBe('CREDENTIALS_REJECTED')
    expect(credentials).toHaveLength(0)
    await app.close()
  })
})

describe('POST /connectors/open-banking/sync + GET accounts', () => {
  it('marks the credential needs_reauth on an auth failure', async () => {
    const app = await buildApp()
    await app.inject({ method: 'POST', url: '/connectors/open-banking/credentials', payload: { provider: 'sandbox' } })
    // Rot the stored credential so the next sync hits the auth path.
    credentials[0]!['access_token'] = 'reject-me' // sandbox reads it unencrypted only when present post-connect; encryptIfNeeded is a no-op without a key configured
    const res = await app.inject({ method: 'POST', url: '/connectors/open-banking/sync' })
    expect(res.statusCode).toBe(401)
    expect(res.json().code).toBe('NEEDS_REAUTH')
    expect(credentials[0]!['needs_reauth']).toBe(true)
    await app.close()
  })

  it('drops accounts the provider no longer returns', async () => {
    const app = await buildApp()
    await app.inject({ method: 'POST', url: '/connectors/open-banking/credentials', payload: { provider: 'sandbox' } })
    accounts.push({ tenant_id: TENANT, provider: 'sandbox', provider_account_id: 'closed-acct', display_name: 'Closed', account_type: 'current', currency: 'GBP', balance_minor: 0, synced_at: new Date() })
    const res = await app.inject({ method: 'POST', url: '/connectors/open-banking/sync' })
    expect(res.statusCode).toBe(200)
    const list = (await app.inject({ method: 'GET', url: '/connectors/open-banking/accounts' })).json()
    expect(list.accounts).toHaveLength(3)
    expect(list.accounts.every((a: { id: string }) => a.id !== 'closed-acct')).toBe(true)
    await app.close()
  })

  it('404s a sync when nothing is connected', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/connectors/open-banking/sync' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})
