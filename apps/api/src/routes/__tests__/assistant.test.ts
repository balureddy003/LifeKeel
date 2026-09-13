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
let insightsFixture: Array<{ reasoning: string; category: string; detector_id: string }> = []

function makeDb() {
  const col = { findOne: vi.fn(async () => profileFixture) }
  return { collection: () => col } as any
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
    insightsFixture = []
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
})
