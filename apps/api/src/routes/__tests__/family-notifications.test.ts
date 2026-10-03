/**
 * PRD-136 §5 — the notification preference center routes: adults read,
 * only the organizer writes, defaults applied on read, zod rejects
 * malformed patches.
 */
import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyNotificationRoutes } from '../family-notifications.js'

const TENANT = 't1'

const family = {
  tenant_id: TENANT,
  members: [
    { id: 'u1', user_id: 'u1', role: 'organizer', status: 'active' },
    { id: 'u2', user_id: 'u2', role: 'adult', status: 'active' },
    { id: 'kid1', user_id: 'u_kid', role: 'child', status: 'active' },
  ],
}

function makeDb(prefs: Record<string, unknown> | null = null) {
  const store = prefs ? [prefs] : []
  const prefsCol = {
    findOne: async () => store[0] ?? null,
    updateOne: async (
      _filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
      opts?: { upsert?: boolean },
    ) => {
      if (store[0]) {
        Object.assign(store[0], update.$set)
        return { modifiedCount: 1 }
      }
      if (opts?.upsert) {
        store.push({ tenant_id: TENANT, ...update.$setOnInsert, ...update.$set })
        return { upsertedCount: 1 }
      }
      return { modifiedCount: 0 }
    },
  }
  return {
    store,
    db: {
      collection: (name: string) =>
        name === 'delivery_preferences' ? prefsCol : { findOne: async () => family },
    } as never,
  }
}

async function build(db: never, userId = 'u1') {
  const app = Fastify()
  app.addHook('onRequest', async (req) => {
    ;(req as { authContext?: unknown }).authContext = { tenant_id: TENANT, user_id: userId }
  })
  registerFamilyNotificationRoutes(app, db)
  return app
}

describe('GET /family/notifications', () => {
  it('applies defaults when no prefs doc exists and lists exempt criticals', async () => {
    const { db } = makeDb()
    const res = await (await build(db)).inject({ method: 'GET', url: '/family/notifications' })
    expect(res.statusCode).toBe(200)
    expect(res.json().preferences).toMatchObject({
      heartbeat_cadence: 'weekly',
      heartbeat_quiet_weeks: false,
      domains_muted: [],
      member_scope: 'all',
      enabled: true,
    })
    expect(res.json().exempt_criticals).toContain('renewal_within_7_days')
    expect(res.json().exempt_criticals).toContain('continuity_check_in')
    expect(res.json().exempt_criticals).toContain('emergency_vault_awareness')
  })

  it('403s a child', async () => {
    const { db } = makeDb()
    const res = await (await build(db, 'u_kid')).inject({ method: 'GET', url: '/family/notifications' })
    expect(res.statusCode).toBe(403)
  })
})

describe('PATCH /family/notifications', () => {
  it('403s a non-organizer adult', async () => {
    const { db } = makeDb()
    const res = await (await build(db, 'u2')).inject({
      method: 'PATCH',
      url: '/family/notifications',
      payload: { heartbeat_cadence: 'monthly' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('400s on an invalid value', async () => {
    const { db } = makeDb()
    const res = await (await build(db)).inject({
      method: 'PATCH',
      url: '/family/notifications',
      payload: { heartbeat_cadence: 'hourly' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('persists the patch and returns merged defaults', async () => {
    const { db, store } = makeDb()
    const app = await build(db)
    const res = await app.inject({
      method: 'PATCH',
      url: '/family/notifications',
      payload: {
        heartbeat_cadence: 'monthly',
        heartbeat_quiet_weeks: true,
        domains_muted: ['education'],
        member_scope: 'mine',
        min_urgency: 'high',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().preferences).toMatchObject({
      heartbeat_cadence: 'monthly',
      heartbeat_quiet_weeks: true,
      domains_muted: ['education'],
      member_scope: 'mine',
      min_urgency: 'high',
    })
    expect(store[0]).toMatchObject({ tenant_id: TENANT, heartbeat_cadence: 'monthly' })

    // Second patch merges without wiping the first.
    await app.inject({ method: 'PATCH', url: '/family/notifications', payload: { digest_mode: true } })
    expect(store[0]).toMatchObject({ heartbeat_cadence: 'monthly', digest_mode: true })
  })
})
