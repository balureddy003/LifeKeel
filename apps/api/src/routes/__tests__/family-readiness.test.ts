/**
 * GET /family/readiness — composite server-side readiness score (PRD-114).
 * Tests the route contract: profile-driven subscores, estate gating for
 * non-adults, has_live_data tied to insights_evaluated_at, and insights
 * riding along as explanations.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyReadinessRoutes } from '../family-readiness.js'
import { ESTATE_VAULT_CATEGORY } from '../documents.js'

const TENANT = 'tenant-ready-1'
const ADULT_ID = 'adult-1'
const CHILD_ID = 'child-1'

let familyMembers: Array<{ id: string; role: string; status: string }>
let profileDoc: Record<string, unknown> | null
let vaultDocs: Record<string, unknown>[]
let insights: Record<string, unknown>[]

const VALID_PROFILE = {
  household: {
    employment_status: 'employed',
    monthly_salary_minor: 400_000,
    annual_living_expenses_minor: 3_000_000,
    mortgage_outstanding_minor: 10_000_000,
    life_cover_minor: 25_000_000, // meets need = mortgage(£100k) + 5yr expenses(£150k)
    income_protection_monthly_minor: 20_000,
    members: [],
  },
  emergency_fund: {
    emergency_savings_minor: 1_500_000,
    monthly_expenses_minor: 250_000,
    has_high_interest_debt: false,
    high_interest_debt_balance_minor: 0,
  },
  retirement: {
    current_age: 40,
    target_retirement_age: 65,
    pension_balance_minor: 10_000_000,
    monthly_contribution_minor: 50_000,
    target_retirement_income_minor: 2_000_000,
    expected_annual_growth_pct: 5,
  },
  education_funds: [
    { child_name: 'A', child_age: 10, current_savings_minor: 500_000, target_savings_minor: 500_000, years_remaining: 8 },
  ],
  policies: [{ type: 'health', provider: 'X', coverage_amount_minor: 0, monthly_premium_minor: 0 }],
}

function matchFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in (v as Record<string, unknown>))
      return ((v as { $in: unknown[] }).$in as unknown[]).includes(doc[k])
    return doc[k] === v
  })
}

function col(store: Record<string, unknown>[]) {
  return {
    findOne: async (filter: Record<string, unknown> = {}) => store.find((d) => matchFilter(d, filter)) ?? null,
    find: (filter: Record<string, unknown> = {}, _opts?: unknown) => ({
      toArray: async () => store.filter((d) => matchFilter(d, filter)),
    }),
    createIndex: async () => ({}),
  }
}

function makeDb() {
  return {
    collection: (name: string) => {
      if (name === 'family_financial_profile') return col(profileDoc ? [{ ...profileDoc, tenant_id: TENANT }] : [])
      if (name === 'documents') return col(vaultDocs.map((d) => ({ ...d, tenant_id: TENANT })))
      if (name === 'family_groups') return col([{ tenant_id: TENANT, members: familyMembers }])
      if (name === 'insights') return col(insights.map((d) => ({ tenant_id: TENANT, ...d })))
      return col([])
    },
  } as never
}

async function buildApp(userId: string) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as { authContext?: unknown }).authContext = { tenant_id: TENANT, user_id: userId }
  })
  registerFamilyReadinessRoutes(app, makeDb())
  return app
}

describe('GET /family/readiness', () => {
  beforeEach(() => {
    familyMembers = [
      { id: ADULT_ID, role: 'organizer', status: 'active' },
      { id: CHILD_ID, role: 'child', status: 'active' },
    ]
    profileDoc = null
    vaultDocs = []
    insights = []
  })

  it('returns null score and empty components with no profile on file', async () => {
    const app = await buildApp(ADULT_ID)
    const res = await app.inject({ method: 'GET', url: '/family/readiness' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ score: null, has_live_data: false, components: [] })
    await app.close()
  })

  it('scores a complete profile — all five components present for an adult', async () => {
    profileDoc = { ...VALID_PROFILE, insights_evaluated_at: new Date() }
    vaultDocs = [
      { id: 'v1', category: ESTATE_VAULT_CATEGORY, doc_type: 'will' },
      { id: 'v2', category: ESTATE_VAULT_CATEGORY, doc_type: 'power_of_attorney' },
    ]
    const app = await buildApp(ADULT_ID)
    const res = await app.inject({ method: 'GET', url: '/family/readiness' })
    const body = res.json()
    expect(body.score).toBe(100)
    expect(body.has_live_data).toBe(true)
    expect(body.components.map((c: { key: string }) => c.key)).toEqual([
      'emergency_fund',
      'protection',
      'retirement',
      'education',
      'estate',
    ])
    await app.close()
  })

  it('marks has_live_data false when the profile was autosaved but never evaluated', async () => {
    profileDoc = { ...VALID_PROFILE } // no insights_evaluated_at
    const app = await buildApp(ADULT_ID)
    const res = await app.inject({ method: 'GET', url: '/family/readiness' })
    expect(res.json().has_live_data).toBe(false)
    await app.close()
  })

  it('gates the estate component for a child member', async () => {
    profileDoc = { ...VALID_PROFILE, insights_evaluated_at: new Date() }
    vaultDocs = [{ id: 'v1', category: ESTATE_VAULT_CATEGORY, doc_type: 'will' }]
    const app = await buildApp(CHILD_ID)
    const res = await app.inject({ method: 'GET', url: '/family/readiness' })
    const body = res.json()
    const estate = body.components.find((c: { key: string }) => c.key === 'estate')
    expect(estate).toMatchObject({ gated: true, score: null })
    expect(body.score).not.toBeNull()
    await app.close()
  })

  it('attaches open family insights to their explaining component only', async () => {
    profileDoc = { ...VALID_PROFILE, insights_evaluated_at: new Date() }
    insights = [
      { id: 'i1', detector_id: 'family_emergency_fund_adequacy', rule_id: 'emergency_fund_below_3_months', hypothesis: 'x', confidence: 0.8, state: 'identified' },
      { id: 'i2', detector_id: 'family_protection_gap', rule_id: 'no_income_protection', hypothesis: 'y', confidence: 0.7, state: 'dismissed' },
      { id: 'i3', detector_id: 'unrelated_detector', rule_id: 'r', hypothesis: 'z', confidence: 0.5, state: 'identified' },
    ]
    const app = await buildApp(ADULT_ID)
    const res = await app.inject({ method: 'GET', url: '/family/readiness' })
    const body = res.json()
    const emergency = body.components.find((c: { key: string }) => c.key === 'emergency_fund')
    expect(emergency.insights).toHaveLength(1)
    expect(emergency.insights[0].id).toBe('i1')
    // dismissed + non-family insights are excluded everywhere
    expect(body.insights).toHaveLength(1)
    await app.close()
  })
})
