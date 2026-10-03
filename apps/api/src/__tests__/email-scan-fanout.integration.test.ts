/**
 * Integration test for the email-scan fan-out against REAL Redis and REAL MongoDB.
 *
 * The unit tests (email-scan.test.ts) use fakes; this checks the parts fakes cannot: the queue
 * actually delivers each job once, the per-tenant lock (a Mongo document) really stops two workers
 * scanning the same mailbox, and the enqueue dedupe window works on a real collection.
 *
 * Runs wherever MONGODB_URL and REDIS_URL are reachable (CI provides both as service containers).
 * Locally without them it is skipped with a reason; in CI (CI=true) a missing service FAILS the
 * test rather than silently skipping, so an infrastructure problem cannot hide as a green run.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

const scannedUsers: string[] = []
let fetchDelayMs = 0
vi.mock('../email/imap-client.js', () => ({
  fetchRecentEmails: vi.fn(async (creds: { username: string }) => {
    scannedUsers.push(creds.username)
    if (fetchDelayMs) await new Promise(r => setTimeout(r, fetchDelayMs))
    return { emails: [], highestUid: 0 }
  }),
}))

const { queueManager } = await import('../queue/QueueManager.js')
const { getMongoClient } = await import('../db.js')
const { enqueueConnectedInboxScans, runQueuedInboxScan, EMAIL_SCAN_QUEUE } = await import('../jobs/email-scan.js')
const { ensureCronLockIndex } = await import('../jobs/cron-lock.js')

const inCi = process.env['CI'] === 'true'
let available = false
let unavailableReason = ''
let db: import('mongodb').Db | undefined
const dbName = `agentoak_fanout_it_${randomUUID().slice(0, 8)}`

try {
  await queueManager.connect()
  if (!queueManager.isAvailable()) throw new Error('Redis not reachable')
  const client = await Promise.race([
    getMongoClient(),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('MongoDB not reachable within 5s')), 5000)),
  ])
  db = client.db(dbName)
  await db.command({ ping: 1 })
  available = true
} catch (err) {
  unavailableReason = (err as Error).message
}

const tenants = ['t-a', 't-b', 't-c']
const credential = (tenant: string) => ({
  tenant_id: tenant, connector_id: 'email', auth_type: 'imap', username: `${tenant}@example.com`,
  password: 'plaintext-in-test', extra: { host: 'imap.example.com', port: 993, use_tls: true },
})

async function waitFor(cond: () => boolean, ms = 10_000): Promise<void> {
  const until = Date.now() + ms
  while (!cond()) {
    if (Date.now() > until) throw new Error('timed out waiting for condition')
    await new Promise(r => setTimeout(r, 50))
  }
}

describe.skipIf(!available && !inCi)('email scan fan-out (real Redis + MongoDB)', () => {
  beforeAll(async () => {
    if (!available) throw new Error(`Infrastructure required in CI but unavailable: ${unavailableReason}`)
    // Production creates this unique index at startup (server.ts); the lock's mutual exclusion depends on it.
    await ensureCronLockIndex(db!)
    await db!.collection('tenants').insertMany(tenants.map(t => ({ tenant_id: t, plan: 'starter' })))
    await db!.collection('connector_credentials').insertMany(tenants.map(credential))
    // Same wiring as server.ts: one subscription, handler scoped to this test database.
    queueManager.subscribe(EMAIL_SCAN_QUEUE, payload => runQueuedInboxScan(db!, payload), { concurrency: 2 })
  })

  afterAll(async () => {
    await db?.dropDatabase()
    await queueManager.shutdown()
  })

  it('delivers exactly one scan per mailbox through the real queue, and records the enqueue', async () => {
    scannedUsers.length = 0
    const enqueued = await enqueueConnectedInboxScans(db!, (q, p) => queueManager.publish(q, p))
    expect(enqueued).toBe(3)

    await waitFor(() => scannedUsers.length >= 3)
    await new Promise(r => setTimeout(r, 300)) // a duplicate delivery would show up here
    expect([...scannedUsers].sort()).toEqual(tenants.map(t => `${t}@example.com`))

    const docs = await db!.collection('connector_credentials').find({}).toArray()
    expect(docs.every(d => d['scan_enqueued_at'] instanceof Date)).toBe(true)
  })

  it('does not enqueue a mailbox again inside the 14-minute window', async () => {
    expect(await enqueueConnectedInboxScans(db!, (q, p) => queueManager.publish(q, p))).toBe(0)
    // ...and does once the window has passed.
    const later = new Date(Date.now() + 15 * 60_000)
    scannedUsers.length = 0
    expect(await enqueueConnectedInboxScans(db!, (q, p) => queueManager.publish(q, p), later)).toBe(3)
    await waitFor(() => scannedUsers.length >= 3)
  })

  it('stops two workers scanning the same mailbox at once (real Mongo lock)', async () => {
    scannedUsers.length = 0
    fetchDelayMs = 600 // keep the first scan in flight while the duplicate arrives
    try {
      // Two jobs for one tenant, delivered to the 2 concurrent workers at the same time.
      await Promise.all([
        queueManager.publish(EMAIL_SCAN_QUEUE, { tenant_id: 't-a' }),
        queueManager.publish(EMAIL_SCAN_QUEUE, { tenant_id: 't-a' }),
      ])
      await waitFor(() => scannedUsers.length >= 1)
      await new Promise(r => setTimeout(r, 1200)) // let the duplicate finish being skipped
      expect(scannedUsers).toEqual(['t-a@example.com']) // scanned once, not twice
      // The lock is released afterwards: a later job for the same tenant runs.
      await queueManager.publish(EMAIL_SCAN_QUEUE, { tenant_id: 't-a' })
      await waitFor(() => scannedUsers.length >= 2)
    } finally {
      fetchDelayMs = 0
    }
  })
})
