/**
 * Crisis-release re-scope: maybeSendVaultReminder is a Tier-3 notification
 * only — no access change, no token, no autonomous release. Verifies it
 * fires for the three qualifying event types when the vault has documents,
 * stays silent otherwise, and doesn't double-send while a reminder is
 * still open.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { maybeSendVaultReminder } from '../vault-reminder.js'

const sendMock = vi.fn(async (_msg: { to: string }) => {})
vi.mock('@sendgrid/mail', () => ({
  default: { setApiKey: vi.fn(), send: (msg: { to: string }) => sendMock(msg) },
}))

const TENANT = 'tenant-vault-reminder'

interface FakeInsight extends Record<string, unknown> {
  detector_id: string
  state: string
}

function makeDb(opts: {
  vaultDocCount: number
  members: Array<{ id: string; name: string; email: string; role: string; status: string }>
  existingInsights?: FakeInsight[]
}) {
  const insights: FakeInsight[] = opts.existingInsights ? [...opts.existingInsights] : []
  const documentsCol = {
    countDocuments: async (filter: Record<string, unknown>) =>
      filter['category'] === 'estate_vault' ? opts.vaultDocCount : 0,
  }
  const familyGroupsCol = {
    findOne: async () => ({ tenant_id: TENANT, members: opts.members }),
  }
  const insightsCol = {
    findOne: async (filter: Record<string, unknown>) =>
      insights.find((i) =>
        i['detector_id'] === filter['detector_id'] &&
        (filter['state'] as { $in: string[] } | undefined)?.$in.includes(i['state']),
      ) ?? null,
    insertOne: async (doc: FakeInsight) => { insights.push(doc); return { insertedId: doc['id'] } },
  }
  const db = {
    collection: (name: string) => {
      if (name === 'family_groups') return familyGroupsCol
      if (name === 'insights') return insightsCol
      return documentsCol
    },
  }
  return { db: db as any, insights }
}

const ADULT_1 = { id: 'reporter', name: 'Balu Reddy', email: 'balu@example.com', role: 'organizer', status: 'active' }
const ADULT_2 = { id: 'adult-2', name: 'Sudha Reddy', email: 'sudha@example.com', role: 'parent', status: 'active' }
const CHILD = { id: 'child-1', name: 'Nihaan', email: 'nihaan@example.com', role: 'child', status: 'active' }
const PENDING_ADULT = { id: 'pending-1', name: 'Aunt Priya', email: 'priya@example.com', role: 'adult', status: 'pending' }

describe('maybeSendVaultReminder', () => {
  beforeEach(() => {
    sendMock.mockClear()
    process.env['SENDGRID_API_KEY'] = 'test-key'
  })

  it('emails every other active adult and creates exactly one insight for a qualifying event', async () => {
    const { db, insights } = makeDb({ vaultDocCount: 2, members: [ADULT_1, ADULT_2, CHILD, PENDING_ADULT] })
    await maybeSendVaultReminder(db, TENANT, 'bereavement', 'event-1', ADULT_1.id, 'Bereavement Response Plan')

    expect(sendMock).toHaveBeenCalledTimes(1) // only ADULT_2 — child excluded, pending excluded, reporter excluded
    expect(sendMock.mock.calls[0]![0]).toMatchObject({ to: ADULT_2.email })
    expect(insights).toHaveLength(1)
    expect(insights[0]!['detector_id']).toBe('family_vault_reminder')
    expect(insights[0]!['reasoning']).toContain('Bereavement Response Plan')
    expect(insights[0]!['reasoning']).toContain('2 documents')
  })

  it('does nothing for a job_loss/car/property event, regardless of vault contents', async () => {
    const { db } = makeDb({ vaultDocCount: 5, members: [ADULT_1, ADULT_2] })
    await maybeSendVaultReminder(db, TENANT, 'job_loss', 'event-2', ADULT_1.id, 'Job Loss Response Plan')
    await maybeSendVaultReminder(db, TENANT, 'car', 'event-3', ADULT_1.id, 'Car Accident Response Plan')
    await maybeSendVaultReminder(db, TENANT, 'property', 'event-4', ADULT_1.id, 'Property Damage Response Plan')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('does nothing when the vault has no documents', async () => {
    const { db, insights } = makeDb({ vaultDocCount: 0, members: [ADULT_1, ADULT_2] })
    await maybeSendVaultReminder(db, TENANT, 'medical', 'event-5', ADULT_1.id, 'Medical Emergency Response Plan')
    expect(sendMock).not.toHaveBeenCalled()
    expect(insights).toHaveLength(0)
  })

  it('does not double-send while a reminder insight is still open', async () => {
    const { db } = makeDb({
      vaultDocCount: 1,
      members: [ADULT_1, ADULT_2],
      existingInsights: [{ id: 'existing', tenant_id: TENANT, detector_id: 'family_vault_reminder', state: 'identified' }],
    })
    await maybeSendVaultReminder(db, TENANT, 'disability', 'event-6', ADULT_1.id, 'Disability / Critical-Illness Response Plan')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('sends again once the previous reminder was dismissed (state no longer open)', async () => {
    const { db } = makeDb({
      vaultDocCount: 1,
      members: [ADULT_1, ADULT_2],
      existingInsights: [{ id: 'existing', tenant_id: TENANT, detector_id: 'family_vault_reminder', state: 'dismissed' }],
    })
    await maybeSendVaultReminder(db, TENANT, 'disability', 'event-7', ADULT_1.id, 'Disability / Critical-Illness Response Plan')
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when the reporter is the only adult on the roster', async () => {
    const { db } = makeDb({ vaultDocCount: 1, members: [ADULT_1, CHILD] })
    await maybeSendVaultReminder(db, TENANT, 'bereavement', 'event-8', ADULT_1.id, 'Bereavement Response Plan')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('never emails a child or a pending member', async () => {
    const { db } = makeDb({ vaultDocCount: 1, members: [ADULT_1, ADULT_2, CHILD, PENDING_ADULT] })
    await maybeSendVaultReminder(db, TENANT, 'medical', 'event-9', ADULT_1.id, 'Medical Emergency Response Plan')
    const recipients = sendMock.mock.calls.map((c) => (c[0] as { to: string }).to)
    expect(recipients).not.toContain(CHILD.email)
    expect(recipients).not.toContain(PENDING_ADULT.email)
  })

  it('skips sending (but does not throw) when SENDGRID_API_KEY is not configured', async () => {
    delete process.env['SENDGRID_API_KEY']
    const { db, insights } = makeDb({ vaultDocCount: 1, members: [ADULT_1, ADULT_2] })
    await expect(
      maybeSendVaultReminder(db, TENANT, 'medical', 'event-10', ADULT_1.id, 'Medical Emergency Response Plan'),
    ).resolves.not.toThrow()
    expect(sendMock).not.toHaveBeenCalled()
    // The insight (the in-app half of the reminder) still gets created even
    // when email delivery isn't configured — informational record stays
    // independent of whether the email channel is set up.
    expect(insights).toHaveLength(1)
  })
})
