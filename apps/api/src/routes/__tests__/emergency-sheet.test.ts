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
      {
        tenant_id: TENANT,
        name: 'Sam',
        phone: '07000',
        email: 'sam@x.test',
        relationship: 'partner',
      },
      { tenant_id: 'other', name: 'NOT-MINE', phone: '9' },
    ],
    documents: [{ tenant_id: TENANT, title: 'Will' }],
    // Real asset shape (family-assets.ts): value_minor, kind from ASSET_KINDS.
    family_assets: [
      { tenant_id: TENANT, name: 'Barclays saver', kind: 'savings_account', value_minor: 1_234_56 },
      { tenant_id: TENANT, name: 'Family home', kind: 'property', value_minor: 40_000_000 },
    ],
    family_groups: [
      {
        tenant_id: TENANT,
        members: [
          { id: 'u1', name: 'Alex', role: 'organizer', status: 'active' },
          { id: 'viewer', name: 'Vic', role: 'adult', status: 'active' },
          { id: 'kid', name: 'Kit', role: 'child', status: 'active', date_of_birth: '2016-04-01' },
          {
            id: 'teen',
            name: 'Tess',
            role: 'adult',
            status: 'active',
            date_of_birth: '2012-01-01',
          },
        ],
      },
    ],
    family_financial_profile: [
      {
        tenant_id: TENANT,
        policies: [{ provider: 'Acme', type: 'life', renewal_date: '2027-01' }],
      },
    ],
  }
  const matches = (d: Record<string, unknown>, f: Record<string, unknown>) =>
    Object.entries(f).every(([k, v]) =>
      v && typeof v === 'object' && '$in' in v
        ? (v as { $in: unknown[] }).$in.includes(d[k])
        : d[k] === v,
    )
  const col = (name: string) => ({
    find: (f: Record<string, unknown>) => {
      const rows = (cols[name] ?? []).filter((d) => matches(d, f))
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
      (cols[name] ?? []).find((d) => matches(d, f)) ?? null,
  })
  return { collection: col } as any
}

async function buildApp(tenant = TENANT, user_id = 'u1', roles = ['owner']) {
  const app = Fastify()
  app.addHook('onRequest', async (req) => {
    ;(req as never as Record<string, unknown>)['authContext'] = {
      tenant_id: tenant,
      user_id,
      roles,
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

  it('balances only appear when explicitly enabled, from value_minor, for accounts only', async () => {
    const app = await buildApp()
    const noBal = await app.inject({
      method: 'POST',
      url: '/family/emergency-sheet/preview',
      payload: { sections: ['accounts'] },
    })
    expect(JSON.stringify(noBal.json())).not.toContain('£')
    const withBal = await app.inject({
      method: 'POST',
      url: '/family/emergency-sheet/preview',
      payload: { sections: ['accounts', 'balances'] },
    })
    const accounts = withBal.json().sections[0]
    expect(accounts.items).toEqual([
      { label: 'Barclays saver', detail: 'Savings account · £1,234.56 on file' },
    ])
    // A house is not an account, and its value is not a balance.
    expect(JSON.stringify(withBal.json())).not.toContain('Family home')
  })

  it('refuses balances without accounts rather than returning nothing', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/family/emergency-sheet/preview',
      payload: { sections: ['balances'] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('Accounts')
  })

  it('children lists minors by role or date of birth, only when chosen', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/family/emergency-sheet/preview',
      payload: { sections: ['children'] },
    })
    expect(res.json().sections).toEqual([
      {
        id: 'children',
        title: 'Children',
        items: [
          { label: 'Kit', detail: 'Born 2016-04-01' },
          { label: 'Tess', detail: 'Born 2012-01-01' },
        ],
      },
    ])
    const without = await app.inject({
      method: 'POST',
      url: '/family/emergency-sheet/preview',
      payload: { sections: ['who_to_call'] },
    })
    expect(JSON.stringify(without.json())).not.toContain('Kit')
  })

  it('refuses viewers, minors and people not on the roster (review F03)', async () => {
    for (const [user, roles] of [
      ['viewer', ['viewer']],
      ['kid', ['owner']],
      ['teen', ['admin']],
      ['stranger', ['owner']],
    ] as const) {
      const app = await buildApp(TENANT, user, [...roles])
      const res = await app.inject({
        method: 'POST',
        url: '/family/emergency-sheet/preview',
        payload: { sections: ['who_to_call', 'key_papers'] },
      })
      expect(res.statusCode).toBe(403)
      expect(res.body).not.toContain('Sam')
      expect(res.body).not.toContain('Will')
    }
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
