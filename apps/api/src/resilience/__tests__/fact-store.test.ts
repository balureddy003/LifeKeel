import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { recordFact, factsAsOf, FACT_KEYS } from '../fact-store.js'
import { DELETABLE_COLLECTIONS, eraseTenantDataReport } from '../../erasure.js'

// Intent 94, B3 (owner decision 2026-11-14: MongoDB with valid_from and recorded_at on each fact).
const T = 'tenant-a'
const OTHER = 'tenant-b'
const d = (s: string) => new Date(`${s}T00:00:00Z`)

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('fact-store-test')
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})
beforeEach(async () => {
  await db.collection('engine_facts').deleteMany({})
})

describe('two-date fact store', () => {
  it('as of a date: the latest fact that was true by then and known by then', async () => {
    // Savings were 5,000 from January (entered 1 Feb), then 6,000 from March (entered 2 Mar).
    await recordFact(db, T, {
      key: 'savings_minor',
      valueMinor: 500000,
      validFrom: d('2026-01-01'),
      enteredBy: 'u1',
      recordedAt: d('2026-02-01'),
    })
    await recordFact(db, T, {
      key: 'savings_minor',
      valueMinor: 600000,
      validFrom: d('2026-03-01'),
      enteredBy: 'u1',
      recordedAt: d('2026-03-02'),
    })
    const at = (validAt: string, knownAt: string) =>
      factsAsOf(db, T, { validAt: d(validAt), knownAt: d(knownAt) })
    expect((await at('2026-04-01', '2026-04-01')).savings_minor).toBe(600000)
    expect((await at('2026-02-15', '2026-04-01')).savings_minor).toBe(500000)
    // known-at matters: on 1 March the 6,000 was not yet entered, so we knew only 5,000
    expect((await at('2026-03-15', '2026-03-01')).savings_minor).toBe(500000)
    // before anything was entered there is nothing
    expect((await at('2026-04-01', '2026-01-15')).savings_minor).toBeUndefined()
  })

  it('a correction: same valid_from entered later wins once it is known', async () => {
    await recordFact(db, T, {
      key: 'monthly_spend_minor',
      valueMinor: 200000,
      validFrom: d('2026-01-01'),
      enteredBy: 'u1',
      recordedAt: d('2026-01-02'),
    })
    await recordFact(db, T, {
      key: 'monthly_spend_minor',
      valueMinor: 210000,
      validFrom: d('2026-01-01'),
      enteredBy: 'u1',
      recordedAt: d('2026-02-10'),
    })
    expect(
      (await factsAsOf(db, T, { validAt: d('2026-03-01'), knownAt: d('2026-03-01') }))
        .monthly_spend_minor,
    ).toBe(210000)
    expect(
      (await factsAsOf(db, T, { validAt: d('2026-03-01'), knownAt: d('2026-02-01') }))
        .monthly_spend_minor,
    ).toBe(200000)
  })

  it('history is append-only: a new fact never overwrites an old row', async () => {
    await recordFact(db, T, {
      key: 'savings_minor',
      valueMinor: 1,
      validFrom: d('2026-01-01'),
      enteredBy: 'u1',
    })
    await recordFact(db, T, {
      key: 'savings_minor',
      valueMinor: 2,
      validFrom: d('2026-01-01'),
      enteredBy: 'u1',
    })
    expect(await db.collection('engine_facts').countDocuments({ tenant_id: T })).toBe(2)
  })

  it('is tenant-scoped: one household never sees another', async () => {
    await recordFact(db, T, {
      key: 'savings_minor',
      valueMinor: 111,
      validFrom: d('2026-01-01'),
      enteredBy: 'u1',
    })
    await recordFact(db, OTHER, {
      key: 'savings_minor',
      valueMinor: 999,
      validFrom: d('2026-01-01'),
      enteredBy: 'u9',
    })
    expect(
      (await factsAsOf(db, T, { validAt: new Date(), knownAt: new Date() })).savings_minor,
    ).toBe(111)
  })

  it('only money figures from the allow-list: no free text, no unknown keys, whole non-negative amounts', async () => {
    await expect(
      recordFact(db, T, {
        key: 'diagnosis' as never,
        valueMinor: 1,
        validFrom: d('2026-01-01'),
        enteredBy: 'u1',
      }),
    ).rejects.toThrow()
    await expect(
      recordFact(db, T, {
        key: 'savings_minor',
        valueMinor: -1,
        validFrom: d('2026-01-01'),
        enteredBy: 'u1',
      }),
    ).rejects.toThrow()
    await expect(
      recordFact(db, T, {
        key: 'savings_minor',
        valueMinor: 1.5,
        validFrom: d('2026-01-01'),
        enteredBy: 'u1',
      }),
    ).rejects.toThrow()
    await expect(
      recordFact(db, T, {
        key: 'savings_minor',
        valueMinor: 1,
        validFrom: new Date('nope'),
        enteredBy: 'u1',
      }),
    ).rejects.toThrow()
    expect(FACT_KEYS.every((k) => k.endsWith('_minor'))).toBe(true)
  })

  it('erasure removes the history: engine_facts is in the wipe and a deletion leaves no rows', async () => {
    expect(DELETABLE_COLLECTIONS).toContain('engine_facts')
    await recordFact(db, T, {
      key: 'savings_minor',
      valueMinor: 1,
      validFrom: d('2026-01-01'),
      enteredBy: 'u1',
    })
    await recordFact(db, OTHER, {
      key: 'savings_minor',
      valueMinor: 2,
      validFrom: d('2026-01-01'),
      enteredBy: 'u9',
    })
    await eraseTenantDataReport(db, T)
    expect(await db.collection('engine_facts').countDocuments({ tenant_id: T })).toBe(0)
    expect(await db.collection('engine_facts').countDocuments({ tenant_id: OTHER })).toBe(1)
  })
})
