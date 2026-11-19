/**
 * DeliveryRetryWorker — insights stuck 'identified' after a crash between
 * persistence and inline delivery get their deliver() path resumed. Uses a
 * real MongoDB (mongodb-memory-server) so the atomic findOneAndUpdate claim
 * is genuinely exercised under concurrent runs, and a stub router so the
 * retry/claim bookkeeping is what's under test.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { DeliveryRetryWorker } from '../delivery-retry-worker.js'

const RETRY_DELAY_MS = 15 * 60_000
const T = 'tenant-1'

describe('DeliveryRetryWorker', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
    db = client.db('delivery_retry_test')
  })

  afterEach(async () => {
    await client.close()
    await mongod.stop()
  })

  function stubRouter(outcome: 'success' | 'failure' | 'gated' | 'throw' = 'success') {
    const calls: string[] = []
    const router = {
      deliver: async (insight: Record<string, unknown>) => {
        calls.push(insight['id'] as string)
        if (outcome === 'throw') throw new Error('provider down')
        if (outcome === 'gated') return null // quiet hours / budget deny / no channel
        return {
          channel: 'email' as const,
          success: outcome === 'success',
          delivered_at: new Date(),
        }
      },
    }
    return { router, calls }
  }

  async function seedInsight(id: string, over: Record<string, unknown> = {}, now = new Date()) {
    await db.collection('insights').insertOne({
      id,
      tenant_id: T,
      state: 'identified',
      created_at: new Date(now.getTime() - 2 * RETRY_DELAY_MS),
      ...over,
    })
  }

  it('retries a stuck identified insight and reports the delivery', async () => {
    const now = new Date()
    await seedInsight('insight-1', {}, now)
    const { router, calls } = stubRouter('success')

    const result = await new DeliveryRetryWorker(db, router).run(now)

    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0, gated: 0 })
    expect(calls).toEqual(['insight-1'])
    const doc = await db.collection('insights').findOne({ id: 'insight-1' })
    expect(doc?.['delivery_retry_count']).toBe(1)
    expect(doc?.['delivery_retry_at']).toBeInstanceOf(Date)
  })

  it('ignores insights too fresh to retry', async () => {
    const now = new Date()
    await db.collection('insights').insertOne({
      id: 'fresh',
      tenant_id: T,
      state: 'identified',
      created_at: new Date(now.getTime() - 60_000), // 1 min old, under the delay
    })
    const { router, calls } = stubRouter()

    const result = await new DeliveryRetryWorker(db, router).run(now)

    expect(result.claimed).toBe(0)
    expect(calls).toEqual([])
  })

  it('ignores insights already sent or resolved', async () => {
    const now = new Date()
    await seedInsight('sent-1', { state: 'sent' }, now)
    await seedInsight('resolved-1', { state: 'resolved' }, now)
    const { router, calls } = stubRouter()

    const result = await new DeliveryRetryWorker(db, router).run(now)

    expect(result.claimed).toBe(0)
    expect(calls).toEqual([])
  })

  it('stops claiming after the retry cap, even when delivery keeps failing', async () => {
    const now = new Date()
    await seedInsight('undeliverable', { delivery_retry_count: 3 }, now)
    const { router, calls } = stubRouter('failure')

    const result = await new DeliveryRetryWorker(db, router).run(now)

    expect(result.claimed).toBe(0)
    expect(calls).toEqual([])
  })

  it('counts a throwing router as failed, not delivered', async () => {
    const now = new Date()
    await seedInsight('insight-1', {}, now)
    const { router } = stubRouter('throw')

    const result = await new DeliveryRetryWorker(db, router).run(now)

    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 1, gated: 0 })
    // The count was still consumed — bounded retries, not a stuck row.
    const doc = await db.collection('insights').findOne({ id: 'insight-1' })
    expect(doc?.['delivery_retry_count']).toBe(1)
  })

  it('counts a success:false result as failed — every channel tried and lost', async () => {
    const now = new Date()
    await seedInsight('insight-1', {}, now)
    const { router } = stubRouter('failure')

    const result = await new DeliveryRetryWorker(db, router).run(now)

    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 1, gated: 0 })
  })

  it('counts a null result as gated — the gate did its job, not a failure', async () => {
    const now = new Date()
    await seedInsight('insight-1', {}, now)
    const { router } = stubRouter('gated')

    const result = await new DeliveryRetryWorker(db, router).run(now)

    expect(result).toEqual({ claimed: 1, delivered: 0, failed: 0, gated: 1 })
  })

  it('two concurrent runs on the same tick claim each insight exactly once', async () => {
    const now = new Date()
    await seedInsight('insight-1', {}, now)
    await seedInsight('insight-2', {}, now)
    const { router, calls } = stubRouter('success')
    const worker = new DeliveryRetryWorker(db, router)

    const [a, b] = await Promise.all([worker.run(now), worker.run(now)])

    expect(a.claimed + b.claimed).toBe(2)
    expect(calls.sort()).toEqual(['insight-1', 'insight-2'])
  })
})
