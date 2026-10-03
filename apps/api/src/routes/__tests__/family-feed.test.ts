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

const evt = (over: Record<string, unknown> = {}) => ({
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
