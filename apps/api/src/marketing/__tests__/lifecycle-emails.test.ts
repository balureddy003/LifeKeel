import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'

vi.mock('@sendgrid/mail', () => ({
  default: { setApiKey: vi.fn(), send: vi.fn().mockResolvedValue([{ statusCode: 202 }]) },
}))

import sgMail from '@sendgrid/mail'
import {
  ensureLifecycleIndexes,
  lifecycleSendsCol,
  runLifecycleSweep,
  unsubscribeToken,
  verifyUnsubscribeToken,
} from '../lifecycle-emails.js'
import { invalidatePlatformConfigCache } from '../../operator/platform-config.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const sgSend = vi.mocked(sgMail.send)

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('lifecycle-test')
  ensureLifecycleIndexes(db)
})

beforeEach(async () => {
  for (const name of await db.listCollections().toArray()) {
    await db.collection(name.name).deleteMany({})
  }
  invalidatePlatformConfigCache()
  process.env['SENDGRID_API_KEY'] = 'test-key'
  sgSend.mockClear().mockResolvedValue([{ statusCode: 202 }, {}] as never)
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

function seedLead(over: Record<string, unknown> = {}) {
  return db.collection('leads').insertOne({
    id: 'lead-1',
    email: 'lead@example.com',
    name: 'Pat Lee',
    stage: 'new',
    suppressed: false,
    score_band: 'mid',
    consent: { marketing: true },
    created_at: new Date(Date.now() - 2 * HOUR),
    ...over,
  })
}

describe('unsubscribe tokens', () => {
  it('round-trips and rejects tampered signatures', () => {
    const sig = unsubscribeToken('lead-1')
    expect(verifyUnsubscribeToken('lead-1', sig)).toBe(true)
    expect(verifyUnsubscribeToken('lead-1', sig.slice(0, -2) + 'xx')).toBe(false)
    expect(verifyUnsubscribeToken('other-lead', sig)).toBe(false)
  })
})

describe('runLifecycleSweep — lead nurture', () => {
  it('sends the welcome step to a fresh consenting lead and promotes stage to contacted', async () => {
    await seedLead()
    const sent = await runLifecycleSweep(db)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      sequence: 'lead_nurture',
      step: 'welcome',
      email: 'lead@example.com',
      status: 'sent',
    })
    expect((await db.collection('leads').findOne({ id: 'lead-1' }))!['stage']).toBe('contacted')
    expect(
      await db.collection('growth_events').countDocuments({ event: 'lifecycle_email_sent' }),
    ).toBe(1)
  })

  it('dedupes — the same step can never send twice', async () => {
    await seedLead()
    await runLifecycleSweep(db)
    expect(await runLifecycleSweep(db)).toHaveLength(0)
    expect(await lifecycleSendsCol(db).countDocuments()).toBe(1)
  })

  it('walks the sequence on schedule — one step per sweep, in order', async () => {
    await seedLead({ created_at: new Date(Date.now() - 8 * DAY) })
    // 8-day-old lead still starts at welcome; later steps follow one per sweep.
    expect((await runLifecycleSweep(db))[0]!['step']).toBe('welcome')
    expect((await runLifecycleSweep(db))[0]!['step']).toBe('day3')
    expect((await runLifecycleSweep(db))[0]!['step']).toBe('day7')
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })

  it('never emails a suppressed lead or one without marketing consent', async () => {
    await seedLead({ id: 'sup', email: 'sup@example.com', suppressed: true })
    await seedLead({ id: 'noconsent', email: 'nc@example.com', consent: { marketing: false } })
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })

  it('stops nurturing the moment the lead signs up', async () => {
    await seedLead()
    await db.collection('users').insertOne({
      id: 'u1',
      email: 'lead@example.com',
      status: 'active',
      tenant_id: 't1',
      created_at: new Date(),
    })
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })
})

