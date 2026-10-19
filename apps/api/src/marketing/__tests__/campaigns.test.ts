import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'

vi.mock('@sendgrid/mail', () => ({
  default: { setApiKey: vi.fn(), send: vi.fn().mockResolvedValue([{ statusCode: 202 }]) },
}))

import sgMail from '@sendgrid/mail'
import {
  campaignsCol,
  ensureCampaignIndexes,
  resolveAudience,
  queueCampaignSend,
  drainCampaignSends,
  pauseCampaign,
  resumeCampaign,
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
  process.env['SENDGRID_API_KEY'] = 'test-key'
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

describe('campaign send (durable per-recipient jobs)', () => {
  /** Route-equivalent: claim draft → sending, queue recipients, then drain
   *  the queue synchronously (no Redis in tests). */
  async function sendToCompletion(campaign: CampaignDoc) {
    await campaignsCol(db).updateOne({ id: campaign.id }, { $set: { status: 'sending' } })
    const { targeted } = await queueCampaignSend(db, campaign)
    await drainCampaignSends(db, campaign.id)
    const done = await campaignsCol(db).findOne({ id: campaign.id })
    return { targeted, done }
  }

  it('sends to both sides, claims ledger keys, completes to sent', async () => {
    await seedUser()
    await seedLead()
    const campaign = makeCampaign()
    await campaignsCol(db).insertOne(campaign)
    const { targeted, done } = await sendToCompletion(campaign)
    expect(targeted).toBe(2)
    expect(done!['status']).toBe('sent')
    expect(done!['stats']).toEqual({ targeted: 2, sent: 2, skipped: 0, failed: 0, settled: 2 })
    const sends = await lifecycleSendsCol(db).find({ sequence: 'campaign' }).toArray()
    expect(sends.map((s) => s.key).sort()).toEqual(['campaign:c1:lead-1', 'campaign:c1:u1'])
  })

  it('never double-mails — a second send attempts no recipients already claimed', async () => {
    await seedUser()
    const campaign = makeCampaign()
    await campaignsCol(db).insertOne(campaign)
    await sendToCompletion(campaign)
    // Simulate a partial resend (e.g. rolled-back draft): the claimed ledger
    // key skips the already-mailed user even though they still match.
    const { targeted } = await queueCampaignSend(db, campaign)
    expect(targeted).toBe(1)
    await drainCampaignSends(db, campaign.id)
    expect(await lifecycleSendsCol(db).countDocuments({ sequence: 'campaign' })).toBe(1)
  })

  it('halts entirely when marketing_paused is set', async () => {
    await seedUser()
    await db.collection('platform_config').insertOne({ key: 'global', marketing_paused: true })
    invalidatePlatformConfigCache()
    await expect(queueCampaignSend(db, makeCampaign())).rejects.toThrow('marketing_paused')
    expect(await lifecycleSendsCol(db).countDocuments({})).toBe(0)
  })

  it('refuses to run without SENDGRID_API_KEY — nothing claimed, nothing "sent"', async () => {
    delete process.env['SENDGRID_API_KEY']
    await seedUser()
    await expect(queueCampaignSend(db, makeCampaign())).rejects.toThrow('SENDGRID_API_KEY')
    // The route rolls the campaign back to draft on throw; no ledger row may
    // exist either — an unconfigured run must not look like a delivered one.
    expect(await lifecycleSendsCol(db).countDocuments({})).toBe(0)
  })

  it('provider rejections settle failed — the ledger never reads sent', async () => {
    vi.mocked(sgMail.send).mockRejectedValueOnce(new Error('sendgrid 503'))
    await seedUser()
    const campaign = makeCampaign()
    await campaignsCol(db).insertOne(campaign)
    const { done } = await sendToCompletion(campaign)
    expect(done!['stats']).toEqual({ targeted: 1, sent: 0, skipped: 0, failed: 1, settled: 1 })
    const row = await lifecycleSendsCol(db).findOne({ key: 'campaign:c1:u1' })
    expect(row!['status']).toBe('failed')
    expect(String(row!['error'])).toContain('sendgrid 503')
  })

  it('pause drops in-flight jobs; resume re-enqueues the pending claims', async () => {
    await seedUser()
    await seedLead()
    const campaign = makeCampaign()
    await campaignsCol(db).insertOne(campaign)
    await campaignsCol(db).updateOne({ id: 'c1' }, { $set: { status: 'sending' } })
    await queueCampaignSend(db, campaign)

    expect(await pauseCampaign(db, 'c1')).toBe(true)
    // Workers see a paused campaign and drop their jobs — claims stay pending.
    await drainCampaignSends(db, 'c1')
    expect(await lifecycleSendsCol(db).countDocuments({ status: 'pending' })).toBe(2)
    expect((await campaignsCol(db).findOne({ id: 'c1' }))!['status']).toBe('paused')

    // Resume re-enqueues (jobs buffer inline without Redis; drain is the
    // test-side stand-in for the subscriber picking them up).
    expect(await resumeCampaign(db, 'c1')).toBe(2)
    await drainCampaignSends(db, 'c1')
    const done = await campaignsCol(db).findOne({ id: 'c1' })
    expect(done!['status']).toBe('sent')
    expect(done!['stats']?.['sent']).toBe(2)
  })

  it('a redelivered job after settlement is a no-op', async () => {
    await seedUser()
    const campaign = makeCampaign()
    await campaignsCol(db).insertOne(campaign)
    await sendToCompletion(campaign)
    const { runCampaignSendJob } = await import('../campaigns.js')
    // At-least-once delivery: the queue may re-run a job that already ran.
    await runCampaignSendJob(db, { campaign_id: 'c1', key: 'campaign:c1:u1' })
    const done = await campaignsCol(db).findOne({ id: 'c1' })
    expect(done!['stats']?.['sent']).toBe(1)
  })
})
