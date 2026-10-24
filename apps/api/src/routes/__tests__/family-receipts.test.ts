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

import {
  CHAIN_VERSION,
  csvCell,
  deriveReceiptChain,
  receiptChainInput,
  registerFamilyReceiptRoutes,
} from '../family-receipts.js'
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

// ── What the chain protects ────────────────────────────────────────────────

describe('what the receipt chain covers (PRD-214)', () => {
  const T = [
    new Date('2026-10-20T10:00:00Z'),
    new Date('2026-10-20T10:01:00Z'),
    new Date('2026-10-20T10:02:00Z'),
  ]
  const ledger = (over: Partial<ActionReceipt> = {}): ActionReceipt[] => [
    receipt({ id: 'a', executed_at: T[0]! }),
    receipt({
      id: 'b',
      executed_at: T[1]!,
      approved_by: ADULT,
      approved_via: 'app',
      outcome_reason: 'sent',
      detector_id: 'family_policy_review',
      insight_id: 'ins-1',
      action_label: 'Send me a renewal reminder',
      ...over,
    }),
    receipt({ id: 'c', executed_at: T[2]! }),
  ]
  const head = (rs: ActionReceipt[]) => deriveReceiptChain(rs).at(-1)!.chain_hash

  // The facts a family relies on: each one, altered on an EARLIER receipt, must move the head.
  it.each<[string, Partial<ActionReceipt>]>([
    ['who approved it', { approved_by: 'mallory' }],
    ['how it was approved', { approved_via: 'signed_link' }],
    ['the reason', { outcome_reason: 'something else' }],
    ['the detector', { detector_id: 'another_detector' }],
    ['the insight', { insight_id: 'ins-2' }],
    ['whether it was a dry run', { dry_run: true }],
    ['the action label', { action_label: 'Send a different message' }],
    ['the action type', { action_type: 'crm.note' }],
    ['the outcome', { outcome: 'policy_blocked' }],
    ['the payload hash', { payload_hash: 'f'.repeat(64) }],
    ['the time', { executed_at: new Date('2026-10-20T10:01:30Z') }],
    ['the tenant', { tenant_id: 'another-tenant' }],
  ])('changing %s on an earlier receipt changes the chain head', (_what, change) => {
    expect(head(ledger(change))).not.toBe(head(ledger()))
  })

  it('clearing an optional fact is also a change (absent is not the same as set)', () => {
    const cleared = ledger({ approved_by: undefined, approved_via: undefined })
    expect(head(cleared)).not.toBe(head(ledger()))
  })

  it('"no approver" and an empty-string approver are different records', () => {
    expect(head(ledger({ approved_by: undefined }))).not.toBe(head(ledger({ approved_by: '' })))
  })

  it('deleting a receipt changes the head', () => {
    const full = ledger()
    expect(head([full[0]!, full[2]!])).not.toBe(head(full))
  })

  it('a delimiter inside free text cannot make two different receipts encode the same', () => {
    const a = receiptChainInput(
      'p',
      receipt({ id: 'x', action_label: 'a|b', outcome_reason: undefined }),
    )
    const b = receiptChainInput('p', receipt({ id: 'x', action_label: 'a', outcome_reason: 'b' }))
    expect(a).not.toBe(b)
  })

  it('bookkeeping that changes during dispatch does not move the head', () => {
    const noisy = ledger({
      attempts: 3,
      claimed_at: new Date('2026-10-20T11:00:00Z'),
      metadata: { insight_score: 0.9 },
      learning_suppressed: true,
    })
    expect(head(noisy)).toBe(head(ledger()))
  })

  it('names its scheme, so an exported head can be matched to how it was made', async () => {
    expect(CHAIN_VERSION).toBe(2)
    expect(receiptChainInput('genesis', receipt({ id: 'x' }))).toContain(
      `lifekeel-receipt-chain-v${CHAIN_VERSION}`,
    )
    await db.collection<ActionReceipt>('action_receipts').insertOne(receipt({ id: 'r-1' }))
    const app = await buildApp(ADULT)
    const body = (await app.inject({ method: 'GET', url: '/family/receipts' })).json()
    expect(body.chain_version).toBe(CHAIN_VERSION)
    const csv = (await app.inject({ method: 'GET', url: '/family/receipts?format=csv' })).body
    const [header, row] = csv.trim().split('\n') as [string, string]
    expect(header.endsWith(',chain_hash,chain_version')).toBe(true)
    expect(row.endsWith(`,${CHAIN_VERSION}`)).toBe(true)
    await app.close()
  })
})

// ── Tenant isolation ───────────────────────────────────────────────────────

