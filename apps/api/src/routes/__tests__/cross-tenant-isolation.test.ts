/**
 * OAK-009: the audit found zero HTTP-level tests anywhere proving one
 * tenant's JWT cannot read/write another tenant's data through the real
 * routes — only unit-level tests of getTenantCollection's isolation
 * existed (ml-tenant-isolation.test.ts), which never goes through an
 * actual route. Covers both isolation patterns in this codebase:
 * family-financial-profile.ts and family-group.ts go through the real
 * getTenantCollection/TenantScopedCollection wrapper; insights.ts
 * manually includes tenant_id in every query with no shared wrapper —
 * more failure-prone, so worth testing independently.
 *
 * The generic fake collection below deliberately does its own filter
 * matching rather than being tenant-keyed by construction — the real
 * safety net under test is TenantScopedCollection.scope() (which injects
 * tenant_id into every filter and rejects a mismatched one), not a mock
 * that already assumes isolation.
 */

import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { Engine } from '@agentoak/engine'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerFamilyFinancialProfileRoutes } from '../family-financial-profile.js'
import { registerFamilyGroupRoutes } from '../family-group.js'
import { registerInsightRoutes } from '../insights.js'

vi.mock('../../signals.js', () => ({
  persistSignal: vi.fn(async () => 'stub-signal-id'),
}))

vi.mock('../../db.js', () => ({
  getInsightsCollection: vi.fn(),
  getReceiptsCollection: vi.fn(async () => ({ find: () => ({ toArray: async () => [] }) })),
  // Pure pass-throughs, matching the real db.ts implementations exactly —
  // family-financial-profile.ts/family-group.ts import these directly.
  getFamilyFinancialProfileCollection: (db: any) => db.collection('family_financial_profile'),
  getFamilyGroupsCollection: (db: any) => db.collection('family_groups'),
}))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DETECTORS_DIR = path.resolve(__dirname, '../../../../../detectors')

const TENANT_A = 'tenant-a-cross-isolation'
const TENANT_B = 'tenant-b-cross-isolation'

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (v !== null && typeof v === 'object' && !(v instanceof Date)) return true // ignore operator clauses — unused by the routes under test
    return doc[k] === v
  })
}

function makeFakeCollection() {
  const docs: Array<Record<string, unknown>> = []
  const cursor = (results: Record<string, unknown>[]) => ({
    sort: () => cursor(results),
    skip: (n: number) => cursor(results.slice(n)),
    limit: (n: number) => cursor(results.slice(0, n)),
    toArray: async () => results,
  })
  return {
    createIndex: vi.fn(async () => ({})),
    insertOne: vi.fn(async (doc: Record<string, unknown>) => { docs.push(doc); return { insertedId: 'stub' } }),
    findOne: vi.fn(async (filter: Record<string, unknown> = {}) => docs.find((d) => matchesFilter(d, filter)) ?? null),
    find: vi.fn((filter: Record<string, unknown> = {}) => cursor(docs.filter((d) => matchesFilter(d, filter)))),
    countDocuments: vi.fn(async (filter: Record<string, unknown> = {}) => docs.filter((d) => matchesFilter(d, filter)).length),
    updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
      const doc = docs.find((d) => matchesFilter(d, filter))
      if (doc && update.$set) Object.assign(doc, update.$set)
      return { acknowledged: true, matchedCount: doc ? 1 : 0 }
    }),
    // Returns the document directly (not wrapped in `.value`) and null on
    // no match — matches the real MongoDB driver's shape, which
    // family-financial-profile.ts's OAK-006 optimistic-concurrency check
    // depends on.
    findOneAndUpdate: vi.fn(async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown>; $inc?: Record<string, number> }, options?: { upsert?: boolean }) => {
      let doc = docs.find((d) => matchesFilter(d, filter))
      if (!doc && options?.upsert) {
        doc = { ...filter }
        docs.push(doc)
      }
      if (!doc) return null
      if (update.$set) Object.assign(doc, update.$set)
      if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) doc[k] = ((doc[k] as number) ?? 0) + v
      }
      return doc
    }),
    _docs: docs,
  }
}

