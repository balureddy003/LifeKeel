/**
 * POST /assistant/ask — grounds the assistant in the tenant's real
 * financial profile and open insights, and never 500s even when the LLM
 * call fails. See docs/prd/101-live-ai-assistant.md.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerAssistantRoutes } from '../assistant.js'

const llmMock = vi.fn(async (_system: string, prompt: string) => `LLM saw: ${prompt}`)

vi.mock('@agentoak/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentoak/platform')>()
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
}))

const TENANT_A = 'tenant-assistant-a'
const TENANT_B = 'tenant-assistant-b'

let profileFixture: Record<string, unknown> | null = null
let familyFixture: Record<string, unknown> | null = null
let insightsFixture: Array<{ reasoning: string; category: string; detector_id: string }> = []
let unreviewedDocsFixture: Array<Record<string, unknown>> = []

function makeDb() {
  return {
    // PRD-104: buildContext() now also reads the family roster
    // (family_groups) to resolve a member_id to a name — the mock needs
    // to serve a different fixture per collection name, unlike before
    // when this route only ever read one collection. Phase 2 (Digital
    // Twin gap audit) added a third: 'documents', for unreviewed AI
    // Memory items — same find().sort().limit().toArray() shape the
    // insights mock above already uses.
    collection: (name: string) => ({
      findOne: vi.fn(async () => (name === 'family_groups' ? familyFixture : profileFixture)),
      find: () => ({
        sort: () => ({
          limit: () => ({
            toArray: async () => (name === 'documents' ? unreviewedDocsFixture : []),
          }),
        }),
      }),
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
  })

  it('returns a live, grounded answer referencing the tenant\'s real numbers', async () => {
    profileFixture = {
      household: { employment_status: 'employed', monthly_salary_minor: 400000, annual_living_expenses_minor: 3600000, life_cover_minor: 0 },
    }
    insightsFixture = [{ reasoning: 'No income protection policy is listed.', category: 'risk', detector_id: 'family_protection_gap' }]

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
        members: [{ member_id: 'm2', employment_status: 'employed', monthly_salary_minor: 250000, income_protection_monthly_minor: 0 }],
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

  it('sends different context for two tenants with different profile data', async () => {
    profileFixture = { household: { monthly_salary_minor: 100000 } }
    const appA = await buildApp(TENANT_A)
    const resA = await appA.inject({ method: 'POST', url: '/assistant/ask', payload: { query: 'What is my salary?' } })

    profileFixture = { household: { monthly_salary_minor: 999900 } }
    const appB = await buildApp(TENANT_B)
    const resB = await appB.inject({ method: 'POST', url: '/assistant/ask', payload: { query: 'What is my salary?' } })

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

  it('flags a Pending member\'s figures as provisional instead of presenting them as confirmed', async () => {
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
      household: { monthly_salary_minor: 0, members: [{ member_id: 'm2', monthly_salary_minor: 250000 }] },
    }
    familyFixture = { members: [{ id: 'm2', name: 'Sam', role: 'parent', status: 'active' }] }

    const app = await buildApp(TENANT_A)
    const response = await app.inject({ method: 'POST', url: '/assistant/ask', payload: { query: 'x' } })
    expect(response.json().content).toContain('Household member Sam:')
    expect(response.json().content).not.toContain('pending')
  })

  it('surfaces an unreviewed uploaded document so Oak can mention it', async () => {
    unreviewedDocsFixture = [{ filename: 'travel-policy.pdf', category: 'insurance', uploaded_at: new Date('2026-01-01') }]
    const app = await buildApp(TENANT_A)
    const response = await app.inject({ method: 'POST', url: '/assistant/ask', payload: { query: 'anything unreviewed?' } })
    expect(response.json().content).toContain('travel-policy.pdf')
    expect(response.json().content).toContain('not yet reviewed')
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
  })

  it('computes a real scenario and asks the LLM to narrate the given numbers, not invent its own', async () => {
    profileFixture = {
      household: { monthly_salary_minor: 500000 },
      emergency_fund: { emergency_savings_minor: 900000, monthly_expenses_minor: 300000 },
      education_funds: [{ child_name: 'Nihaan', current_savings_minor: 200000, target_savings_minor: 2000000, years_remaining: 10 }],
    }

    const app = await buildApp(TENANT_A)
    const response = await app.inject({
      method: 'POST',
      url: '/assistant/simulate',
      payload: { monthlyIncomeDeltaMinor: 200000, monthlyExtraSavingsMinor: 50000, targetChildName: 'Nihaan' },
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
    profileFixture = { household: { monthly_salary_minor: 500000 }, emergency_fund: { emergency_savings_minor: 0, monthly_expenses_minor: 300000 } }
    llmMock.mockImplementation(async () => { throw new Error('rate limited') })

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
