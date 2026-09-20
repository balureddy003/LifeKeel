import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyInboxRoutes } from '../routes/family-inbox.js'

const cursor = (rows: unknown[]) => {
  const c: Record<string, unknown> = {}
  c['sort'] = () => c
  c['limit'] = () => c
  c['toArray'] = async () => rows
  return c
}

function makeDb(collections: Record<string, { rows?: unknown[]; updateOne?: ReturnType<typeof vi.fn> }>) {
  const finds: Record<string, unknown[]> = {}
  return {
    finds,
    db: {
      collection: (name: string) => ({
        find: vi.fn((filter: unknown) => {
          ;(finds[name] ??= []).push(filter)
          return cursor(collections[name]?.rows ?? [])
        }),
        updateOne: collections[name]?.updateOne ?? vi.fn(async () => ({ matchedCount: 1 })),
        findOneAndUpdate: vi.fn(async () => ({})),
      }),
    } as never,
  }
}

async function build(db: never) {
  const app = Fastify()
  app.addHook('onRequest', async (req) => {
    ;(req as never as { authContext: unknown }).authContext = { tenant_id: 't1', user_id: 'u1' }
  })
  registerFamilyInboxRoutes(app, db)
  return app
}

const insight = {
  id: 'ins1',
  detector_id: 'family_protection_gap',
  hypothesis: 'Life cover looks below household need',
  reasoning: 'Cover £0 vs estimated £759,885.',
  actions: ['Review your current life insurance policy terms'],
  urgency: 'high',
  state: 'identified',
  created_at: new Date('2026-09-20T10:00:00Z'),
}

describe('GET /inbox — Oak recommendations feed', () => {
  it('returns open family insights as recommendations, merged with policy emails, newest first', async () => {
    const { db, finds } = makeDb({
      insights: { rows: [insight] },
      inbox_items: {
        rows: [{
          id: 'e1', source: 'Acme Travel <x@acme.example>', subject: 'Your policy', ai_summary: 'Travel cover to India.',
          action_label: 'Save claims number', action_type: 'info', priority: 'high',
          date: '2026-09-19T10:00:00.000Z', read: false, policy_details: { provider: 'Acme Travel', type: 'travel' },
        }],
      },
    })
    const app = await build(db)
    const body = (await app.inject({ method: 'GET', url: '/inbox' })).json()
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['insight:ins1', 'e1'])
    expect(body.items[0]).toMatchObject({ source: 'Oak', subject: 'Life cover looks below household need', priority: 'high', route: '/health/protection', actionLabel: 'Review your current life insurance policy terms' })
    expect(body.items[1].policy).toEqual({ provider: 'Acme Travel', type: 'travel' })
    // Transaction/legacy emails (no policy_details) are filtered at the query.
    expect((finds['inbox_items']![0] as Record<string, unknown>)['policy_details']).toEqual({ $exists: true })
  })

  it('dismissing an insight-backed item dismisses the insight, not an inbox row', async () => {
    const updateOne = vi.fn(async () => ({ matchedCount: 1 }))
    const { db } = makeDb({ insights: { updateOne } })
    const app = await build(db)
    const res = await app.inject({ method: 'POST', url: '/inbox/insight:ins1/dismiss' })
    expect(res.statusCode).toBe(200)
    expect(updateOne).toHaveBeenCalledWith({ id: 'ins1' }, expect.objectContaining({ $set: expect.objectContaining({ state: 'dismissed' }) }))
  })
})
