/**
 * PRD-136 §4 — the family heartbeat: per-adult weekly/monthly email,
 * tenant-level cadence, quiet-week suppression, idempotent re-runs.
 * sendHeartbeatEmail no-ops without SENDGRID_API_KEY, so "sent" is
 * observed via heartbeat_sends rows + the result counters.
 */
import { describe, expect, it } from 'vitest'
import { runFamilyHeartbeat } from '../family-heartbeat.js'
import { renderHeartbeat, type HeartbeatData } from '../../feed/render-heartbeat.js'
import { renderPlaybook } from '../../life-events/render-playbook.js'

const TENANT = 't1'
const NOW = new Date('2026-02-09T08:00:00Z') // a Monday
const DAY = 86_400_000

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (v && typeof v === 'object' && '$gte' in (v as Record<string, unknown>)) {
      return (
        new Date(doc[k] as string | Date).getTime() >=
        new Date((v as Record<string, unknown>)['$gte'] as string).getTime()
      )
    }
    return doc[k] === v
  })
}

function col(store: Record<string, unknown>[]) {
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
  }
}

function makeFamily() {
  return {
    tenant_id: TENANT,
    members: [
      {
        id: 'm-org',
        user_id: 'u-org',
        name: 'Organizer',
        email: 'org@x.test',
        role: 'organizer',
        status: 'active',
      },
      {
        id: 'm-adult',
        user_id: 'u-adult',
        name: 'Adult',
        email: 'adult@x.test',
        role: 'adult',
        status: 'active',
      },
      {
        id: 'm-kid',
        user_id: 'u-kid',
        name: 'Kid',
        email: 'kid@x.test',
        role: 'child',
        status: 'active',
      },
    ],
  }
}

interface Seed {
  prefs?: Record<string, unknown> | null
  events?: Record<string, unknown>[]
  history?: Record<string, unknown>[]
  insights?: Record<string, unknown>[]
  profile?: Record<string, unknown> | null
  signals?: Record<string, unknown>[]
  sends?: Record<string, unknown>[]
}

function makeDb(seed: Seed) {
  const stores: Record<string, Record<string, unknown>[]> = {
    family_groups: [makeFamily() as unknown as Record<string, unknown>],
    delivery_preferences: seed.prefs ? [{ tenant_id: TENANT, ...seed.prefs }] : [],
    readiness_events: (seed.events ?? []).map((e) => ({ tenant_id: TENANT, ...e })),
    family_readiness_history: (seed.history ?? []).map((h) => ({ tenant_id: TENANT, ...h })),
    insights: seed.insights ?? [],
    family_financial_profile: seed.profile ? [{ tenant_id: TENANT, ...seed.profile }] : [],
    signals: (seed.signals ?? []).map((s) => ({ tenant_id: TENANT, ...s })),
    heartbeat_sends: (seed.sends ?? []).map((s) => ({ tenant_id: TENANT, ...s })),
  }
  return {
    stores,
    db: { collection: (n: string) => col(stores[n] ?? (stores[n] = [])) } as never,
  }
}

const isoDaysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString().slice(0, 10)

const scoreMoved = () => ({
  type: 'score_moved',
  severity: 'info',
  direction: 'up',
  member_id: null,
  domain: 'protection',
  title: 'Score moved',
  summary: 'x',
  evidence: [],
  links: [],
  dedupe_key: 'score_moved:t1:2026-02-06',
  created_at: new Date(NOW.getTime() - 3 * DAY),
})

/** A bereavement signal whose playbook has exactly `pending` steps open. */
function lifeEventSignal(pending: number) {
  const playbook = renderPlaybook('bereavement', { policies: [] } as never)
  const completed = playbook.steps.slice(pending).map((s) => s.id)
  return {
    signal_type: 'family.life_event',
    data: { event_type: 'bereavement', affected_member_id: 'm-org', completed_step_ids: completed },
  }
}

describe('renderHeartbeat', () => {
  it('subject names the delta + open items; body lists movement, renewal and steps', () => {
    const data: HeartbeatData = {
      period: 'week',
      window_start: new Date(NOW.getTime() - 7 * DAY),
      score_delta: 4,
      moved_events: 1,
      open_insights: 1,
      new_insights: 1,
      resolved_insights: 0,
      renewals: [{ type: 'life', renewal_date: '2026-02-20' }],
      pending_steps: 2,
      profile_stale: false,
      review_due: false,
      app_url: 'http://localhost:3002',
    }
    const r = renderHeartbeat(data)
    expect(r.subject).toBe("Your family's week: score +4, 3 things to look at")
    expect(r.text).toContain('score moved +4')
    expect(r.text).toContain('life on 2026-02-20')
    expect(r.text).toContain('2 steps still open')
    expect(r.text).toContain('/settings#notifications')
    expect(r.html).toContain('Open LifeKeel')
  })

  it('quiet week renders the nothing-moved subject', () => {
    const r = renderHeartbeat({
      period: 'week',
      window_start: new Date(NOW.getTime() - 7 * DAY),
      score_delta: null,
      moved_events: 0,
      open_insights: 0,
      new_insights: 0,
      resolved_insights: 0,
      renewals: [],
      pending_steps: 0,
      profile_stale: false,
      review_due: false,
      app_url: 'http://x',
    })
    expect(r.subject).toBe("Your family's week: nothing moved")
    expect(r.text).toContain('Nothing moved')
  })
})

