import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { checkConnectedProfiles } from '../profile-sync.js'
import { DEFAULT_PROFILES } from '../channel-profiles.js'
import { buildDecisions } from '../../operator/mission-control.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('profile-sync')
})
beforeEach(async () => {
  await db.dropDatabase()
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

const NOW = new Date('2026-10-26T07:10:00Z')
const oauth = (
  connector_id: string,
  extra: Record<string, unknown> = {},
  over: Record<string, unknown> = {},
) => ({
  tenant_id: 't1',
  connector_id,
  extra,
  needs_reauth: false,
  ...over,
})
const ok = (body: unknown) => ({ ok: true, status: 200, body })
const bskyConn = {
  tenant_id: 't1',
  channel: 'bluesky',
  handle: 'h',
  status: 'active',
  credentials: {},
}

describe('checkConnectedProfiles', () => {
  it('reads every connected, readable platform and stores drift, writing nothing to any platform', async () => {
    await db.collection('social_connections').insertOne(bskyConn)
    await db.collection('connector_credentials').insertMany([
      oauth('twitter_x'),
      oauth('threads'),
      oauth('linkedin'), // connected but not readable: skipped, not failed
    ])
    const calls: [string, string][] = []
    const connectorRead = vi.fn(async (_t: string, connector: string, action: string) => {
      calls.push([connector, action])
      return connector === 'twitter_x'
        ? ok({
            data: {
              name: 'LifeKeel',
              description: 'old',
              profile_image_url: 'https://pbs.twimg.com/a.jpg',
            },
          })
        : ok({
            username: 'lifekeel',
            name: 'LifeKeel',
            threads_biography: DEFAULT_PROFILES.threads.bio,
            threads_profile_picture_url: 'https://x/t.jpg',
          })
    })
    const readBluesky = vi.fn(async () => ({
      display_name: 'LifeKeel',
      bio: DEFAULT_PROFILES.bluesky.bio,
      has_avatar: true,
      has_banner: true,
      checked_at: NOW,
    }))
    const r = await checkConnectedProfiles(db, { connectorRead, readBluesky }, NOW)
    expect(r).toEqual({ checked: 3, failed: [] })
    expect(readBluesky).toHaveBeenCalledWith(DEFAULT_PROFILES.bluesky.handle)
    // Only the read actions ran — nothing that could change a profile.
    expect(calls.sort()).toEqual([
      ['threads', 'get_profile'],
      ['twitter_x', 'getUsersMe'],
    ])

    const x = await db.collection('channel_profiles').findOne({ tenant_id: 't1', channel: 'x' })
    expect(x!['drift']).toEqual([expect.objectContaining({ field: 'bio' })])
    expect(x!['updated_by']).toBe('weekly-profile-check')
    expect(
      (await db.collection('channel_profiles').findOne({ channel: 'threads' }))!['drift'],
    ).toEqual([])
    expect(await db.collection('channel_profiles').findOne({ channel: 'linkedin' })).toBeNull()
  })

  it("records each channel's latest check outcome, one row per channel, so a failing API shows up", async () => {
    await db.collection('connector_credentials').insertMany([oauth('twitter_x'), oauth('threads')])
    const connectorRead = vi.fn(async (_t: string, connector: string) =>
      connector === 'twitter_x'
        ? { ok: false, status: 403, body: {} }
        : ok({
            username: 'lifekeel',
            name: 'LifeKeel',
            threads_biography: 'x',
            threads_profile_picture_url: 'https://x/t.jpg',
          }),
    )
    await checkConnectedProfiles(db, { connectorRead }, NOW)
    const rows = await db.collection('channel_checks').find({}).toArray()
    expect(rows.map((r) => `${r['channel']}:${r['ok']}`).sort()).toEqual([
      'threads:true',
      'x:false',
    ])
    expect(rows.find((r) => r['channel'] === 'x')!['error']).toMatch(/HTTP 403/)

    // The next run replaces the row instead of adding one — and a recovery clears the failure.
    connectorRead.mockResolvedValue(
      ok({ data: { name: 'LifeKeel', description: 'x', profile_image_url: 'https://x/a.jpg' } }),
    )
    await checkConnectedProfiles(db, { connectorRead }, new Date(NOW.getTime() + 86_400_000))
    expect(await db.collection('channel_checks').countDocuments()).toBe(2)
    expect((await db.collection('channel_checks').findOne({ channel: 'x' }))!['ok']).toBe(true)
  })

  it('keeps the approved text the operator saved, and does not overwrite it', async () => {
    await db.collection('connector_credentials').insertOne(oauth('twitter_x'))
    const mine = { ...DEFAULT_PROFILES.x, bio: 'My own approved bio' }
    await db.collection('channel_profiles').insertOne({
      tenant_id: 't1',
      channel: 'x',
      desired: mine,
      checklist: { bio_set: true },
      drift: [],
      updated_by: 'u',
      updated_at: NOW,
    })
    await checkConnectedProfiles(
      db,
      {
        connectorRead: async () =>
          ok({
            data: {
              name: 'LifeKeel',
              description: 'My own approved bio',
              profile_image_url: 'https://x/a.jpg',
            },
          }),
      },
      NOW,
    )
    const doc = await db.collection('channel_profiles').findOne({ channel: 'x' })
    expect(doc!['desired']).toEqual(mine)
    expect(doc!['checklist']).toEqual({ bio_set: true })
    expect(doc!['drift']).toEqual([])
  })

  it('records a failure per channel and carries on with the others', async () => {
    await db.collection('connector_credentials').insertMany([oauth('twitter_x'), oauth('threads')])
    const connectorRead = vi.fn(async (_t: string, connector: string) =>
      connector === 'twitter_x'
        ? { ok: false, status: 429, body: {} }
        : ok({
            username: 'lifekeel',
            name: 'LifeKeel',
            threads_biography: 'x',
            threads_profile_picture_url: 'https://x/t.jpg',
          }),
    )
    const r = await checkConnectedProfiles(db, { connectorRead }, NOW)
    expect(r.checked).toBe(1)
    expect(r.failed).toEqual([
      expect.objectContaining({ channel: 'x', reason: expect.stringContaining('HTTP 429') }),
    ])
  })

  it('skips a connection that needs reconnecting instead of calling the platform', async () => {
    await db
      .collection('connector_credentials')
      .insertOne(oauth('twitter_x', {}, { needs_reauth: true }))
    const connectorRead = vi.fn()
    expect(await checkConnectedProfiles(db, { connectorRead }, NOW)).toEqual({
      checked: 0,
      failed: [],
    })
    expect(connectorRead).not.toHaveBeenCalled()
  })
})

describe('profile drift in Mission Control', () => {
  const admin = { user_id: 'me', roles: ['super_admin'] as never }
  const profile = (channel: string, drift: { field: string }[]) => ({
    tenant_id: 't1',
    channel,
    desired: DEFAULT_PROFILES.x,
    checklist: {},
    drift,
    actual: { checked_at: new Date('2026-10-26T07:10:00Z') },
    updated_by: 'u',
    updated_at: NOW,
  })

  it('raises one informational decision per profile that differs, naming what', async () => {
    await db
      .collection('channel_profiles')
      .insertMany([
        profile('x', [{ field: 'bio' }, { field: 'display_name' }]),
        profile('threads', []),
      ])
    const ds = (await buildDecisions(db, admin, NOW)).filter((d) => d.kind === 'profile_drift')
    expect(ds).toHaveLength(1)
    expect(ds[0]).toMatchObject({
      id: 'profile_drift:t1:x',
      severity: 'info',
      batchable: false,
      title: 'X profile differs from the approved text: bio, display name',
    })
    expect(ds[0]!.effect).toMatch(/Nothing changes by itself/)
    expect(ds[0]!.why).toMatch(/2026-10-26/)
  })

  it('is only for roles that can manage marketing', async () => {
    await db.collection('channel_profiles').insertOne(profile('x', [{ field: 'bio' }]))
    expect(
      (await buildDecisions(db, { user_id: 'me', roles: ['support'] as never }, NOW)).some(
        (d) => d.kind === 'profile_drift',
      ),
    ).toBe(false)
    expect(
      (
        await buildDecisions(db, { user_id: 'me', roles: ['marketing_operator'] as never }, NOW)
      ).some((d) => d.kind === 'profile_drift'),
    ).toBe(true)
  })
})
