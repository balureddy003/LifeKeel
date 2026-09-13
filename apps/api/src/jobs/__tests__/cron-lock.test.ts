/**
 * OAK-003: the shared distributed cron lock. Uses a real MongoDB
 * (mongodb-memory-server) rather than a hand-rolled mock, since atomicity
 * of the underlying findOneAndUpdate is exactly the property under test —
 * a mock would only prove the code calls the right method, not that two
 * concurrent callers actually can't both win.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { acquireCronLock, releaseCronLock, ensureCronLockIndex } from '../cron-lock.js'

describe('cron-lock', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
    db = client.db('cron_lock_test')
    await ensureCronLockIndex(db)
  })

  afterEach(async () => {
    await client.close()
    await mongod.stop()
  })

  it('acquires an uncontended lock', async () => {
    expect(await acquireCronLock(db, 'test-job')).toBe(true)
  })

  it('a second acquire of the same name fails while the first still holds it', async () => {
    expect(await acquireCronLock(db, 'test-job')).toBe(true)
    expect(await acquireCronLock(db, 'test-job')).toBe(false)
  })

  it('a concurrent acquire race lets exactly one caller win', async () => {
    const results = await Promise.all([
      acquireCronLock(db, 'race-job'),
      acquireCronLock(db, 'race-job'),
      acquireCronLock(db, 'race-job'),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('succeeds again after release', async () => {
    expect(await acquireCronLock(db, 'test-job')).toBe(true)
    await releaseCronLock(db, 'test-job')
    expect(await acquireCronLock(db, 'test-job')).toBe(true)
  })

  it('succeeds again after the TTL expires, without an explicit release', async () => {
    expect(await acquireCronLock(db, 'test-job', 10)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(await acquireCronLock(db, 'test-job', 10)).toBe(true)
  })

  it('different lock names do not contend with each other', async () => {
    expect(await acquireCronLock(db, 'job-a')).toBe(true)
    expect(await acquireCronLock(db, 'job-b')).toBe(true)
  })
})
