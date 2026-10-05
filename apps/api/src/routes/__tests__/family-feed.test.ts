import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyFeedRoutes } from '../family-feed.js'

const DAY = 86_400_000

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === 'object') {
      const c = cond as Record<string, unknown>
      if ('$gte' in c) return new Date(doc[key] as string | Date).getTime() >= new Date(c.$gte as string | Date).getTime()
      if ('$in' in c) return (c.$in as unknown[]).includes(doc[key])
      if ('$ne' in c) return doc[key] !== c.$ne
    }
    return doc[key] === cond
  })
}

const family = {
  tenant_id: 't1',
  members: [
    { id: 'u1', role: 'organizer', status: 'active' },
    { id: 'kid1', user_id: 'u_kid', role: 'child', status: 'active' },
  ],
}

const evt = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: over['id'] ?? Math.random().toString(36).slice(2),
  tenant_id: 't1',
  type: 'insight_opened',
  severity: 'notice',
  direction: null,
  member_id: null,
  domain: 'protection',
  title: 'Something happened',
  summary: 'details',
  evidence: [],
  links: [],
  next_check_at: null,
  dedupe_key: 'k',
  created_at: new Date(),
  feedback: [{ user_id: 'u1', value: 'useful', at: new Date() }],
  ...over,
})

function makeDb(events: Record<string, unknown>[], history: Record<string, unknown>[] = []) {
  const collections: Record<string, unknown> = {
    family_groups: { findOne: async () => family },
    readiness_events: {
      find: (filter: Record<string, unknown>) => ({
        toArray: async () => events.filter((d) => matches(d, { ...filter })),
      }),
    },
    family_readiness_history: {
      find: (filter: Record<string, unknown>) => ({
        toArray: async () => history.filter((d) => matches(d, { ...filter })),
      }),
    },
  }
  return { db: { collection: (n: string) => collections[n] } as never }
}

async function build(db: never, userId = 'u1') {
  const app = Fastify()
  app.addHook('onRequest', async (req) => {
    ;(req as never as { authContext: unknown }).authContext = { tenant_id: 't1', user_id: userId }
  })
  registerFamilyFeedRoutes(app, db)
  return app
}

describe('GET /family/feed', () => {
  it('403s a non-adult caller', async () => {
    const { db } = makeDb([evt()])
    const res = await (await build(db, 'u_kid')).inject({ method: 'GET', url: '/family/feed' })
    expect(res.statusCode).toBe(403)
  })

  it('returns newest first and strips feedback', async () => {
    const old = evt({ title: 'old', created_at: new Date(Date.now() - 2 * DAY) })
    const fresh = evt({ title: 'fresh', created_at: new Date() })
    const { db } = makeDb([old, fresh])
    const res = await (await build(db)).inject({ method: 'GET', url: '/family/feed' })
    const body = res.json()
    expect(body.events.map((e: { title: string }) => e.title)).toEqual(['fresh', 'old'])
    expect(body.events[0].feedback).toBeUndefined()
  })

  it('honours limit', async () => {
    const events = Array.from({ length: 5 }, (_, i) => evt({ title: `e${i}`, created_at: new Date(Date.now() - i * 1000) }))
    const { db } = makeDb(events)
    const res = await (await build(db)).inject({ method: 'GET', url: '/family/feed?limit=2' })
    expect(res.json().events).toHaveLength(2)
  })

  it('filters by member_id and domain', async () => {
    const { db } = makeDb([
      evt({ title: 'mine', member_id: 'kid1', domain: 'education' }),
      evt({ title: 'other', member_id: 'u1', domain: 'protection' }),
    ])
    const res = await (await build(db)).inject({ method: 'GET', url: '/family/feed?member_id=kid1&domain=education' })
    expect(res.json().events.map((e: { title: string }) => e.title)).toEqual(['mine'])
  })

  it('collapses a run of sweep_quiet events into "Quiet for N days"', async () => {
    const quiet = (daysAgo: number) =>
      evt({ type: 'sweep_quiet', title: 'Quiet day', created_at: new Date(Date.now() - daysAgo * DAY) })
    // 'real' must sort strictly newest — a same-millisecond tie with
    // quiet(0) would split the run (that's the collapse working, not
    // failing).
    const { db } = makeDb([quiet(0), quiet(1), quiet(2), evt({ title: 'real', created_at: new Date(Date.now() + 60_000) })])
    const res = await (await build(db)).inject({ method: 'GET', url: '/family/feed' })
    const events = res.json().events
    const quietItems = events.filter((e: { type: string }) => e.type === 'sweep_quiet')
    expect(quietItems).toHaveLength(1)
    expect(quietItems[0].title).toBe('Quiet for 3 days')
    expect(events.find((e: { title: string }) => e.title === 'real')).toBeTruthy()
  })
})

