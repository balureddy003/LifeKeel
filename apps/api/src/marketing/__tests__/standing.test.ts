import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  CHANNEL_CHAR_LIMITS,
  enableStanding,
  entryBlock,
  londonParts,
  londonToUtc,
  POLICY_MAX_DAYS,
  policyCollection,
  revokeStanding,
  resumeChannel,
  runBreakers,
  scheduleStanding,
  standingStatus,
} from '../standing.js'
import { addCandidate, approveEntries, bankCollection, LINK_TOKEN } from '../bank.js'
import { contentHash } from '../content-plan.js'
import { invalidatePlatformConfigCache, CONFIG_DOC_KEY } from '../../operator/platform-config.js'
import { registerMarketingStandingRoutes } from '../../routes/marketing-standing.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

// A Tuesday morning in October (London is on BST, UTC+1).
const NOW = new Date('2026-10-20T08:00:00Z')
const T = 't1'
const deps = {
  linkFor: (channel: string, path: string, tag: string, campaign: string) =>
    `https://lifekeel.co.uk${path}?utm_source=${channel}&utm_medium=social&utm_campaign=${campaign}&utm_content=${tag}`,
}
const TEXT = `Where does your family stand? A look at what is on file. Free to start. ${LINK_TOKEN}`

async function connect(channel = 'bluesky') {
  await db.collection('social_connections').insertOne({
    tenant_id: T,
    channel,
    handle: 'h',
    credentials: {},
    status: 'active',
  })
}

async function approvedEntry(
  text = TEXT,
  extra: Partial<Parameters<typeof addCandidate>[3]> = {},
  by = 'founder-1',
) {
  const e = await addCandidate(
    db,
    T,
    'op-1',
    {
      content: text,
      channels: ['bluesky'],
      link_path: '/guides/chart',
      campaign: 'pillar_chart',
      source: 'manual',
      ...extra,
    },
    NOW,
  )
  const [r] = await approveEntries(db, T, by, [{ id: e.id, content_hash: e.content_hash }], NOW)
  expect(r?.ok, JSON.stringify(r)).toBe(true)
  return (await bankCollection(db).findOne({ id: e.id }))!
}

async function enable(over: Partial<Parameters<typeof enableStanding>[3]> = {}) {
  return enableStanding(
    db,
    T,
    'founder-1',
    { reason: 'routine posting', expires_in_days: 30, channels: ['bluesky'], ...over },
    NOW,
  )
}