function makeFakeDb(names: string[]) {
  const collections = new Map(names.map((n) => [n, makeFakeCollection()]))
  return {
    db: { collection: (name: string) => collections.get(name) ?? (collections.set(name, makeFakeCollection()), collections.get(name)) } as any,
    collections,
  }
}

function authHook(tenantId: string) {
  return async (request: any) => { request.authContext = { tenant_id: tenantId, user_id: `${tenantId}-user` } }
}

const BASE_PROFILE = {
  household: {
    employment_status: 'employed',
    monthly_salary_minor: 400000,
    annual_living_expenses_minor: 3600000,
    mortgage_outstanding_minor: 0,
    life_cover_minor: 10_000_000,
    income_protection_monthly_minor: 400000,
  },
  emergency_fund: {
    emergency_savings_minor: 3_600_000,
    monthly_expenses_minor: 300000,
    has_high_interest_debt: false,
    high_interest_debt_balance_minor: 0,
  },
  retirement: {
    current_age: 30,
    target_retirement_age: 65,
    pension_balance_minor: 5_000_000,
    monthly_contribution_minor: 50000,
    target_retirement_income_minor: 3_000_000,
    expected_annual_growth_pct: 5,
  },
  education_funds: [],
}

describe('OAK-009: HTTP-level cross-tenant isolation', () => {
  describe('family-financial-profile.ts (via real getTenantCollection)', () => {
    it('tenant B cannot read tenant A\'s financial profile via GET /family/financial-profile', async () => {
      const engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
      await engine.load()
      const { db } = makeFakeDb(['family_financial_profile'])

      const app = Fastify()
      app.addHook('onRequest', async (request: any) => {
        request.authContext = { tenant_id: request.headers['x-test-tenant'], user_id: 'user-1' }
      })
      await registerFamilyFinancialProfileRoutes(app, db, engine)

      const postA = await app.inject({
        method: 'POST',
        url: '/family/financial-profile',
        headers: { 'x-test-tenant': TENANT_A },
        payload: BASE_PROFILE,
      })
      expect(postA.statusCode).toBe(200)

      const getAsB = await app.inject({
        method: 'GET',
        url: '/family/financial-profile',
        headers: { 'x-test-tenant': TENANT_B },
      })
      expect(getAsB.statusCode).toBe(200)
      expect(getAsB.json().profile).toBeNull()

      const getAsA = await app.inject({
        method: 'GET',
        url: '/family/financial-profile',
        headers: { 'x-test-tenant': TENANT_A },
      })
      expect(getAsA.json().profile).not.toBeNull()
    })
  })

  describe('family-group.ts (via real getTenantCollection)', () => {
    it('tenant B cannot read tenant A\'s family via GET /family, and can create their own', async () => {
      const { db } = makeFakeDb(['family_groups', 'users'])

      const app = Fastify()
      app.addHook('onRequest', authHook(TENANT_A))
      registerFamilyGroupRoutes(app, db)

      const createA = await app.inject({ method: 'POST', url: '/family', payload: { name: 'The A Family' } })
      expect(createA.statusCode).toBe(201)

      const appB = Fastify()
      appB.addHook('onRequest', authHook(TENANT_B))
      registerFamilyGroupRoutes(appB, db)

      const getAsB = await appB.inject({ method: 'GET', url: '/family' })
      expect(getAsB.json().family).toBeNull()

      // Tenant B must still be able to create their OWN family — proves
      // the earlier null wasn't from some global "family already exists"
      // guard leaking across tenants.
      const createB = await appB.inject({ method: 'POST', url: '/family', payload: { name: 'The B Family' } })
      expect(createB.statusCode).toBe(201)
      expect(createB.json().family.name).toBe('The B Family')

      const getAsA = await app.inject({ method: 'GET', url: '/family' })
      expect(getAsA.json().family.name).toBe('The A Family')
    })
  })

  describe('insights.ts (manual tenant_id filtering, no shared wrapper)', () => {
    async function buildInsightsApp(tenantId: string, seed: Array<Record<string, unknown>>) {
      const { getInsightsCollection } = await import('../../db.js')
      const insightsCol = makeFakeCollection()
      for (const doc of seed) await insightsCol.insertOne(doc)
      vi.mocked(getInsightsCollection).mockResolvedValue(insightsCol as any)

      const app = Fastify()
      app.addHook('onRequest', authHook(tenantId))
      await registerInsightRoutes(app, {} as any)
      return { app, col: insightsCol }
    }

    const tenantAInsight = {
      id: 'insight-a-1',
      tenant_id: TENANT_A,
      hypothesis: 'test',
      reasoning: 'Tenant A only.',
      category: 'risk',
      urgency: 'medium',
      state: 'identified',
      actions: [],
      created_at: new Date(),
    }

    it('tenant B cannot list or fetch-by-id tenant A\'s insight', async () => {
      const { app } = await buildInsightsApp(TENANT_B, [tenantAInsight])

      const list = await app.inject({ method: 'GET', url: '/insights' })
      expect(list.json().insights).toHaveLength(0)
      expect(list.json().total).toBe(0)

      const byId = await app.inject({ method: 'GET', url: '/insights/insight-a-1' })
      expect(byId.statusCode).toBe(404)
    })

    it('sanity check: tenant A can see their own insight via the same setup', async () => {
      const { app } = await buildInsightsApp(TENANT_A, [tenantAInsight])

      const byId = await app.inject({ method: 'GET', url: '/insights/insight-a-1' })
      expect(byId.statusCode).toBe(200)
      expect(byId.json().id).toBe('insight-a-1')

      const list = await app.inject({ method: 'GET', url: '/insights' })
      expect(list.json().total).toBe(1)
    })

    // OAK-009: the tests above only cover GET routes. approve/dismiss are
    // the state-mutating endpoints closest to the original exploit chain
    // (a tenant acting on data that isn't theirs), and had zero HTTP-level
    // isolation coverage — both already filter correctly
    // (`{ id, tenant_id, state }` in findOneAndUpdate), this closes the gap
    // between "correct" and "proven correct by a real request."
    it('tenant B cannot approve tenant A\'s insight via POST /insights/:id/approve', async () => {
      const { app, col } = await buildInsightsApp(TENANT_B, [{ ...tenantAInsight }])

      const res = await app.inject({ method: 'POST', url: '/insights/insight-a-1/approve', payload: {} })
      expect(res.statusCode).toBe(404)

      const doc = col._docs.find((d) => d['id'] === 'insight-a-1')
      expect(doc?.['state']).toBe('identified')
    })

    it('tenant B cannot dismiss tenant A\'s insight via POST /insights/:id/dismiss', async () => {
      const { app, col } = await buildInsightsApp(TENANT_B, [{ ...tenantAInsight }])

      const res = await app.inject({ method: 'POST', url: '/insights/insight-a-1/dismiss', payload: {} })
      expect(res.statusCode).toBe(404)

      const doc = col._docs.find((d) => d['id'] === 'insight-a-1')
      expect(doc?.['state']).toBe('identified')
    })

    it('sanity check: tenant A can approve their own insight', async () => {
      const { app, col } = await buildInsightsApp(TENANT_A, [{ ...tenantAInsight }])

      const res = await app.inject({ method: 'POST', url: '/insights/insight-a-1/approve', payload: {} })
      expect(res.statusCode).toBe(200)
      expect(res.json().insight.state).toBe('completed')

      const doc = col._docs.find((d) => d['id'] === 'insight-a-1')
      expect(doc?.['state']).toBe('completed')
    })
  })
})
