/**
 * CLAUDE.md rule 3 / IMS G-AI-05 against a real MongoDB: the stale federated
 * scorer artifact leaves the warm-start path and expires.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  FEDERATED_QUARANTINE_COLLECTION,
  FEDERATED_QUARANTINE_TTL_SECONDS,
  migrations,
} from '../migrate.js'

const ID = '20261120000000-quarantine-federated-global-models'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('federated-quarantine-test')
})
beforeEach(async () => {
  await db.dropDatabase()
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

const run = () => migrations.find((m) => m.id === ID)!.up(db)

async function collectionNames(): Promise<string[]> {
  return (await db.listCollections().toArray()).map((c) => c.name).sort()
}

describe(ID, () => {
  it('moves the artifact out of federated_global_models and stamps it for expiry', async () => {
    await db
      .collection('federated_global_models')
      .insertOne({ _id: 'latest' as never, weights: [1] })

    await run()

    expect(await collectionNames()).toEqual([FEDERATED_QUARANTINE_COLLECTION])
    const doc = await db.collection(FEDERATED_QUARANTINE_COLLECTION).findOne({})
    expect(doc?.['quarantined_at']).toBeInstanceOf(Date)
    const ttl = (await db.collection(FEDERATED_QUARANTINE_COLLECTION).indexes()).find(
      (i) => i.key['quarantined_at'] === 1,
    )
    expect(ttl?.expireAfterSeconds).toBe(FEDERATED_QUARANTINE_TTL_SECONDS)
    expect(FEDERATED_QUARANTINE_TTL_SECONDS).toBe(7_776_000)
  })

  it('succeeds with no artifact and leaves only the empty quarantine index', async () => {
    await run()

    expect(await collectionNames()).toEqual([FEDERATED_QUARANTINE_COLLECTION])
    expect(await db.collection(FEDERATED_QUARANTINE_COLLECTION).countDocuments()).toBe(0)
  })

  it('refuses to merge into an existing quarantine collection', async () => {
    await db.collection('federated_global_models').insertOne({ weights: [1] })
    await db.collection(FEDERATED_QUARANTINE_COLLECTION).insertOne({ weights: [2] })

    await expect(run()).rejects.toThrow()
    expect(await db.collection('federated_global_models').countDocuments()).toBe(1)
  })
})
