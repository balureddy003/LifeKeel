/**
 * PRD-136 §4 — the family heartbeat: per-adult weekly/monthly email,
 * tenant-level cadence, quiet-week suppression, idempotent re-runs.
 * sendHeartbeatEmail is mocked: "sent" is observed via heartbeat_sends rows
 * + the result counters, and a failed delivery must leave no row behind.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendMock = vi.hoisted(() => vi.fn())
vi.mock('../../auth-email.js', () => ({ sendHeartbeatEmail: sendMock }))

import { runFamilyHeartbeat } from '../family-heartbeat.js'
import { renderHeartbeat, type HeartbeatData } from '../../feed/render-heartbeat.js'
import { renderPlaybook } from '../../life-events/render-playbook.js'

const TENANT = 't1'
const NOW = new Date('2026-02-09T08:00:00Z') // a Monday
const DAY = 86_400_000
const MARCH_SWEEP = new Date('2026-03-01T06:30:00Z')

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
  /** Defaults to weekly; pass null for a tenant that never chose a cadence. */
  prefs?: Record<string, unknown> | null
  /** When the daily sweep last completed; defaults to 2h before NOW, null = never recorded. */
  sweepRanAt?: Date | null
  events?: Record<string, unknown>[]
  history?: Record<string, unknown>[]
  insights?: Record<string, unknown>[]
  profile?: Record<string, unknown> | null
  signals?: Record<string, unknown>[]
  sends?: Record<string, unknown>[]
  freshness?: Record<string, unknown>[]
}

