/**
 * PRD-130: the continuity state machine — watching → check_in_sent →
 * alerted, self-resetting on organizer activity, idempotent across runs.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { runContinuityCheck } from '../continuity-check.js'

const checkInEmail = vi.fn(async (..._args: unknown[]) => {})
const alertEmail = vi.fn(async (..._args: unknown[]) => {})
vi.mock('../../auth-email.js', () => ({
  sendContinuityCheckInEmail: (...args: unknown[]) => checkInEmail(...args),
  sendContinuityAlertEmail: (...args: unknown[]) => alertEmail(...args),
}))

const TENANT = 't-cont'

let groups: Record<string, unknown>[]
let users: Record<string, unknown>[]
let states: Record<string, unknown>[]

const ORG = { id: 'org-1', user_id: 'org-1', name: 'Balu', email: 'b@x.com', role: 'organizer', status: 'active', joined_at: '2026-01-01' }
const PARTNER = { id: 'partner-1', name: 'Sudha', email: 's@x.com', role: 'adult', status: 'active', joined_at: '2026-01-02' }
const KID = { id: 'kid-1', name: 'Nih', email: '', role: 'child', status: 'pending', joined_at: '2026-01-03' }

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000)
}

function resolveKey(doc: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, p) => (acc as Record<string, unknown>)?.[p], doc)
}
function match(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (k === '$or') return (v as Record<string, unknown>[]).some((c) => match(doc, c))
    return resolveKey(doc, k) === v
  })
}
function applyUpdate(doc: Record<string, unknown>, update: Record<string, unknown>) {
  for (const [k, v] of Object.entries((update['$set'] as Record<string, unknown>) ?? {})) doc[k] = v
  for (const k of Object.keys((update['$unset'] as Record<string, unknown>) ?? {})) delete doc[k]
}

function col(store: Record<string, unknown>[]) {
  return {
    findOne: async (filter: Record<string, unknown> = {}) => store.find((d) => match(d, filter)) ?? null,
    find: (filter: Record<string, unknown> = {}) => ({ toArray: async () => store.filter((d) => match(d, filter)) }),
    updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>, opts?: { upsert?: boolean }) => {
      const doc = store.find((d) => match(d, filter))
      if (doc) { applyUpdate(doc, update); return { modifiedCount: 1 } }
      if (opts?.upsert) { const d: Record<string, unknown> = { ...filter }; applyUpdate(d, update); store.push(d); return { upsertedCount: 1 } }
      return { modifiedCount: 0 }
    },
    updateMany: async () => ({ modifiedCount: 0 }),
    createIndex: async () => ({}),
  }
}

function makeDb() {
  return {
    collection: (name: string) =>
      name === 'family_groups' ? col(groups) : name === 'users' ? col(users) : name === 'family_continuity_state' ? col(states) : col([]),
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  users = [{ id: 'org-1', tenant_id: TENANT, email: 'b@x.com', name: 'Balu', last_seen_at: new Date() }]
  states = []
  groups = [{
    tenant_id: TENANT,
    id: 'fam-1',
    name: 'Kumars',
    members: [ORG, PARTNER, KID],
    continuity: { enabled: true, designated_member_ids: [PARTNER.id, KID.id], check_in_after_days: 30, grace_days: 14 },
  }]
})

describe('runContinuityCheck', () => {
  it('does nothing while the organizer is active inside the threshold', async () => {
    const s = await runContinuityCheck(makeDb() as never)
    expect(s.checkInsSent).toBe(0)
    expect(checkInEmail).not.toHaveBeenCalled()
    expect(alertEmail).not.toHaveBeenCalled()
  })

  it('sends the organizer a check-in after the inactivity threshold — once, not every run', async () => {
    users[0]!['last_seen_at'] = daysAgo(45)
    const db = makeDb()
    let s = await runContinuityCheck(db as never)
    expect(s.checkInsSent).toBe(1)
    expect(checkInEmail).toHaveBeenCalledWith('b@x.com', 'Balu', 45, expect.any(String))
    expect(states[0]?.['phase']).toBe('check_in_sent')

    // Second run same state — idempotent, no re-send.
    s = await runContinuityCheck(db as never)
    expect(s.checkInsSent).toBe(0)
    expect(checkInEmail).toHaveBeenCalledTimes(1)
  })

  it('alerts designated adult members after threshold + grace — children and pending members skipped', async () => {
    users[0]!['last_seen_at'] = daysAgo(50) // 30 + 14 = 44 < 50
    states = [{ tenant_id: TENANT, phase: 'check_in_sent', check_in_sent_at: daysAgo(20), inactive_since: daysAgo(50) }]
    const s = await runContinuityCheck(makeDb() as never)
    expect(s.alertsSent).toBe(1) // partner only — the kid is pending + child + no email
    expect(alertEmail).toHaveBeenCalledWith('s@x.com', 'Sudha', 'Balu', 50, expect.any(String))
    expect(states[0]?.['phase']).toBe('alerted')
  })

  it('organizer activity silently resets the whole machine — even after alerting', async () => {
    states = [{ tenant_id: TENANT, phase: 'alerted', alerted_at: daysAgo(1), inactive_since: daysAgo(50) }]
    users[0]!['last_seen_at'] = new Date() // they're back
    const s = await runContinuityCheck(makeDb() as never)
    expect(s.reset).toBe(1)
    expect(states[0]?.['phase']).toBe('watching')
    expect(states[0]?.['alerted_at']).toBeUndefined()
    expect(alertEmail).not.toHaveBeenCalled()
  })

  it('a family with the switch disabled is never touched', async () => {
    groups[0]!['continuity'] = { enabled: false, designated_member_ids: [], check_in_after_days: 30, grace_days: 14 }
    users[0]!['last_seen_at'] = daysAgo(200)
    const s = await runContinuityCheck(makeDb() as never)
    expect(s.families).toBe(0)
    expect(checkInEmail).not.toHaveBeenCalled()
  })

  it('falls back to joined_at for an organizer with no user record seen', async () => {
    users = []
    groups[0]!['members'] = [{ ...ORG, joined_at: daysAgo(60).toISOString() }, PARTNER]
    const s = await runContinuityCheck(makeDb() as never)
    expect(s.checkInsSent).toBe(1) // inactive since join — no email possible, but the phase advances
    expect(checkInEmail).not.toHaveBeenCalled() // no user record → no email address
  })
})
