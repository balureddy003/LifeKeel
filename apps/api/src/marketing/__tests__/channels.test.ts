import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  EXPIRY_WARN_DAYS,
  SOCIAL_CHANNELS,
  allUsableChannels,
  appCredentialsPresent,
  channelHealth,
  channelIssues,
  listChannels,
  missingImage,
  plannableChannels,
} from '../channels.js'
import { generateDailyMarketingDrafts } from '../../routes/marketing-posts.js'
import { ensureWeeklyPlans } from '../content-plan.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('channels')
})
beforeEach(async () => {
  await db.dropDatabase()
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

const NOW = new Date('2026-10-20T10:00:00Z')
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000)

const bluesky = (over: Record<string, unknown> = {}) => ({
  tenant_id: 't1',
  channel: 'bluesky',
  handle: 'keel.bsky.social',
  credentials: { app_password: 'SECRET-APP-PASSWORD' },
  status: 'active',
  ...over,
})
const oauth = (connector_id: string, over: Record<string, unknown> = {}) => ({
  tenant_id: 't1',
  connector_id,
  extra: { username: `${connector_id}-user` },
  needs_reauth: false,
  access_token: 'SECRET-ACCESS-TOKEN',
  ...over,
})

describe('listChannels', () => {
  it('merges both credential stores into one list', async () => {
    await db.collection('social_connections').insertOne(bluesky())
    await db
      .collection('connector_credentials')
      .insertMany([
        oauth('twitter_x'),
        oauth('facebook_pages'),
        oauth('threads'),
        oauth('instagram_business'),
      ])
    const list = await listChannels(db, 't1', NOW)
    expect(list.map((c) => c.channel).sort()).toEqual([
      'bluesky',
      'facebook',
      'instagram',
      'threads',
      'x',
    ])
    expect(list.find((c) => c.channel === 'x')).toMatchObject({
      source: 'oauth',
      handle: 'twitter_x-user',
      status: 'connected',
      usable: true,
    })
    expect(list.find((c) => c.channel === 'bluesky')).toMatchObject({
      source: 'social_connections',
      usable: true,
    })
  })

  it('never includes another tenant’s connections or unrelated connectors', async () => {
    await db.collection('social_connections').insertOne(bluesky({ tenant_id: 'other' }))
    await db
      .collection('connector_credentials')
      .insertMany([oauth('twitter_x', { tenant_id: 'other' }), oauth('gmail')])
    expect(await listChannels(db, 't1', NOW)).toEqual([])
  })

  it('marks a Bluesky connection in error and an OAuth one needing reauth as unusable', async () => {
    await db
      .collection('social_connections')
      .insertOne(bluesky({ status: 'error', last_error: 'bad password' }))
    await db
      .collection('connector_credentials')
      .insertOne(oauth('twitter_x', { needs_reauth: true }))
    const list = await listChannels(db, 't1', NOW)
    expect(list.find((c) => c.channel === 'bluesky')).toMatchObject({
      status: 'error',
      usable: false,
      last_error: 'bad password',
    })
    expect(list.find((c) => c.channel === 'x')).toMatchObject({
      status: 'needs_reauth',
      usable: false,
    })
  })

  it('warns a week before a LinkedIn token (which cannot refresh) dies, and treats a dead one as needing reauth', async () => {
    const case_ = async (expiresAt: Date | undefined) => {
      await db.collection('connector_credentials').deleteMany({})
      await db
        .collection('connector_credentials')
        .insertOne(oauth('linkedin', expiresAt ? { token_expires_at: expiresAt } : {}))
      return (await listChannels(db, 't1', NOW))[0]!
    }
    expect(await case_(days(30))).toMatchObject({ status: 'connected', usable: true })
    const soon = await case_(days(EXPIRY_WARN_DAYS - 1))
    expect(soon).toMatchObject({ status: 'expiring_soon', usable: true })
    expect(soon.expires_at).toEqual(days(EXPIRY_WARN_DAYS - 1))
    expect(await case_(days(-1))).toMatchObject({ status: 'needs_reauth', usable: false })
    expect(await case_(undefined)).toMatchObject({ status: 'connected' })
  })

  it('does not warn about tokens that refresh themselves', async () => {
    await db
      .collection('connector_credentials')
      .insertOne(oauth('twitter_x', { token_expires_at: days(1) }))
    expect(await listChannels(db, 't1', NOW)).toEqual([
      expect.objectContaining({ status: 'connected', expires_at: null }),
    ])
  })
})

describe('plannableChannels', () => {
  it('returns healthy channels once each and reports what it skipped and why', async () => {
    await db.collection('social_connections').insertOne(bluesky())
    await db.collection('connector_credentials').insertMany([
      oauth('twitter_x'),
      oauth('linkedin', { needs_reauth: true }),
      oauth('threads', { token_expires_at: days(2) }), // refreshes itself: fine
    ])
    const r = await plannableChannels(db, 't1', NOW)
    expect(r.channels.sort()).toEqual(['bluesky', 'threads', 'x'])
    expect(r.skipped).toEqual([
      expect.objectContaining({ channel: 'linkedin', status: 'needs_reauth' }),
    ])
  })

  it('does not call a channel skipped when it also has a healthy connection', async () => {
    await db
      .collection('social_connections')
      .insertMany([bluesky({ status: 'error' }), bluesky({ handle: 'second' })])
    const r = await plannableChannels(db, 't1', NOW)
    expect(r.channels).toEqual(['bluesky'])
    expect(r.skipped).toEqual([])
  })
})

describe('channelHealth', () => {
  it('reports all six platforms, including the ones not connected yet', async () => {
    await db.collection('social_connections').insertOne(bluesky())
    const health = await channelHealth(db, 't1', { env: {}, now: NOW })
    expect(health.map((h) => h.channel)).toEqual([...SOCIAL_CHANNELS])
    expect(health.find((h) => h.channel === 'bluesky')).toMatchObject({
      status: 'connected',
      usable: true,
    })
    for (const c of ['linkedin', 'x', 'threads', 'instagram', 'facebook'])
      expect(health.find((h) => h.channel === c)).toMatchObject({
        status: 'not_configured',
        usable: false,
        app_credentials: false,
      })
  })

  it('says whether developer-app credentials are present without ever exposing them', async () => {
    const env = {
      X_CLIENT_ID: 'SECRET-X-ID',
      X_CLIENT_SECRET: 'SECRET-X-SECRET',
      META_CLIENT_ID: 'only-half',
    }
    expect(appCredentialsPresent('x', env)).toBe(true)
    expect(appCredentialsPresent('facebook', env)).toBe(false) // id without secret
    expect(appCredentialsPresent('bluesky', {})).toBe(true) // app password, no developer app
    expect(appCredentialsPresent('threads', { META_CLIENT_ID: 'a', META_CLIENT_SECRET: 'b' })).toBe(
      true,
    ) // reuses Meta app
    await db.collection('social_connections').insertOne(bluesky())
    await db.collection('connector_credentials').insertOne(oauth('twitter_x'))
    const json = JSON.stringify(await channelHealth(db, 't1', { env, now: NOW }))
    for (const secret of [
      'SECRET-X-ID',
      'SECRET-X-SECRET',
      'SECRET-APP-PASSWORD',
      'SECRET-ACCESS-TOKEN',
    ])
      expect(json).not.toContain(secret)
  })

  it('builds the exact redirect URI to register and the setup steps', async () => {
    const health = await channelHealth(db, 't1', {
      env: { API_BASE_URL: 'https://api.lifekeel.co.uk' },
      now: NOW,
    })
    const by = Object.fromEntries(health.map((h) => [h.channel, h]))
    expect(by['linkedin']!.setup.redirect_uri).toBe(
      'https://api.lifekeel.co.uk/connectors/linkedin/oauth/callback',
    )
    expect(by['x']!.setup.redirect_uri).toBe(
      'https://api.lifekeel.co.uk/connectors/twitter_x/oauth/callback',
    )
    expect(by['facebook']!.setup.redirect_uri).toMatch(
      /\/connectors\/facebook_pages\/oauth\/callback$/,
    )
    expect(by['bluesky']!.setup.redirect_uri).toBeNull()
    expect(by['instagram']!.setup.note).toMatch(/image/i)
    for (const h of health) expect(h.setup.steps.length).toBeGreaterThan(0)
  })

  it('shows the last real publish, ignoring dry runs and failures', async () => {
    await db.collection('social_connections').insertOne(bluesky())
    await db.collection('marketing_posts').insertMany([
      { tenant_id: 't1', channel: 'bluesky', state: 'published', published_at: days(-5) },
      {
        tenant_id: 't1',
        channel: 'bluesky',
        state: 'published',
        published_at: days(-1),
        dry_run: true,
      },
      { tenant_id: 't1', channel: 'bluesky', state: 'publish_failed', published_at: days(-2) },
      { tenant_id: 'other', channel: 'bluesky', state: 'published', published_at: days(-1) },
    ])
    const b = (await channelHealth(db, 't1', { env: {}, now: NOW })).find(
      (h) => h.channel === 'bluesky',
    )!
    expect(b.last_publish_at).toBe(days(-5).toISOString())
  })

  it('exposes a LinkedIn expiry date and flags it expiring', async () => {
    await db
      .collection('connector_credentials')
      .insertOne(oauth('linkedin', { token_expires_at: days(3) }))
    const l = (await channelHealth(db, 't1', { env: {}, now: NOW })).find(
      (h) => h.channel === 'linkedin',
    )!
    expect(l).toMatchObject({
      status: 'expiring_soon',
      usable: true,
      expires_at: days(3).toISOString(),
    })
  })
})

describe('missingImage', () => {
  it('only Instagram needs one', () => {
    expect(missingImage({ channel: 'instagram' })).toBe(true)
    expect(missingImage({ channel: 'instagram', media_url: '' })).toBe(true)
    expect(missingImage({ channel: 'instagram', media_url: 'https://x/y.png' })).toBe(false)
    expect(missingImage({ channel: 'x' })).toBe(false)
    expect(missingImage({ channel: 'facebook' })).toBe(false)
  })
})

describe('allUsableChannels', () => {
  it('lists healthy channels for every tenant across both stores', async () => {
    await db.collection('social_connections').insertOne(bluesky())
    await db
      .collection('connector_credentials')
      .insertMany([
        oauth('twitter_x', { tenant_id: 't2' }),
        oauth('linkedin', { tenant_id: 't2', needs_reauth: true }),
      ])
    const all = await allUsableChannels(db, NOW)
    expect(all).toEqual(
      expect.arrayContaining([
        { tenant_id: 't1', channel: 'bluesky' },
        { tenant_id: 't2', channel: 'x' },
      ]),
    )
    expect(all).toHaveLength(2)
  })
})

describe('automatic drafting uses every platform', () => {
  const optIn = (tenant_id: string) =>
    db
      .collection('tenant_settings')
      .insertOne({ tenant_id, automation: { daily_marketing_drafts_enabled: true } })

  it('the weekly plan is prepared for an X-only tenant, with no Bluesky at all', async () => {
    await optIn('t1')
    await db.collection('connector_credentials').insertOne(oauth('twitter_x'))
    const drafted = await ensureWeeklyPlans(
      db,
      () => async () => "LifeKeel keeps your family's chart. Free to start.",
      NOW,
    )
    expect(drafted).toBe(4)
    expect([
      ...new Set(
        (await db.collection('marketing_posts').find({}).toArray()).map((p) => p['channel']),
      ),
    ]).toEqual(['x'])
  })

  it('the weekly plan skips a tenant whose only connection has died', async () => {
    await optIn('t1')
    await db
      .collection('connector_credentials')
      .insertOne(oauth('twitter_x', { needs_reauth: true }))
    expect(await ensureWeeklyPlans(db, () => async () => 'x', NOW)).toBe(0)
    expect(await db.collection('marketing_posts').countDocuments()).toBe(0)
  })

  it('the daily blog draft goes to a healthy text channel, never Instagram', async () => {
    await optIn('t1')
    await db.collection('blog_posts').insertOne({
      slug: 'cover-gap',
      published: true,
      title: 'The cover gap',
      excerpt: 'Most families miss it.',
      published_at: NOW,
    })
    await db
      .collection('connector_credentials')
      .insertMany([oauth('instagram_business'), oauth('linkedin')])
    const n = await generateDailyMarketingDrafts(
      db,
      () => async () => "LifeKeel keeps your family's chart. Free to start.",
    )
    expect(n).toBe(1)
    const post = (await db.collection('marketing_posts').find({}).toArray())[0]!
    expect(post['channel']).toBe('linkedin')
    expect(post['state']).toBe('draft')
  })

  it('an Instagram-only tenant gets no daily blog draft (it has no image)', async () => {
    await optIn('t1')
    await db.collection('blog_posts').insertOne({
      slug: 'cover-gap',
      published: true,
      title: 'T',
      excerpt: 'E',
      published_at: NOW,
    })
    await db.collection('connector_credentials').insertOne(oauth('instagram_business'))
    expect(await generateDailyMarketingDrafts(db, () => async () => 'x')).toBe(0)
  })
})

describe('degraded: connected but not working', () => {
  const failedVersionPost = (over: Record<string, unknown> = {}) => ({
    tenant_id: 't1',
    channel: 'linkedin',
    state: 'publish_failed',
    publish_error:
      'linkedin_api_version_expired: LinkedIn rejected API version 202501. Set LINKEDIN_API_VERSION to a current version',
    approved_at: days(-1),
    ...over,
  })
  const check = (over: Record<string, unknown> = {}) => ({
    tenant_id: 't1',
    channel: 'x',
    ok: false,
    error: 'x profile read failed (HTTP 403)',
    checked_at: days(-0.2),
    ...over,
  })

  it('flags a channel whose latest post was rejected for its API version, and keeps it usable', async () => {
    await db.collection('connector_credentials').insertOne(oauth('linkedin'))
    await db.collection('marketing_posts').insertOne(failedVersionPost())
    const [li] = await listChannels(db, 't1', NOW)
    expect(li).toMatchObject({ channel: 'linkedin', status: 'degraded', usable: true })
    expect(li!.last_error).toMatch(/api_version_expired.*LINKEDIN_API_VERSION/)
    expect((await plannableChannels(db, 't1', NOW)).channels).toEqual(['linkedin'])
  })

  it('clears once a real post has gone out after the failure — dry runs do not count', async () => {
    await db.collection('connector_credentials').insertOne(oauth('linkedin'))
    await db.collection('marketing_posts').insertMany([
      failedVersionPost(),
      {
        tenant_id: 't1',
        channel: 'linkedin',
        state: 'published',
        dry_run: true,
        published_at: days(-0.5),
      },
    ])
    expect((await listChannels(db, 't1', NOW))[0]!.status).toBe('degraded')
    await db.collection('marketing_posts').insertOne({
      tenant_id: 't1',
      channel: 'linkedin',
      state: 'published',
      published_at: days(-0.1),
    })
    expect((await listChannels(db, 't1', NOW))[0]!.status).toBe('connected')
  })

  it('ignores old failures, other tenants and other channels', async () => {
    await db.collection('connector_credentials').insertMany([oauth('linkedin'), oauth('twitter_x')])
    await db.collection('marketing_posts').insertMany([
      failedVersionPost({ approved_at: days(-20) }), // outside the 14-day window
      failedVersionPost({ tenant_id: 'other' }),
      failedVersionPost({ channel: 'x' }), // belongs to X, whose connection is also fine
    ])
    const by = Object.fromEntries(
      (await listChannels(db, 't1', NOW)).map((c) => [c.channel, c.status]),
    )
    expect(by['linkedin']).toBe('connected')
    expect(by['x']).toBe('degraded') // the failure was recorded against X, so X is flagged — LinkedIn is not
  })

  it('flags a channel whose daily read-only check failed, saying posting may still work', async () => {
    await db.collection('connector_credentials').insertOne(oauth('twitter_x'))
    await db.collection('channel_checks').insertOne(check())
    const [x] = await listChannels(db, 't1', NOW)
    expect(x).toMatchObject({ status: 'degraded', usable: true })
    expect(x!.last_error).toMatch(
      /Daily check failed: x profile read failed \(HTTP 403\).*posting may still work/,
    )
  })

  it('a passing or stale check does not flag anything', async () => {
    await db.collection('connector_credentials').insertOne(oauth('twitter_x'))
    await db.collection('channel_checks').insertOne(check({ ok: true, error: null }))
    expect((await listChannels(db, 't1', NOW))[0]!.status).toBe('connected')
    await db.collection('channel_checks').deleteMany({})
    await db.collection('channel_checks').insertOne(check({ checked_at: days(-5) }))
    expect((await listChannels(db, 't1', NOW))[0]!.status).toBe('connected')
  })

  it('never softens a dead connection: needs_reauth stays needs_reauth', async () => {
    await db
      .collection('connector_credentials')
      .insertOne(oauth('twitter_x', { needs_reauth: true }))
    await db.collection('channel_checks').insertOne(check())
    expect((await listChannels(db, 't1', NOW))[0]).toMatchObject({
      status: 'needs_reauth',
      usable: false,
    })
  })

  it('shows up in channel health with the reason, and in the issues list', async () => {
    await db.collection('connector_credentials').insertOne(oauth('linkedin'))
    await db.collection('marketing_posts').insertOne(failedVersionPost())
    const li = (await channelHealth(db, 't1', { env: {}, now: NOW })).find(
      (h) => h.channel === 'linkedin',
    )!
    expect(li).toMatchObject({ status: 'degraded', usable: true })
    expect(li.last_error).toMatch(/api_version_expired/)
    expect((await channelIssues(db, NOW)).map((i) => `${i.channel}:${i.status}`)).toEqual([
      'linkedin:degraded',
    ])
  })
})
