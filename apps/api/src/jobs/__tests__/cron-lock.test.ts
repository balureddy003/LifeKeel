/**
 * KEEL-003: the shared distributed cron lock. Uses a real MongoDB
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
    expect(await acquireCronLock(db, 'test-job')).toEqual(expect.any(String))
  })

  it('an expired owner cannot release a newer owner’s lease', async () => {
    const first = await acquireCronLock(db, 'expired-owner', 10)
    await new Promise(resolve => setTimeout(resolve, 30))
    const second = await acquireCronLock(db, 'expired-owner')
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    await releaseCronLock(db, 'expired-owner', first as string)
    expect(await acquireCronLock(db, 'expired-owner')).toBe(false)
  })

  it('a second acquire of the same name fails while the first still holds it', async () => {
    expect(await acquireCronLock(db, 'test-job')).toEqual(expect.any(String))
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
    const owner = await acquireCronLock(db, 'test-job')
    expect(owner).toEqual(expect.any(String))
    await releaseCronLock(db, 'test-job', owner as string)
    expect(await acquireCronLock(db, 'test-job')).toEqual(expect.any(String))
  })

  it('succeeds again after the TTL expires, without an explicit release', async () => {
    expect(await acquireCronLock(db, 'test-job', 10)).toEqual(expect.any(String))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(await acquireCronLock(db, 'test-job', 10)).toEqual(expect.any(String))
  })

  it('different lock names do not contend with each other', async () => {
    expect(await acquireCronLock(db, 'job-a')).toEqual(expect.any(String))
    expect(await acquireCronLock(db, 'job-b')).toEqual(expect.any(String))
  })
})