describe('GET /family/feed?mode=youth', () => {
  it('returns only the caller member’s milestone/score_moved events, money stripped', async () => {
    const { db } = makeDb([
      evt({ type: 'milestone', member_id: 'kid1', title: 'kid milestone', evidence: [{ label: 'Fund', value_minor: 12000 }] }),
      evt({ type: 'score_moved', member_id: 'kid1', title: 'kid score', evidence: [{ label: 'Score', value: '60 → 62' }] }),
      evt({ type: 'milestone', member_id: 'u1', title: 'adult milestone' }),
      evt({ type: 'insight_opened', member_id: 'kid1', title: 'kid insight — wrong type' }),
    ])
    const res = await (await build(db, 'u_kid')).inject({ method: 'GET', url: '/family/feed?mode=youth' })
    expect(res.statusCode).toBe(200)
    const events = res.json().events
    expect(events.map((e: { title: string }) => e.title).sort()).toEqual(['kid milestone', 'kid score'])
    expect(events[0].evidence[0].value_minor).toBeUndefined()
    expect(events[0].feedback).toBeUndefined()
  })
})

// ── Feedback + mutes (PRD-136 §3) ────────────────────────────────────────
// A fuller fake: readiness_events/feed_mutes/insights each get find,
// findOne, updateOne ($set/$unset/$setOnInsert/upsert) and deleteMany —
// everything the feedback route and emitReadinessEvent's mute consult use.

function colFor(store: Record<string, unknown>[]) {
  return {
    find: (filter: Record<string, unknown> = {}) => ({
      toArray: async () => store.filter((d) => matches(d, filter)),
    }),
    findOne: async (filter: Record<string, unknown> = {}) =>
      store.find((d) => matches(d, filter)) ?? null,
    insertOne: async (doc: Record<string, unknown>) => {
      store.push(doc)
      return { insertedId: doc['id'] }
    },
    updateOne: async (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
      opts?: { upsert?: boolean },
    ) => {
      const existing = store.find((d) => matches(d, filter))
      if (existing) {
        Object.assign(existing, update.$set)
        for (const k of Object.keys(update.$unset ?? {})) delete existing[k]
        return { modifiedCount: 1 }
      }
      if (opts?.upsert) {
        store.push({ ...filter, ...update.$setOnInsert, ...update.$set })
        return { upsertedCount: 1 }
      }
      return { modifiedCount: 0 }
    },
    deleteMany: async (filter: Record<string, unknown>) => {
      let n = 0
      for (let i = store.length - 1; i >= 0; i--) {
        if (matches(store[i]!, filter)) { store.splice(i, 1); n++ }
      }
      return { deletedCount: n }
    },
  }
}

function makeFeedbackDb(seed: {
  events: Record<string, unknown>[]
  insights?: Record<string, unknown>[]
  mutes?: Record<string, unknown>[]
}) {
  const { events, insights = [], mutes = [] } = seed
  const collections: Record<string, unknown> = {
    family_groups: { findOne: async () => family },
    readiness_events: colFor(events),
    feed_mutes: colFor(mutes),
    insights: colFor(insights),
    family_readiness_history: colFor([]),
  }
  return { db: { collection: (n: string) => collections[n] ?? colFor([]) } as never }
}

