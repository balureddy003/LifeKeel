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

function makeDb(
  collections: Record<string, { rows?: unknown[]; updateOne?: ReturnType<typeof vi.fn> }>,
) {
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
        // No extraction candidates: documents take the legacy (stored fields) path.
        findOne: vi.fn(async () => null),
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

describe('insurance documents in the feed', () => {
  const day = 86_400_000
  const fmt = (d: Date) =>
    `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
  const doc = (fields: Record<string, string>) => ({
    id: 'd1',
    category: 'insurance',
    status: 'extracted',
    uploaded_at: new Date(),
    extracted_data: fields,
  })

  it('ranks a claim form with a deadline in the next 30 days as high priority', async () => {
    const soon = fmt(new Date(Date.now() + day * 1.5))
    const { db } = makeDb({
      insights: { rows: [] },
      inbox_items: { rows: [] },
      documents: {
        rows: [
          doc({
            provider: 'Aviva',
            policy_number: 'P1',
            policy_type: 'critical_illness',
            due_date: soon,
          }),
        ],
      },
    })
    const item = (await (await build(db)).inject({ method: 'GET', url: '/inbox' })).json().items[0]
    expect(item).toMatchObject({ id: 'doc:d1', priority: 'high', route: '/documents/d1' })
    expect(item.subject).toMatch(/^Aviva form due (tomorrow|in 2 days)$/)
  })

  it('surfaces a found policy with no near deadline as a review nudge, and ignores documents with no provider or number', async () => {
    const far = fmt(new Date(Date.now() + day * 200))
    const { db } = makeDb({
      insights: { rows: [] },
      inbox_items: { rows: [] },
      documents: {
        rows: [doc({ provider: 'Aviva', due_date: far }), { ...doc({ note: 'x' }), id: 'd2' }],
      },
    })
    const items = (await (await build(db)).inject({ method: 'GET', url: '/inbox' })).json().items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'doc:d1',
      priority: 'medium',
      subject: 'Policy found: Aviva',
    })
  })
})

describe('email threads', () => {
  it('collapses a claim conversation into one item with a count', async () => {
    const row = (id: string, subject: string, date: string) => ({
      id,
      source: 'Cega',
      subject,
      ai_summary: 's',
      action_label: 'Review',
      action_type: 'review',
      priority: 'high',
      date,
      read: false,
      policy_details: { type: 'travel' },
    })
    const { db } = makeDb({
      insights: { rows: [] },
      documents: { rows: [] },
      inbox_items: {
        rows: [
          row('a', 'Assistance Correspondence (# ClaimNo 22559712 #)', '2026-09-09T10:00:00Z'),
          row('b', 'RE: Assistance Correspondence (# ClaimNo 22559712 #)', '2026-09-10T10:00:00Z'),
          row(
            'c',
            'Re: [EXTERNAL] Assistance Correspondence (# ClaimNo 22559712 #)',
            '2026-09-14T10:00:00Z',
          ),
          row('d', 'Your home insurance renewed', '2026-09-01T10:00:00Z'),
        ],
      },
    })
    const items = (await (await build(db)).inject({ method: 'GET', url: '/inbox' })).json().items
    expect(items.map((i: { id: string }) => i.id)).toEqual(['c', 'd'])
    expect(items[0].threadCount).toBe(3)
    expect(items[1].threadCount).toBeUndefined()
  })
})

describe('feed titles', () => {
  it('turns a snake_case rule id into a readable title', async () => {
    const { db } = makeDb({
      insights: { rows: [{ ...insight, hypothesis: 'no_income_protection' }] },
      inbox_items: { rows: [] },
    })
    const app = await build(db)
    const body = (await app.inject({ method: 'GET', url: '/inbox' })).json()
    expect(body.items[0].subject).toBe('No income protection')
  })
})

describe('GET /inbox — Keel recommendations feed', () => {
  it('returns open family insights as recommendations, merged with policy emails, newest first', async () => {
    const { db, finds } = makeDb({
      insights: { rows: [insight] },
      inbox_items: {
        rows: [
          {
            id: 'e1',
            source: 'Acme Travel <x@acme.example>',
            subject: 'Your policy',
            ai_summary: 'Travel cover to India.',
            action_label: 'Save claims number',
            action_type: 'info',
            priority: 'high',
            date: '2026-09-19T10:00:00.000Z',
            read: false,
            policy_details: { provider: 'Acme Travel', type: 'travel' },
          },
        ],
      },
    })
    const app = await build(db)
    const body = (await app.inject({ method: 'GET', url: '/inbox' })).json()
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['insight:ins1', 'e1'])
    expect(body.items[0]).toMatchObject({
      source: 'Keel',
      subject: 'Life cover looks below household need',
      priority: 'high',
      route: '/health/protection',
      actionLabel: 'Review your current life insurance policy terms',
    })
    expect(body.items[1].policy).toEqual({ provider: 'Acme Travel', type: 'travel' })
    // Transaction/legacy emails (no policy_details) are filtered at the query.
    expect((finds['inbox_items']![0] as Record<string, unknown>)['policy_details']).toEqual({
      $exists: true,
    })
  })

  it('dismissing an insight-backed item dismisses the insight, not an inbox row', async () => {
    const updateOne = vi.fn(async () => ({ matchedCount: 1 }))
    const { db } = makeDb({ insights: { updateOne } })
    const app = await build(db)
    const res = await app.inject({ method: 'POST', url: '/inbox/insight:ins1/dismiss' })
    expect(res.statusCode).toBe(200)
    const [filter, update] = updateOne.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ]
    expect(filter).toMatchObject({ id: 'ins1', tenant_id: 't1' })
    expect(update.$set['state']).toBe('dismissed')
  })
})