describe('runLifecycleSweep — activation + upgrade', () => {
  it('nudges a user whose tenant still has no family profile after 48h', async () => {
    await db.collection('users').insertOne({
      id: 'u1',
      email: 'u@example.com',
      name: 'Uma',
      tenant_id: 't1',
      status: 'active',
      created_at: new Date(Date.now() - 3 * DAY),
    })
    const sent = await runLifecycleSweep(db)
    expect(sent.map((s) => s.sequence)).toEqual(['activation'])
    // With the profile in place, no nudge.
    await db.collection('family_financial_profile').insertOne({ tenant_id: 't1' })
    await lifecycleSendsCol(db).deleteMany({})
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })

  it('nudges an engaged free-tenant user toward paid — once', async () => {
    await db
      .collection('tenants')
      .insertOne({ tenant_id: 't1', plan: 'free', created_at: new Date(Date.now() - 10 * DAY) })
    await db.collection('users').insertOne({
      id: 'u1',
      email: 'u@example.com',
      name: 'Uma',
      tenant_id: 't1',
      status: 'active',
      created_at: new Date(Date.now() - 10 * DAY),
    })
    await db
      .collection('login_events')
      .insertMany([1, 2, 3].map(() => ({ user_id: 'u1', success: true, created_at: new Date() })))
    const sent = await runLifecycleSweep(db)
    expect(sent.map((s) => s.sequence)).toEqual(['upgrade'])
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })

  it('leaves paid tenants and dormant users alone', async () => {
    await db
      .collection('tenants')
      .insertOne({ tenant_id: 't1', plan: 'growth', created_at: new Date(Date.now() - 10 * DAY) })
    await db.collection('users').insertOne({
      id: 'u1',
      email: 'u@example.com',
      tenant_id: 't1',
      status: 'active',
      created_at: new Date(Date.now() - 10 * DAY),
    })
    await db
      .collection('login_events')
      .insertMany([1, 2, 3].map(() => ({ user_id: 'u1', success: true, created_at: new Date() })))
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })

  it('targets a free tenant that hit the paywall even without the login threshold', async () => {
    await db
      .collection('tenants')
      .insertOne({ tenant_id: 't1', plan: 'free', created_at: new Date(Date.now() - 10 * DAY) })
    await db.collection('users').insertOne({
      id: 'u1',
      email: 'u@example.com',
      tenant_id: 't1',
      status: 'active',
      created_at: new Date(Date.now() - 10 * DAY),
    })
    // Zero logins — but one document upload hit the extraction wall.
    await db.collection('growth_events').insertOne({
      event: 'upgrade_intent',
      meta: { tenant_id: 't1', feature: 'document_ai_extraction' },
      created_at: new Date(),
    })
    const sent = await runLifecycleSweep(db)
    expect(sent.map((s) => s.sequence)).toEqual(['upgrade'])
  })
})

describe('runLifecycleSweep — trial sequence', () => {
  it('emails a tenant whose trial ends within 72h — once', async () => {
    await db.collection('tenants').insertOne({
      tenant_id: 't1',
      plan: 'free',
      created_at: new Date(Date.now() - 12 * DAY),
      billing: { trial_ends_at: new Date(Date.now() + 2 * DAY), credits_balance: 40 },
    })
    await db.collection('users').insertOne({
      id: 'u1',
      email: 'u@example.com',
      name: 'Uma',
      tenant_id: 't1',
      status: 'active',
      created_at: new Date(Date.now() - 12 * DAY),
    })
    const sent = await runLifecycleSweep(db)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ sequence: 'trial', step: 'ending', email: 'u@example.com' })
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })

  it('sends the winback when a trial expired within the last 48h', async () => {
    await db.collection('tenants').insertOne({
      tenant_id: 't1',
      plan: 'free',
      created_at: new Date(Date.now() - 20 * DAY),
      billing: { trial_ends_at: new Date(Date.now() - DAY), trial_expired: true },
    })
    await db.collection('users').insertOne({
      id: 'u1',
      email: 'u@example.com',
      tenant_id: 't1',
      status: 'active',
      created_at: new Date(Date.now() - 20 * DAY),
    })
    const sent = await runLifecycleSweep(db)
    expect(sent[0]).toMatchObject({ sequence: 'trial', step: 'expired' })
  })

  it('does not generic-nudge a tenant mid-trial — the trial sequence owns them', async () => {
    await db.collection('tenants').insertOne({
      tenant_id: 't1',
      plan: 'free',
      created_at: new Date(Date.now() - 10 * DAY),
      billing: { trial_ends_at: new Date(Date.now() + 10 * DAY) }, // 10d out — too early for 'ending'
    })
    await db.collection('users').insertOne({
      id: 'u1',
      email: 'u@example.com',
      tenant_id: 't1',
      status: 'active',
      created_at: new Date(Date.now() - 10 * DAY),
    })
    await db
      .collection('login_events')
      .insertMany([1, 2, 3].map(() => ({ user_id: 'u1', success: true, created_at: new Date() })))
    // Engaged + free would normally trigger 'upgrade' — but the trial is live.
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })
})