function makeDb(seed: Seed) {
  const stores: Record<string, Record<string, unknown>[]> = {
    family_groups: [makeFamily() as unknown as Record<string, unknown>],
    delivery_preferences:
      seed.prefs === null
        ? []
        : [{ tenant_id: TENANT, heartbeat_cadence: 'weekly', ...seed.prefs }],
    job_runs:
      seed.sweepRanAt === null
        ? []
        : [
            {
              job: 'stale-profile-evaluation',
              ran_at: seed.sweepRanAt ?? new Date(NOW.getTime() - 2 * 3_600_000),
            },
          ],
    readiness_events: (seed.events ?? []).map((e) => ({ tenant_id: TENANT, ...e })),
    family_readiness_history: (seed.history ?? []).map((h) => ({ tenant_id: TENANT, ...h })),
    insights: seed.insights ?? [],
    family_financial_profile: seed.profile ? [{ tenant_id: TENANT, ...seed.profile }] : [],
    signals: (seed.signals ?? []).map((s) => ({ tenant_id: TENANT, ...s })),
    freshness_state: (seed.freshness ?? []).map((f) => ({ tenant_id: TENANT, ...f })),
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
  beforeEach(() => {
    sendMock.mockReset()
    sendMock.mockResolvedValue({ ok: true })
  })

  it('does not record a send (and retries next run) when delivery fails or is skipped', async () => {
    const { db, stores } = makeDb({ events: [scoreMoved()] })
    sendMock.mockResolvedValue({ ok: false, reason: 'no_api_key' })
    const r = await runFamilyHeartbeat(db, { cadence: 'weekly', now: NOW })
    expect(r.sent).toBe(0)
    expect(r.failed).toBe(2)
    expect(stores['heartbeat_sends']).toHaveLength(0)

    // Provider recovers: the same window is retried and now recorded.
    sendMock.mockResolvedValue({ ok: true })
    const retry = await runFamilyHeartbeat(db, { cadence: 'weekly', now: NOW })
    expect(retry.sent).toBe(2)
    expect(retry.failed).toBe(0)
    expect(stores['heartbeat_sends']).toHaveLength(2)
  })

  it('a thrown send error is counted as failed and writes no row', async () => {
    const { db, stores } = makeDb({ events: [scoreMoved()] })
    sendMock.mockRejectedValue(new Error('boom'))
    const r = await runFamilyHeartbeat(db, { cadence: 'weekly', now: NOW })
    expect(r.sent).toBe(0)
    expect(r.failed).toBe(2)
    expect(stores['heartbeat_sends']).toHaveLength(0)
  })

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

    // An event created only in the new month is outside the window, but the
    // digest still sends: a quiet month is the reassurance it exists to give.
    const { db: db2 } = makeDb({
      prefs: { heartbeat_cadence: 'monthly' },
      events: [inMarch],
      sweepRanAt: MARCH_SWEEP,
    })
    const r2 = await runFamilyHeartbeat(db2, { cadence: 'monthly', now: firstRun })
    expect(r2.sent).toBe(2)
    expect(r2.skipped_quiet).toBe(0)
    const body = sendMock.mock.calls.at(-1)![2] as { text: string }
    expect(body.text).toContain('No changes this month.')
  })

  it('monthly in January reaches back to December of the previous year', async () => {
    const jan = new Date('2027-01-01T08:00:00Z')
    const dec = { ...scoreMoved(), created_at: new Date('2026-12-20T10:00:00Z') }
    const { db, stores } = makeDb({ prefs: { heartbeat_cadence: 'monthly' }, events: [dec] })
    const r = await runFamilyHeartbeat(db, { cadence: 'monthly', now: jan })
    expect(r.sent).toBe(2)
    expect(stores['heartbeat_sends']![0]!['window_start']).toBe('2026-12-01')
  })

  it('a tenant with no stored cadence gets the monthly digest, not the weekly email', async () => {
    const { db } = makeDb({ prefs: null, events: [scoreMoved()] })
    const weekly = await runFamilyHeartbeat(db, { cadence: 'weekly', now: NOW })
    expect(weekly.sent).toBe(0)
    expect(weekly.skipped_off).toBe(1)
    const monthly = await runFamilyHeartbeat(db, {
      cadence: 'monthly',
      now: new Date('2026-03-01T08:00:00Z'),
    })
    expect(monthly.sent).toBe(2)
  })

  it('monthly digest names the real last-check date and cites a real run record', async () => {
    const ranAt = new Date('2026-03-01T06:30:00Z')
    const { db } = makeDb({ prefs: { heartbeat_cadence: 'monthly' }, sweepRanAt: ranAt })
    await runFamilyHeartbeat(db, { cadence: 'monthly', now: new Date('2026-03-01T08:00:00Z') })
    const rendered = sendMock.mock.calls.at(-1)![2] as { subject: string; text: string }
    expect(rendered.subject).toBe("Your family's February 2026: all clear")
    expect(rendered.text).toContain('The daily check last ran on 1 March.')
    expect(rendered.text).toContain('covers 1–28 February')
  })

  it('sends the could-not-check variant when the sweep has not run recently, never all clear', async () => {
    const { db } = makeDb({
      prefs: { heartbeat_cadence: 'monthly' },
      sweepRanAt: new Date('2026-02-20T06:30:00Z'),
    })
    const r = await runFamilyHeartbeat(db, {
      cadence: 'monthly',
      now: new Date('2026-03-01T08:00:00Z'),
    })
    expect(r.sent).toBe(2)
    const rendered = sendMock.mock.calls.at(-1)![2] as { subject: string; text: string }
    expect(rendered.subject).toBe("We couldn't run this month's checks")
    expect(rendered.text).not.toMatch(/all clear/i)
    expect(rendered.text).toContain('20 February')
  })

  it('sends nothing, and leaves the window retryable, when no sweep run was ever recorded', async () => {
    const { db, stores } = makeDb({ prefs: { heartbeat_cadence: 'monthly' }, sweepRanAt: null })
    const r = await runFamilyHeartbeat(db, {
      cadence: 'monthly',
      now: new Date('2026-03-01T08:00:00Z'),
    })
    expect(r.sent).toBe(0)
    expect(r.failed).toBe(2)
    expect(sendMock).not.toHaveBeenCalled()
    expect(stores['heartbeat_sends']).toHaveLength(0)
  })

  it('surfaces one open item as the single thing worth a look, linking to it', async () => {
    const { db } = makeDb({
      prefs: { heartbeat_cadence: 'monthly' },
      sweepRanAt: MARCH_SWEEP,
      insights: [
        {
          tenant_id: TENANT,
          id: 'i-low',
          state: 'identified',
          confidence: 0.4,
          hypothesis: 'Lower item',
        },
        {
          tenant_id: TENANT,
          id: 'i-top',
          state: 'identified',
          confidence: 0.9,
          hypothesis: 'Top item',
        },
      ],
    })
    await runFamilyHeartbeat(db, { cadence: 'monthly', now: new Date('2026-03-01T08:00:00Z') })
    const rendered = sendMock.mock.calls.at(-1)![2] as { subject: string; text: string }
    expect(rendered.subject).toBe("Your family's February 2026: 1 thing worth a look")
    expect(rendered.text).toContain('Top item')
    expect(rendered.text).not.toContain('Lower item')
    expect(rendered.text).toContain('/insights/i-top')
  })

  it('records scheduled-versus-delivered for each run', async () => {
    const { db, stores } = makeDb({ events: [scoreMoved()] })
    sendMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reason: 'send_failed' })
    await runFamilyHeartbeat(db, { cadence: 'weekly', now: NOW })
    const run = stores['job_runs']!.find((r) => r['job'] === 'family-heartbeat-weekly')!
    expect(run).toMatchObject({ sent: 1, failed: 1, scheduled: 2 })
  })

  it('collapses paused checks from the freshness record into one quiet line', async () => {
    const { db } = makeDb({
      prefs: { heartbeat_cadence: 'monthly' },
      sweepRanAt: MARCH_SWEEP,
      freshness: [
        { detector_id: 'family_retirement_gap', label: 'Retirement', state: 'paused_missing' },
        {
          detector_id: 'family_emergency_fund_adequacy',
          label: 'Emergency fund',
          state: 'paused_stale',
        },
        { detector_id: 'family_protection_gap', label: 'Protection', state: 'running' },
      ],
    })
    await runFamilyHeartbeat(db, { cadence: 'monthly', now: new Date('2026-03-01T08:00:00Z') })
    const text = (sendMock.mock.calls.at(-1)![2] as { text: string }).text
    expect(text).toContain(
      '2 checks are paused because some details are missing or out of date: Retirement, Emergency fund.',
    )
    expect(text.match(/paused because/g)).toHaveLength(1)
    expect(text).not.toContain('Protection,')
  })

  it('says nothing is paused when every check in the freshness record is running', async () => {
    const { db } = makeDb({
      prefs: { heartbeat_cadence: 'monthly' },
      sweepRanAt: MARCH_SWEEP,
      freshness: [{ detector_id: 'family_protection_gap', label: 'Protection', state: 'running' }],
    })
    await runFamilyHeartbeat(db, { cadence: 'monthly', now: new Date('2026-03-01T08:00:00Z') })
    expect((sendMock.mock.calls.at(-1)![2] as { text: string }).text).not.toContain('Paused')
  })

  it('counts each confirmed digest as exempt Tier B in the notification ledger (PRD-139)', async () => {
    const { db, stores } = makeDb({
      prefs: { heartbeat_cadence: 'monthly' },
      sweepRanAt: MARCH_SWEEP,
    })
    await runFamilyHeartbeat(db, { cadence: 'monthly', now: new Date('2026-03-01T08:00:00Z') })
    const rows = stores['notification_ledger']!
    expect(rows).toHaveLength(2)
    expect(
      rows.every(
        (r) => r['tier'] === 'B' && r['outcome'] === 'exempt' && r['kind'] === 'quiet_care_digest',
      ),
    ).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('@x.test')
  })

  it('a failed send is not counted in the ledger', async () => {
    const { db, stores } = makeDb({
      prefs: { heartbeat_cadence: 'monthly' },
      sweepRanAt: MARCH_SWEEP,
    })
    sendMock.mockResolvedValue({ ok: false, reason: 'send_failed' })
    await runFamilyHeartbeat(db, { cadence: 'monthly', now: new Date('2026-03-01T08:00:00Z') })
    expect(stores['notification_ledger'] ?? []).toHaveLength(0)
  })

  it('adds the digest-only offer line when an offer is pending', async () => {
    const { db } = makeDb({
      prefs: { heartbeat_cadence: 'monthly', digest_offer: { offered_at: new Date('2026-02-20') } },
      sweepRanAt: MARCH_SWEEP,
    })
    await runFamilyHeartbeat(db, { cadence: 'monthly', now: new Date('2026-03-01T08:00:00Z') })
    expect((sendMock.mock.calls.at(-1)![2] as { text: string }).text).toContain(
      "You haven't opened the last two alerts.",
    )
  })
})
