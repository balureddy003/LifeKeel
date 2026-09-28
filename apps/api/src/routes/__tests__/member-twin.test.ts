/**
 * GET /family/members/:id/twin (PRD-117) — the per-member read model
 * assembling roster + earner + policies + education funds + attributed
 * insights, computed fresh on read.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerMemberTwinRoutes } from '../member-twin.js'

const TENANT = 'tenant-twin-1'
const OTHER_TENANT = 'tenant-twin-2'
const ORG_ID = 'org-1'
const PARTNER_ID = 'partner-1'
const CHILD_ID = 'child-1'

let profileDoc: Record<string, unknown> | null
let insights: Record<string, unknown>[]
let members: Record<string, unknown>[]

const PROFILE = {
  household: {
    employment_status: 'employed',
    monthly_salary_minor: 600_000,
    annual_living_expenses_minor: 3_600_000,
    mortgage_outstanding_minor: 0,
    life_cover_minor: 0,
    income_protection_monthly_minor: 10_000,
    members: [
      { member_id: PARTNER_ID, employment_status: 'self_employed', monthly_salary_minor: 250_000, income_protection_monthly_minor: 0 },
    ],
  },
  emergency_fund: { emergency_savings_minor: 900_000, monthly_expenses_minor: 300_000, has_high_interest_debt: false, high_interest_debt_balance_minor: 0 },
  retirement: { current_age: 40, target_retirement_age: 65, pension_balance_minor: 0, monthly_contribution_minor: 0, target_retirement_income_minor: 0, expected_annual_growth_pct: 5 },
  education_funds: [
    { child_name: 'Nihaan Kumar', child_age: 10, current_savings_minor: 200_000, target_savings_minor: 2_000_000, years_remaining: 8 },
    { child_name: 'Tanvi', child_age: 6, current_savings_minor: 100_000, target_savings_minor: 1_000_000, years_remaining: 12, member_id: 'other-child' },
  ],
  policies: [
    { type: 'life', provider: 'Aviva', coverage_amount_minor: 25_000_000, monthly_premium_minor: 4_000, member_id: ORG_ID },
    { type: 'car', provider: 'Direct Line', coverage_amount_minor: 0, monthly_premium_minor: 5_000 }, // household — no member
    { type: 'health', provider: 'Bupa', coverage_amount_minor: 0, monthly_premium_minor: 12_000, member_id: PARTNER_ID, renewal_date: '2026-12-01' },
  ],
}

function matchFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (k === '$or') return (v as Record<string, unknown>[]).some((c) => matchFilter(doc, c))
    if (v && typeof v === 'object' && '$in' in (v as Record<string, unknown>))
      return ((v as { $in: unknown[] }).$in as unknown[]).includes(resolveKey(doc, k))
    return resolveKey(doc, k) === v
  })
}

// Supports the dotted keys used in insight filters ('feature_snapshot.member_id').
function resolveKey(doc: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], doc)
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

function makeDb(tenantId: string) {
  return {
    collection: (name: string) => {
      if (name === 'family_financial_profile')
        return col(profileDoc ? [{ ...profileDoc, tenant_id: tenantId }] : [])
      // The group doc belongs to TENANT regardless of who's asking — the
      // tenant-scoped wrapper adds tenant_id to the filter, so another
      // tenant's query finds nothing (as it should).
      if (name === 'family_groups') return col([{ tenant_id: TENANT, members }])
      if (name === 'insights') return col(insights.map((d) => ({ tenant_id: tenantId, ...d })))
      return col([])
    },
  } as never
}

async function buildApp(tenantId = TENANT) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as { authContext?: unknown }).authContext = { tenant_id: tenantId, user_id: ORG_ID }
  })
  registerMemberTwinRoutes(app, makeDb(tenantId))
  return app
}

describe('GET /family/members/:id/twin', () => {
  beforeEach(() => {
    members = [
      { id: ORG_ID, name: 'Balu Kumar', email: 'b@x.com', role: 'organizer', status: 'active', joined_at: '2026-01-01', date_of_birth: '1985-06-15' },
      { id: PARTNER_ID, name: 'Sudha Kumar', email: 's@x.com', role: 'adult', status: 'active', joined_at: '2026-01-02' },
      { id: CHILD_ID, name: 'Nihaan Kumar', email: '', role: 'child', status: 'pending', joined_at: '2026-01-03', date_of_birth: '2016-03-01' },
    ]
    profileDoc = { ...PROFILE }
    insights = []
  })

  it('404s for a member id not on the roster', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/family/members/nope/twin' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('assembles the organizer’s twin — household earner fields, attributed policies, member insights', async () => {
    insights = [
      { id: 'i1', detector_id: 'family_protection_gap', rule_id: 'no_income_protection', hypothesis: 'h', confidence: 0.8, state: 'identified', feature_snapshot: { member_id: ORG_ID } },
      { id: 'i2', detector_id: 'family_protection_gap', rule_id: 'other', hypothesis: 'h2', confidence: 0.7, state: 'identified', feature_snapshot: { member_id: PARTNER_ID } },
      { id: 'i3', detector_id: 'family_protection_gap', rule_id: 'old', hypothesis: 'h3', confidence: 0.7, state: 'dismissed', feature_snapshot: { member_id: ORG_ID } },
    ]
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/family/members/${ORG_ID}/twin` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.member.name).toBe('Balu Kumar')
    expect(body.member.age).toBeGreaterThanOrEqual(40)
    // Organizer falls back to household-level earner fields
    expect(body.financial.earner).toMatchObject({ employment_status: 'employed', monthly_salary_minor: 600_000 })
    expect(body.financial.policies).toHaveLength(1)
    expect(body.financial.policies[0].provider).toBe('Aviva')
    // Only open, member-attributed insights
    expect(body.financial.insights.map((i: { id: string }) => i.id)).toEqual(['i1'])
    expect(body.has_live_data).toBe(true)
    await app.close()
  })

  it('assembles a partner twin from their per-member earner entry', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/family/members/${PARTNER_ID}/twin` })
    const body = res.json()
    expect(body.financial.earner).toMatchObject({ employment_status: 'self_employed', monthly_salary_minor: 250_000 })
    expect(body.financial.policies.map((p: { provider: string }) => p.provider)).toEqual(['Bupa'])
    expect(body.financial.education_funds).toHaveLength(0)
    await app.close()
  })

  it('assembles a child twin — education fund matched by member_id or first name, with the pace needed', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/family/members/${CHILD_ID}/twin` })
    const body = res.json()
    // 'Nihaan Kumar' fund matches by first name (no member_id on it);
    // Tanvi's fund belongs to a different member_id — excluded.
    expect(body.financial.education_funds).toHaveLength(1)
    const fund = body.financial.education_funds[0]
    expect(fund.child_name).toBe('Nihaan Kumar')
    expect(fund.months_remaining).toBe(96)
    // (2,000,000 − 200,000) / 96 = 18,750 needed per month
    expect(fund.needed_monthly_minor).toBe(18_750)
    expect(body.financial.earner).toBeNull()
    await app.close()
  })

  it('returns has_live_data false and an empty financial shell with no profile', async () => {
    profileDoc = null
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/family/members/${ORG_ID}/twin` })
    const body = res.json()
    expect(body.has_live_data).toBe(false)
    expect(body.financial).toMatchObject({ earner: null, policies: [], education_funds: [], insights: [] })
    await app.close()
  })

  it('scopes to the tenant — a member id only resolves in its own family', async () => {
    const app = await buildApp(OTHER_TENANT)
    const res = await app.inject({ method: 'GET', url: `/family/members/${ORG_ID}/twin` })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})
