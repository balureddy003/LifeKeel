/**
 * PRD-212: /assistant/ask's deterministic tier — a factual ask resolved to
 * an approved read operation is answered by computation, never a model call.
 * Falls through to the governed LLM path for anything unresolvable.
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
    find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
  })),
  getSignalsCollection: vi.fn(async () => ({
    find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
  })),
}))

let profileFixture: Record<string, unknown> | null = null
let familyFixture: Record<string, unknown> | null = null

function makeDb() {
  return {
    collection: (name: string) => ({
      findOne: vi.fn(async () => (name === 'family_groups' ? familyFixture : profileFixture)),
      find: () => ({
        toArray: async () => [],
        sort: () => ({ limit: () => ({ toArray: async () => [] }) }),
      }),
    }),
  } as never
}

async function buildApp() {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as never as { authContext: unknown }).authContext = {
      tenant_id: 'tenant-verified',
      user_id: 'user-1',
    }
  })
  registerAssistantRoutes(app, makeDb())
  return app
}

const PROFILE = {
  updated_at: new Date('2026-10-12T00:00:00Z'),
  household: {
    employment_status: 'employed',
    monthly_salary_minor: 400000,
    annual_living_expenses_minor: 3600000,
    mortgage_outstanding_minor: 0,
    life_cover_minor: 0,
    members: [{ member_id: 'm2', monthly_salary_minor: 250000 }],
  },
  retirement: {
    current_age: 41,
    target_retirement_age: 67,
    target_retirement_income_minor: 3000000,
    pension_balance_minor: 0,
    monthly_pension_contribution_minor: 0,
    expected_annual_growth_pct: 4,
  },
  education_funds: [],
  emergency_fund: { emergency_savings_minor: 900000, monthly_expenses_minor: 300000 },
  policies: [
    {
      type: 'car',
      provider: 'Acme',
      coverage_amount_minor: 1500000,
      monthly_premium_minor: 4500,
      renewal_date: '2027-03-01',
      member_id: 'm2',
    },
    { type: 'home', provider: 'HomeCo', monthly_premium_minor: 2200, renewal_date: '2026-11-15' },
  ],
}

describe('POST /assistant/ask — verified tier (PRD-212)', () => {
  beforeEach(() => {
    llmMock.mockClear()
    profileFixture = PROFILE
    familyFixture = null
  })

  it('answers a factual emergency-fund question deterministically — no model call, figures with provenance', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'how much is in our emergency fund?' },
    })
    const body = res.json()
    expect(body.verified).toBe(true)
    expect(body.operation).toBe('emergency_fund')
    expect(body.isLive).toBe(true)
    expect(body.content).toContain('9000.00')
    expect(body.content).toContain('months of cover')
    expect(body.content).toContain('2026-10-12')
    expect(body.provenance.source).toContain('emergency fund')
    expect(llmMock).not.toHaveBeenCalled()
  })

  it('answers renewal questions from the profile, soonest first', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'when does our car insurance renew?' },
    })
    const body = res.json()
    expect(body.verified).toBe(true)
    expect(body.operation).toBe('policy_renewals')
    expect(body.content.indexOf('2026-11-15')).toBeLessThan(body.content.indexOf('2027-03-01'))
    expect(llmMock).not.toHaveBeenCalled()
  })

  it('answers an income-stops question with the scenario calculator, not narration', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'what if we lost our income?' },
    })
    const body = res.json()
    expect(body.verified).toBe(true)
    expect(body.operation).toBe('income_stops')
    expect(body.content).toContain('scenario calculator')
    expect(body.content).toContain('runway')
    expect(llmMock).not.toHaveBeenCalled()
  })

  it('asks a clarification rather than guessing between two matched operations', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'how much is in our emergency fund and when does insurance renew?' },
    })
    const body = res.json()
    expect(body.verified).toBe(true)
    expect(body.clarify).toEqual(expect.arrayContaining(['Emergency fund', 'Policy renewal dates']))
    expect(llmMock).not.toHaveBeenCalled()
  })

  it('unresolvable questions still reach the governed LLM path', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'what should I do about my pension?' },
    })
    const body = res.json()
    expect(body.isLive).toBe(true)
    expect(body.verified).toBeUndefined()
    expect(body.content).toContain('LLM saw:')
    expect(llmMock).toHaveBeenCalled()
  })

  it('a medical-hinted ask never reaches the verified tier — the sensitive boundary is unchanged', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'how much is in our emergency fund?', medical_hint: true },
    })
    const body = res.json()
    expect(body.verified).toBeUndefined()
    // Sensitive task fails closed without LOCAL_TEXT_ENABLED → the honest
    // quarantined answer, not a silent hop to hosted or a verified reply.
    expect(body.quarantined).toBe(true)
  })

  it('member-scoped verified answers filter to that member', async () => {
    familyFixture = {
      members: [
        { id: 'm1', name: 'Priya', role: 'organizer', status: 'active' },
        { id: 'm2', name: 'Alex', role: 'parent', status: 'active' },
      ],
    }
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/assistant/ask',
      payload: { query: 'when does our car insurance renew?', member_id: 'm2' },
    })
    const body = res.json()
    expect(body.verified).toBe(true)
    expect(body.content).toContain('for Alex')
    expect(body.content).toContain('2027-03-01')
    // The household 'home' policy carries no member_id — not Alex's.
    expect(body.content).not.toContain('2026-11-15')
    expect(llmMock).not.toHaveBeenCalled()
  })
})
