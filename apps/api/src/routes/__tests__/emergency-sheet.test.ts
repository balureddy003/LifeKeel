/** PRD-220: the emergency sheet is opt-in-per-section, tenant-scoped,
 *  unpersisted, and audited without content. */
import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

const auditCalls: Record<string, unknown>[] = []
vi.mock('../../audit/audit-log.js', () => ({
  getAuditLogger: () => ({ log: (e: Record<string, unknown>) => auditCalls.push(e) }),
}))

import { registerEmergencySheetRoutes } from '../emergency-sheet.js'

const TENANT = 'tenant-1'

function makeDb() {
  const cols: Record<string, Record<string, unknown>[]> = {
    legacy_contacts: [
      { tenant_id: TENANT, name: 'Sam', phone: '07000', email: 'sam@x.test', role: 'partner' },
      { tenant_id: 'other', name: 'NOT-MINE', phone: '9' },
    ],
    documents: [{ tenant_id: TENANT, title: 'Will' }],
    family_assets: [{ tenant_id: TENANT, name: 'Barclays', balance: 100 }],
    family_financial_profile: [
      {
        tenant_id: TENANT,
        policies: [{ provider: 'Acme', type: 'life', renewal_date: '2027-01' }],
      },
    ],
  }
  const col = (name: string) => ({
    find: (f: Record<string, unknown>) => {
      const rows = (cols[name] ?? []).filter((d) => Object.entries(f).every(([k, v]) => d[k] === v))
      return {
        project: () => ({
          toArray: async () => rows,
          limit: () => ({ toArray: async () => rows }),
        }),
        limit: () => ({ toArray: async () => rows }),
        toArray: async () => rows,
      }
    },
    findOne: async (f: Record<string, unknown>) =>
      (cols[name] ?? []).find((d) => Object.entries(f).every(([k, v]) => d[k] === v)) ?? null,
  })
  return { collection: col } as any
}

async function buildApp(tenant = TENANT) {
  const app = Fastify()
  app.addHook('onRequest', async (req) => {
    ;(req as never as Record<string, unknown>)['authContext'] = {
      tenant_id: tenant,
      user_id: 'u1',
    }
  })
  await registerEmergencySheetRoutes(app, makeDb())
  await app.ready()
  return app
}

describe('POST /family/emergency-sheet/preview', () => {
  it('returns nothing by default — every section is opt-in', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/family/emergency-sheet/preview',
      payload: { sections: [] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().sections).toEqual([])
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('returns only requested sections, scoped to the caller tenant', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/family/emergency-sheet/preview',
      payload: { sections: ['who_to_call', 'policies'] },
    })
    const body = res.json()
    expect(body.sections.map((s: { id: string }) => s.id).sort()).toEqual([
      'policies',
      'who_to_call',
    ])
    const names = body.sections
      .find((s: { id: string }) => s.id === 'who_to_call')!
      .items.map((i: { label: string }) => i.label)
    expect(names).toEqual(['Sam'])
    expect(JSON.stringify(body)).not.toContain('NOT-MINE')
  })

  it('balances only appear when explicitly enabled', async () => {
    const app = await buildApp()
    const noBal = await app.inject({
      method: 'POST',
      url: '/family/emergency-sheet/preview',
      payload: { sections: ['accounts'] },
    })
    expect(JSON.stringify(noBal.json())).not.toContain('100')
    const withBal = await app.inject({
      method: 'POST',
      url: '/family/emergency-sheet/preview',
      payload: { sections: ['accounts', 'balances'] },
    })
    expect(JSON.stringify(withBal.json())).toContain('100')
  })

  it('audits only the section ids — never the content', async () => {
    auditCalls.length = 0
    const app = await buildApp()
    await app.inject({
      method: 'POST',
      url: '/family/emergency-sheet/preview',
      payload: { sections: ['who_to_call'] },
    })
    expect(auditCalls).toHaveLength(1)
    expect(auditCalls[0]!['action']).toBe('family.emergency_sheet_generated')
    expect(JSON.stringify(auditCalls[0])).not.toContain('Sam')
  })
})
