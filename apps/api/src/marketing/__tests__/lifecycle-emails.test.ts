import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
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
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

function seedLead(over: Record<string, unknown> = {}) {
  return db.collection('leads').insertOne({
    id: 'lead-1', email: 'lead@example.com', name: 'Pat Lee',
    stage: 'new', suppressed: false, score_band: 'mid',
    consent: { marketing: true }, created_at: new Date(Date.now() - 2 * HOUR),
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
    expect(sent[0]).toMatchObject({ sequence: 'lead_nurture', step: 'welcome', email: 'lead@example.com', status: 'sent' })
    expect((await db.collection('leads').findOne({ id: 'lead-1' }))!['stage']).toBe('contacted')
    expect(await db.collection('growth_events').countDocuments({ event: 'lifecycle_email_sent' })).toBe(1)
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
    await db.collection('users').insertOne({ id: 'u1', email: 'lead@example.com', status: 'active', tenant_id: 't1', created_at: new Date() })
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })
})

describe('runLifecycleSweep — activation + upgrade', () => {
  it('nudges a user whose tenant still has no family profile after 48h', async () => {
    await db.collection('users').insertOne({
      id: 'u1', email: 'u@example.com', name: 'Uma', tenant_id: 't1', status: 'active',
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
    await db.collection('tenants').insertOne({ tenant_id: 't1', plan: 'free', created_at: new Date(Date.now() - 10 * DAY) })
    await db.collection('users').insertOne({
      id: 'u1', email: 'u@example.com', name: 'Uma', tenant_id: 't1', status: 'active',
      created_at: new Date(Date.now() - 10 * DAY),
    })
    await db.collection('login_events').insertMany(
      [1, 2, 3].map(() => ({ user_id: 'u1', success: true, created_at: new Date() })),
    )
    const sent = await runLifecycleSweep(db)
    expect(sent.map((s) => s.sequence)).toEqual(['upgrade'])
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })

  it('leaves paid tenants and dormant users alone', async () => {
    await db.collection('tenants').insertOne({ tenant_id: 't1', plan: 'growth', created_at: new Date(Date.now() - 10 * DAY) })
    await db.collection('users').insertOne({
      id: 'u1', email: 'u@example.com', tenant_id: 't1', status: 'active', created_at: new Date(Date.now() - 10 * DAY),
    })
    await db.collection('login_events').insertMany(
      [1, 2, 3].map(() => ({ user_id: 'u1', success: true, created_at: new Date() })),
    )
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })

  it('targets a free tenant that hit the paywall even without the login threshold', async () => {
    await db.collection('tenants').insertOne({ tenant_id: 't1', plan: 'free', created_at: new Date(Date.now() - 10 * DAY) })
    await db.collection('users').insertOne({
      id: 'u1', email: 'u@example.com', tenant_id: 't1', status: 'active', created_at: new Date(Date.now() - 10 * DAY),
    })
    // Zero logins — but one document upload hit the extraction wall.
    await db.collection('growth_events').insertOne({
      event: 'upgrade_intent', meta: { tenant_id: 't1', feature: 'document_ai_extraction' }, created_at: new Date(),
    })
    const sent = await runLifecycleSweep(db)
    expect(sent.map((s) => s.sequence)).toEqual(['upgrade'])
  })
})

describe('runLifecycleSweep — trial sequence', () => {
  it('emails a tenant whose trial ends within 72h — once', async () => {
    await db.collection('tenants').insertOne({
      tenant_id: 't1', plan: 'free', created_at: new Date(Date.now() - 12 * DAY),
      billing: { trial_ends_at: new Date(Date.now() + 2 * DAY), credits_balance: 40 },
    })
    await db.collection('users').insertOne({
      id: 'u1', email: 'u@example.com', name: 'Uma', tenant_id: 't1', status: 'active', created_at: new Date(Date.now() - 12 * DAY),
    })
    const sent = await runLifecycleSweep(db)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ sequence: 'trial', step: 'ending', email: 'u@example.com' })
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })

  it('sends the winback when a trial expired within the last 48h', async () => {
    await db.collection('tenants').insertOne({
      tenant_id: 't1', plan: 'free', created_at: new Date(Date.now() - 20 * DAY),
      billing: { trial_ends_at: new Date(Date.now() - DAY), trial_expired: true },
    })
    await db.collection('users').insertOne({
      id: 'u1', email: 'u@example.com', tenant_id: 't1', status: 'active', created_at: new Date(Date.now() - 20 * DAY),
    })
    const sent = await runLifecycleSweep(db)
    expect(sent[0]).toMatchObject({ sequence: 'trial', step: 'expired' })
  })

  it('does not generic-nudge a tenant mid-trial — the trial sequence owns them', async () => {
    await db.collection('tenants').insertOne({
      tenant_id: 't1', plan: 'free', created_at: new Date(Date.now() - 10 * DAY),
      billing: { trial_ends_at: new Date(Date.now() + 10 * DAY) }, // 10d out — too early for 'ending'
    })
    await db.collection('users').insertOne({
      id: 'u1', email: 'u@example.com', tenant_id: 't1', status: 'active', created_at: new Date(Date.now() - 10 * DAY),
    })
    await db.collection('login_events').insertMany(
      [1, 2, 3].map(() => ({ user_id: 'u1', success: true, created_at: new Date() })),
    )
    // Engaged + free would normally trigger 'upgrade' — but the trial is live.
    expect(await runLifecycleSweep(db)).toHaveLength(0)
  })
})

describe('runLifecycleSweep — churned-tenant winback', () => {
  it('emails a churned tenant still on free — once, after the 3d grace window', async () => {
    await db.collection('tenants').insertOne({ tenant_id: 't1', plan: 'free', created_at: new Date(Date.now() - 60 * DAY) })
    await db.collection('users').insertOne({
      id: 'u1', email: 'u@example.com', name: 'Uma', tenant_id: 't1', status: 'active', created_at: new Date(Date.now() - 60 * DAY),
    })
    await db.collection('audit_log').insertOne({
      action: 'billing.plan_downgraded', tenant_id: 't1', timestamp: new Date(Date.now() - 5 * DAY),
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
    await db.collection('tenants').insertOne({ tenant_id: 't1', plan: 'free', created_at: new Date(Date.now() - 60 * DAY) })
    await db.collection('audit_log').insertOne({
      action: 'billing.plan_downgraded', tenant_id: 't1', timestamp: new Date(Date.now() - 12 * HOUR),
    })
    // Re-subscribed — stripe_subscription_id back on the tenant.
    await db.collection('tenants').insertOne({
      tenant_id: 't2', plan: 'free', stripe_subscription_id: 'sub_1', created_at: new Date(Date.now() - 60 * DAY),
    })
    await db.collection('audit_log').insertOne({
      action: 'billing.plan_downgraded', tenant_id: 't2', timestamp: new Date(Date.now() - 5 * DAY),
    })
    await db.collection('users').insertMany([
      { id: 'u1', email: 'a@x.com', tenant_id: 't1', status: 'active', created_at: new Date(Date.now() - 60 * DAY) },
      { id: 'u2', email: 'b@x.com', tenant_id: 't2', status: 'active', created_at: new Date(Date.now() - 60 * DAY) },
    ])
    expect(await runLifecycleSweep(db)).toHaveLength(0)
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
