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
let nudges: Record<string, unknown>[] = []
let readinessEvents: Record<string, unknown>[] = []

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
    if (v && typeof v === 'object' && '$nin' in (v as Record<string, unknown>))
      return !((v as { $nin: unknown[] }).$nin as unknown[]).includes(resolveKey(doc, k))
    return resolveKey(doc, k) === v
  })
}

// Minimal $set/$setOnInsert/$unset writer — enough for member_nudges'
// reconcile upserts.
function applyUpdate(doc: Record<string, unknown>, update: Record<string, unknown>, inserting: boolean) {
  const set = { ...(inserting ? (update['$setOnInsert'] as Record<string, unknown> | undefined) : {}), ...(update['$set'] as Record<string, unknown> | undefined) }
  for (const [k, v] of Object.entries(set)) doc[k] = v
  for (const k of Object.keys((update['$unset'] as Record<string, unknown> | undefined) ?? {})) delete doc[k]
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
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>, opts?: { upsert?: boolean }) => {
      const doc = store.find((d) => matchFilter(d, filter))
      if (doc) {
        applyUpdate(doc, update, false)
        return { modifiedCount: 1 }
      }
      if (opts?.upsert) {
        const fresh: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(filter)) if (!k.startsWith('$') && typeof v !== 'object') fresh[k] = v
        applyUpdate(fresh, update, true)
        store.push(fresh)
        return { modifiedCount: 0, upsertedCount: 1 }
      }
      return { modifiedCount: 0 }
    },
    updateMany: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      let n = 0
      for (const d of store) if (matchFilter(d, filter)) { applyUpdate(d, update, false); n++ }
      return { modifiedCount: n }
    },
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
      if (name === 'member_nudges') return col(nudges)
      if (name === 'readiness_events') return col(readinessEvents)
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
    // PRD-118 member readiness: protection 100 (IP on file + attributed
    // Aviva life cover ≥ need), retirement null (no target set), estate 0
    // (no vault docs in this mock) → (100×40 + 0×10)/50 = 80.
    expect(body.readiness.components.map((c: { key: string }) => c.key)).toEqual(['protection', 'retirement', 'estate'])
    expect(body.readiness.score).toBe(80)
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
    // Employed earner with no income protection and no life policy —
    // their own protection component reads 0, not the household's.
    expect(body.readiness.components.find((c: { key: string }) => c.key === 'protection').score).toBe(0)
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
    // Child twin readiness is education alone: £2k of £20k target → 10.
    expect(body.readiness.components.map((c: { key: string }) => c.key)).toEqual(['education'])
    expect(body.readiness.score).toBe(10)
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

describe('GET /family/members/:id/twin?mode=youth (PRD-124)', () => {
  beforeEach(() => {
    members = [
      { id: ORG_ID, name: 'Balu Kumar', email: 'b@x.com', role: 'organizer', status: 'active', joined_at: '2026-01-01', date_of_birth: '1985-06-15' },
      { id: PARTNER_ID, name: 'Sudha Kumar', email: 's@x.com', role: 'adult', status: 'active', joined_at: '2026-01-02' },
      { id: CHILD_ID, name: 'Nihaan Kumar', email: '', role: 'child', status: 'pending', joined_at: '2026-01-03', date_of_birth: '2016-03-01' },
    ]
    profileDoc = { ...PROFILE }
    insights = []
  })

  it('returns a redacted youth projection — percentages, never minor amounts', async () => {
    insights = [
      { id: 'i1', detector_id: 'family_education_shortfall', rule_id: 'r', hypothesis: 'gap', confidence: 0.8, state: 'identified', feature_snapshot: { member_id: CHILD_ID } },
    ]
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/family/members/${CHILD_ID}/twin?mode=youth` })
    expect(res.statusCode).toBe(200)
    const body = res.json()

    // The youth block carries the kid-legible view.
    expect(body.youth.age_band).toBe('younger')
    expect(body.youth.savings_goals).toHaveLength(1)
    const goal = body.youth.savings_goals[0]
    expect(goal.progress_pct).toBe(10) // 200k of 2M target
    expect(goal.years_until_goal).toBe(8)

    // The redaction is the point: nothing in the payload carries money,
    // earner data, policies, or insight copy.
    expect(body.financial).toEqual({ earner: null, policies: [], education_funds: [], insights: [] })
    expect(body.readiness).toBeNull()
    // No minor-unit fields or raw savings figures anywhere in the payload.
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('_minor')
    expect(raw).not.toContain('200000') // the fund's current_savings_minor
    expect(raw).not.toContain('2000000') // its target

    // PRD-129: band-appropriate literacy lessons ride the same payload.
    expect(body.youth.lessons.length).toBeGreaterThan(0)
    expect(body.youth.lessons.map((l: { id: string }) => l.id)).toContain('save-some-first')
    expect(body.youth.lessons.map((l: { id: string }) => l.id)).not.toContain('compounding')
    await app.close()
  })

  it('teen band gets the teen curriculum — server-side banding, not a client pick', async () => {
    members[2]!['date_of_birth'] = '2011-05-01' // ~15 → teen band
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/family/members/${CHILD_ID}/twin?mode=youth` })
    const body = res.json()
    expect(body.youth.age_band).toBe('teen')
    expect(body.youth.lessons.map((l: { id: string }) => l.id)).toContain('compounding')
    await app.close()
  })

  it('400s youth mode on an adult member rather than silently leaking the full payload', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/family/members/${ORG_ID}/twin?mode=youth` })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('adult-role member under 18 still gets youth treatment (DOB wins over role)', async () => {
    members[1]!['date_of_birth'] = '2011-05-01' // partner, ~15
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/family/members/${PARTNER_ID}/twin?mode=youth` })
    expect(res.statusCode).toBe(200)
    expect(res.json().youth.age_band).toBe('teen')
    await app.close()
  })
})

