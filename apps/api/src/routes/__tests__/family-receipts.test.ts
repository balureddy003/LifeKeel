/**
 * /family/receipts (PRD-214, M7) — the family-visible, hash-chained record
 * of what Keel did: proposed → approved → executed, exportable, and gated
 * to adult family members.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { createHash } from 'node:crypto'

import { registerFamilyReceiptRoutes, deriveReceiptChain } from '../family-receipts.js'
import type { ActionReceipt } from '@lifekeel/workflows'

const TENANT = 't-receipts'
const ADULT = 'adult-1'
const CHILD = 'child-1'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

async function buildApp(userId: string): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as { authContext?: unknown }).authContext = { tenant_id: TENANT, user_id: userId }
  })
  registerFamilyReceiptRoutes(app, db)
  await app.ready()
  return app
}

function receipt(partial: Partial<ActionReceipt> & { id: string }): ActionReceipt {
  return {
    tenant_id: TENANT,
    action_type: 'send_email',
    outcome: 'executed',
    executed_at: new Date('2026-10-20T10:00:00Z'),
    payload_hash: createHash('sha256').update(partial.id).digest('hex'),
    dry_run: false,
    ...partial,
  }
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('family-receipts')
})

beforeEach(async () => {
  await db.dropDatabase()
  await db.collection('family_groups').insertOne({
    tenant_id: TENANT,
    id: 'fam-1',
    name: 'Test Family',
    members: [
      { id: ADULT, name: 'Sam', email: 's@x.co', role: 'organizer', status: 'active' },
      { id: CHILD, name: 'Kid', email: '', role: 'child', status: 'active' },
    ],
    created_at: new Date(),
  })
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('GET /family/receipts (PRD-214)', () => {
  it('denies a child member — the action ledger is adult-scoped', async () => {
    const app = await buildApp(CHILD)
    const res = await app.inject({ method: 'GET', url: '/family/receipts' })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('returns an empty ledger honestly when nothing has happened', async () => {
    const app = await buildApp(ADULT)
    const res = await app.inject({ method: 'GET', url: '/family/receipts' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ receipts: [], total: 0, chain_head: null })
    await app.close()
  })

  it('lists receipts newest-first with chain position, plain-language policy and approver', async () => {
    const t0 = new Date('2026-10-20T10:00:00Z')
    const t1 = new Date('2026-10-20T10:05:00Z')
    await db.collection<ActionReceipt>('action_receipts').insertMany([
      receipt({
        id: 'r-approve',
        action_type: 'insight.approve',
        outcome: 'approved',
        executed_at: t0,
        approved_by: ADULT,
        insight_id: 'ins-1',
        detector_id: 'family_policy_review',
      }),
      receipt({
        id: 'r-exec',
        action_type: 'send_email',
        action_label: 'Send me a renewal reminder',
        outcome: 'executed',
        executed_at: t1,
        approved_by: ADULT,
        approved_via: 'signed_link',
        insight_id: 'ins-1',
      }),
    ])

    const app = await buildApp(ADULT)
    const res = await app.inject({ method: 'GET', url: '/family/receipts' })
    expect(res.statusCode).toBe(200)
    const body = res.json()

    expect(body.total).toBe(2)
    expect(body.receipts).toHaveLength(2)
    // Newest first for display; chain_index still reflects true order.
    expect(body.receipts[0].id).toBe('r-exec')
    expect(body.receipts[0].chain_index).toBe(1)
    expect(body.receipts[0].approved_via).toBe('signed_link')
    expect(body.receipts[0].policy).toContain('signed email link')
    expect(body.receipts[1].id).toBe('r-approve')
    expect(body.receipts[1].chain_index).toBe(0)
    expect(body.chain_head).toBe(body.receipts[0].chain_hash)
    await app.close()
  })

  it('the chain is tamper-evident — editing an earlier receipt changes every later hash', async () => {
    const base = [
      receipt({ id: 'a', executed_at: new Date('2026-10-20T10:00:00Z') }),
      receipt({ id: 'b', executed_at: new Date('2026-10-20T10:01:00Z') }),
      receipt({ id: 'c', executed_at: new Date('2026-10-20T10:02:00Z') }),
    ]
    const clean = deriveReceiptChain(base)
    expect(clean.map((r) => r.chain_index)).toEqual([0, 1, 2])

    // Same receipt, altered payload — as if someone rewrote the record.
    const tampered = deriveReceiptChain([
      { ...base[0]!, payload_hash: 'x'.repeat(64) },
      base[1]!,
      base[2]!,
    ])
    expect(tampered[0]!.chain_hash).not.toBe(clean[0]!.chain_hash)
    expect(tampered[1]!.chain_hash).not.toBe(clean[1]!.chain_hash)
    expect(tampered[2]!.chain_hash).not.toBe(clean[2]!.chain_hash)

    // Deterministic: the same ledger always derives the same chain.
    expect(deriveReceiptChain(base).map((r) => r.chain_hash)).toEqual(
      clean.map((r) => r.chain_hash),
    )
  })

  it('exports the ledger as CSV with the chain hashes', async () => {
    await db
      .collection<ActionReceipt>('action_receipts')
      .insertOne(receipt({ id: 'r-1', action_label: 'Send me a renewal reminder' }))
    const app = await buildApp(ADULT)
    const res = await app.inject({ method: 'GET', url: '/family/receipts?format=csv' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('lifekeel-receipts.csv')
    const lines = res.body.trim().split('\n')
    expect(lines[0]).toContain('chain_index')
    expect(lines[0]).toContain('chain_hash')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('Send me a renewal reminder')
    await app.close()
  })

  it('paginates without losing chain positions', async () => {
    await db.collection<ActionReceipt>('action_receipts').insertMany(
      [0, 1, 2, 3].map((i) =>
        receipt({
          id: `r-${i}`,
          executed_at: new Date(`2026-10-20T10:0${i}:00Z`),
        }),
      ),
    )
    const app = await buildApp(ADULT)
    const res = await app.inject({ method: 'GET', url: '/family/receipts?limit=2&offset=2' })
    const body = res.json()
    expect(body.receipts).toHaveLength(2)
    // Positions 1 and 0 of the chain — page 2 of a newest-first view.
    expect(body.receipts.map((r: { chain_index: number }) => r.chain_index)).toEqual([1, 0])
    await app.close()
  })
})
