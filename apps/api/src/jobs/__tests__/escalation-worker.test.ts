/**
 * KEEL-003: EscalationWorker.run() must not enqueue the same crisis
 * escalation twice when two API replicas race the same 15-minute cron
 * tick. Uses a real MongoDB (mongodb-memory-server) so the atomic
 * findOneAndUpdate guard is genuinely exercised under concurrency, not
 * just asserted by reading the code.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { EscalationWorker } from '../escalation-worker.js'

describe('EscalationWorker', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
    db = client.db('escalation_worker_test')
  })

  afterEach(async () => {
    await client.close()
    await mongod.stop()
  })

  async function seedOneEligibleInsight(now: Date) {
    await db.collection('delivery_preferences').insertOne({
      tenant_id: 'tenant-1',
      escalation: { timeout_minutes: 30, escalation_channel: 'sms', escalation_target: '+15550000000' },
    })
    await db.collection('insights').insertOne({
      id: 'insight-1',
      tenant_id: 'tenant-1',
      state: 'sent',
      delivered_at: new Date(now.getTime() - 60 * 60 * 1000),
    })
  }

  it('queues exactly one escalation for one eligible insight', async () => {
    const now = new Date()
    await seedOneEligibleInsight(now)

    const worker = new EscalationWorker(db)
    const queued = await worker.run(now)

    expect(queued).toBe(1)
    expect(await db.collection('delivery_queue').countDocuments({})).toBe(1)
    const insight = await db.collection('insights').findOne({ id: 'insight-1' })
    expect(insight?.['escalated_at']).toBeInstanceOf(Date)
  })

  it('two concurrent replicas racing the same tick enqueue exactly one delivery, not two', async () => {
    const now = new Date()
    await seedOneEligibleInsight(now)

    const worker = new EscalationWorker(db)
    const [a, b] = await Promise.all([worker.run(now), worker.run(now)])

    expect(a + b).toBe(1)
    expect(await db.collection('delivery_queue').countDocuments({})).toBe(1)
  })

  it('does not re-escalate an insight already marked escalated', async () => {
    const now = new Date()
    await seedOneEligibleInsight(now)
    const worker = new EscalationWorker(db)
    await worker.run(now)

    const secondRun = await worker.run(new Date(now.getTime() + 1000))
    expect(secondRun).toBe(0)
    expect(await db.collection('delivery_queue').countDocuments({})).toBe(1)
  })
})