describe("receipts are scoped to the caller's own family (tenant isolation)", () => {
  const OTHER = 't-someone-else'

  async function seedBoth() {
    await db.collection<ActionReceipt>('action_receipts').insertMany([
      receipt({
        id: 'mine-1',
        executed_at: new Date('2026-10-20T10:00:00Z'),
        action_label: 'my reminder',
      }),
      receipt({
        id: 'theirs-1',
        tenant_id: OTHER,
        executed_at: new Date('2026-10-20T10:01:00Z'),
        action_label: 'THEIR PRIVATE ACTION',
        approved_by: 'their-user',
      }),
      receipt({
        id: 'theirs-2',
        tenant_id: OTHER,
        executed_at: new Date('2026-10-20T10:02:00Z'),
        action_label: 'THEIR OTHER ACTION',
      }),
    ])
  }

  it("the JSON ledger contains only the caller's receipts, count and head", async () => {
    await seedBoth()
    const app = await buildApp(ADULT)
    const body = (await app.inject({ method: 'GET', url: '/family/receipts' })).json()
    expect(body.receipts.map((r: { id: string }) => r.id)).toEqual(['mine-1'])
    expect(body.total).toBe(1)
    expect(JSON.stringify(body)).not.toMatch(/THEIR|theirs-|their-user/)
    // The head is the chain over MY receipts alone: another family's rows cannot move it.
    const mineOnly = deriveReceiptChain([
      receipt({
        id: 'mine-1',
        executed_at: new Date('2026-10-20T10:00:00Z'),
        action_label: 'my reminder',
      }),
    ])
    expect(body.chain_head).toBe(mineOnly[0]!.chain_hash)
    await app.close()
  })

  it("the CSV export contains only the caller's receipts", async () => {
    await seedBoth()
    const app = await buildApp(ADULT)
    const csv = (await app.inject({ method: 'GET', url: '/family/receipts?format=csv' })).body
    expect(csv).toContain('my reminder')
    expect(csv).not.toMatch(/THEIR|theirs-|their-user/)
    expect(csv.trim().split('\n')).toHaveLength(2) // header + one row
    await app.close()
  })

  it("another family's activity does not change my chain head", async () => {
    await db.collection<ActionReceipt>('action_receipts').insertOne(receipt({ id: 'mine-1' }))
    const app = await buildApp(ADULT)
    const before = (await app.inject({ method: 'GET', url: '/family/receipts' })).json().chain_head
    await db.collection<ActionReceipt>('action_receipts').insertMany([
      receipt({
        id: 'theirs-1',
        tenant_id: OTHER,
        executed_at: new Date('2026-10-21T10:00:00Z'),
      }),
      receipt({
        id: 'theirs-0',
        tenant_id: OTHER,
        executed_at: new Date('2026-10-19T10:00:00Z'),
      }),
    ])
    const after = (await app.inject({ method: 'GET', url: '/family/receipts' })).json().chain_head
    expect(after).toBe(before)
    await app.close()
  })
})

// ── CSV formula injection ──────────────────────────────────────────────────

describe('CSV export neutralises spreadsheet formulas', () => {
  it.each(['=1+1', '+1+1', '-1+1', '@SUM(A1)', '\t=1', '\r=1'])(
    'prefixes a cell that starts with %j so it is text, not a formula',
    (raw) => {
      const cell = csvCell(raw)
      // The first character of the (unquoted) cell content is the apostrophe.
      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true)
    },
  )

  it('leaves ordinary values alone', () => {
    expect(csvCell('Send me a renewal reminder')).toBe('Send me a renewal reminder')
    expect(csvCell('2026-10-20T10:00:00.000Z')).toBe('2026-10-20T10:00:00.000Z')
    expect(csvCell(2)).toBe('2')
    expect(csvCell(false)).toBe('false')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell('a=b')).toBe('a=b') // only a leading trigger matters
  })

  it('still quotes commas, quotes and line breaks (RFC 4180)', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
    expect(csvCell('=A1,B1')).toBe(`"'=A1,B1"`)
  })

  it('a hostile label, reason and approver cannot reach the file as a formula', async () => {
    await db.collection<ActionReceipt>('action_receipts').insertOne(
      receipt({
        id: 'evil',
        action_label: '=HYPERLINK("http://evil.example","click")',
        outcome_reason: "+cmd|' /C calc'!A0",
        approved_by: '@attacker',
        detector_id: '-2+3',
      }),
    )
    const app = await buildApp(ADULT)
    const csv = (await app.inject({ method: 'GET', url: '/family/receipts?format=csv' })).body
    // No cell begins with a formula trigger: after a comma or at line start, never = + - @.
    const cells = csv.split('\n').slice(1).join('\n')
    expect(cells).not.toMatch(/(^|,)"?[=+\-@]/)
    expect(cells).toContain(`'=HYPERLINK`)
    expect(cells).toContain(`'@attacker`)
    await app.close()
  })
})
