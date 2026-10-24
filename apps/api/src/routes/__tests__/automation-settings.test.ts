/**
 * GET/PATCH /settings/automation — the live surface for the Act-layer trust
 * fields (tenant_settings.automation.dry_run_mode / trust_level_by_workflow)
 * that POST /insights/:id/approve already honors but no shipped client could
 * reach (remediation item 25).
 */

import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { registerAutomationSettingsRoutes } from '../automation-settings.js'

const TENANT = 'tenant-automation-test'

function makeDb(initial?: Record<string, unknown>) {
  let doc: Record<string, unknown> | null = initial ? { ...initial } : null
  const tenantSettingsCol = {
    findOne: vi.fn(async (filter: Record<string, unknown>) =>
      doc && doc['tenant_id'] === filter['tenant_id'] ? doc : null,
    ),
    updateOne: vi.fn(
      async (
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
        opts?: Record<string, unknown>,
      ) => {
        if (!doc && opts?.['upsert']) doc = { tenant_id: filter['tenant_id'] }
        if (!doc || doc['tenant_id'] !== filter['tenant_id']) return { matchedCount: 0 }
        const set = (update['$set'] as Record<string, unknown>) ?? {}
        for (const [key, value] of Object.entries(set)) {
          const parts = key.split('.')
          let target = doc as Record<string, unknown>
          for (const part of parts.slice(0, -1)) {
            target = (target[part] ??= {}) as Record<string, unknown>
          }
          target[parts[parts.length - 1]!] = value
        }
        return { matchedCount: 1 }
      },
    ),
  }
  // scope_contracts (PRD-214) is written through when renewal_reminders_enabled
  // flips — a tolerant stub keeps the settings assertions focused.
  const stubCol = {
    findOne: vi.fn(async () => null),
    updateOne: vi.fn(async () => ({ matchedCount: 0, upsertedCount: 1 })),
  }
  return {
    collection: (name: string) => (name === 'tenant_settings' ? tenantSettingsCol : stubCol),
  } as any
}

async function buildApp(db: unknown) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: 'user-1' }
  })
  registerAutomationSettingsRoutes(app, db as never)
  return app
}

describe('/settings/automation', () => {
  it('GET returns safe defaults when the tenant has no automation doc', async () => {
    const app = await buildApp(makeDb())
    const res = await app.inject({ method: 'GET', url: '/settings/automation' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      dry_run_mode: false,
      trust_level_by_workflow: {},
      renewal_reminders_enabled: false,
      renewal_reminder_lead_days: [30, 7],
      auto_execute_enabled: false,
      daily_marketing_drafts_enabled: false,
    })
  })

  it('PATCH dry_run_mode persists and GET reads it back', async () => {
    const app = await buildApp(makeDb({ tenant_id: TENANT }))

    const patch = await app.inject({
      method: 'PATCH',
      url: '/settings/automation',
      payload: { dry_run_mode: true },
    })
    expect(patch.statusCode).toBe(200)
    expect(patch.json().dry_run_mode).toBe(true)

    const get = await app.inject({ method: 'GET', url: '/settings/automation' })
    expect(get.json().dry_run_mode).toBe(true)
  })

  it('PATCH rejects a non-boolean dry_run_mode', async () => {
    const app = await buildApp(makeDb())
    const res = await app.inject({
      method: 'PATCH',
      url: '/settings/automation',
      payload: { dry_run_mode: 'yes' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('GET returns stored trust levels read-only alongside dry_run_mode', async () => {
    const app = await buildApp(
      makeDb({
        tenant_id: TENANT,
        automation: { dry_run_mode: false, trust_level_by_workflow: { wf_1: 3 } },
      }),
    )
    const res = await app.inject({ method: 'GET', url: '/settings/automation' })
    expect(res.json()).toEqual({
      dry_run_mode: false,
      trust_level_by_workflow: { wf_1: 3 },
      renewal_reminders_enabled: false,
      renewal_reminder_lead_days: [30, 7],
      auto_execute_enabled: false,
      daily_marketing_drafts_enabled: false,
    })
  })

  it('PATCH auto_execute_enabled persists and GET reads it back', async () => {
    const app = await buildApp(makeDb({ tenant_id: TENANT }))
    const res = await app.inject({
      method: 'PATCH',
      url: '/settings/automation',
      payload: { auto_execute_enabled: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().auto_execute_enabled).toBe(true)
    const bad = await app.inject({
      method: 'PATCH',
      url: '/settings/automation',
      payload: { auto_execute_enabled: 'on' },
    })
    expect(bad.statusCode).toBe(400)
  })

  it('PATCH renewal_reminders_enabled persists and GET reads it back', async () => {
    const app = await buildApp(makeDb({ tenant_id: TENANT }))
    const res = await app.inject({
      method: 'PATCH',
      url: '/settings/automation',
      payload: { renewal_reminders_enabled: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().renewal_reminders_enabled).toBe(true)
  })

  it('PATCH accepts custom lead days and rejects invalid ones', async () => {
    const app = await buildApp(makeDb({ tenant_id: TENANT }))
    const ok = await app.inject({
      method: 'PATCH',
      url: '/settings/automation',
      payload: { renewal_reminder_lead_days: [14] },
    })
    expect(ok.json().renewal_reminder_lead_days).toEqual([14])
    const bad = await app.inject({
      method: 'PATCH',
      url: '/settings/automation',
      payload: { renewal_reminder_lead_days: [0] },
    })
    expect(bad.statusCode).toBe(400)
  })

  it('PATCH with no recognized fields returns 400', async () => {
    const app = await buildApp(makeDb({ tenant_id: TENANT }))
    const res = await app.inject({ method: 'PATCH', url: '/settings/automation', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH only writes dry_run_mode — trust levels survive unchanged', async () => {
    const app = await buildApp(
      makeDb({
        tenant_id: TENANT,
        automation: { dry_run_mode: false, trust_level_by_workflow: { wf_1: 3 } },
      }),
    )
    const res = await app.inject({
      method: 'PATCH',
      url: '/settings/automation',
      payload: { dry_run_mode: true },
    })
    expect(res.json().trust_level_by_workflow).toEqual({ wf_1: 3 })
  })
})
