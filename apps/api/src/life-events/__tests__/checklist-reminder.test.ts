/**
 * Tier 3 checklist reminder — mirrors vault-reminder.test.ts's coverage
 * shape (fires for qualifying event types with real data, stays silent
 * otherwise, never double-sends) adapted for a time-based trigger (3+ days
 * stalled) instead of an immediate post-report one, and a reporter-only
 * recipient instead of "every other adult".
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { runChecklistReminderSweep } from '../checklist-reminder.js'
import { renderPlaybook } from '../render-playbook.js'
import type { FinancialProfile } from '../../routes/family-financial-profile.js'

const sendMock = vi.fn(async (_msg: { to: string }) => {})
vi.mock('@sendgrid/mail', () => ({
  default: { setApiKey: vi.fn(), send: (msg: { to: string }) => sendMock(msg) },
}))

interface StoredSignal {
  id: string
  tenant_id: string
  signal_type: string
  data: Record<string, unknown>
  created_at: Date
}
let signalsStore: StoredSignal[] = []

vi.mock('../../db.js', () => ({
  // A trivial stand-in for the real `signals` collection — just enough of
  // find().toArray() and updateOne() to evaluate the exact filter shape
  // runChecklistReminderSweep sends.
  getSignalsCollection: vi.fn(async () => ({
    find: (filter: Record<string, unknown>) => ({
      toArray: async () =>
        signalsStore.filter((s) => {
          if (s.signal_type !== filter['signal_type']) return false
          const eventTypeIn = (filter['data.event_type'] as { $in: string[] } | undefined)?.$in
          if (eventTypeIn && !eventTypeIn.includes(s.data['event_type'] as string)) return false
          const cutoff = (filter['created_at'] as { $lte: Date } | undefined)?.$lte
          if (cutoff && !(s.created_at.getTime() <= cutoff.getTime())) return false
          if ('data.checklist_reminder_sent' in filter && s.data['checklist_reminder_sent'] === true) return false
          return true
        }),
    }),
    updateOne: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
      const doc = signalsStore.find(
        (s) => s.tenant_id === filter['tenant_id'] && s.signal_type === filter['signal_type'] && s.id === filter['id'],
      )
      if (!doc) return { matchedCount: 0, modifiedCount: 0 }
      for (const [key, value] of Object.entries(update.$set ?? {})) {
        doc.data[key.replace('data.', '')] = value
      }
      return { matchedCount: 1, modifiedCount: 1 }
    },
  })),
}))

const TENANT = 'tenant-checklist-reminder'

interface FakeInsight extends Record<string, unknown> {
  detector_id: string
  tenant_id: string
}

interface FakeMember { id: string; name: string; email: string; role: string; status: string }

function makeDb(opts: {
  profile: FinancialProfile | null
  members: FakeMember[] | null
}) {
  const insights: FakeInsight[] = []
  const events: Record<string, unknown>[] = []
  const profileCol = { findOne: async () => opts.profile }
  const familyGroupsCol = { findOne: async () => (opts.members ? { tenant_id: TENANT, members: opts.members } : null) }
  const insightsCol = { insertOne: async (doc: FakeInsight) => { insights.push(doc); return { insertedId: doc['id'] } } }
  const readinessEventsCol = {
    updateOne: async (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
    ) => {
      const existing = events.find((e) => e['dedupe_key'] === filter['dedupe_key'])
      if (existing) Object.assign(existing, update.$set)
      else events.push({ ...update.$setOnInsert, ...update.$set })
      return { upsertedCount: 1 }
    },
  }
  const db = {
    collection: (name: string) => {
      if (name === 'family_financial_profile') return profileCol
      if (name === 'family_groups') return familyGroupsCol
      if (name === 'insights') return insightsCol
      if (name === 'readiness_events') return readinessEventsCol
      throw new Error(`unexpected collection ${name}`)
    },
  }
  return { db: db as any, insights, events }
}

function makeProfile(overrides: Partial<FinancialProfile> = {}): FinancialProfile {
  return {
    household: {
      employment_status: 'employed',
      monthly_salary_minor: 400000,
      annual_living_expenses_minor: 3600000,
      mortgage_outstanding_minor: 20_000_000,
      life_cover_minor: 10_000_000,
      income_protection_monthly_minor: 400000,
      members: [],
    },
    emergency_fund: {
      emergency_savings_minor: 900000,
      monthly_expenses_minor: 300000,
      has_high_interest_debt: false,
      high_interest_debt_balance_minor: 0,
    },
    retirement: {
      current_age: 30,
      target_retirement_age: 65,
      pension_balance_minor: 5_000_000,
      monthly_contribution_minor: 50000,
      target_retirement_income_minor: 3_000_000,
      expected_annual_growth_pct: 5,
    },
    education_funds: [],
    policies: [],
    ...overrides,
  } as FinancialProfile
}

const REPORTER: FakeMember = { id: 'reporter', name: 'Balu Reddy', email: 'balu@example.com', role: 'organizer', status: 'active' }
const OTHER_ADULT: FakeMember = { id: 'adult-2', name: 'Sudha Reddy', email: 'sudha@example.com', role: 'parent', status: 'active' }

const FOUR_DAYS_AGO = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
const ONE_DAY_AGO = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)

let idCounter = 0
function makeSignal(overrides: Partial<StoredSignal['data']> & { created_at?: Date } = {}): void {
  idCounter += 1
  const { created_at, ...data } = overrides
  signalsStore.push({
    id: `event-${idCounter}`,
    tenant_id: TENANT,
    signal_type: 'family.life_event',
    created_at: created_at ?? FOUR_DAYS_AGO,
    data: {
      event_type: 'bereavement',
      reported_at: (created_at ?? FOUR_DAYS_AGO).toISOString(),
      reported_by_user_id: REPORTER.id,
      ...data,
    },
  })
}

describe('runChecklistReminderSweep', () => {
  beforeEach(() => {
    signalsStore = []
    idCounter = 0
    sendMock.mockClear()
    process.env['SENDGRID_API_KEY'] = 'test-key'
  })

  it('emails the reporter only and creates one insight for a qualifying, stalled, incomplete checklist', async () => {
    makeSignal({ event_type: 'bereavement' })
    const { db, insights } = makeDb({ profile: makeProfile(), members: [REPORTER, OTHER_ADULT] })

    const sent = await runChecklistReminderSweep(db)

    expect(sent).toBe(1)
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0]![0]).toMatchObject({ to: REPORTER.email })
    expect(insights).toHaveLength(1)
    expect(insights[0]!['detector_id']).toBe('family_checklist_reminder')
    expect(signalsStore[0]!.data['checklist_reminder_sent']).toBe(true)
  })

  it('does nothing for a job_loss/car/property event, regardless of how stalled it is', async () => {
    makeSignal({ event_type: 'job_loss' })
    makeSignal({ event_type: 'car' })
    makeSignal({ event_type: 'property' })
    const { db } = makeDb({ profile: makeProfile(), members: [REPORTER, OTHER_ADULT] })

    const sent = await runChecklistReminderSweep(db)

    expect(sent).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('does not fire before the event is 3 days old', async () => {
    makeSignal({ event_type: 'medical', created_at: ONE_DAY_AGO })
    const { db } = makeDb({ profile: makeProfile(), members: [REPORTER, OTHER_ADULT] })

    const sent = await runChecklistReminderSweep(db)

    expect(sent).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('marks the event done without emailing once every checklist step is already complete', async () => {
    const profile = makeProfile()
    const allStepIds = renderPlaybook('bereavement', profile).steps.map((s) => s.id)
    makeSignal({ event_type: 'bereavement', completed_step_ids: allStepIds })
    const { db, insights } = makeDb({ profile, members: [REPORTER, OTHER_ADULT] })

    const sent = await runChecklistReminderSweep(db)

    expect(sent).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
    expect(insights).toHaveLength(0)
    expect(signalsStore[0]!.data['checklist_reminder_sent']).toBe(true)
  })

  it('never double-sends — a second sweep after the first is a no-op', async () => {
    makeSignal({ event_type: 'disability' })
    const { db } = makeDb({ profile: makeProfile(), members: [REPORTER, OTHER_ADULT] })

    await runChecklistReminderSweep(db)
    const secondSent = await runChecklistReminderSweep(db)

    expect(secondSent).toBe(0)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('marks done without emailing when no reporter is on file (event predates reported_by_user_id)', async () => {
    makeSignal({ event_type: 'medical', reported_by_user_id: undefined })
    const { db, insights } = makeDb({ profile: makeProfile(), members: [REPORTER, OTHER_ADULT] })

    const sent = await runChecklistReminderSweep(db)

    expect(sent).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
    expect(insights).toHaveLength(0)
  })

  it('marks done without emailing when the reporter is no longer on the family roster', async () => {
    makeSignal({ event_type: 'medical' })
    const { db } = makeDb({ profile: makeProfile(), members: [OTHER_ADULT] })

    const sent = await runChecklistReminderSweep(db)

    expect(sent).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('still creates the insight even when SENDGRID_API_KEY is not configured', async () => {
    delete process.env['SENDGRID_API_KEY']
    makeSignal({ event_type: 'bereavement' })
    const { db, insights } = makeDb({ profile: makeProfile(), members: [REPORTER, OTHER_ADULT] })

    const sent = await runChecklistReminderSweep(db)

    expect(sent).toBe(1)
    expect(sendMock).not.toHaveBeenCalled()
    expect(insights).toHaveLength(1)
  })

  it('emits a playbook_steps_pending feed event when the reminder fires', async () => {
    makeSignal({ event_type: 'bereavement', affected_member_id: 'adult-2' })
    const { db, events } = makeDb({ profile: makeProfile(), members: [REPORTER, OTHER_ADULT] })

    await runChecklistReminderSweep(db)
    await new Promise((r) => setTimeout(r, 20))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'playbook_steps_pending',
      severity: 'notice',
      member_id: 'adult-2',
      links: [{ kind: 'member', id: 'adult-2' }],
    })
    expect(events[0]!['title']).toMatch(/steps? still open$/)
    expect(events[0]!['dedupe_key']).toMatch(/^playbook_steps_pending:event-\d+:\d{4}-\d{2}-\d{2}$/)
  })

  it('emits without a member link when the event has no affected member', async () => {
    makeSignal({ event_type: 'bereavement' })
    const { db, events } = makeDb({ profile: makeProfile(), members: [REPORTER, OTHER_ADULT] })

    await runChecklistReminderSweep(db)
    await new Promise((r) => setTimeout(r, 20))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'playbook_steps_pending', member_id: null, links: [] })
  })
})
