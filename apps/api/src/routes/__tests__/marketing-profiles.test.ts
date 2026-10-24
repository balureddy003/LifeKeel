import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerMarketingProfileRoutes } from '../marketing-profiles.js'
import {
  BIO_LIMIT,
  DEFAULT_PROFILES,
  PROFILE_CHANNELS,
  computeDrift,
  desiredHash,
  readConnectorProfile,
  SUPPORTS_APPLY,
  SUPPORTS_CHECK,
  validateDesired,
} from '../../marketing/channel-profiles.js'
import { NEVER_AUTONOMOUS } from '../../operator/autopilot.js'
import { invalidatePlatformConfigCache } from '../../operator/platform-config.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

const read = vi.fn()
const connectorRead = vi.fn()
const apply = vi.fn(async () => {})

async function buildApp() {
  const app = Fastify()
  app.addHook('onRequest', async (req) => {
    req.authContext = { user_id: 'op-1', tenant_id: 't1', roles: ['admin'] } as never
  })
  registerMarketingProfileRoutes(app, db, {
    operatorTenants: ['t1'],
    readProfile: read,
    connectorRead,
    applyProfile: apply,
  })
  await app.ready()
  return app
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('marketing-profiles')
})
beforeEach(async () => {
  await db.dropDatabase()
  read.mockReset()
  connectorRead.mockReset()
  apply.mockClear()
  invalidatePlatformConfigCache()
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('profile text rules', () => {
  it('every default profile passes its own limits and the copy guard', () => {
    for (const c of PROFILE_CHANNELS) {
      const v = validateDesired(c, DEFAULT_PROFILES[c])
      expect(v.problems, c).toEqual([])
      expect(DEFAULT_PROFILES[c].bio.length).toBeLessThanOrEqual(BIO_LIMIT[c])
    }
  })

  it('rejects over-length text and copy that breaks the guard', () => {
    const d = { ...DEFAULT_PROFILES.x, bio: 'You should switch to a cheaper insurer. '.repeat(6) }
    const v = validateDesired('x', d)
    expect(v.ok).toBe(false)
    expect(v.problems.join(' ')).toMatch(/allows 160/)
    expect(v.problems.join(' ')).toMatch(/copy guard/)
  })

  it('computeDrift reports changed text and missing pictures, ignoring whitespace', () => {
    const d = DEFAULT_PROFILES.bluesky
    const same = {
      display_name: d.display_name,
      bio: `  ${d.bio.replace(/ /g, '  ')} `,
      has_avatar: true,
      has_banner: true,
      checked_at: new Date(),
    }
    expect(computeDrift(d, same)).toEqual([])
    const off = {
      display_name: 'Someone',
      bio: 'old',
      has_avatar: false,
      has_banner: true,
      checked_at: new Date(),
    }
    expect(computeDrift(d, off).map((x) => x.field)).toEqual(['display_name', 'bio', 'avatar'])
  })

  it('profile writes are never autonomous', () => {
    expect(NEVER_AUTONOMOUS).toContain('marketing.profile_update')
  })
})

describe('/marketing/profiles', () => {
  it('lists every network with the kit defaults before anything is saved', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/marketing/profiles' })
    const profiles = res.json().profiles
    expect(profiles.map((p: { channel: string }) => p.channel)).toEqual([...PROFILE_CHANNELS])
    expect(
      profiles.every(
        (p: { saved: boolean; problems: string[] }) => !p.saved && p.problems.length === 0,
      ),
    ).toBe(true)
  })

  it('refuses text that fails the guard and saves text that passes', async () => {
    const app = await buildApp()
    const bad = await app.inject({
      method: 'PUT',
      url: '/marketing/profiles/bluesky',
      payload: { ...DEFAULT_PROFILES.bluesky, bio: 'We recommend Aviva.' },
    })
    expect(bad.statusCode).toBe(422)
    const ok = await app.inject({
      method: 'PUT',
      url: '/marketing/profiles/bluesky',
      payload: { ...DEFAULT_PROFILES.bluesky, bio: 'Your family chart, kept current.' },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().saved).toBe(true)
    expect(ok.json().desired.bio).toBe('Your family chart, kept current.')
  })

  it('ticks a known checklist item and rejects an unknown one', async () => {
    const app = await buildApp()
    const ok = await app.inject({
      method: 'PUT',
      url: '/marketing/profiles/linkedin/checklist',
      payload: { item: 'two_admins', done: true },
    })
    expect(ok.json().checklist).toEqual({ two_admins: true })
    const bad = await app.inject({
      method: 'PUT',
      url: '/marketing/profiles/linkedin/checklist',
      payload: { item: 'nope', done: true },
    })
    expect(bad.statusCode).toBe(400)
  })

  it('check reads the live Bluesky profile and stores the drift; LinkedIn stays manual', async () => {
    read.mockResolvedValue({
      display_name: 'LifeKeel',
      bio: 'old bio',
      has_avatar: true,
      has_banner: false,
      checked_at: new Date(),
    })
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/marketing/profiles/bluesky/check' })
    expect(res.statusCode).toBe(200)
    expect(res.json().drift.map((d: { field: string }) => d.field)).toEqual(['bio', 'banner'])
    expect(read).toHaveBeenCalledWith('lifekeel.co.uk')
    const manual = await app.inject({ method: 'POST', url: '/marketing/profiles/linkedin/check' })
    expect(manual.statusCode).toBe(400)
    expect(manual.json().error).toBe('manual_channel')
  })

  describe('apply (Tier 2)', () => {
    const hash = () => desiredHash(DEFAULT_PROFILES.bluesky)

    it('needs the hash of the reviewed text and refuses a stale one', async () => {
      const app = await buildApp()
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/marketing/profiles/bluesky/apply',
            payload: {},
          })
        ).statusCode,
      ).toBe(400)
      const stale = await app.inject({
        method: 'POST',
        url: '/marketing/profiles/bluesky/apply',
        payload: { expected_hash: 'deadbeef' },
      })
      expect(stale.statusCode).toBe(409)
      expect(apply).not.toHaveBeenCalled()
    })

    it('refuses without a connection, and when marketing is paused', async () => {
      const app = await buildApp()
      const none = await app.inject({
        method: 'POST',
        url: '/marketing/profiles/bluesky/apply',
        payload: { expected_hash: hash() },
      })
      expect(none.json().error).toBe('channel_not_connected')

      await db.collection('social_connections').insertOne({
        tenant_id: 't1',
        channel: 'bluesky',
        handle: 'lifekeel.co.uk',
        credentials: {},
        status: 'active',
      })
      await db.collection('platform_config').insertOne({ key: 'global', marketing_paused: true })
      invalidatePlatformConfigCache()
      const paused = await app.inject({
        method: 'POST',
        url: '/marketing/profiles/bluesky/apply',
        payload: { expected_hash: hash() },
      })
      expect(paused.statusCode).toBe(409)
      expect(apply).not.toHaveBeenCalled()
    })

    it('writes the approved text through the connection, once', async () => {
      await db.collection('social_connections').insertOne({
        tenant_id: 't1',
        channel: 'bluesky',
        handle: 'lifekeel.co.uk',
        credentials: {},
        status: 'active',
      })
      const app = await buildApp()
      const res = await app.inject({
        method: 'POST',
        url: '/marketing/profiles/bluesky/apply',
        payload: { expected_hash: hash() },
      })
      expect(res.statusCode).toBe(200)
      expect(apply).toHaveBeenCalledTimes(1)
      expect(res.json().applied_at).toBeTruthy()
    })

    it('dry-run mode rehearses without calling the network', async () => {
      await db
        .collection('tenant_settings')
        .insertOne({ tenant_id: 't1', automation: { dry_run_mode: true } })
      const app = await buildApp()
      const res = await app.inject({
        method: 'POST',
        url: '/marketing/profiles/bluesky/apply',
        payload: { expected_hash: hash() },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().dry_run).toBe(true)
      expect(apply).not.toHaveBeenCalled()
    })

    it('other networks must be updated by hand', async () => {
      const app = await buildApp()
      const res = await app.inject({
        method: 'POST',
        url: '/marketing/profiles/linkedin/apply',
        payload: { expected_hash: 'x' },
      })
      expect(res.json().error).toBe('manual_channel')
    })
  })
})

