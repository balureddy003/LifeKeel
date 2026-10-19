import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  campaignsCol,
  ensureCampaignIndexes,
  resolveAudience,
  sendCampaign,
  type CampaignDoc,
} from '../campaigns.js'
import {
  lifecycleSendsCol,
  userUnsubscribeToken,
  verifyUserUnsubscribeToken,
} from '../lifecycle-emails.js'
import { invalidatePlatformConfigCache } from '../../operator/platform-config.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

const DAY = 24 * 60 * 60 * 1000

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('campaigns-test')
  ensureCampaignIndexes(db)
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

function seedUser(over: Record<string, unknown> = {}) {
  return db.collection('users').insertOne({
    id: 'u1',
    email: 'user@example.com',
    name: 'Sam Keel',
    tenant_id: 't1',
    status: 'active',
    created_at: new Date(Date.now() - 10 * DAY),
    ...over,
  })
}

function seedLead(over: Record<string, unknown> = {}) {
  return db.collection('leads').insertOne({
    id: 'lead-1',
    email: 'lead@example.com',
    name: 'Pat Lee',
    stage: 'new',
    suppressed: false,
    consent: { marketing: true },
    created_at: new Date(Date.now() - 2 * DAY),
    ...over,
  })
}

function makeCampaign(over: Partial<CampaignDoc> = {}): CampaignDoc {
  return {
    id: 'c1',
    name: 'Test blast',
    subject: 'Hi there',
    body_text: 'Hello {{first_name}},\n\nSomething happened.',
    filter: { audience: 'both' },
    status: 'draft',
    created_by: 'op-1',
    created_at: new Date(),
    ...over,
  }
}

describe('user unsubscribe tokens', () => {
  it('round-trips and rejects tampered signatures', () => {
    const sig = userUnsubscribeToken('u1')
    expect(verifyUserUnsubscribeToken('u1', sig)).toBe(true)
    expect(verifyUserUnsubscribeToken('u1', sig.slice(0, -2) + 'xx')).toBe(false)
    expect(verifyUserUnsubscribeToken('u2', sig)).toBe(false)
    // A lead token must not verify as a user token on the same id
    expect(verifyUserUnsubscribeToken('u1', userUnsubscribeToken('u1') + 'x')).toBe(false)
  })
})

describe('resolveAudience', () => {
  it('users audience skips suspended and email_opt_out users', async () => {
    await seedUser()
    await seedUser({ id: 'u2', email: 'opted@example.com', email_opt_out: true })
    await seedUser({ id: 'u3', email: 'susp@example.com', status: 'suspended' })
    const r = await resolveAudience(db, { audience: 'users' })
    expect(r.map((x) => x.id)).toEqual(['u1'])
  })

  it('plan + trialing filters join through tenants', async () => {
    await seedUser()
    await seedUser({ id: 'u2', email: 'paid@example.com', tenant_id: 't2' })
    await seedUser({ id: 'u3', email: 'trial@example.com', tenant_id: 't3' })
    await db.collection('tenants').insertMany([
      { tenant_id: 't1', plan: 'free' },
      { tenant_id: 't2', plan: 'starter' },
      { tenant_id: 't3', plan: 'free', billing: { trial_ends_at: new Date(Date.now() + 5 * DAY) } },
    ])
    const free = await resolveAudience(db, { audience: 'users', plans: ['free'] })
    expect(free.map((x) => x.id).sort()).toEqual(['u1', 'u3'])
    const trial = await resolveAudience(db, { audience: 'users', trialing: true })
    expect(trial.map((x) => x.id)).toEqual(['u3'])
  })

  it('has_profile filter matches family_financial_profile presence', async () => {
    await seedUser()
    await seedUser({ id: 'u2', email: 'noprof@example.com', tenant_id: 't2' })
    await db.collection('tenants').insertMany([{ tenant_id: 't1' }, { tenant_id: 't2' }])
    await db.collection('family_financial_profile').insertOne({ tenant_id: 't1' })
    const yes = await resolveAudience(db, { audience: 'users', has_profile: true })
    expect(yes.map((x) => x.id)).toEqual(['u1'])
    const no = await resolveAudience(db, { audience: 'users', has_profile: false })
    expect(no.map((x) => x.id)).toEqual(['u2'])
  })

  it('users audience hard-excludes members who are minors (intent 09)', async () => {
    await seedUser() // u1 on t1 — linked to a child roster member
    await seedUser({ id: 'u2', email: 'parent@example.com' })
    await db.collection('family_groups').insertOne({
      tenant_id: 't1',
      members: [
        { id: 'm-adult', user_id: 'u2', role: 'organizer', status: 'active' },
        { id: 'm-kid', user_id: 'u1', role: 'child', status: 'active' },
      ],
    })
    const r = await resolveAudience(db, { audience: 'users' })
    expect(r.map((x) => x.id)).toEqual(['u2'])
  })

  it('excludes an adult-role member whose DOB is under 18', async () => {
    await seedUser()
    await db.collection('family_groups').insertOne({
      tenant_id: 't1',
      members: [
        {
          id: 'm-1',
          user_id: 'u1',
          role: 'adult',
          status: 'active',
          date_of_birth: new Date(Date.now() - 15 * 365 * DAY).toISOString().slice(0, 10),
        },
      ],
    })
    expect(await resolveAudience(db, { audience: 'users' })).toEqual([])
  })

  it('leads audience requires consent and honors suppression + stages', async () => {
    await seedLead()
    await seedLead({ id: 'l2', email: 'noconsent@example.com', consent: { marketing: false } })
    await seedLead({ id: 'l3', email: 'supp@example.com', suppressed: true })
    await seedLead({ id: 'l4', email: 'converted@example.com', stage: 'converted' })
    const r = await resolveAudience(db, { audience: 'leads' })
    expect(r.map((x) => x.id)).toEqual(['lead-1'])
    const withConverted = await resolveAudience(db, {
      audience: 'leads',
      lead_stages: ['converted'],
    })
    expect(withConverted.map((x) => x.id)).toEqual(['l4'])
  })
})

describe('sendCampaign', () => {
  it('sends to both sides, claims ledger keys, records stats', async () => {
    await seedUser()
    await seedLead()
    const campaign = makeCampaign()
    await campaignsCol(db).insertOne(campaign)
    const stats = await sendCampaign(db, campaign)
    expect(stats).toEqual({ targeted: 2, sent: 2, failed: 0 })
    const sends = await lifecycleSendsCol(db).find({ sequence: 'campaign' }).toArray()
    expect(sends.map((s) => s.key).sort()).toEqual(['campaign:c1:lead-1', 'campaign:c1:u1'])
  })

  it('never double-mails — a second send attempts no recipients already claimed', async () => {
    await seedUser()
    const campaign = makeCampaign()
    await campaignsCol(db).insertOne(campaign)
    await sendCampaign(db, campaign)
    // Simulate a partial resend (e.g. rolled-back draft): the claimed ledger
    // key skips the already-mailed user even though they still match.
    const stats = await sendCampaign(db, campaign)
    expect(stats?.targeted).toBe(1)
    expect(stats?.sent).toBe(0)
    expect(await lifecycleSendsCol(db).countDocuments({ sequence: 'campaign' })).toBe(1)
  })

  it('halts entirely when marketing_paused is set', async () => {
    await seedUser()
    await db.collection('platform_config').insertOne({ key: 'global', marketing_paused: true })
    invalidatePlatformConfigCache()
    await expect(sendCampaign(db, makeCampaign())).rejects.toThrow('marketing_paused')
    expect(await lifecycleSendsCol(db).countDocuments({})).toBe(0)
  })
})
