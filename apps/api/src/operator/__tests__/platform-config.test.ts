import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  currentLlmProviderOverride,
  getPlatformConfig,
  invalidatePlatformConfigCache,
  registerPublicStatusRoute,
  CONFIG_DOC_KEY,
} from '../platform-config.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('platform-config-test')
})

beforeEach(async () => {
  await db.collection('platform_config').deleteMany({})
  invalidatePlatformConfigCache()
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('getPlatformConfig', () => {
  it('returns permissive defaults when no config doc exists', async () => {
    const config = await getPlatformConfig(db)
    expect(config).toEqual({
      maintenance_mode: false,
      maintenance_window: null,
      signups_enabled: true,
      marketing_paused: false,
      autopilot_paused: false,
      ai_disabled_tasks: [],
      llm_provider_override: null,
    })
  })

  it('reads stored flags and caches them for the TTL', async () => {
    await db
      .collection('platform_config')
      .insertOne({ key: CONFIG_DOC_KEY, maintenance_mode: true, signups_enabled: false })
    const config = await getPlatformConfig(db)
    expect(config.maintenance_mode).toBe(true)
    expect(config.signups_enabled).toBe(false)
    expect(config.marketing_paused).toBe(false)

    // Cache hit — a direct write underneath is invisible until invalidation.
    await db
      .collection('platform_config')
      .updateOne({ key: CONFIG_DOC_KEY }, { $set: { maintenance_mode: false } })
    expect((await getPlatformConfig(db)).maintenance_mode).toBe(true)
    invalidatePlatformConfigCache()
    expect((await getPlatformConfig(db)).maintenance_mode).toBe(false)
  })

  it('parses a stored provider override and exposes it to sync readers', async () => {
    await db
      .collection('platform_config')
      .insertOne({ key: CONFIG_DOC_KEY, llm_provider_override: 'vertex' })
    const config = await getPlatformConfig(db)
    expect(config.llm_provider_override).toBe('vertex')
    expect(currentLlmProviderOverride()).toBe('vertex')
  })

  it('treats malformed provider values as no override', async () => {
    await db
      .collection('platform_config')
      .insertOne({ key: CONFIG_DOC_KEY, llm_provider_override: 'not-a-provider' })
    expect((await getPlatformConfig(db)).llm_provider_override).toBeNull()
    invalidatePlatformConfigCache()
    await db
      .collection('platform_config')
      .updateOne({ key: CONFIG_DOC_KEY }, { $set: { llm_provider_override: 42 } })
    expect((await getPlatformConfig(db)).llm_provider_override).toBeNull()
  })
})

describe('GET /status', () => {
  it('reports maintenance_mode and signups_enabled, and nothing else', async () => {
    await db.collection('platform_config').insertOne({
      key: CONFIG_DOC_KEY,
      maintenance_mode: true,
      signups_enabled: false,
      marketing_paused: true,
    })
    const app = Fastify()
    registerPublicStatusRoute(app, () => db)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/status' })
    expect(res.statusCode).toBe(200)
    // marketing_paused is deliberately not exposed publicly — operators only.
    expect(res.json()).toEqual({ maintenance_mode: true, signups_enabled: false })
    await app.close()
  })

  it('reports permissive defaults while the db is still booting', async () => {
    const app = Fastify()
    registerPublicStatusRoute(app, () => undefined)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/status' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ maintenance_mode: false, signups_enabled: true })
    await app.close()
  })
})