describe('runLifecycleSweep — churned-tenant winback', () => {
  it('emails a churned tenant still on free — once, after the 3d grace window', async () => {
    await db
      .collection('tenants')
      .insertOne({ tenant_id: 't1', plan: 'free', created_at: new Date(Date.now() - 60 * DAY) })
    await db.collection('users').insertOne({
      id: 'u1',
      email: 'u@example.com',
      name: 'Uma',
      tenant_id: 't1',
      status: 'active',
      created_at: new Date(Date.now() - 60 * DAY),
    })
    await db.collection('audit_log').insertOne({
      action: 'billing.plan_downgraded',
      tenant_id: 't1',
      timestamp: new Date(Date.now() - 5 * DAY),
    })
    const sent = await runLifecycleSweep(db)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ sequence: 'winback', step: 'return', email: 'u@example.com' })
    // Once ever — a second sweep sends nothing.
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })

  it('leaves recent churns and re-subscribed tenants alone', async () => {
    // Too fresh (inside the 3d grace window) — tenant exists and is free,
    // only the timestamp excludes it.
    await db
      .collection('tenants')
      .insertOne({ tenant_id: 't1', plan: 'free', created_at: new Date(Date.now() - 60 * DAY) })
    await db.collection('audit_log').insertOne({
      action: 'billing.plan_downgraded',
      tenant_id: 't1',
      timestamp: new Date(Date.now() - 12 * HOUR),
    })
    // Re-subscribed — stripe_subscription_id back on the tenant.
    await db.collection('tenants').insertOne({
      tenant_id: 't2',
      plan: 'free',
      stripe_subscription_id: 'sub_1',
      created_at: new Date(Date.now() - 60 * DAY),
    })
    await db.collection('audit_log').insertOne({
      action: 'billing.plan_downgraded',
      tenant_id: 't2',
      timestamp: new Date(Date.now() - 5 * DAY),
    })
    await db.collection('users').insertMany([
      {
        id: 'u1',
        email: 'a@x.com',
        tenant_id: 't1',
        status: 'active',
        created_at: new Date(Date.now() - 60 * DAY),
      },
      {
        id: 'u2',
        email: 'b@x.com',
        tenant_id: 't2',
        status: 'active',
        created_at: new Date(Date.now() - 60 * DAY),
      },
    ])
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })
})

describe('minor exclusion (intent 09)', () => {
  async function seedMinorHousehold(memberOver: Record<string, unknown> = {}) {
    await db.collection('tenants').insertOne({
      tenant_id: 't1',
      plan: 'free',
      created_at: new Date(Date.now() - 12 * DAY),
      billing: { trial_ends_at: new Date(Date.now() + 2 * DAY) },
    })
    await db.collection('users').insertOne({
      id: 'kid-user',
      email: 'kid@example.com',
      name: 'Kit',
      tenant_id: 't1',
      status: 'active',
      created_at: new Date(Date.now() - 3 * DAY),
    })
    await db.collection('family_groups').insertOne({
      tenant_id: 't1',
      members: [
        { id: 'm-adult', user_id: 'adult-user', role: 'organizer', status: 'active' },
        { id: 'm-kid', user_id: 'kid-user', role: 'child', status: 'active', ...memberOver },
      ],
    })
  }

  it('never sends activation/trial mail to a user whose roster member is a child', async () => {
    await seedMinorHousehold()
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })

  it('excludes by DOB too — an adult-role member under 18 is still a minor', async () => {
    await seedMinorHousehold({
      role: 'adult',
      date_of_birth: new Date(Date.now() - 15 * 365 * DAY).toISOString().slice(0, 10),
    })
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })

  it('an 18th birthday restores eligibility', async () => {
    await seedMinorHousehold({
      role: 'adult',
      date_of_birth: new Date(Date.now() - 19 * 365 * DAY).toISOString().slice(0, 10),
    })
    const sent = await runLifecycleSweep(db)
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.every((s) => s.email === 'kid@example.com')).toBe(true)
  })
})

describe('global gates', () => {
  it('honors marketing_paused — zero sends, nothing claimed', async () => {
    await seedLead()
    await db.collection('platform_config').insertOne({ key: 'global', marketing_paused: true })
    invalidatePlatformConfigCache()
    expect(await runLifecycleSweep(db)).toHaveLength(0)
    expect(await lifecycleSendsCol(db).countDocuments()).toBe(0)
  })
})

