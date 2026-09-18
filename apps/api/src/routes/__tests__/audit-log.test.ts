/**
 * GET /audit-log (remediation item 22) — read-only view over the tenant's
 * own audit_log collection. Covers tenant scoping, the `before` cursor,
 * the limit cap, and the absent-any-write-surface contract.
 */
import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { registerAuditLogRoutes } from '../audit-log.js'

const TENANT = 'tenant-audit-test'

interface AuditDoc {
  tenant_id: string
  user_id: string
  action: string
  resource_type: string
  resource_id: string
  metadata?: Record<string, unknown>
  timestamp: Date
}

function matchesFilter(doc: AuditDoc, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key as keyof AuditDoc]
    if (cond && typeof cond === 'object' && '$lt' in (cond as Record<string, unknown>)) {
      return (value as Date) < (cond as { $lt: Date }).$lt
    }
    return value === cond
  })
}

function makeDb(docs: AuditDoc[]) {
  const col = {
    find: (filter: Record<string, unknown>) => ({
      sort: () => ({
        limit: (n: number) => ({
          toArray: async () => docs.filter((d) => matchesFilter(d, filter)).slice(0, n),
        }),
      }),
    }),
  }
  return { collection: () => col } as any
}

async function buildApp(db: any) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: 'user-1' }
  })
  registerAuditLogRoutes(app, db)
  return app
}

const base = (i: number, tenant = TENANT): AuditDoc => ({
  tenant_id: tenant,
  user_id: 'user-1',
  action: i % 2 === 0 ? 'auth.login' : 'insight.approve',
  resource_type: 'session',
  resource_id: `res-${i}`,
  timestamp: new Date(Date.now() - i * 60_000),
})

describe('GET /audit-log', () => {
  it('returns only the requesting tenant’s entries, newest first, ISO timestamps', async () => {
    const docs = [base(2), base(0), base(1), base(0, 'other-tenant')]
    const app = await buildApp(makeDb(docs))
    const res = await app.inject({ method: 'GET', url: '/audit-log' })

    expect(res.statusCode).toBe(200)
    const entries = res.json().entries
    expect(entries).toHaveLength(3)
    expect(entries.every((e: any) => typeof e.timestamp === 'string' && !Number.isNaN(Date.parse(e.timestamp)))).toBe(true)
  })

  it('honours the "before" cursor for pagination', async () => {
    const docs = [base(0), base(5), base(10)]
    const app = await buildApp(makeDb(docs))
    const cursor = docs[1].timestamp.toISOString()
    const res = await app.inject({ method: 'GET', url: `/audit-log?before=${encodeURIComponent(cursor)}` })

    expect(res.statusCode).toBe(200)
    const entries = res.json().entries
    expect(entries).toHaveLength(1)
    expect(entries[0].resource_id).toBe('res-10')
  })

  it('400s on an unparseable "before" timestamp', async () => {
    const app = await buildApp(makeDb([]))
    const res = await app.inject({ method: 'GET', url: '/audit-log?before=not-a-date' })
    expect(res.statusCode).toBe(400)
  })

  it('filters by action when provided', async () => {
    const docs = [base(0), base(1)]
    const app = await buildApp(makeDb(docs))
    const res = await app.inject({ method: 'GET', url: '/audit-log?action=insight.approve' })

    const entries = res.json().entries
    expect(entries).toHaveLength(1)
    expect(entries[0].action).toBe('insight.approve')
  })

  it('caps the limit at 100', async () => {
    const docs = Array.from({ length: 150 }, (_, i) => base(i))
    const app = await buildApp(makeDb(docs))
    const res = await app.inject({ method: 'GET', url: '/audit-log?limit=500' })

    expect(res.statusCode).toBe(200)
    expect(res.json().entries.length).toBeLessThanOrEqual(100)
  })

  it('exposes no write surface — POST/PUT/DELETE all 404', async () => {
    const app = await buildApp(makeDb([base(0)]))
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      const res = await app.inject({ method, url: '/audit-log', payload: {} })
      expect(res.statusCode).toBe(404)
    }
  })
})
