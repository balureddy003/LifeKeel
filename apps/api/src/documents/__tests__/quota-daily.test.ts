/**
 * The daily upload counter is created on a tenant's first upload of the day.
 * Several files picked at once all hit that first creation together. A
 * duplicate-key collision there is a race, not "limit reached": only a counter
 * that is genuinely at the limit may refuse with daily_limit.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { type Db, MongoClient } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { ensureQuotaIndexes, reserveUpload } from '../quota.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = await MongoClient.connect(mongod.getUri())
  db = client.db('quota-daily')
}, 60_000)

afterAll(async () => {
  await client?.close()
  await mongod?.stop()
})

beforeEach(async () => {
  await db.dropDatabase()
  await ensureQuotaIndexes(db)
  delete process.env['MAX_TENANT_UPLOADS_PER_DAY']
})

describe('daily upload counter under a burst', () => {
  it('a burst on a fresh day is never refused as "daily limit"', async () => {
    // Many tenants, each with a simultaneous first-of-day burst, so a creation
    // race shows up reliably instead of once in a while.
    const bursts = await Promise.all(
      Array.from({ length: 40 }, (_, t) =>
        Promise.all(
          Array.from({ length: 8 }, () =>
            reserveUpload(db, `tenant-${t}`, 1, { countsInflight: false }),
          ),
        ),
      ),
    )
    const refused = bursts.flat().filter((r) => r !== null)
    expect(refused).toEqual([])
  }, 60_000)

  it('still refuses with daily_limit once the counter is really at the limit', async () => {
    process.env['MAX_TENANT_UPLOADS_PER_DAY'] = '2'
    const results = await Promise.all(
      Array.from({ length: 5 }, () => reserveUpload(db, 'tenant-x', 1, { countsInflight: false })),
    )
    expect(results.filter((r) => r === null)).toHaveLength(2)
    const refusals = results.filter((r) => r !== null)
    expect(refusals).toHaveLength(3)
    expect(refusals.every((r) => r?.error === 'daily_limit')).toBe(true)
    // Refused attempts give their bytes back: only the two accepted stay reserved.
    const q = await db.collection('tenant_quota').findOne({ tenant_id: 'tenant-x' })
    expect(q?.['bytes_reserved']).toBe(2)
  })
})