const cred = (
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

describe('profile read-back on X, Facebook, Instagram and Threads', () => {
  it('can read four more networks but still only write to Bluesky', () => {
    expect([...SUPPORTS_CHECK].sort()).toEqual(['bluesky', 'facebook', 'instagram', 'threads', 'x'])
    expect([...SUPPORTS_APPLY]).toEqual(['bluesky'])
  })

  it('reads X through the connected account', async () => {
    await db.collection('connector_credentials').insertOne(cred('twitter_x'))
    connectorRead.mockResolvedValue(
      ok({
        data: {
          name: 'LifeKeel',
          description: 'old bio',
          profile_image_url: 'https://pbs.twimg.com/profile_images/1/me.jpg',
        },
      }),
    )
    const res = await (
      await buildApp()
    ).inject({ method: 'POST', url: '/marketing/profiles/x/check' })
    expect(res.statusCode).toBe(200)
    expect(connectorRead).toHaveBeenCalledWith('t1', 'twitter_x', 'getUsersMe', {})
    expect(res.json().actual).toMatchObject({
      display_name: 'LifeKeel',
      bio: 'old bio',
      has_avatar: true,
      has_banner: null,
    })
    // The banner is unknown on X, so it is never reported as drift.
    expect(res.json().drift.map((d: { field: string }) => d.field)).toEqual(['bio'])
  })

  it('treats X’s stock avatar as no avatar', async () => {
    await db.collection('connector_credentials').insertOne(cred('twitter_x'))
    connectorRead.mockResolvedValue(
      ok({
        data: {
          name: 'LifeKeel',
          description: DEFAULT_PROFILES.x.bio,
          profile_image_url: 'https://abs.twimg.com/sticky/default_profile_images/x.png',
        },
      }),
    )
    const res = await (
      await buildApp()
    ).inject({ method: 'POST', url: '/marketing/profiles/x/check' })
    expect(res.json().drift.map((d: { field: string }) => d.field)).toEqual(['avatar'])
  })

  it('does not call a bio different just because X turns links into t.co short links', async () => {
    await db.collection('connector_credentials').insertOne(cred('twitter_x'))
    const withLink = DEFAULT_PROFILES.x.bio + ' https://lifekeel.co.uk/?utm_source=x'
    await db.collection('channel_profiles').insertOne({
      tenant_id: 't1',
      channel: 'x',
      checklist: {},
      drift: [],
      updated_by: 'u',
      updated_at: new Date(),
      desired: { ...DEFAULT_PROFILES.x, bio: withLink },
    })
    connectorRead.mockResolvedValue(
      ok({
        data: {
          name: 'LifeKeel',
          description: DEFAULT_PROFILES.x.bio + ' https://t.co/AbCdEf',
          profile_image_url: 'https://pbs.twimg.com/a.jpg',
        },
      }),
    )
    const res = await (
      await buildApp()
    ).inject({ method: 'POST', url: '/marketing/profiles/x/check' })
    expect(res.json().drift).toEqual([])
  })

  it('reads a Facebook Page by the stored page id, and notices a missing picture and cover', async () => {
    await db
      .collection('connector_credentials')
      .insertOne(cred('facebook_pages', { page_id: 'PAGE-1' }))
    connectorRead.mockResolvedValue(
      ok({
        name: 'LifeKeel',
        about: DEFAULT_PROFILES.facebook.bio,
        picture: { data: { is_silhouette: true } },
      }),
    )
    const res = await (
      await buildApp()
    ).inject({ method: 'POST', url: '/marketing/profiles/facebook/check' })
    expect(connectorRead).toHaveBeenCalledWith('t1', 'facebook_pages', 'get_profile', {
      page_id: 'PAGE-1',
    })
    expect(res.json().drift.map((d: { field: string }) => d.field)).toEqual(['avatar', 'banner'])
  })

  it('reads an Instagram account and a Threads profile', async () => {
    await db
      .collection('connector_credentials')
      .insertMany([cred('instagram_business', { ig_user_id: 'IG-1' }), cred('threads')])
    const app = await buildApp()
    connectorRead.mockResolvedValueOnce(
      ok({
        name: '',
        username: 'lifekeel',
        biography: 'old',
        profile_picture_url: 'https://x/y.jpg',
      }),
    )
    const ig = await app.inject({ method: 'POST', url: '/marketing/profiles/instagram/check' })
    expect(connectorRead).toHaveBeenLastCalledWith('t1', 'instagram_business', 'get_profile', {
      ig_user_id: 'IG-1',
    })
    expect(ig.json().actual).toMatchObject({
      display_name: 'lifekeel',
      bio: 'old',
      has_avatar: true,
      has_banner: null,
    })

    connectorRead.mockResolvedValueOnce(
      ok({
        username: 'lifekeel',
        name: 'LifeKeel',
        threads_biography: DEFAULT_PROFILES.threads.bio,
        threads_profile_picture_url: 'https://x/t.jpg',
      }),
    )
    const th = await app.inject({ method: 'POST', url: '/marketing/profiles/threads/check' })
    expect(connectorRead).toHaveBeenLastCalledWith('t1', 'threads', 'get_profile', {})
    expect(th.json().drift).toEqual([])
  })

  it('says why when the channel is not connected, needs reconnecting, or the platform refuses', async () => {
    const app = await buildApp()
    const none = await app.inject({ method: 'POST', url: '/marketing/profiles/x/check' })
    expect(none.statusCode).toBe(502)
    expect(none.json().message).toMatch(/x is not connected/)

    await db
      .collection('connector_credentials')
      .insertOne(cred('twitter_x', {}, { needs_reauth: true }))
    expect(
      (await app.inject({ method: 'POST', url: '/marketing/profiles/x/check' })).json().message,
    ).toMatch(/reconnect/)

    await db.collection('connector_credentials').deleteMany({})
    await db.collection('connector_credentials').insertOne(cred('twitter_x'))
    connectorRead.mockResolvedValue({ ok: false, status: 403, body: {} })
    expect(
      (await app.inject({ method: 'POST', url: '/marketing/profiles/x/check' })).json().message,
    ).toMatch(/HTTP 403/)
    expect(connectorRead).toHaveBeenCalledTimes(1)
  })

  it('needs a Page id to read Facebook and an account id to read Instagram', async () => {
    await db
      .collection('connector_credentials')
      .insertMany([cred('facebook_pages'), cred('instagram_business')])
    const app = await buildApp()
    expect(
      (await app.inject({ method: 'POST', url: '/marketing/profiles/facebook/check' })).json()
        .message,
    ).toMatch(/no Page id/)
    expect(
      (await app.inject({ method: 'POST', url: '/marketing/profiles/instagram/check' })).json()
        .message,
    ).toMatch(/no account id/)
    expect(connectorRead).not.toHaveBeenCalled()
  })

  it('never offers to write anywhere but Bluesky', async () => {
    const app = await buildApp()
    for (const c of ['x', 'facebook', 'instagram', 'threads', 'linkedin']) {
      const r = await app.inject({
        method: 'POST',
        url: `/marketing/profiles/${c}/apply`,
        payload: { expected_hash: 'x' },
      })
      expect(r.statusCode, c).toBe(400)
      expect(r.json().error).toBe('manual_channel')
    }
  })

  it('readConnectorProfile only calls a read action and passes nothing but ids', async () => {
    await db
      .collection('connector_credentials')
      .insertOne(cred('facebook_pages', { page_id: 'P' }, { access_token: 'SECRET' }))
    const calls: unknown[][] = []
    await readConnectorProfile(db, 't1', 'facebook', async (...a) => {
      calls.push(a)
      return ok({ name: 'n', about: 'a', picture: { data: { is_silhouette: false } }, cover: {} })
    })
    expect(JSON.stringify(calls)).not.toContain('SECRET')
    expect(calls[0]![2]).toBe('get_profile')
  })
})

describe('computeDrift with unknown pictures', () => {
  it('never reports a picture it cannot see', () => {
    const d = DEFAULT_PROFILES.threads
    const actual = {
      display_name: d.display_name,
      bio: d.bio,
      has_avatar: null,
      has_banner: null,
      checked_at: new Date(),
    }
    expect(computeDrift(d, actual, 'threads')).toEqual([])
  })
})
