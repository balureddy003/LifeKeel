/**
 * POST /insights/:id/prepare — Tier 1 "prepare, don't send" (PRD-103).
 * Generates a draft grounded in the insight's real reasoning, degrades
 * gracefully (200, draft: null) on LLM failure, and — the actual point of
 * this PRD — never touches any outbound-send integration.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import Fastify from 'fastify'
import { registerInsightRoutes } from '../insights.js'

const llmMock = vi.fn(async (_system: string, prompt: string) => `Draft based on: ${prompt}`)

vi.mock('@agentoak/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentoak/platform')>()
  return { ...actual, createLlmRouterFromEnv: () => llmMock }
})

const TENANT = 'tenant-prepare-test'
const INSIGHT_ID = 'insight-1'

function makeInsightsCol(insight: Record<string, unknown> | null) {
  return {
    findOne: vi.fn(async (filter: Record<string, unknown>) =>
      insight && filter['id'] === insight['id'] && filter['tenant_id'] === insight['tenant_id'] ? insight : null,
    ),
    updateOne: vi.fn(async () => ({ acknowledged: true })),
  }
}

vi.mock('../../db.js', () => ({
  getInsightsCollection: vi.fn(),
  getReceiptsCollection: vi.fn(async () => ({ find: () => ({ toArray: async () => [] }) })),
}))

async function buildApp(insight: Record<string, unknown> | null) {
  const { getInsightsCollection } = await import('../../db.js')
  const col = makeInsightsCol(insight)
  vi.mocked(getInsightsCollection).mockResolvedValue(col as any)

  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: 'user-1' }
  })
  await registerInsightRoutes(app, {} as any)
  return { app, col }
}

const BASE_INSIGHT = {
  id: INSIGHT_ID,
  tenant_id: TENANT,
  reasoning: 'No income protection policy is listed in your family profile.',
  category: 'risk',
  detector_id: 'family_protection_gap',
  state: 'identified',
}

describe('POST /insights/:id/prepare', () => {
  beforeEach(() => {
    llmMock.mockClear()
    llmMock.mockImplementation(async (_system: string, prompt: string) => `Draft based on: ${prompt}`)
  })

  it('generates a draft grounded in the insight and persists it', async () => {
    const { app, col } = await buildApp(BASE_INSIGHT)
    const res = await app.inject({ method: 'POST', url: `/insights/${INSIGHT_ID}/prepare` })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.draft.content).toContain('No income protection policy is listed')
    expect(col.updateOne).toHaveBeenCalledWith(
      { id: INSIGHT_ID, tenant_id: TENANT },
      { $set: { draft: expect.objectContaining({ content: expect.any(String) }) } },
    )
  })

  it('returns 404 for a non-existent insight', async () => {
    const { app } = await buildApp(null)
    const res = await app.inject({ method: 'POST', url: `/insights/${INSIGHT_ID}/prepare` })
    expect(res.statusCode).toBe(404)
  })

  it('marks which source figures the draft carried over as provenance facts', async () => {
    const insight = {
      ...BASE_INSIGHT,
      reasoning: 'Your life cover is £250,000 but the estimated gap is about £55,000 a year.',
    }
    llmMock.mockImplementation(async () => 'I am writing to ask about our life cover of £250,000.')
    const { app } = await buildApp(insight)
    const res = await app.inject({ method: 'POST', url: `/insights/${INSIGHT_ID}/prepare` })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.draft.provenance.facts).toEqual(['£250,000'])
  })

  it('degrades gracefully (200, draft: null) when the LLM call fails', async () => {
    llmMock.mockImplementation(async () => { throw new Error('ANTHROPIC_API_KEY not set') })
    const { app } = await buildApp(BASE_INSIGHT)
    const res = await app.inject({ method: 'POST', url: `/insights/${INSIGHT_ID}/prepare` })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.draft).toBeNull()
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })

  it('guardrail: generate-draft.ts and the prepare route never import SendGrid or read its API key', () => {
    // Checks actual code constructs (import/require, process.env reads),
    // not prose — this file's own doc comments legitimately name
    // "@sendgrid/mail" and "SENDGRID_API_KEY" to explain why they must
    // never appear as real code below.
    const draftSource = readFileSync(new URL('../../insights/generate-draft.ts', import.meta.url), 'utf-8')
    const insightsSource = readFileSync(new URL('../insights.ts', import.meta.url), 'utf-8')

    for (const source of [draftSource, insightsSource]) {
      expect(source).not.toMatch(/from\s+['"]@sendgrid\/mail['"]/)
      expect(source).not.toMatch(/require\(\s*['"]@sendgrid\/mail['"]\s*\)/)
      expect(source).not.toMatch(/import\(\s*['"]@sendgrid\/mail['"]\s*\)/)
      expect(source).not.toMatch(/process\.env(\.SENDGRID_API_KEY|\[['"]SENDGRID_API_KEY['"]\])/)
    }
  })
})