describe('GET /family/members/:id/agent (PRD-126)', () => {
  beforeEach(() => {
    members = [
      { id: ORG_ID, name: 'Balu Kumar', email: 'b@x.com', role: 'organizer', status: 'active', joined_at: '2026-01-01', date_of_birth: '1985-06-15' },
      { id: PARTNER_ID, name: 'Sudha Kumar', email: 's@x.com', role: 'adult', status: 'active', joined_at: '2026-01-02' },
      { id: CHILD_ID, name: 'Nihaan Kumar', email: '', role: 'child', status: 'pending', joined_at: '2026-01-03', date_of_birth: '2016-03-01' },
    ]
    profileDoc = { ...PROFILE }
    insights = []
  })

  it('synthesizes prioritized nudges — member insights first, then attention, then progress', async () => {
    insights = [
      { id: 'i1', detector_id: 'family_protection_gap', rule_id: 'no_income_protection', hypothesis: 'missing_income_protection', reasoning: 'Partner has no income protection on file', confidence: 0.8, state: 'identified', feature_snapshot: { member_id: PARTNER_ID } },
    ]
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/family/members/${PARTNER_ID}/agent` })
    expect(res.statusCode).toBe(200)
    const body = res.json()

    expect(body.persona).toBe('adult')
    expect(body.provisional).toBe(false)
    const kinds = body.nudges.map((n: { kind: string }) => n.kind)
    // Insight first, then the attention nudge for protection=0, estate=0.
    expect(kinds[0]).toBe('insight')
    expect(kinds).toContain('attention')
    expect(body.nudges[0].source.insight_id).toBe('i1')
    const protection = body.nudges.find((n: { source?: { component?: string } }) => n.source?.component === 'protection')
    expect(protection.title).toMatch(/protection/i)
    await app.close()
  })

  it('marks a pending member provisional — their data was entered on their behalf', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/family/members/${CHILD_ID}/agent` })
    const body = res.json()
    expect(body.provisional).toBe(true)
  })

  it('child members get the guardian persona — nudges speak about the child, to the adults', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/family/members/${CHILD_ID}/agent` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.persona).toBe('guardian')
    // Education at 10% of target → attention nudge phrased about Nihaan.
    const attention = body.nudges.find((n: { kind: string }) => n.kind === 'attention')
    expect(attention.title).toContain('Nihaan')
    await app.close()
  })

  it('nudges carry no product/provider steering — informational copy only', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/family/members/${PARTNER_ID}/agent` })
    const body = res.json()
    const text = JSON.stringify(body.nudges).toLowerCase()
    expect(text).not.toMatch(/buy|purchase|switch to|we recommend \w+ insurance/)
    await app.close()
  })

  it('404s for a member id not on the roster', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/family/members/nope/agent' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('member nudge persistence (PRD-127)', () => {
  beforeEach(() => {
    members = [
      { id: ORG_ID, name: 'Balu Kumar', email: 'b@x.com', role: 'organizer', status: 'active', joined_at: '2026-01-01', date_of_birth: '1985-06-15' },
      { id: PARTNER_ID, name: 'Sudha Kumar', email: 's@x.com', role: 'adult', status: 'active', joined_at: '2026-01-02' },
      { id: CHILD_ID, name: 'Nihaan Kumar', email: '', role: 'child', status: 'pending', joined_at: '2026-01-03', date_of_birth: '2016-03-01' },
    ]
    profileDoc = { ...PROFILE }
    insights = []
    nudges = []
    readinessEvents = []
  })

  it('emits a milestone feed event once ever per (member, age)', async () => {
    // Age 17 with a birthday ~3 months out → the "approaching 18" milestone.
    const dob = new Date()
    dob.setUTCFullYear(dob.getUTCFullYear() - 18)
    dob.setUTCMonth(dob.getUTCMonth() + 3)
    members[2]!['date_of_birth'] = dob.toISOString().slice(0, 10)
    const app = await buildApp()

    const first = await app.inject({ method: 'GET', url: `/family/members/${CHILD_ID}/agent` })
    expect(first.statusCode).toBe(200)
    await new Promise((r) => setTimeout(r, 20))
    const milestones = readinessEvents.filter((e) => e['type'] === 'milestone')
    expect(milestones).toHaveLength(1)
    expect(milestones[0]).toMatchObject({
      severity: 'notice',
      direction: 'up',
      member_id: CHILD_ID,
      dedupe_key: `milestone:${CHILD_ID}:age-18`,
    })

    await app.inject({ method: 'GET', url: `/family/members/${CHILD_ID}/agent` })
    await new Promise((r) => setTimeout(r, 20))
    expect(readinessEvents.filter((e) => e['type'] === 'milestone')).toHaveLength(1)
    await app.close()
  })

  it('persists nudges with stable ids — a second read dedupes instead of duplicating', async () => {
    const app = await buildApp()
    const first = await app.inject({ method: 'GET', url: `/family/members/${PARTNER_ID}/agent` })
    const firstBody = first.json()
    const count = firstBody.nudges.length
    expect(count).toBeGreaterThan(0)
    expect(firstBody.nudges.every((n: { id?: string }) => typeof n.id === 'string')).toBe(true)
    expect(nudges).toHaveLength(count)

    const second = await app.inject({ method: 'GET', url: `/family/members/${PARTNER_ID}/agent` })
    expect(second.json().nudges.map((n: { id: string }) => n.id)).toEqual(
      firstBody.nudges.map((n: { id: string }) => n.id),
    )
    expect(nudges).toHaveLength(count)
    await app.close()
  })

  it('dismissal persists — the nudge leaves the surface and stays gone while the evidence stands', async () => {
    const app = await buildApp()
    const first = (await app.inject({ method: 'GET', url: `/family/members/${PARTNER_ID}/agent` })).json()
    const target = first.nudges[0]
    const res = await app.inject({
      method: 'POST',
      url: `/family/members/${PARTNER_ID}/agent/nudges/${target.id}/dismiss`,
    })
    expect(res.statusCode).toBe(200)
    expect(nudges.find((n) => n.id === target.id)?.status).toBe('dismissed')

    const second = (await app.inject({ method: 'GET', url: `/family/members/${PARTNER_ID}/agent` })).json()
    expect(second.nudges.map((n: { id: string }) => n.id)).not.toContain(target.id)
    // Still exactly one row — no resurrection, no duplicate.
    expect(nudges.filter((n) => n.dedupe_key === nudges.find((x) => x.id === target.id)?.dedupe_key)).toHaveLength(1)
    await app.close()
  })

  it('a nudge whose evidence disappears resolves itself on the next read', async () => {
    insights = [
      { id: 'i1', detector_id: 'family_protection_gap', rule_id: 'no_income_protection', hypothesis: 'h', reasoning: 'r', confidence: 0.8, state: 'identified', feature_snapshot: { member_id: PARTNER_ID } },
    ]
    const app = await buildApp()
    const first = (await app.inject({ method: 'GET', url: `/family/members/${PARTNER_ID}/agent` })).json()
    const insightNudge = first.nudges.find((n: { kind: string }) => n.kind === 'insight')
    expect(insightNudge).toBeTruthy()

    // The insight resolves — the nudge must retire itself, not linger.
    insights = []
    const second = (await app.inject({ method: 'GET', url: `/family/members/${PARTNER_ID}/agent` })).json()
    expect(second.nudges.map((n: { id: string }) => n.id)).not.toContain(insightNudge.id)
    expect(nudges.find((n) => n.id === insightNudge.id)?.status).toBe('resolved')
    await app.close()
  })

  it('404s dismissing a nudge that belongs to a different member', async () => {
    const app = await buildApp()
    const partner = (await app.inject({ method: 'GET', url: `/family/members/${PARTNER_ID}/agent` })).json()
    const res = await app.inject({
      method: 'POST',
      url: `/family/members/${ORG_ID}/agent/nudges/${partner.nudges[0].id}/dismiss`,
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})
