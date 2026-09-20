import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { getPlatformConfig, invalidatePlatformConfigCache, CONFIG_DOC_KEY } from '../platform-config.js'

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
    expect(config).toEqual({ maintenance_mode: false, signups_enabled: true, marketing_paused: false })
  })

  it('reads stored flags and caches them for the TTL', async () => {
    await db.collection('platform_config').insertOne({ key: CONFIG_DOC_KEY, maintenance_mode: true, signups_enabled: false })
    const config = await getPlatformConfig(db)
    expect(config.maintenance_mode).toBe(true)
    expect(config.signups_enabled).toBe(false)
    expect(config.marketing_paused).toBe(false)

    // Cache hit — a direct write underneath is invisible until invalidation.
    await db.collection('platform_config').updateOne({ key: CONFIG_DOC_KEY }, { $set: { maintenance_mode: false } })
    expect((await getPlatformConfig(db)).maintenance_mode).toBe(true)
    invalidatePlatformConfigCache()
    expect((await getPlatformConfig(db)).maintenance_mode).toBe(false)
  })
})
