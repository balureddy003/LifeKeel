/**
 * POST /assistant/ask — grounds the assistant in the tenant's real
 * financial profile and open insights, and never 500s even when the LLM
 * call fails. See docs/prd/101-live-ai-assistant.md.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerAssistantRoutes } from '../assistant.js'
import { initTestGateway } from '../../__tests__/test-gateway.js'

initTestGateway()

const llmMock = vi.fn(async (_system: string, prompt: string) => `LLM saw: ${prompt}`)

vi.mock('@lifekeel/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifekeel/platform')>()
  return { ...actual, createLlmRouterFromEnv: () => llmMock }
})

vi.mock('../../db.js', () => ({
  getInsightsCollection: vi.fn(async () => ({
    find: () => ({
      sort: () => ({
        limit: () => ({
          toArray: async () => insightsFixture,
        }),
      }),
    }),
  })),
  // life-event context grounding (G6) reads family.life_event signals —
  // empty by default; individual tests can swap the fixture.
  getSignalsCollection: vi.fn(async () => ({
    find: () => ({
      sort: () => ({
        limit: () => ({
          toArray: async () => lifeEventSignalsFixture,
        }),
      }),
    }),
  })),
}))

const TENANT_A = 'tenant-assistant-a'
const TENANT_B = 'tenant-assistant-b'

let profileFixture: Record<string, unknown> | null = null
let familyFixture: Record<string, unknown> | null = null
let insightsFixture: Array<Record<string, unknown>> = []
let unreviewedDocsFixture: Array<Record<string, unknown>> = []
let lifeEventSignalsFixture: Array<Record<string, unknown>> = []
let legacyDocsFixture: Array<Record<string, unknown>> = []
let legacyContactsFixture: Array<Record<string, unknown>> = []
let assetsFixture: Array<Record<string, unknown>> = []

// Mongo-filter matcher just capable enough for the member-twin's insight
// attribution filter (equality + $in + $or + dotted paths) — the member-
// scoped /assistant/ask path (PRD-122) queries db.collection('insights')
// directly rather than the mocked getInsightsCollection.
function getPath(doc: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], doc)
}
function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or')
      return (cond as Record<string, unknown>[]).some((sub) => matchesFilter(doc, sub))
    if (cond && typeof cond === 'object' && '$in' in (cond as Record<string, unknown>)) {
      return (cond as { $in: unknown[] }).$in.includes(getPath(doc, key))
    }
    return getPath(doc, key) === cond
  })
}

function makeDb() {
  return {
    // PRD-104: buildContext() now also reads the family roster
    // (family_groups) to resolve a member_id to a name — the mock needs
    // to serve a different fixture per collection name, unlike before
    // when this route only ever read one collection. Phase 2 (Digital
    // Twin gap audit) added a third: 'documents', for unreviewed AI
    // Memory items — same find().sort().limit().toArray() shape the
    // insights mock above already uses. PRD-122 added 'insights' here:
    // the member twin's attributed-insight query hits it raw with a
    // direct toArray() (no sort chain).
    collection: (name: string) => ({
      findOne: vi.fn(async () => (name === 'family_groups' ? familyFixture : profileFixture)),
      find: (filter: Record<string, unknown> = {}) => {
        const docs = () => {
          if (name === 'documents') return unreviewedDocsFixture
          if (name === 'insights') return insightsFixture.filter((d) => matchesFilter(d, filter))
          if (name === 'legacy_documents') return legacyDocsFixture
          if (name === 'legacy_contacts') return legacyContactsFixture
          if (name === 'family_assets') return assetsFixture
          return []
        }
        return {
          toArray: async () => docs(),
          sort: () => ({
            limit: () => ({ toArray: async () => docs() }),
          }),
        }
      },
    }),
  } as any
}

async function buildApp(tenantId: string) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: tenantId, user_id: 'user-1' }
  })
  registerAssistantRoutes(app, makeDb())
  return app
}

describe('POST /assistant/ask', () => {
  beforeEach(() => {
    llmMock.mockClear()
    llmMock.mockImplementation(async (_system: string, prompt: string) => `LLM saw: ${prompt}`)
    profileFixture = null
    familyFixture = null
    insightsFixture = []
    unreviewedDocsFixture = []
    lifeEventSignalsFixture = []
    legacyDocsFixture = []
    legacyContactsFixture = []
    assetsFixture = []
  })

  it("returns a live, grounded answer referencing the tenant's real numbers", async () => {
    profileFixture = {
      household: {
        employment_status: 'employed',
        monthly_salary_minor: 400000,
        annual_living_expenses_minor: 3600000,
        life_cover_minor: 0,
      },
    }
    insightsFixture = [
      {
        reasoning: 'No income protection policy is listed.',
        category: 'risk',
        detector_id: 'family_protection_gap',
      },
    ]

    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'Am I covered?' },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.isLive).toBe(true)
    expect(body.content).toContain('4000.00') // monthly_salary_minor 400000 -> £4000.00
    expect(body.content).toContain('No income protection policy is listed.')
  })

  it('PRD-104: resolves a household member_id to their real roster name and figures', async () => {
    profileFixture = {
      household: {
        employment_status: 'retired',
        monthly_salary_minor: 0,
        members: [
          {
            member_id: 'm2',
            employment_status: 'employed',
            monthly_salary_minor: 250000,
            income_protection_monthly_minor: 0,
          },
        ],
      },
    }
    familyFixture = { members: [{ id: 'm2', name: 'Alex', role: 'parent' }] }

    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'Does Alex have income protection?' },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.content).toContain('Alex')
    expect(body.content).toContain('2500.00') // monthly_salary_minor 250000 -> £2500.00
  })

  it("does not present the retirement wizard's placeholder age/target as real data before the user sets a target income", async () => {
    // Matches the shape the financial-profile wizard actually autosaves
    // before a user has ever reached the retirement step: current_age and
    // target_retirement_age hold their untouched form defaults (30/65),
    // and target_retirement_income_minor is still 0 — the same signal the
    // family_retirement_gap detector itself already uses (isUnsetTarget in
    // family-financial-profile.ts) to know this section was never engaged
    // with. Live-verification finding: without this gate, Keel told a user
    // with no date of birth on file "Current age: 30" as if it were a
    // confirmed fact.
    profileFixture = {
      household: {
        employment_status: 'employed',
        monthly_salary_minor: 400000,
        annual_living_expenses_minor: 250000,
      },
      retirement: {
        current_age: 30,
        target_retirement_age: 65,
        pension_balance_minor: 0,
        monthly_contribution_minor: 0,
        target_retirement_income_minor: 0,
      },
    }

    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'Can we retire at 65?' },
    })

    const body = response.json()
    expect(body.content).not.toContain('currently age 30')
    expect(body.content).toContain('no target retirement income has been set yet')
  })

  it('does present retirement figures once the user has set a real target retirement income', async () => {
    profileFixture = {
      household: { employment_status: 'employed', monthly_salary_minor: 400000 },
      retirement: {
        current_age: 42,
        target_retirement_age: 65,
        pension_balance_minor: 5000000,
        monthly_contribution_minor: 50000,
        target_retirement_income_minor: 3000000,
      },
    }

    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'Can we retire at 65?' },
    })

    const body = response.json()
    expect(body.content).toContain('currently age 42')
  })

  it('sends different context for two tenants with different profile data', async () => {
    profileFixture = { household: { monthly_salary_minor: 100000 } }
    const appA = await buildApp(TENANT_A)
    const resA = await appA.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'What is my salary?' },
    })

    profileFixture = { household: { monthly_salary_minor: 999900 } }
    const appB = await buildApp(TENANT_B)
    const resB = await appB.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'What is my salary?' },
    })

    expect(resA.json().content).not.toBe(resB.json().content)
    expect(resA.json().content).toContain('1000.00')
    expect(resB.json().content).toContain('9999.00')
  })

  it('degrades gracefully (200, isLive false) when the LLM call fails', async () => {
    llmMock.mockImplementation(async () => {
      throw new Error('ANTHROPIC_API_KEY not set')
    })
    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'Am I covered?' },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.isLive).toBe(false)
    expect(typeof body.content).toBe('string')
    expect(body.content.length).toBeGreaterThan(0)
  })

  it('rejects an empty query with 400', async () => {
    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: '' },
    })
    expect(response.statusCode).toBe(400)
  })

  it("flags a Pending member's figures as provisional instead of presenting them as confirmed", async () => {
    profileFixture = {
      household: {
        monthly_salary_minor: 0,
        members: [{ member_id: 'm2', employment_status: 'employed', monthly_salary_minor: 250000 }],
      },
    }
    familyFixture = { members: [{ id: 'm2', name: 'Sam', role: 'parent', status: 'pending' }] }

    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'Does Sam have income protection?' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().content).toContain('Sam (profile pending)')
  })

  it('does not flag an active (non-pending) member', async () => {
    profileFixture = {
      household: {
        monthly_salary_minor: 0,
        members: [{ member_id: 'm2', monthly_salary_minor: 250000 }],
      },
    }
    familyFixture = { members: [{ id: 'm2', name: 'Sam', role: 'parent', status: 'active' }] }

    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'x' },
    })
    expect(response.json().content).toContain('Household member Sam:')
    expect(response.json().content).not.toContain('pending')
  })

  it('surfaces an unreviewed uploaded document so Keel can mention it', async () => {
    unreviewedDocsFixture = [
      { filename: 'travel-policy.pdf', category: 'insurance', uploaded_at: new Date('2026-01-01') },
    ]
    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'anything unreviewed?' },
    })
    expect(response.json().content).toContain('travel-policy.pdf')
    expect(response.json().content).toContain('not yet reviewed')
  })

  // PRD-122: member_id scopes the grounding to that member's twin.
  it("member_id scopes the prompt to that member's twin — their figures and attributed insights, not the whole household", async () => {
    profileFixture = {
      household: {
        employment_status: 'employed',
        monthly_salary_minor: 400000,
        annual_living_expenses_minor: 3600000,
        mortgage_outstanding_minor: 0,
        life_cover_minor: 0,
        income_protection_monthly_minor: 0,
        members: [
          {
            member_id: 'm2',
            employment_status: 'employed',
            monthly_salary_minor: 250000,
            income_protection_monthly_minor: 0,
            monthly_pension_contribution_minor: 30000,
          },
        ],
      },
      emergency_fund: {
        emergency_savings_minor: 900000,
        monthly_expenses_minor: 300000,
        has_high_interest_debt: false,
      },
      // The scorer reads retirement/education_funds as schema-required —
      // a real stored doc always has them, so the fixture models that.
      retirement: {
        current_age: 40,
        target_retirement_age: 65,
        pension_balance_minor: 0,
        monthly_contribution_minor: 0,
        target_retirement_income_minor: 3000000,
        expected_annual_growth_pct: 5,
      },
      education_funds: [],
    }
    familyFixture = {
      members: [
        { id: 'user-1', name: 'Organizer', role: 'organizer', status: 'active' },
        { id: 'm2', name: 'Sam', role: 'parent', status: 'active' },
      ],
    }
    insightsFixture = [
      {
        tenant_id: TENANT_A,
        reasoning: 'Sam has no income protection policy.',
        category: 'risk',
        detector_id: 'family_protection_gap',
        state: 'identified',
        feature_snapshot: { member_id: 'm2' },
      },
      {
        tenant_id: TENANT_A,
        reasoning: 'Household emergency fund covers only 3 months.',
        category: 'savings',
        detector_id: 'family_emergency_fund_adequacy',
        state: 'identified',
      },
    ]

    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: "Is Sam's pension on track?", member_id: 'm2' },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.isLive).toBe(true)
    expect(body.content).toContain('specifically about Sam')
    expect(body.content).toContain('2500.00') // Sam's salary, not the household's 4000
    expect(body.content).toContain('300.00') // Sam's pension contribution
    // Member-attributed insight rides along; the household-only one doesn't.
    expect(body.content).toContain('Sam has no income protection')
    expect(body.content).not.toContain('emergency fund covers only 3 months')
  })

  it('member_id 404s for a roster member that does not exist', async () => {
    familyFixture = {
      members: [{ id: 'user-1', name: 'Organizer', role: 'organizer', status: 'active' }],
    }
    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'anything?', member_id: 'ghost' },
    })
    expect(response.statusCode).toBe(404)
  })

  it("member scope flags a pending member's figures as provisional", async () => {
    profileFixture = {
      household: {
        members: [{ member_id: 'm2', employment_status: 'employed', monthly_salary_minor: 250000 }],
        mortgage_outstanding_minor: 0,
        annual_living_expenses_minor: 0,
        life_cover_minor: 0,
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
    }
    familyFixture = {
      members: [
        { id: 'user-1', name: 'Organizer', role: 'organizer', status: 'active' },
        { id: 'm2', name: 'Sam', role: 'parent', status: 'pending' },
      ],
    }
    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: "Is Sam's income recorded?", member_id: 'm2' },
    })
    expect(response.json().content).toContain('profile pending')
  })
})

describe('POST /assistant/simulate', () => {
  beforeEach(() => {
    llmMock.mockClear()
    llmMock.mockImplementation(async (_system: string, prompt: string) => `LLM saw: ${prompt}`)
    profileFixture = null
    familyFixture = null
    insightsFixture = []
    unreviewedDocsFixture = []
    legacyDocsFixture = []
    legacyContactsFixture = []
    assetsFixture = []
  })

  it('computes a real scenario and asks the LLM to narrate the given numbers, not invent its own', async () => {
    profileFixture = {
      household: { monthly_salary_minor: 500000 },
      emergency_fund: { emergency_savings_minor: 900000, monthly_expenses_minor: 300000 },
      education_funds: [
        {
          child_name: 'Nihaan',
          current_savings_minor: 200000,
          target_savings_minor: 2000000,
          years_remaining: 10,
        },
      ],
    }

    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/simulate',
      payload: {
        monthlyIncomeDeltaMinor: 200000,
        monthlyExtraSavingsMinor: 50000,
        targetChildName: 'Nihaan',
      },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.isLive).toBe(true)
    expect(body.scenario.projectedMonthlyIncomeMinor).toBe(700000)
    expect(body.scenario.educationFundProjection.onTrack).toBe(true)
    // The prompt handed to the (mocked) LLM must contain the computed figures.
    expect(body.content).toContain('7000.00')
  })

  it('declines honestly instead of computing on an empty profile', async () => {
    const app = await buildApp(TENANT_A)
    const response = await app.inject({ method: 'POST', url: '/assistant/simulate', payload: {} })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.scenario).toBeNull()
    expect(body.content).toMatch(/isn't enough/)
  })

  it('falls back to the raw computed numbers (never a fabricated answer) when the LLM call fails', async () => {
    profileFixture = {
      household: { monthly_salary_minor: 500000 },
      emergency_fund: { emergency_savings_minor: 0, monthly_expenses_minor: 300000 },
    }
    llmMock.mockImplementation(async () => {
      throw new Error('rate limited')
    })

    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/simulate',
      payload: { monthlyIncomeDeltaMinor: -500000 },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.isLive).toBe(false)
    expect(body.scenario.projectedRunwayMonths).toBe(0)
    expect(body.content).toContain('0 months')
  })
})

describe('POST /assistant/simulate — steps[] and member_id (G14/PRD-132)', () => {
  beforeEach(() => {
    llmMock.mockClear()
    llmMock.mockImplementation(async (_s: string, prompt: string) => `LLM saw: ${prompt}`)
    profileFixture = {
      household: { monthly_salary_minor: 500000 },
      emergency_fund: { emergency_savings_minor: 1200000, monthly_expenses_minor: 300000 },
    }
    familyFixture = {
      tenant_id: TENANT_A,
      members: [
        { id: 'm1', user_id: 'user-1', name: 'Alex', role: 'organizer', status: 'active' },
        { id: 'm2', user_id: 'user-2', name: 'Sam', role: 'adult', status: 'active' },
      ],
    }
    insightsFixture = []
    unreviewedDocsFixture = []
    lifeEventSignalsFixture = []
    legacyDocsFixture = []
  })

  it('accepts a two-step body and narrates every regime in the grounding', async () => {
    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/simulate',
      payload: {
        steps: [
          { atMonth: 0, monthlyIncomeDeltaMinor: -240000 },
          { atMonth: 4, monthlyIncomeDeltaMinor: 192000 },
        ],
        question: 'What if I take a sabbatical?',
      },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.isLive).toBe(true)
    expect(body.scenario.timeline).toHaveLength(2)
    // The LLM prompt (echoed back by the mock) names both regimes.
    expect(body.content).toContain('months 1–3')
    expect(body.content).toContain('from month 4')
    expect(body.content).toContain('income −£2400.00/mo')
  })

  it('the raw-numbers fallback describes each step when the LLM fails', async () => {
    llmMock.mockImplementation(async () => {
      throw new Error('down')
    })
    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/simulate',
      payload: {
        steps: [
          { atMonth: 0, monthlyIncomeDeltaMinor: -240000 },
          { atMonth: 4, monthlyIncomeDeltaMinor: 192000 },
        ],
      },
    })
    const body = response.json()
    expect(body.isLive).toBe(false)
    expect(body.content).toContain('months 1–3')
    expect(body.content).toContain('from month 4')
  })

  it('400s on a malformed step', async () => {
    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/simulate',
      payload: { steps: [{ atMonth: 'soon' }] },
    })
    expect(response.statusCode).toBe(400)
  })

  it('scopes the projection to a member via member_id and 400s on a stranger', async () => {
    const app = await buildApp(TENANT_A)
    const ok = await app.inject({
      method: 'POST',
      url: '/assistant/simulate',
      payload: { member_id: 'm1', monthlyIncomeDeltaMinor: -100000 },
    })
    expect(ok.statusCode).toBe(200)
    const bad = await app.inject({
      method: 'POST',
      url: '/assistant/simulate',
      payload: { member_id: 'ghost', monthlyIncomeDeltaMinor: -100000 },
    })
    expect(bad.statusCode).toBe(400)
  })
})

describe('legacy register grounding (PRD-137 §5)', () => {
  beforeEach(() => {
    llmMock.mockClear()
    llmMock.mockImplementation(async (_s: string, prompt: string) => `LLM saw: ${prompt}`)
    profileFixture = { household: { monthly_salary_minor: 500000 } }
    familyFixture = {
      tenant_id: TENANT_A,
      members: [
        { id: 'm1', user_id: 'user-1', name: 'Alex', role: 'organizer', status: 'active' },
        { id: 'm2', user_id: 'user-2', name: 'Sam', role: 'adult', status: 'active' },
      ],
    }
    insightsFixture = []
    unreviewedDocsFixture = []
    lifeEventSignalsFixture = []
    legacyContactsFixture = []
    assetsFixture = []
    legacyDocsFixture = [
      {
        id: 'd1',
        tenant_id: TENANT_A,
        type: 'will',
        subject_member_id: 'm1',
        jurisdiction: 'England & Wales',
        signed_on: '2019-03-01',
        last_reviewed_on: '2019-03-01',
        roles: [{ role: 'executor', member_id: 'm2', verification: 'user_declared' }],
        covers_asset_ids: [],
        verification: 'user_declared',
        visibility: 'adults',
      },
    ]
  })

  it('adds the legacy map block to the context when records exist', async () => {
    const app = await buildApp(TENANT_A)
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'who is the executor?' },
    })
    expect(res.json().content).toContain('Family legacy map')
    expect(res.json().content).toContain('executor: Sam [user-declared]')
  })

  it('omits the block when the register is empty', async () => {
    legacyDocsFixture = []
    const app = await buildApp(TENANT_A)
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'anything recorded?' },
    })
    expect(res.json().content).not.toContain('Family legacy map')
  })
})
