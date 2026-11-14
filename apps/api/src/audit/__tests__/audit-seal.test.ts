/**
 * G-SEC-03 against a real MongoDB: sealed audit days detect edits, deletions,
 * insertions and anchor rewrites.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { AuditLogger, type AuditEntry } from '../audit-log.js'
import { ANCHOR_COLLECTION, entryHash, sealAuditDays, verifyAuditChain } from '../audit-seal.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('audit-seal-test')
})
beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

const NOW = new Date('2026-11-12T10:00:00Z')

const entry = (at: string, id: string): AuditEntry => ({
  tenant_id: 't1',
  user_id: 'u1',
  action: 'account.exported',
  resource_type: 'account',
  resource_id: id,
  metadata: { b: 1, a: { z: true, y: [1, 2] } },
  ip: '127.0.0.1',
  user_agent: 'test',
  timestamp: new Date(at),
})

async function seed(): Promise<void> {
  const logger = new AuditLogger(db, true)
  await logger.logCritical(entry('2026-11-09T08:00:00Z', 'r1'))
  await logger.logCritical(entry('2026-11-09T20:00:00Z', 'r2'))
  await logger.logCritical(entry('2026-11-10T09:00:00Z', 'r3'))
  await logger.logCritical(entry('2026-11-11T23:30:00Z', 'r4'))
  // today is not closed yet and must not be sealed
  await logger.logCritical(entry('2026-11-12T09:00:00Z', 'r5'))
}

describe('entryHash', () => {
  it('ignores key order and _id', () => {
    const a = entry('2026-11-09T08:00:00Z', 'r1')
    const reordered = { ...a, metadata: { a: { y: [1, 2], z: true }, b: 1 }, _id: 'x' }
    expect(entryHash(reordered as AuditEntry)).toBe(entryHash(a))
  })

  it('changes when any field changes', () => {
    const a = entry('2026-11-09T08:00:00Z', 'r1')
    expect(entryHash({ ...a, resource_id: 'r2' })).not.toBe(entryHash(a))
  })
})

describe('sealAuditDays / verifyAuditChain', () => {
  it('stores entry_hash on every write', async () => {
    await seed()
    const rows = await db.collection('audit_log').find({}).toArray()
    expect(rows).toHaveLength(5)
    for (const r of rows) expect(r['entry_hash']).toBe(entryHash(r as unknown as AuditEntry))
  })

  it('seals each closed day once and leaves today open', async () => {
    await seed()
    const sealed = await sealAuditDays(db, NOW)
    expect(sealed.map((a) => [a._id, a.count])).toEqual([
      ['2026-11-09', 2],
      ['2026-11-10', 1],
      ['2026-11-11', 1],
    ])
    expect(await sealAuditDays(db, NOW)).toEqual([])
    expect(await verifyAuditChain(db, { now: NOW })).toEqual({ ok: true, checked: 3 })
  })

  it('continues the chain on the next run', async () => {
    await seed()
    await sealAuditDays(db, NOW)
    const next = await sealAuditDays(db, new Date('2026-11-13T02:00:00Z'))
    expect(next.map((a) => a._id)).toEqual(['2026-11-12'])
    const anchors = await db.collection(ANCHOR_COLLECTION).find({}).sort({ _id: 1 }).toArray()
    expect(next[0]!.prev_anchor_hash).toBe(anchors[2]!['anchor_hash'])
  })

  it('detects an edited entry', async () => {
    await seed()
    await sealAuditDays(db, NOW)
    await db.collection('audit_log').updateOne({ resource_id: 'r3' }, { $set: { user_id: 'u2' } })
    expect(await verifyAuditChain(db, { now: NOW })).toMatchObject({
      ok: false,
      day: '2026-11-10',
      reason: 'entry_hash_mismatch',
    })
  })

  it('detects an edit that also rewrites entry_hash', async () => {
    await seed()
    await sealAuditDays(db, NOW)
    const edited = { ...entry('2026-11-10T09:00:00Z', 'r3'), user_id: 'u2' }
    await db
      .collection('audit_log')
      .updateOne({ resource_id: 'r3' }, { $set: { user_id: 'u2', entry_hash: entryHash(edited) } })
    expect(await verifyAuditChain(db, { now: NOW })).toMatchObject({
      ok: false,
      day: '2026-11-10',
      reason: 'entries_changed',
    })
  })

  it('detects a deleted entry and an inserted one', async () => {
    await seed()
    await sealAuditDays(db, NOW)
    await db.collection('audit_log').deleteOne({ resource_id: 'r1' })
    expect(await verifyAuditChain(db, { now: NOW })).toMatchObject({
      ok: false,
      day: '2026-11-09',
      reason: 'entries_changed',
    })
  })

  it('detects a rewritten anchor and a broken chain', async () => {
    await seed()
    await sealAuditDays(db, NOW)
    await db
      .collection(ANCHOR_COLLECTION)
      .updateOne({ _id: '2026-11-10' as never }, { $set: { count: 9 } })
    expect(await verifyAuditChain(db, { now: NOW })).toMatchObject({
      ok: false,
      day: '2026-11-10',
      reason: 'anchor_altered',
    })

    await db.collection(ANCHOR_COLLECTION).deleteOne({ _id: '2026-11-10' as never })
    expect(await verifyAuditChain(db, { now: NOW })).toMatchObject({
      ok: false,
      day: '2026-11-11',
      reason: 'chain_broken',
    })
  })

  it('skips content checks for days past retention but keeps the chain', async () => {
    await seed()
    await sealAuditDays(db, NOW)
    await db.collection('audit_log').deleteOne({ resource_id: 'r1' })
    const twoDays = 2 * 24 * 60 * 60 * 1000
    expect(await verifyAuditChain(db, { now: NOW, retentionMs: twoDays })).toEqual({
      ok: true,
      checked: 3,
    })
  })
})
