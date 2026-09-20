/**
 * Policy renewal reminders — Tier 3 automatic action lifecycle.
 *
 * Exercises the real MongoDB semantics that matter here: the dedupe_key
 * unique index (re-runs never double-schedule), the scheduled → sending
 * atomic claim (concurrent runs can't double-send), and execution-time
 * re-verification of consent + evidence (a reminder whose policy changed
 * or whose tenant opted out is cancelled, not sent).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { ensureReminderIndexes, runPolicyRenewalReminders, type PolicyReminderDoc } from '../policy-renewal-reminders.js'

const TENANT = 'tenant-1'

type DeliverFn = (tenantId: string, reminder: { id: string; title: string; body: string; url: string }) => Promise<'sent' | 'deferred' | 'failed' | 'no_channel'>

const sendOk: DeliverFn = async () => 'sent'

function profile(policies: Array<Record<string, unknown>>) {
  return { tenant_id: TENANT, policies }
}

function policy(overrides: Record<string, unknown> = {}) {
  return {
    type: 'life',
    provider: 'Aviva',
    renewal_date: '2099-06-01',
    ...overrides,
  }
}

describe('runPolicyRenewalReminders', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
    db = client.db('reminders_test')
    await ensureReminderIndexes(db)
    // The feature is opt-in — most tests exercise the enabled path.
    await db.collection('tenant_settings').insertOne({
      tenant_id: TENANT,
      automation: { renewal_reminders_enabled: true },
    })
  })

  afterEach(async () => {
    await client.close()
    await mongod.stop()
    vi.unstubAllGlobals()
  })

  it('schedules one reminder per lead day for a policy with a future renewal', async () => {
    await db.collection('family_financial_profile').insertOne(profile([policy()]))
    const summary = await runPolicyRenewalReminders(db, sendOk, { now: new Date('2099-01-01') })

    const docs = await db.collection<PolicyReminderDoc>('reminders').find({}).toArray()
    expect(docs).toHaveLength(2) // default leads: 30d + 7d
    expect(docs.every((d) => d.status === 'scheduled')).toBe(true)
    expect(summary.scheduled).toBe(2)
  })

  it('is idempotent — a second run schedules nothing new', async () => {
    await db.collection('family_financial_profile').insertOne(profile([policy()]))
    const now = new Date('2099-01-01')
    await runPolicyRenewalReminders(db, sendOk, { now })
    await runPolicyRenewalReminders(db, sendOk, { now: new Date('2099-01-02') })

    expect(await db.collection('reminders').countDocuments({})).toBe(2)
  })

  it('sends a due reminder and marks it sent', async () => {
    const deliver = vi.fn(sendOk)
    await db.collection('family_financial_profile').insertOne(profile([policy()]))
    // Renewing in 5 days: both the 30d and 7d reminders are already due.
    const now = new Date('2099-05-27')
    const summary = await runPolicyRenewalReminders(db, deliver, { now })

    expect(deliver).toHaveBeenCalledTimes(2)
    expect(summary.sent).toBe(2)
    expect(await db.collection('reminders').countDocuments({ status: 'sent' })).toBe(2)
  })

  it('does not send a reminder whose due date is still in the future', async () => {
    const deliver = vi.fn(sendOk)
    await db.collection('family_financial_profile').insertOne(profile([policy()]))
    // 25 days out: the 7d reminder isn't due yet.
    const summary = await runPolicyRenewalReminders(db, deliver, { now: new Date('2099-05-07') })

    expect(deliver).toHaveBeenCalledTimes(1)
    expect(summary.sent).toBe(1)
    expect(await db.collection('reminders').countDocuments({ status: 'scheduled' })).toBe(1)
  })

  it('cancels scheduled reminders when the policy renewal date changes', async () => {
    await db.collection('family_financial_profile').insertOne(profile([policy()]))
    await runPolicyRenewalReminders(db, sendOk, { now: new Date('2099-01-01') })

    await db.collection('family_financial_profile').updateOne(
      { tenant_id: TENANT },
      { $set: { 'policies.0.renewal_date': '2099-09-15' } },
    )
    const summary = await runPolicyRenewalReminders(db, sendOk, { now: new Date('2099-01-02') })

    expect(summary.cancelled).toBe(2)
    const cancelled = await db.collection<PolicyReminderDoc>('reminders').find({ status: 'cancelled' }).toArray()
    expect(cancelled).toHaveLength(2)
    expect(cancelled.every((d) => d.cancelled_reason === 'policy_changed')).toBe(true)
    // And the new date got its own reminders
    expect(await db.collection('reminders').countDocuments({ status: 'scheduled', renewal_date: '2099-09-15' })).toBe(2)
  })

  it('cancels everything scheduled when the tenant disables renewal reminders', async () => {
    await db.collection('family_financial_profile').insertOne(profile([policy()]))
    await runPolicyRenewalReminders(db, sendOk, { now: new Date('2099-01-01') })

    await db.collection('tenant_settings').updateOne(
      { tenant_id: TENANT },
      { $set: { 'automation.renewal_reminders_enabled': false } },
    )
    const summary = await runPolicyRenewalReminders(db, sendOk, { now: new Date('2099-05-27') })

    expect(summary.cancelled).toBe(2)
    expect(summary.sent).toBe(0)
    expect(await db.collection('reminders').countDocuments({ status: 'cancelled', cancelled_reason: 'reminders_disabled' })).toBe(2)
  })

  it('re-verifies evidence at dispatch: a reminder whose policy vanished mid-flight is cancelled, not sent', async () => {
    const deliver = vi.fn(sendOk)
    await db.collection('family_financial_profile').insertOne(profile([policy()]))
    await runPolicyRenewalReminders(db, sendOk, { now: new Date('2099-01-01') })

    // Policy removed between scheduling and dispatch.
    await db.collection('family_financial_profile').updateOne({ tenant_id: TENANT }, { $set: { policies: [] } })
    const summary = await runPolicyRenewalReminders(db, deliver, { now: new Date('2099-05-27') })

    expect(deliver).not.toHaveBeenCalled()
    expect(summary.sent).toBe(0)
  })

  it('never resurrects a user-cancelled reminder on re-run', async () => {
    await db.collection('family_financial_profile').insertOne(profile([policy()]))
    await runPolicyRenewalReminders(db, sendOk, { now: new Date('2099-01-01') })

    await db.collection('reminders').updateMany({}, { $set: { status: 'cancelled', cancelled_reason: 'user_cancelled' } })
    await runPolicyRenewalReminders(db, sendOk, { now: new Date('2099-05-27') })

    expect(await db.collection('reminders').countDocuments({ status: 'cancelled' })).toBe(2)
    expect(await db.collection('reminders').countDocuments({ status: 'scheduled' })).toBe(0)
  })

  it('a failed send retries with backoff, then fails permanently after max attempts', async () => {
    const deliver = vi.fn(async () => 'failed' as const)
    await db.collection('family_financial_profile').insertOne(profile([policy()]))

    const now = new Date('2099-05-27')
    await runPolicyRenewalReminders(db, deliver, { now })
    let doc = await db.collection<PolicyReminderDoc>('reminders').findOne({ status: 'scheduled' })
    expect(doc!.attempts).toBe(1)
    expect(doc!.next_attempt_at!.getTime()).toBeGreaterThan(now.getTime())

    // Burn through the remaining attempts — each run steps 12h forward,
    // always past the (attempts × 1h, max 5h) backoff.
    for (let i = 2; i <= 7; i++) {
      await runPolicyRenewalReminders(db, deliver, { now: new Date(now.getTime() + i * 12 * 60 * 60 * 1000) })
    }
    doc = await db.collection<PolicyReminderDoc>('reminders').findOne({ status: 'failed' })
    expect(doc).not.toBeNull()
    expect(doc!.attempts).toBe(6)
  })

  it('quiet-hours deferral leaves the reminder scheduled without burning an attempt', async () => {
    const deliver = vi.fn(async () => 'deferred' as const)
    await db.collection('family_financial_profile').insertOne(profile([policy()]))
    const summary = await runPolicyRenewalReminders(db, deliver, { now: new Date('2099-05-27') })

    expect(summary.deferred).toBe(2)
    const doc = await db.collection<PolicyReminderDoc>('reminders').findOne({ status: 'scheduled' })
    expect(doc!.attempts).toBe(0)
  })

  it('two concurrent runs cannot double-send the same reminder', async () => {
    const deliver = vi.fn(sendOk)
    await db.collection('family_financial_profile').insertOne(profile([policy()]))
    const now = new Date('2099-05-27')

    await Promise.all([
      runPolicyRenewalReminders(db, deliver, { now }),
      runPolicyRenewalReminders(db, deliver, { now }),
    ])

    // Two reminders, each claimed atomically once — exactly two sends total.
    expect(deliver).toHaveBeenCalledTimes(2)
    const sent = await db.collection('reminders').countDocuments({ status: 'sent' })
    expect(sent).toBe(2)
  })

  it('recovers a crashed "sending" claim after the stale window', async () => {
    const deliver = vi.fn(sendOk)
    await db.collection('family_financial_profile').insertOne(profile([policy()]))
    const now = new Date('2099-05-27')
    await runPolicyRenewalReminders(db, sendOk, { now: new Date('2099-01-01') })

    // Simulate a crash between claim and outcome: claim sits in 'sending'.
    await db.collection('reminders').updateMany(
      { status: 'scheduled' },
      { $set: { status: 'sending', updated_at: new Date(now.getTime() - 20 * 60 * 1000) } },
    )
    // A fresh claim (10m window) must NOT be stolen — only the stale one is.
    // Both claims here are 20m old, so both are stale and get recovered.
    const summary = await runPolicyRenewalReminders(db, deliver, { now })

    expect(deliver).toHaveBeenCalledTimes(2)
    expect(summary.sent).toBe(2)
  })

  it('does not steal a fresh "sending" claim held by another worker', async () => {
    const deliver = vi.fn(sendOk)
    await db.collection('family_financial_profile').insertOne(profile([policy()]))
    const now = new Date('2099-05-27')
    await runPolicyRenewalReminders(db, sendOk, { now: new Date('2099-01-01') })

    // Claimed 1 minute ago — still within the stale window.
    await db.collection('reminders').updateMany(
      { status: 'scheduled' },
      { $set: { status: 'sending', updated_at: new Date(now.getTime() - 60 * 1000) } },
    )
    const summary = await runPolicyRenewalReminders(db, deliver, { now })

    expect(deliver).not.toHaveBeenCalled()
    expect(summary.sent).toBe(0)
  })

  it('does nothing for a tenant who never opted in — autonomy is off by default', async () => {
    await db.collection('tenant_settings').deleteMany({})
    const deliver = vi.fn(sendOk)
    await db.collection('family_financial_profile').insertOne(profile([policy()]))
    const summary = await runPolicyRenewalReminders(db, deliver, { now: new Date('2099-05-27') })

    expect(deliver).not.toHaveBeenCalled()
    expect(summary.scheduled).toBe(0)
    expect(await db.collection('reminders').countDocuments({})).toBe(0)
  })

  it('honors custom lead days from tenant settings', async () => {
    await db.collection('family_financial_profile').insertOne(profile([policy()]))
    await db.collection('tenant_settings').updateOne(
      { tenant_id: TENANT },
      { $set: { 'automation.renewal_reminder_lead_days': [14] } },
    )
    await runPolicyRenewalReminders(db, sendOk, { now: new Date('2099-01-01') })

    const docs = await db.collection<PolicyReminderDoc>('reminders').find({}).toArray()
    expect(docs).toHaveLength(1)
    expect(docs[0]!.lead_days).toBe(14)
  })
})
