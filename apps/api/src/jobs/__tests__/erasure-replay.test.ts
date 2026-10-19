/**
 * erasure-replay — the backup↔erasure reconciliation job.
 *
 * The hazard it exists for: a --drop restore of a pre-deletion backup
 * resurrects the deleted tenant's rows. Re-running the wipe for every
 * status:'deleted' tenant makes erasure durable across restores.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, type Db } from 'mongodb'
import { runErasureReplay } from '../erasure-replay.js'
import { eraseTenantData } from '../../erasure.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = await MongoClient.connect(mongod.getUri())
  db = client.db('erasure_replay_test')
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

beforeEach(async () => {
  for (const name of await db.listCollections().toArray()) {
    await db.collection(name.name).drop()
  }
})

async function seedTenant(tenantId: string) {
  await db.collection('tenants').insertOne({ tenant_id: tenantId, status: 'active' })
  await db
    .collection('users')
    .insertOne({ tenant_id: tenantId, id: `u_${tenantId}`, email: `${tenantId}@x.io` })
  await db.collection('insights').insertOne({ tenant_id: tenantId, claim: 'x' })
  await db.collection('growth_events').insertOne({ meta: { tenant_id: tenantId }, name: 'e' })
}

describe('runErasureReplay', () => {
  it('re-wipes a tombstoned tenant whose data a stale restore resurrected', async () => {
    await seedTenant('t_dead')
    await eraseTenantData(db, 't_dead')
    await db
      .collection('tenants')
      .updateOne({ tenant_id: 't_dead' }, { $set: { status: 'deleted' } })

    // Simulate a stale backup resurrecting the data (tombstone preserved by
    // restore.sh's export/re-apply step).
    await db
      .collection('users')
      .insertOne({ tenant_id: 't_dead', id: 'u_t_dead', email: 't_dead@x.io' })
    await db.collection('insights').insertOne({ tenant_id: 't_dead', claim: 'x' })
    await db.collection('growth_events').insertOne({ meta: { tenant_id: 't_dead' }, name: 'e' })

    const result = await runErasureReplay(db)

    expect(result.tenants_replayed).toBe(1)
    expect(await db.collection('users').countDocuments({ tenant_id: 't_dead' })).toBe(0)
    expect(await db.collection('insights').countDocuments({ tenant_id: 't_dead' })).toBe(0)
    expect(
      await db.collection('growth_events').countDocuments({ 'meta.tenant_id': 't_dead' }),
    ).toBe(0)
  })

  it('leaves active tenants untouched and is a no-op with no tombstones', async () => {
    await seedTenant('t_live')
    const result = await runErasureReplay(db)
    expect(result.tenants_replayed).toBe(0)
    expect(await db.collection('users').countDocuments({ tenant_id: 't_live' })).toBe(1)
  })
})
