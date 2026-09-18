/**
 * GET /insights/:id/action-preview — the read behind the approval-gate
 * screen (remediation item 25). Returns the insight plus a per-action
 * preview of what POST /insights/:id/approve would actually run, using the
 * same classifier the executor dispatches on — so the gate can't describe
 * different side effects than the ones that execute.
 */

import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { registerInsightRoutes } from '../insights.js'

const TENANT = 'tenant-preview-test'
const INSIGHT_ID = 'insight-1'

vi.mock('../../db.js', () => ({
  getInsightsCollection: vi.fn(),
  getReceiptsCollection: vi.fn(),
}))

function makeTenantSettingsCol(dryRunMode: boolean | null) {
  const doc = dryRunMode === null ? null : { tenant_id: TENANT, automation: { dry_run_mode: dryRunMode } }
  return { findOne: vi.fn(async () => doc) }
}

async function buildApp(
  insight: Record<string, unknown> | null,
  opts: { dryRunMode?: boolean | null } = {},
) {
  const { getInsightsCollection, getReceiptsCollection } = await import('../../db.js')
  vi.mocked(getInsightsCollection).mockResolvedValue({ findOne: vi.fn(async () => insight) } as any)
  vi.mocked(getReceiptsCollection).mockResolvedValue({ insertOne: vi.fn(async () => ({})) } as any)

  const tenantSettingsCol = makeTenantSettingsCol(opts.dryRunMode ?? null)
  const db = {
    collection: (name: string) => {
      if (name === 'tenant_settings') return tenantSettingsCol
      return {
        findOne: vi.fn(async () => null),
        updateOne: vi.fn(async () => ({})),
        insertOne: vi.fn(async () => ({})),
        countDocuments: vi.fn(async () => 0),
        // The real ActionExecutor (constructed by registerInsightRoutes when
        // db is present) creates indexes on action_receipts in its ctor.
        createIndex: vi.fn(async () => ({})),
      }
    },
  } as any

  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: 'user-1' }
  })
  await registerInsightRoutes(app, {} as any, undefined, db)
  return app
}

const INSIGHT = {
  id: INSIGHT_ID,
  tenant_id: TENANT,
  detector_id: 'family_protection_gap',
  hypothesis: 'h',
  reasoning: 'r',
  actions: [
    'Send an email reminder',
    'Review your current life insurance policy terms',
  ],
  state: 'identified',
}

describe('GET /insights/:id/action-preview', () => {
  it('classifies each action with its real external effect', async () => {
    const app = await buildApp({ ...INSIGHT })
    const res = await app.inject({ method: 'GET', url: `/insights/${INSIGHT_ID}/action-preview` })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.insight.id).toBe(INSIGHT_ID)
    expect(body.actions).toHaveLength(2)
    expect(body.actions[0]).toMatchObject({ type: 'send_email', external: true })
    expect(body.actions[0].summary).toMatch(/email/i)
    expect(body.actions[1]).toMatchObject({ type: 'log_only', external: false })
  })

  it('reflects tenant dry_run_mode so the gate can say nothing will actually send', async () => {
    const app = await buildApp({ ...INSIGHT }, { dryRunMode: true })
    const res = await app.inject({ method: 'GET', url: `/insights/${INSIGHT_ID}/action-preview` })

    expect(res.statusCode).toBe(200)
    expect(res.json().dry_run).toBe(true)
  })

  it('defaults dry_run false when the tenant has no automation settings', async () => {
    const app = await buildApp({ ...INSIGHT }, { dryRunMode: null })
    const res = await app.inject({ method: 'GET', url: `/insights/${INSIGHT_ID}/action-preview` })
    expect(res.statusCode).toBe(200)
    expect(res.json().dry_run).toBe(false)
  })

  it('404s for an insight from another tenant (tenant_id is in the lookup)', async () => {
    const app = await buildApp(null)
    const res = await app.inject({ method: 'GET', url: `/insights/${INSIGHT_ID}/action-preview` })
    expect(res.statusCode).toBe(404)
  })
})
