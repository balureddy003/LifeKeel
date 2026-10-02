/**
 * GET/PATCH /family/continuity (PRD-130) — organizer-only configuration of
 * the inactivity switch; designated contacts must be active adults.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyContinuityRoutes } from '../family-continuity.js'

const TENANT = 't-cont-route'
const ORG = 'org-1'

let group: Record<string, unknown> | null
let states: Record<string, unknown>[]

function match(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (k === '$or') return (v as Record<string, unknown>[]).some((c) => match(doc, c))
    return doc[k] === v
  })
}
function applyUpdate(doc: Record<string, unknown>, update: Record<string, unknown>) {
  for (const [k, v] of Object.entries((update['$set'] as Record<string, unknown>) ?? {})) doc[k] = v
}

function col(store: Record<string, unknown>[]) {
  return {
    findOne: async (filter: Record<string, unknown> = {}) => store.find((d) => match(d, filter)) ?? null,
    find: (filter: Record<string, unknown> = {}) => ({ toArray: async () => store.filter((d) => match(d, filter)) }),
    updateOne: async (_filter: Record<string, unknown>, update: Record<string, unknown>) => {
      // groupsFor() is tenant-scoped — the filter carries tenant_id which
      // the store doc already has; match on it.
      const doc = store.find((d) => match(d, { tenant_id: TENANT, ..._filter }))
      if (doc) { applyUpdate(doc, update); return { modifiedCount: 1 } }
      return { modifiedCount: 0 }
    },
    createIndex: async () => ({}),
  }
}

function makeDb() {
  return {
    collection: (name: string) =>
      name === 'family_groups' ? col(group ? [group] : []) : name === 'family_continuity_state' ? col(states) : col([]),
  } as never
}

async function buildApp(userId = ORG) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as { authContext?: unknown }).authContext = { tenant_id: TENANT, user_id: userId }
  })
  registerFamilyContinuityRoutes(app, makeDb())
  return app
}

const MEMBERS = [
  { id: ORG, user_id: ORG, name: 'Balu', email: 'b@x.com', role: 'organizer', status: 'active', joined_at: '2026-01-01' },
  { id: 'partner-1', name: 'Sudha', email: 's@x.com', role: 'adult', status: 'active', joined_at: '2026-01-02' },
  { id: 'kid-1', name: 'Nih', email: '', role: 'child', status: 'pending', joined_at: '2026-01-03' },
]

beforeEach(() => {
  group = { tenant_id: TENANT, id: 'fam-1', name: 'Kumars', members: [...MEMBERS.map((m) => ({ ...m }))] }
  states = []
})

describe('PATCH /family/continuity', () => {
  it('403s a non-organizer', async () => {
    const app = await buildApp('partner-1')
    const res = await app.inject({ method: 'PATCH', url: '/family/continuity', payload: { enabled: true } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('saves config and rejects ineligible designated members (child, pending, unknown)', async () => {
    const app = await buildApp()
    const bad = await app.inject({
      method: 'PATCH', url: '/family/continuity',
      payload: { enabled: true, designated_member_ids: ['kid-1', 'ghost'], check_in_after_days: 30 },
    })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().invalid_member_ids).toEqual(['kid-1', 'ghost'])

    const ok = await app.inject({
      method: 'PATCH', url: '/family/continuity',
      payload: { enabled: true, designated_member_ids: ['partner-1'], check_in_after_days: 60, grace_days: 7 },
    })
    expect(ok.statusCode).toBe(200)
    expect(group?.['continuity']).toMatchObject({ enabled: true, designated_member_ids: ['partner-1'], check_in_after_days: 60, grace_days: 7 })
    await app.close()
  })
})

describe('GET /family/continuity', () => {
  it('returns defaults when unset, and the persisted config once saved', async () => {
    const app = await buildApp()
    const first = (await app.inject({ method: 'GET', url: '/family/continuity' })).json()
    expect(first.continuity.enabled).toBe(false)
    expect(first.state.phase).toBe('watching')
    expect(first.is_organizer).toBe(true)

    group!['continuity'] = { enabled: true, designated_member_ids: ['partner-1'], check_in_after_days: 30, grace_days: 14 }
    const second = (await app.inject({ method: 'GET', url: '/family/continuity' })).json()
    expect(second.continuity.enabled).toBe(true)
    expect(second.continuity.designated_member_ids).toEqual(['partner-1'])
    await app.close()
  })

  it('404s when there is no family', async () => {
    group = null
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/family/continuity' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})