describe('runFamilyHeartbeat', () => {
  it('sends to both adults (never the child), records heartbeat_sends, and the copy reflects the window', async () => {
    const signal = lifeEventSignal(2)
    const { db, stores } = makeDb({
      events: [scoreMoved()],
      history: [
        { date: isoDaysAgo(6), score: 70 },
        { date: isoDaysAgo(1), score: 74 },
      ],
      insights: [
        {
          id: 'i1',
          tenant_id: TENANT,
          state: 'identified',
          created_at: new Date(NOW.getTime() - 2 * DAY),
        },
      ],
      profile: {
        updated_at: new Date(NOW.getTime() - 10 * DAY),
        policies: [{ type: 'life', renewal_date: isoDaysAgo(-20) }],
      },
      signals: [signal],
    })
    const r = await runFamilyHeartbeat(db, { cadence: 'weekly', now: NOW })
    expect(r.tenants).toBe(1)
    expect(r.sent).toBe(2)
    const sends = stores['heartbeat_sends']!
    expect(sends).toHaveLength(2)
    expect(sends.map((s) => s['member_id']).sort()).toEqual(['m-adult', 'm-org'])
    expect(sends.every((s) => !s['member_id']!.toString().includes('kid'))).toBe(true)

    // Idempotent: same window again sends nothing.
    const again = await runFamilyHeartbeat(db, { cadence: 'weekly', now: NOW })
    expect(again.sent).toBe(0)
    expect(sends).toHaveLength(2)
  })

  it('skips a quiet week unless heartbeat_quiet_weeks is on', async () => {
    const { db } = makeDb({})
    const r = await runFamilyHeartbeat(db, { cadence: 'weekly', now: NOW })
    expect(r.sent).toBe(0)
    expect(r.skipped_quiet).toBe(1)

    const { db: db2 } = makeDb({ prefs: { heartbeat_quiet_weeks: true } })
    const r2 = await runFamilyHeartbeat(db2, { cadence: 'weekly', now: NOW })
    expect(r2.sent).toBe(2)
    expect(r2.skipped_quiet).toBe(0)
  })

  it('cadence off sends nothing; monthly cadence ignores the weekly run', async () => {
    const { db } = makeDb({ prefs: { heartbeat_cadence: 'off' }, events: [scoreMoved()] })
    const r = await runFamilyHeartbeat(db, { cadence: 'weekly', now: NOW })
    expect(r.sent).toBe(0)
    expect(r.skipped_off).toBe(1)

    const { db: db2 } = makeDb({ prefs: { heartbeat_cadence: 'monthly' }, events: [scoreMoved()] })
    const r2 = await runFamilyHeartbeat(db2, { cadence: 'weekly', now: NOW })
    expect(r2.sent).toBe(0)
    expect(r2.skipped_off).toBe(1)
  })

  it('muted events do not count as movement', async () => {
    const { db } = makeDb({ events: [{ ...scoreMoved(), muted: true }] })
    const r = await runFamilyHeartbeat(db, { cadence: 'weekly', now: NOW })
    expect(r.sent).toBe(0)
    expect(r.skipped_quiet).toBe(1)
  })

  it('monthly run on the 1st reports the previous calendar month, not the current 8 hours', async () => {
    const firstRun = new Date('2026-03-01T08:00:00Z')
    const inFeb = { ...scoreMoved(), created_at: new Date('2026-02-14T10:00:00Z') }
    const inMarch = { ...scoreMoved(), created_at: new Date('2026-03-01T02:00:00Z') }
    const { db, stores } = makeDb({ prefs: { heartbeat_cadence: 'monthly' }, events: [inFeb] })
    const r = await runFamilyHeartbeat(db, { cadence: 'monthly', now: firstRun })
    expect(r.sent).toBe(2)
    expect(stores['heartbeat_sends']!.every((s) => s['window_start'] === '2026-02-01')).toBe(true)

    // An event created only in the new month is outside the window → quiet.
    const { db: db2 } = makeDb({ prefs: { heartbeat_cadence: 'monthly' }, events: [inMarch] })
    const r2 = await runFamilyHeartbeat(db2, { cadence: 'monthly', now: firstRun })
    expect(r2.sent).toBe(0)
    expect(r2.skipped_quiet).toBe(1)
  })

  it('monthly in January reaches back to December of the previous year', async () => {
    const jan = new Date('2027-01-01T08:00:00Z')
    const dec = { ...scoreMoved(), created_at: new Date('2026-12-20T10:00:00Z') }
    const { db, stores } = makeDb({ prefs: { heartbeat_cadence: 'monthly' }, events: [dec] })
    const r = await runFamilyHeartbeat(db, { cadence: 'monthly', now: jan })
    expect(r.sent).toBe(2)
    expect(stores['heartbeat_sends']![0]!['window_start']).toBe('2026-12-01')
  })
})