describe('POST /family/feed/:id/feedback', () => {
  const insightEvent = () =>
    evt({
      id: 'e-ins',
      links: [{ kind: 'insight', id: 'ins-1' }],
      dedupe_key: 'insight_opened:ins-1:2026-01-05',
      feedback: [],
    })

  it('stores feedback and replaces an existing entry by the same user', async () => {
    const events = [
      evt({
        id: 'e1',
        feedback: [
          { user_id: 'u1', value: 'useful', at: new Date(0) },
          { user_id: 'other', value: 'handled', at: new Date(0) },
        ],
      }),
    ]
    const { db } = makeFeedbackDb({ events })
    const res = await (await build(db)).inject({ method: 'POST', url: '/family/feed/e1/feedback', payload: { value: 'handled' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    const fb = events[0]!['feedback'] as { user_id: string; value: string }[]
    expect(fb).toHaveLength(2)
    expect(fb.find((f) => f.user_id === 'u1')?.value).toBe('handled')
    expect(fb.find((f) => f.user_id === 'other')?.value).toBe('handled')
  })

  it('403s a child, 400s an unknown value, 404s a missing event', async () => {
    const { db } = makeFeedbackDb({ events: [evt({ id: 'e1' })] })
    const kid = await (await build(db, 'u_kid')).inject({ method: 'POST', url: '/family/feed/e1/feedback', payload: { value: 'useful' } })
    expect(kid.statusCode).toBe(403)
    const bad = await (await build(db)).inject({ method: 'POST', url: '/family/feed/e1/feedback', payload: { value: 'meh' } })
    expect(bad.statusCode).toBe(400)
    const missing = await (await build(db)).inject({ method: 'POST', url: '/family/feed/ghost/feedback', payload: { value: 'useful' } })
    expect(missing.statusCode).toBe(404)
  })

  it('not_relevant resolves the insight link into a rule/entity mute, marks the event, and returns muted_until', async () => {
    const events = [insightEvent()]
    const mutes: Record<string, unknown>[] = []
    const insights = [{ id: 'ins-1', tenant_id: 't1', detector_id: 'fam', rule_id: 'protection_gap', entity_key: 'u1' }]
    const { db } = makeFeedbackDb({ events, insights, mutes })
    const app = await build(db)
    const res = await app.inject({ method: 'POST', url: '/family/feed/e-ins/feedback', payload: { value: 'not_relevant' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().muted_until).toBeTruthy()
    expect(events[0]!['muted']).toBe(true)
    expect(String(events[0]!['muted_reason'])).toContain('not relevant')
    expect(mutes).toHaveLength(1)
    expect(mutes[0]).toMatchObject({ rule_id: 'protection_gap', entity_key: 'u1', by_user_id: 'u1' })

    // The mute is honoured on read: hidden by default, visible with
    // include_muted (reason intact), and excluded from the summary.
    const hidden = await app.inject({ method: 'GET', url: '/family/feed' })
    expect(hidden.json().events).toHaveLength(0)
    const shown = await app.inject({ method: 'GET', url: '/family/feed?include_muted=1' })
    expect(shown.json().events).toHaveLength(1)
    expect(shown.json().events[0].muted_reason).toContain('not relevant')
    const summary = await app.inject({ method: 'GET', url: '/family/feed/summary' })
    expect(summary.json().total).toBe(0)
  })

  it('the emitter marks a new event muted when a live mute matches', async () => {
    const { emitReadinessEvent, buildDedupeKey } = await import('../../feed/emit.js')
    const mutes: Record<string, unknown>[] = []
    const events: Record<string, unknown>[] = []
    const { db } = makeFeedbackDb({ events, mutes })
    // Mute keyed by {type, subject}: subject = dedupe_key minus date suffix.
    const key = buildDedupeKey('profile_changed', 't1')
    const dayless = key.replace(/:\d{4}-\d{2}-\d{2}$/, '')
    mutes.push({ tenant_id: 't1', type: 'profile_changed', subject: dayless, until: new Date(Date.now() + 90 * DAY), by_user_id: 'u1', event_id: 'e0', created_at: new Date() })

    emitReadinessEvent(db, 't1', {
      type: 'profile_changed',
      severity: 'info',
      direction: null,
      member_id: null,
      domain: null,
      title: 'Changed',
      summary: 'x',
      evidence: [],
      links: [],
      next_check_at: null,
      dedupe_key: buildDedupeKey('profile_changed', 't1'),
    })
    await new Promise((r) => setTimeout(r, 15))
    expect(events).toHaveLength(1)
    expect(events[0]!['muted']).toBe(true)

    // Expired mutes don't suppress.
    mutes[0]!['until'] = new Date(Date.now() - 1000)
    emitReadinessEvent(db, 't1', {
      type: 'profile_changed',
      severity: 'info',
      direction: null,
      member_id: null,
      domain: null,
      title: 'Changed 2',
      summary: 'x',
      evidence: [],
      links: [],
      next_check_at: null,
      dedupe_key: buildDedupeKey('profile_changed', 't1'),
    })
    await new Promise((r) => setTimeout(r, 15))
    expect(events[0]!['muted']).toBe(false)
  })

  it('useful undoes a mute: the event unmutes and the feed_mutes row is gone', async () => {
    const events = [insightEvent()]
    const mutes: Record<string, unknown>[] = []
    const insights = [{ id: 'ins-1', tenant_id: 't1', detector_id: 'fam', rule_id: 'protection_gap', entity_key: 'u1' }]
    const { db } = makeFeedbackDb({ events, insights, mutes })
    const app = await build(db)
    await app.inject({ method: 'POST', url: '/family/feed/e-ins/feedback', payload: { value: 'not_relevant' } })
    expect(mutes).toHaveLength(1)

    const undo = await app.inject({ method: 'POST', url: '/family/feed/e-ins/feedback', payload: { value: 'useful' } })
    expect(undo.statusCode).toBe(200)
    expect(mutes).toHaveLength(0)
    expect(events[0]!['muted']).toBeUndefined()
    const list = await app.inject({ method: 'GET', url: '/family/feed' })
    expect(list.json().events).toHaveLength(1)
  })

  it('remind_later snoozes the event out of the default feed for ~7 days', async () => {
    const events = [evt({ id: 'e2' })]
    const { db } = makeFeedbackDb({ events })
    const app = await build(db)
    await app.inject({ method: 'POST', url: '/family/feed/e2/feedback', payload: { value: 'remind_later' } })
    const until = new Date(events[0]!['snoozed_until'] as string).getTime()
    expect(until - Date.now()).toBeGreaterThan(6 * DAY)
    expect(until - Date.now()).toBeLessThan(8 * DAY)
    const list = await app.inject({ method: 'GET', url: '/family/feed' })
    expect(list.json().events).toHaveLength(0)
    const summary = await app.inject({ method: 'GET', url: '/family/feed/summary' })
    expect(summary.json().total).toBe(0)
  })
})

describe('GET /family/feed/summary', () => {
  it('counts by type/direction and reports composite delta', async () => {
    const { db } = makeDb(
      [
        evt({ type: 'score_moved', direction: 'up' }),
        evt({ type: 'insight_opened' }),
        evt({ type: 'insight_opened', direction: 'down' }),
        evt({ type: 'insight_opened', created_at: new Date(Date.now() - 40 * DAY) }),
      ],
      [
        { tenant_id: 't1', date: new Date(Date.now() - 6 * DAY).toISOString().slice(0, 10), score: 70 },
        { tenant_id: 't1', date: new Date().toISOString().slice(0, 10), score: 76 },
      ],
    )
    const res = await (await build(db)).inject({ method: 'GET', url: '/family/feed/summary?window=7d' })
    const body = res.json()
    expect(body).toMatchObject({ window: '7d', total: 3, up: 1, down: 1, composite_delta: 6 })
    expect(body.by_type).toEqual({ score_moved: 1, insight_opened: 2 })
  })
})