describe('ledger honesty — provider acceptance gates the sent state', () => {
  it('with no SENDGRID_API_KEY the sweep claims nothing and sends nothing', async () => {
    delete process.env['SENDGRID_API_KEY']
    await seedLead()
    expect(await runLifecycleSweep(db)).toHaveLength(0)
    expect(sgSend).not.toHaveBeenCalled()
    // No half-claimed rows: a configured sweep later still mails the lead.
    expect(await lifecycleSendsCol(db).countDocuments()).toBe(0)
  })

  it('a provider rejection settles the row to failed with the error recorded', async () => {
    sgSend.mockRejectedValueOnce(new Error('sendgrid 503'))
    await seedLead()
    const sent = await runLifecycleSweep(db)
    expect(sent).toHaveLength(1)
    expect(sent[0]!['status']).toBe('failed')
    const row = await lifecycleSendsCol(db).findOne({ key: 'lead_nurture:welcome:lead-1' })
    expect(row!['status']).toBe('failed')
    expect(String(row!['error'])).toContain('sendgrid 503')
    // A send that never happened must not emit the sent metric.
    expect(
      await db.collection('growth_events').countDocuments({ event: 'lifecycle_email_sent' }),
    ).toBe(0)
  })

  it('a failed claim retries on a later sweep and can still land', async () => {
    sgSend.mockRejectedValueOnce(new Error('sendgrid 503'))
    await seedLead()
    await runLifecycleSweep(db)
    const retried = await runLifecycleSweep(db)
    expect(retried).toHaveLength(1)
    expect(retried[0]!['status']).toBe('sent')
    const row = await lifecycleSendsCol(db).findOne({ key: 'lead_nurture:welcome:lead-1' })
    expect(row!['status']).toBe('sent')
    expect(row!['attempts']).toBe(2)
    // One ledger row, not two — retries settle the same claim.
    expect(await lifecycleSendsCol(db).countDocuments()).toBe(1)
  })

  it('retry budget is bounded — a permanently failing send stops at MAX_SEND_ATTEMPTS', async () => {
    sgSend.mockRejectedValue(new Error('sendgrid down'))
    await seedLead()
    for (let i = 0; i < 4; i++) await runLifecycleSweep(db)
    const row = await lifecycleSendsCol(db).findOne({ key: 'lead_nurture:welcome:lead-1' })
    expect(row!['attempts']).toBe(3)
    expect(row!['status']).toBe('failed')
    expect(sgSend).toHaveBeenCalledTimes(3)
  })

  it('a settled sent row suppresses re-sends forever', async () => {
    await seedLead()
    await runLifecycleSweep(db)
    expect(await runLifecycleSweep(db)).toHaveLength(0)
    expect(sgSend).toHaveBeenCalledTimes(1)
  })
})

describe('promotional lifecycle opt-out', () => {
  it.each(['upgrade', 'winback'] as const)(
    'adds unsubscribe and honors opt-out for %s without suppressing account mail',
    async (sequence) => {
      await db
        .collection('tenants')
        .insertOne({ tenant_id: 't1', plan: 'free', created_at: new Date(Date.now() - 60 * DAY) })
      await db.collection('users').insertOne({
        id: 'u1',
        tenant_id: 't1',
        email: 'u@example.com',
        name: 'Uma',
        status: 'active',
        email_opt_out: true,
        created_at: new Date(Date.now() - 60 * DAY),
      })
      if (sequence === 'upgrade') {
        await db
          .collection('growth_events')
          .insertOne({ event: 'upgrade_intent', meta: { tenant_id: 't1' }, created_at: new Date() })
      } else {
        await db.collection('audit_log').insertOne({
          action: 'billing.plan_downgraded',
          tenant_id: 't1',
          timestamp: new Date(Date.now() - 5 * DAY),
        })
      }
      expect(await runLifecycleSweep(db)).toHaveLength(0)
      expect(sgSend).not.toHaveBeenCalled()
      await db.collection('users').updateOne({ id: 'u1' }, { $set: { email_opt_out: false } })
      const sent = await runLifecycleSweep(db, { appUrl: 'https://app.example' })
      expect(sent.map((s) => s.sequence)).toEqual([sequence])
      const data = sgSend.mock.calls[0]![0]
      const message = Array.isArray(data) ? data[0]! : data
      expect(message.html).toContain('>Unsubscribe</a>')
      expect(message.headers?.['List-Unsubscribe']).toContain('/users/unsubscribe?id=u1&sig=')

      await lifecycleSendsCol(db).deleteMany({})
      await db
        .collection('users')
        .updateOne(
          { id: 'u1' },
          { $set: { email_opt_out: true, created_at: new Date(Date.now() - 3 * DAY) } },
        )
      expect((await runLifecycleSweep(db)).map((s) => s.sequence)).toEqual(['activation'])
    },
  )
})
