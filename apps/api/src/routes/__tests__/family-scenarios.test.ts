/**
 * /family/scenarios (PRD-115) — preview + saved scenarios that recompute
 * against the live profile on every read.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyScenarioRoutes } from '../family-scenarios.js'

const TENANT = 'tenant-scen-1'
const OTHER_TENANT = 'tenant-scen-2'
const ADULT_ID = 'adult-1'
const OTHER_ADULT_ID = 'adult-2'
const CHILD_ID = 'child-1'

let profileDoc: Record<string, unknown> | null
let scenarioDocs: Record<string, unknown>[]
let familyMembers: Array<{ id: string; role: string; status: string }>

const PROFILE = {
  household: {
    employment_status: 'employed',
    monthly_salary_minor: 500_000,
    annual_living_expenses_minor: 3_600_000,
    mortgage_outstanding_minor: 0,
    life_cover_minor: 0,
    income_protection_monthly_minor: 0,
    members: [],
  },
  emergency_fund: {
    emergency_savings_minor: 900_000,
    monthly_expenses_minor: 300_000,
    has_high_interest_debt: false,
    high_interest_debt_balance_minor: 0,
  },
  retirement: {
    current_age: 40,
    target_retirement_age: 65,
    pension_balance_minor: 0,
    monthly_contribution_minor: 0,
    target_retirement_income_minor: 0,
    expected_annual_growth_pct: 5,
  },
  education_funds: [],
  policies: [],
}

function matchFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in (v as Record<string, unknown>))
      return ((v as { $in: unknown[] }).$in as unknown[]).includes(doc[k])
    return doc[k] === v
  })
}

// The real getTenantCollection injects tenant_id into insertOne docs and
// find filters, so these stubs see the scoped doc/query directly.
function col(store: Record<string, unknown>[]) {
  return {
    findOne: async (filter: Record<string, unknown> = {}) => store.find((d) => matchFilter(d, filter)) ?? null,
    find: (filter: Record<string, unknown> = {}) => ({
      toArray: async () => store.filter((d) => matchFilter(d, filter)),
    }),
    insertOne: async (doc: Record<string, unknown>) => { store.push(doc); return { insertedId: doc.id } },
    deleteOne: async (filter: Record<string, unknown>) => {
      const i = store.findIndex((d) => matchFilter(d, filter))
      if (i >= 0) store.splice(i, 1)
      return { deletedCount: i >= 0 ? 1 : 0 }
    },
    createIndex: async () => ({}),
  }
}

function makeDb(tenantId: string) {
  return {
    collection: (name: string) => {
      if (name === 'family_financial_profile')
        return col(profileDoc ? [{ ...profileDoc, tenant_id: tenantId }] : [])
      if (name === 'family_groups') return col([{ tenant_id: tenantId, members: familyMembers }])
      if (name === 'family_scenarios') return col(scenarioDocs)
      return col([])
    },
  } as never
}

async function buildApp(userId: string, tenantId = TENANT) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as { authContext?: unknown }).authContext = { tenant_id: tenantId, user_id: userId }
  })
  registerFamilyScenarioRoutes(app, makeDb(tenantId))
  return app
}

describe('family scenarios', () => {
  beforeEach(() => {
    profileDoc = { ...PROFILE }
    scenarioDocs = []
    familyMembers = [
      { id: ADULT_ID, role: 'organizer', status: 'active' },
      { id: OTHER_ADULT_ID, role: 'adult', status: 'active' },
      { id: CHILD_ID, role: 'child', status: 'active' },
    ]
  })

  it('POST /preview runs the math without persisting anything', async () => {
    const app = await buildApp(ADULT_ID)
    const res = await app.inject({
      method: 'POST',
      url: '/family/scenarios/preview',
      payload: { monthlyIncomeDeltaMinor: -500_000, monthsUntilChange: 6 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.has_live_data).toBe(true)
    // £9,000 + £2,000/mo surplus × 6 = £21,000 → 7 months of £3,000 expenses
    expect(body.result.savingsAtChangeMinor).toBe(2_100_000)
    expect(body.result.projectedRunwayMonths).toBe(7)
    expect(scenarioDocs).toHaveLength(0)
    await app.close()
  })

  it('POST /preview reports has_live_data false with nothing on file rather than projecting zeros', async () => {
    profileDoc = null
    const app = await buildApp(ADULT_ID)
    const res = await app.inject({
      method: 'POST',
      url: '/family/scenarios/preview',
      payload: { monthlyIncomeDeltaMinor: -500_000 },
    })
    expect(res.json()).toMatchObject({ result: null, has_live_data: false })
    await app.close()
  })

  it('rejects a malformed preview body', async () => {
    const app = await buildApp(ADULT_ID)
    const res = await app.inject({
      method: 'POST',
      url: '/family/scenarios/preview',
      payload: { monthsUntilChange: -3 },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('saves a scenario and recomputes it against the live profile on read', async () => {
    const app = await buildApp(ADULT_ID)
    const create = await app.inject({
      method: 'POST',
      url: '/family/scenarios',
      payload: { name: 'Job loss in 6 months', monthlyIncomeDeltaMinor: -500_000, monthsUntilChange: 6 },
    })
    expect(create.statusCode).toBe(201)
    const saved = create.json().scenario
    expect(saved.result.projectedRunwayMonths).toBe(7)

    // The family saves more before the change arrives — the stored inputs
    // are unchanged but the result moves with the live profile.
    ;(profileDoc!.emergency_fund as Record<string, unknown>).emergency_savings_minor = 1_500_000
    const list = await app.inject({ method: 'GET', url: '/family/scenarios' })
    const listed = list.json().scenarios[0]
    expect(listed.id).toBe(saved.id)
    // £15,000 + £12,000 accrued = £27,000 → 9 months
    expect(listed.result.projectedRunwayMonths).toBe(9)
    await app.close()
  })

  it('GET /family/scenarios/:id returns one scenario, 404s for unknown ids', async () => {
    const app = await buildApp(ADULT_ID)
    const create = await app.inject({
      method: 'POST',
      url: '/family/scenarios',
      payload: { name: 'Extra savings', monthlyExtraSavingsMinor: 50_000 },
    })
    const id = create.json().scenario.id
    const one = await app.inject({ method: 'GET', url: `/family/scenarios/${id}` })
    expect(one.statusCode).toBe(200)
    expect(one.json().scenario.name).toBe('Extra savings')
    const missing = await app.inject({ method: 'GET', url: '/family/scenarios/nope' })
    expect(missing.statusCode).toBe(404)
    await app.close()
  })

  it('scopes scenarios to the tenant — another tenant sees an empty list', async () => {
    const appA = await buildApp(ADULT_ID, TENANT)
    await appA.inject({
      method: 'POST',
      url: '/family/scenarios',
      payload: { name: 'Job loss', monthlyIncomeDeltaMinor: -500_000 },
    })
    const appB = await buildApp(ADULT_ID, OTHER_TENANT)
    const res = await appB.inject({ method: 'GET', url: '/family/scenarios' })
    expect(res.json().scenarios).toHaveLength(0)
    await appA.close()
    await appB.close()
  })

  it('lets the creator delete their own scenario; a child cannot delete another member’s', async () => {
    const app = await buildApp(ADULT_ID)
    const create = await app.inject({
      method: 'POST',
      url: '/family/scenarios',
      payload: { name: 'Job loss', monthlyIncomeDeltaMinor: -100_000 },
    })
    const id = create.json().scenario.id
    await app.close()

    const childApp = await buildApp(CHILD_ID)
    const denied = await childApp.inject({ method: 'DELETE', url: `/family/scenarios/${id}` })
    expect(denied.statusCode).toBe(403)
    await childApp.close()

    const creatorApp = await buildApp(ADULT_ID)
    const ok = await creatorApp.inject({ method: 'DELETE', url: `/family/scenarios/${id}` })
    expect(ok.statusCode).toBe(204)
    await creatorApp.close()
  })

  it('lets a non-creator family adult delete a scenario', async () => {
    const app = await buildApp(ADULT_ID)
    const create = await app.inject({
      method: 'POST',
      url: '/family/scenarios',
      payload: { name: 'Job loss', monthlyIncomeDeltaMinor: -100_000 },
    })
    const id = create.json().scenario.id
    await app.close()

    const otherAdult = await buildApp(OTHER_ADULT_ID)
    const res = await otherAdult.inject({ method: 'DELETE', url: `/family/scenarios/${id}` })
    expect(res.statusCode).toBe(204)
    await otherAdult.close()
  })
})
