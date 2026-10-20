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
  validateDesired,
} from '../../marketing/channel-profiles.js'
import { NEVER_AUTONOMOUS } from '../../operator/autopilot.js'
import { invalidatePlatformConfigCache } from '../../operator/platform-config.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

const read = vi.fn()
const apply = vi.fn(async () => {})

async function buildApp() {
  const app = Fastify()
  app.addHook('onRequest', async (req) => {
    req.authContext = { user_id: 'op-1', tenant_id: 't1', roles: ['admin'] } as never
  })
  registerMarketingProfileRoutes(app, db, { operatorTenants: ['t1'], readProfile: read, applyProfile: apply })
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
    const same = { display_name: d.display_name, bio: `  ${d.bio.replace(/ /g, '  ')} `, has_avatar: true, has_banner: true, checked_at: new Date() }
    expect(computeDrift(d, same)).toEqual([])
    const off = { display_name: 'Someone', bio: 'old', has_avatar: false, has_banner: true, checked_at: new Date() }
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
    expect(profiles.every((p: { saved: boolean; problems: string[] }) => !p.saved && p.problems.length === 0)).toBe(true)
  })

  it('refuses text that fails the guard and saves text that passes', async () => {
    const app = await buildApp()
    const bad = await app.inject({ method: 'PUT', url: '/marketing/profiles/bluesky', payload: { ...DEFAULT_PROFILES.bluesky, bio: 'We recommend Aviva.' } })
    expect(bad.statusCode).toBe(422)
    const ok = await app.inject({ method: 'PUT', url: '/marketing/profiles/bluesky', payload: { ...DEFAULT_PROFILES.bluesky, bio: 'Your family chart, kept current.' } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().saved).toBe(true)
    expect(ok.json().desired.bio).toBe('Your family chart, kept current.')
  })

  it('ticks a known checklist item and rejects an unknown one', async () => {
    const app = await buildApp()
    const ok = await app.inject({ method: 'PUT', url: '/marketing/profiles/linkedin/checklist', payload: { item: 'two_admins', done: true } })
    expect(ok.json().checklist).toEqual({ two_admins: true })
    const bad = await app.inject({ method: 'PUT', url: '/marketing/profiles/linkedin/checklist', payload: { item: 'nope', done: true } })
    expect(bad.statusCode).toBe(400)
  })

  it('check reads the live Bluesky profile and stores the drift; other networks are manual', async () => {
    read.mockResolvedValue({ display_name: 'LifeKeel', bio: 'old bio', has_avatar: true, has_banner: false, checked_at: new Date() })
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/marketing/profiles/bluesky/check' })
    expect(res.statusCode).toBe(200)
    expect(res.json().drift.map((d: { field: string }) => d.field)).toEqual(['bio', 'banner'])
    expect(read).toHaveBeenCalledWith('lifekeel.co.uk')
    const manual = await app.inject({ method: 'POST', url: '/marketing/profiles/instagram/check' })
    expect(manual.statusCode).toBe(400)
    expect(manual.json().error).toBe('manual_channel')
  })

  describe('apply (Tier 2)', () => {
    const hash = () => desiredHash(DEFAULT_PROFILES.bluesky)

    it('needs the hash of the reviewed text and refuses a stale one', async () => {
      const app = await buildApp()
      expect((await app.inject({ method: 'POST', url: '/marketing/profiles/bluesky/apply', payload: {} })).statusCode).toBe(400)
      const stale = await app.inject({ method: 'POST', url: '/marketing/profiles/bluesky/apply', payload: { expected_hash: 'deadbeef' } })
      expect(stale.statusCode).toBe(409)
      expect(apply).not.toHaveBeenCalled()
    })

    it('refuses without a connection, and when marketing is paused', async () => {
      const app = await buildApp()
      const none = await app.inject({ method: 'POST', url: '/marketing/profiles/bluesky/apply', payload: { expected_hash: hash() } })
      expect(none.json().error).toBe('channel_not_connected')

      await db.collection('social_connections').insertOne({ tenant_id: 't1', channel: 'bluesky', handle: 'lifekeel.co.uk', credentials: {}, status: 'active' })
      await db.collection('platform_config').insertOne({ key: 'global', marketing_paused: true })
      invalidatePlatformConfigCache()
      const paused = await app.inject({ method: 'POST', url: '/marketing/profiles/bluesky/apply', payload: { expected_hash: hash() } })
      expect(paused.statusCode).toBe(409)
      expect(apply).not.toHaveBeenCalled()
    })

    it('writes the approved text through the connection, once', async () => {
      await db.collection('social_connections').insertOne({ tenant_id: 't1', channel: 'bluesky', handle: 'lifekeel.co.uk', credentials: {}, status: 'active' })
      const app = await buildApp()
      const res = await app.inject({ method: 'POST', url: '/marketing/profiles/bluesky/apply', payload: { expected_hash: hash() } })
      expect(res.statusCode).toBe(200)
      expect(apply).toHaveBeenCalledTimes(1)
      expect(res.json().applied_at).toBeTruthy()
    })

    it('dry-run mode rehearses without calling the network', async () => {
      await db.collection('tenant_settings').insertOne({ tenant_id: 't1', automation: { dry_run_mode: true } })
      const app = await buildApp()
      const res = await app.inject({ method: 'POST', url: '/marketing/profiles/bluesky/apply', payload: { expected_hash: hash() } })
      expect(res.statusCode).toBe(200)
      expect(res.json().dry_run).toBe(true)
      expect(apply).not.toHaveBeenCalled()
    })

    it('other networks must be updated by hand', async () => {
      const app = await buildApp()
      const res = await app.inject({ method: 'POST', url: '/marketing/profiles/linkedin/apply', payload: { expected_hash: 'x' } })
      expect(res.json().error).toBe('manual_channel')
    })
  })
})