const posts = () => db.collection('marketing_posts')

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('standing')
})
beforeEach(async () => {
  await db.dropDatabase()
  invalidatePlatformConfigCache()
  await connect()
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('London time helpers', () => {
  it('maps London hours to UTC across the clock change', () => {
    expect(londonToUtc(2026, 10, 20, 9).toISOString()).toBe('2026-10-20T08:00:00.000Z') // BST
    expect(londonToUtc(2026, 12, 1, 9).toISOString()).toBe('2026-12-01T09:00:00.000Z') // GMT
    expect(londonParts(new Date('2026-10-20T08:00:00Z')).h).toBe(9)
  })
})

describe('scheduling from the bank', () => {
  it('schedules approved entries as approved posts that carry the human approver, a fresh tag and a bank id', async () => {
    const e1 = await approvedEntry(TEXT + ' One.', {}, 'founder-1')
    await approvedEntry(TEXT + ' Two.', {}, 'founder-1')
    await approvedEntry(TEXT + ' Three.', {}, 'founder-1')
    await enable()
    const res = await scheduleStanding(db, NOW, deps)
    expect(res.scheduled).toBeGreaterThan(0)
    const made = await posts().find({ tenant_id: T }).toArray()
    expect(made.length).toBe(res.scheduled)
    for (const p of made) {
      expect(p.state).toBe('approved')
      expect(p.approved_via).toBe('standing')
      expect(p.approved_by).toBe('founder-1') // the human, never the scheduler
      expect(p.created_by).toBe('standing-scheduler')
      expect(p.bank_entry_id).toBeTruthy()
      expect(p.content).not.toContain(LINK_TOKEN)
      expect(p.content).toContain(`utm_content=${p.post_tag}`)
      expect(p.copy_check.ok).toBe(true)
    }
    // Every scheduled post has its own tag, so per-post attribution still works.
    expect(new Set(made.map((p) => p.post_tag)).size).toBe(made.length)
    expect(
      (await bankCollection(db).findOne({ id: e1.id }))?.times_scheduled,
    ).toBeGreaterThanOrEqual(0)
  })

  it('respects the daily and weekly caps, the gap and the window', async () => {
    for (let i = 0; i < 6; i++) await approvedEntry(TEXT + ` Entry ${i}.`)
    await enable({ max_per_channel_per_week: 2, min_gap_hours: 24 })
    await scheduleStanding(db, NOW, deps)
    const made = await posts().find({ tenant_id: T }).sort({ scheduled_at: 1 }).toArray()
    const week = (d: Date) => Math.floor((d.getTime() - Date.UTC(2026, 9, 19)) / (7 * 86_400_000))
    const byWeek = new Map<number, number>()
    for (const p of made)
      byWeek.set(week(p.scheduled_at), (byWeek.get(week(p.scheduled_at)) ?? 0) + 1)
    for (const n of byWeek.values()) expect(n).toBeLessThanOrEqual(2)
    for (let i = 1; i < made.length; i++)
      expect(
        made[i].scheduled_at.getTime() - made[i - 1].scheduled_at.getTime(),
      ).toBeGreaterThanOrEqual(24 * 3_600_000)
    for (const p of made) {
      const h = londonParts(p.scheduled_at).h
      expect(h).toBeGreaterThanOrEqual(8)
      expect(h).toBeLessThan(20)
    }
  })

  it('never repeats an entry on a network inside the cooldown', async () => {
    await approvedEntry()
    await enable({ repeat_cooldown_days: 45 })
    const res = await scheduleStanding(db, NOW, deps)
    expect(res.scheduled).toBe(1)
    // Running again does not add the same text a second time.
    expect((await scheduleStanding(db, NOW, deps)).scheduled).toBe(0)
  })

  it('schedules nothing without an enabled, unexpired policy, or while marketing is paused', async () => {
    await approvedEntry()
    expect((await scheduleStanding(db, NOW, deps)).scheduled).toBe(0) // no policy
    await enable()
    await db
      .collection('platform_config')
      .updateOne({ key: CONFIG_DOC_KEY }, { $set: { marketing_paused: true } }, { upsert: true })
    invalidatePlatformConfigCache()
    expect(await scheduleStanding(db, NOW, deps)).toMatchObject({
      scheduled: 0,
      skipped_reason: 'marketing_paused',
    })
    await db
      .collection('platform_config')
      .updateOne({ key: CONFIG_DOC_KEY }, { $set: { marketing_paused: false } })
    invalidatePlatformConfigCache()
    const later = new Date(NOW.getTime() + 31 * 86_400_000)
    expect((await scheduleStanding(db, later, deps)).scheduled).toBe(0) // policy expired
    expect((await scheduleStanding(db, NOW, deps)).scheduled).toBeGreaterThan(0)
  })

  it('skips a network whose connection is not healthy, or that is not in the policy', async () => {
    await approvedEntry()
    await enable({ channels: ['linkedin'] }) // policy names a network with no connection
    expect((await scheduleStanding(db, NOW, deps)).scheduled).toBe(0)
  })

  it('only schedules posts at or before the policy expiry', async () => {
    for (let i = 0; i < 4; i++) await approvedEntry(TEXT + ` E${i}.`)
    await enable({ expires_in_days: 1 })
    await scheduleStanding(db, NOW, deps)
    const p = await policyCollection(db).findOne({ tenant_id: T })
    for (const post of await posts().find({ tenant_id: T }).toArray())
      expect(post.scheduled_at.getTime()).toBeLessThanOrEqual(p!.expires_at.getTime())
  })
})

describe('what an entry must satisfy', () => {
  it('blocks unapproved, expired, tampered, copy-failing, over-long and imageless entries', async () => {
    const ok = await approvedEntry()
    expect(entryBlock(ok, 'bluesky', NOW)).toBeNull()
    expect(entryBlock({ ...ok, status: 'candidate' }, 'bluesky', NOW)).toBe('not_approved')
    expect(entryBlock(ok, 'bluesky', new Date(ok.expires_at!.getTime() + 1))).toBe(
      'approval_expired',
    )
    expect(entryBlock({ ...ok, content: ok.content + ' edited' }, 'bluesky', NOW)).toBe(
      'hash_mismatch',
    )
    const bad = { ...ok, content: 'You should buy this. ' + LINK_TOKEN }
    bad.content_hash = contentHash(bad.content)
    expect(entryBlock(bad, 'bluesky', NOW)).toBe('copy_guard_failed')
    expect(entryBlock(ok, 'x', NOW)).toBe('channel_not_approved')
    const long = {
      ...ok,
      channels: ['x'],
      content: 'A calm note about papers. '.repeat(20) + 'Free to start.',
    }
    long.content_hash = contentHash(long.content)
    expect(long.content.length).toBeGreaterThan(CHANNEL_CHAR_LIMITS['x']!)
    expect(entryBlock(long, 'x', NOW)).toBe('too_long_for_channel')
    expect(entryBlock({ ...ok, channels: ['instagram'] }, 'instagram', NOW)).toBe('image_required')
    expect(
      entryBlock(
        { ...ok, channels: ['instagram'], card: { layout: 'headline', headline: 'h' } },
        'instagram',
        NOW,
      ),
    ).not.toBe('image_required')
  })

  it('an expired approval is never used by the scheduler', async () => {
    const e = await approvedEntry()
    await bankCollection(db).updateOne(
      { id: e.id },
      { $set: { expires_at: new Date(NOW.getTime() - 1000) } },
    )
    await enable()
    expect((await scheduleStanding(db, NOW, deps)).scheduled).toBe(0)
  })
})

describe('circuit breakers', () => {
  async function failed(channel: string, when: string, state = 'publish_failed') {
    await posts().insertOne({
      id: `p-${when}-${channel}`,
      tenant_id: T,
      channel,
      content: 'x',
      state,
      approved_via: 'standing',
      bank_entry_id: 'b',
      scheduled_at: new Date(when),
      created_at: new Date(when),
    })
  }

  it('two failures in a row pause that network only, and resuming forgets the old failures', async () => {
    await connect('x')
    await enable({ channels: ['bluesky', 'x'] })
    await failed('bluesky', '2026-10-18T08:00:00Z')
    await failed('bluesky', '2026-10-19T08:00:00Z')
    await failed('x', '2026-10-19T09:00:00Z')
    await failed('x', '2026-10-18T09:00:00Z', 'published')
    const res = await runBreakers(db, NOW)
    expect(res.channels_paused).toEqual([`${T}:bluesky`])
    const p = await policyCollection(db).findOne({ tenant_id: T })
    expect(p!.paused_channels.map((c) => c.channel)).toEqual(['bluesky'])
    // Paused network is not scheduled to.
    await approvedEntry()
    expect((await scheduleStanding(db, NOW, deps)).scheduled).toBe(0)
    // Resume: the old failures no longer count, so it does not trip again at once.
    expect(await resumeChannel(db, T, 'founder-1', 'bluesky', NOW)).toBe(true)
    expect((await runBreakers(db, NOW)).channels_paused).toEqual([])
  })

  it('copy rules that change retire the entry and reject its future posts, not past ones', async () => {
    const e = await approvedEntry()
    await enable()
    await posts().insertMany([
      {
        id: 'future',
        tenant_id: T,
        channel: 'bluesky',
        content: 'a',
        state: 'approved',
        approved_via: 'standing',
        bank_entry_id: e.id,
        scheduled_at: new Date('2026-10-22T08:00:00Z'),
      },
      {
        id: 'past',
        tenant_id: T,
        channel: 'bluesky',
        content: 'a',
        state: 'published',
        approved_via: 'standing',
        bank_entry_id: e.id,
        scheduled_at: new Date('2026-10-18T08:00:00Z'),
      },
    ])
    // Simulate rules tightening: the stored text now violates them.
    const worse = 'You should buy this today. ' + LINK_TOKEN
    await bankCollection(db).updateOne(
      { id: e.id },
      { $set: { content: worse, content_hash: contentHash(worse) } },
    )
    const res = await runBreakers(db, NOW)
    expect(res.entries_retired).toBe(1)
    expect((await bankCollection(db).findOne({ id: e.id }))?.retired_reason).toBe(
      'copy_rules_changed',
    )
    expect((await posts().findOne({ id: 'future' }))?.state).toBe('rejected')
    expect((await posts().findOne({ id: 'past' }))?.state).toBe('published')
  })

  it('an expired approval is retired and its future posts are rejected', async () => {
    const e = await approvedEntry()
    await enable()
    await posts().insertOne({
      id: 'f',
      tenant_id: T,
      channel: 'bluesky',
      content: 'a',
      state: 'approved',
      approved_via: 'standing',
      bank_entry_id: e.id,
      scheduled_at: new Date('2027-02-01T08:00:00Z'),
    })
    const res = await runBreakers(db, new Date(e.expires_at!.getTime() + 1000))
    expect(res.entries_retired).toBe(1)
    expect((await posts().findOne({ id: 'f' }))?.state).toBe('rejected')
  })
})

describe('revoking', () => {
  it('stops scheduling and rejects every unsent standing post, leaving sent and human-approved posts alone', async () => {
    await approvedEntry()
    await approvedEntry(TEXT + ' Two.')
    await enable()
    await scheduleStanding(db, NOW, deps)
    await posts().insertMany([
      {
        id: 'human',
        tenant_id: T,
        channel: 'bluesky',
        content: 'h',
        state: 'approved',
        approved_by: 'founder-1',
        scheduled_at: new Date('2026-10-23T08:00:00Z'),
      },
      {
        id: 'sent',
        tenant_id: T,
        channel: 'bluesky',
        content: 's',
        state: 'published',
        approved_via: 'standing',
        scheduled_at: new Date('2026-10-19T08:00:00Z'),
      },
    ])
    const { rejected } = await revokeStanding(db, T, 'founder-1', 'pausing the programme', NOW)
    expect(rejected).toBeGreaterThan(0)
    expect(await posts().countDocuments({ approved_via: 'standing', state: 'approved' })).toBe(0)
    expect((await posts().findOne({ id: 'human' }))?.state).toBe('approved')
    expect((await posts().findOne({ id: 'sent' }))?.state).toBe('published')
    expect((await scheduleStanding(db, NOW, deps)).scheduled).toBe(0)
    expect((await standingStatus(db, T, NOW)).active).toBe(false)
  })
})

describe('status', () => {
  it('reports bank counts and how many weeks the thinnest network can run before a text repeats', async () => {
    for (let i = 0; i < 6; i++) await approvedEntry(TEXT + ` E${i}.`)
    await addCandidate(
      db,
      T,
      'op-1',
      { content: 'c ' + LINK_TOKEN, channels: ['bluesky'], source: 'manual' },
      NOW,
    )
    await enable({ max_per_channel_per_week: 3 })
    const s = await standingStatus(db, T, NOW)
    expect(s.bank).toMatchObject({ approved: 6, candidate: 1, retired: 0 })
    expect(s.weeks_of_posts_left).toBe(2)
    expect(s.active).toBe(true)
  })
})

describe('policy routes', () => {
  async function app(tenant = T) {
    const a = Fastify()
    a.addHook('onRequest', async (req) => {
      req.authContext = { user_id: 'founder-1', tenant_id: tenant, roles: ['admin'] } as never
    })
    registerMarketingStandingRoutes(a, db, { operatorTenants: [T], now: () => NOW, deps })
    await a.ready()
    return a
  }

  it('requires a reason and an expiry, and caps the expiry', async () => {
    const a = await app()
    const noReason = await a.inject({
      method: 'PUT',
      url: '/marketing/standing',
      payload: { expires_in_days: 7, channels: ['bluesky'] },
    })
    expect(noReason.statusCode).toBe(400)
    const tooLong = await a.inject({
      method: 'PUT',
      url: '/marketing/standing',
      payload: { reason: 'routine', expires_in_days: POLICY_MAX_DAYS + 1, channels: ['bluesky'] },
    })
    expect(tooLong.statusCode).toBe(400)
    const ok = await a.inject({
      method: 'PUT',
      url: '/marketing/standing',
      payload: { reason: 'routine posting', expires_in_days: 14, channels: ['bluesky'] },
    })
    expect(ok.statusCode).toBe(200)
    const p = await policyCollection(db).findOne({ tenant_id: T })
    expect(p).toMatchObject({ enabled: true, enabled_by: 'founder-1', reason: 'routine posting' })
    expect(p!.expires_at.getTime()).toBe(NOW.getTime() + 14 * 86_400_000)
  })

  it('run now schedules for this tenant, and disable needs a reason', async () => {
    await approvedEntry()
    const a = await app()
    await a.inject({
      method: 'PUT',
      url: '/marketing/standing',
      payload: { reason: 'routine', expires_in_days: 7, channels: ['bluesky'] },
    })
    const run = await a.inject({ method: 'POST', url: '/marketing/standing/run' })
    expect((run.json() as { scheduled: number }).scheduled).toBeGreaterThan(0)
    const noReason = await a.inject({
      method: 'POST',
      url: '/marketing/standing/disable',
      payload: {},
    })
    expect(noReason.statusCode).toBe(400)
    const off = await a.inject({
      method: 'POST',
      url: '/marketing/standing/disable',
      payload: { reason: 'pause' },
    })
    expect(off.statusCode).toBe(200)
  })

  it('is closed to a tenant that is not an operator', async () => {
    const a = await app('stranger')
    const res = await a.inject({ method: 'GET', url: '/marketing/standing' })
    expect(res.statusCode).toBe(403)
  })
})
