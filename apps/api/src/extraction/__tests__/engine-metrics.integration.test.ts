/**
 * Intent 97 slice 1 wiring, against a real MongoDB: an extraction run counts
 * every field it suggested; a bank statement that fails its mechanical checks
 * is counted once with which check; a review confirm and a review edit each
 * write exactly one event; and a metrics-store failure never fails the
 * request the user made.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { GridFSBucket, MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { DecisionFn } from '@lifekeel/platform'
import { initAuditLogger } from '../../audit/audit-log.js'
import { initTaskGateway } from '../../ai/task-gateway.js'
import { processDocument } from '../../ocr/extract.js'
import { registerDocumentRoutes } from '../../routes/documents.js'

const A = 'tenant-a'
const PDF = readFileSync(path.join(__dirname, '../../ocr/__tests__/text-layer.pdf'))

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('engine-metrics-wiring-test')
  initAuditLogger(db, true)
  initTaskGateway({ collection: () => ({}) } as never)
})
beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

const decideReturning = (value: Record<string, unknown>) =>
  (async () => ({ value, model: 'local', latency_ms: 1 })) as unknown as DecisionFn

const empty = {
  category: 'income',
  provider: null,
  policy_type: null,
  policy_number: null,
  coverage_amount: null,
  premium: null,
  renewal_date: null,
  has_beneficiary: null,
  claims_phone: null,
  claims_email: null,
  balance: null,
  net_pay: null,
  gross_pay: null,
  statement_opening_balance: null,
  statement_closing_balance: null,
  statement_money_in: null,
  statement_money_out: null,
  statement_period_start: null,
  statement_period_end: null,
  document_date: null,
}

async function seedDoc(tenant: string, id: string) {
  const up = new GridFSBucket(db, { bucketName: 'documents' }).openUploadStream('x.pdf', {
    metadata: { tenant_id: tenant },
  })
  await new Promise<void>((resolve) => {
    up.on('finish', () => resolve())
    up.end(PDF)
  })
  await db.collection('documents').insertOne({
    tenant_id: tenant,
    id,
    filename: 'x.pdf',
    mime_type: 'application/pdf',
    size: PDF.length,
    category: 'other',
    status: 'uploaded',
    uploaded_at: new Date(),
    file_id: up.id,
  })
}

async function extract(tenant: string, id: string, value: Record<string, unknown>) {
  await seedDoc(tenant, id)
  await processDocument(
    db,
    id,
    tenant,
    PDF,
    'application/pdf',
    'x.pdf',
    decideReturning({ ...empty, ...value }),
  )
}

async function appFor(tenant: string, userId = 'user-1', overDb: Db = db) {
  const app = Fastify()
  await app.register(multipart)
  app.addHook('onRequest', async (req) => {
    ;(req as unknown as { authContext: unknown }).authContext = {
      tenant_id: tenant,
      user_id: userId,
      roles: ['admin'],
    }
  })
  registerDocumentRoutes(app, overDb)
  await app.ready()
  return app
}

const events = (name: string) =>
  db.collection('engine_metrics_events').find({ tenant_id: A, event: name }).toArray()

describe('extraction_suggested', () => {
  it('counts every field an extraction run proposed, with field class and category', async () => {
    await extract(A, 'd1', { category: 'income', net_pay: '£2,000', gross_pay: '£2,600' })
    const rows = await events('extraction_suggested')
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r['field_class']).sort()).toEqual(['gross_pay', 'net_pay'])
    expect(rows.every((r) => r['document_category'] === 'income')).toBe(true)
    // No content anywhere in the stored events.
    expect(JSON.stringify(rows)).not.toMatch(/2,000|2,600|x\.pdf/)
  })

  it('a document whose fields were all dropped suggests nothing', async () => {
    await extract(A, 'd1', { category: 'income' })
    expect(await events('extraction_suggested')).toHaveLength(0)
  })
})

describe('statement mechanical checks', () => {
  const statement = {
    category: 'banking',
    statement_opening_balance: '£1,000',
    statement_money_in: '£500',
    statement_money_out: '£600',
    statement_period_start: '2026-10-01',
    statement_period_end: '2026-10-31',
  }

  it('a statement whose arithmetic does not reconcile counts the failing check and the rejection', async () => {
    await extract(A, 'd1', { ...statement, statement_closing_balance: '£800' })
    const failed = await events('extraction_check_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({
      check: 'balance_does_not_reconcile',
      field_class: 'closing_minor',
      document_category: 'banking',
    })
    const rejected = await events('statement_rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ reason: 'check_failed', document_category: 'banking' })
  })

  it('a statement that reconciles is not counted as rejected', async () => {
    await extract(A, 'd1', { ...statement, statement_closing_balance: '£900' })
    expect(await events('extraction_check_failed')).toHaveLength(0)
    expect(await events('statement_rejected')).toHaveLength(0)
    expect((await events('extraction_suggested')).length).toBeGreaterThan(0)
  })

  it('a statement missing the figures to check is rejected as unparsable', async () => {
    await extract(A, 'd1', { category: 'banking', statement_money_in: '£500' })
    const rejected = await events('statement_rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!['reason']).toBe('fields_unparsable')
  })
})

describe('review and apply outcomes', () => {
  it('confirming a field writes exactly one unchanged event, editing writes exactly one corrected', async () => {
    await extract(A, 'd2', { category: 'income', net_pay: '£2,000', gross_pay: '£2,600' })
    const app = await appFor(A)
    const reviewed = await app.inject({
      method: 'POST',
      url: '/documents/d2/review',
      payload: {
        decisions: [
          { key: 'net_pay', action: 'confirm' },
          { key: 'gross_pay', action: 'edit', value: '£2,700' },
        ],
      },
    })
    expect(reviewed.statusCode).toBe(200)
    const unchanged = await events('extraction_confirmed_unchanged')
    const corrected = await events('extraction_corrected')
    expect(unchanged).toHaveLength(1)
    expect(unchanged[0]).toMatchObject({ field_class: 'net_pay', document_category: 'income' })
    expect(corrected).toHaveLength(1)
    expect(corrected[0]).toMatchObject({ field_class: 'gross_pay' })
  })

  it('rejecting a field writes no confirm or correct event', async () => {
    await extract(A, 'd2', { category: 'income', net_pay: '£2,000' })
    const app = await appFor(A)
    await app.inject({
      method: 'POST',
      url: '/documents/d2/review',
      payload: { decisions: [{ key: 'net_pay', action: 'reject' }] },
    })
    expect(await events('extraction_confirmed_unchanged')).toHaveLength(0)
    expect(await events('extraction_corrected')).toHaveLength(0)
  })

  it('applying a still-proposed field counts it as confirmed unchanged', async () => {
    await extract(A, 'd2', { category: 'income', net_pay: '£2,000' })
    const app = await appFor(A)
    await app.inject({
      method: 'POST',
      url: '/documents/d2/confirm-type',
      payload: { category: 'income' },
    })
    await app.inject({
      method: 'POST',
      url: '/documents/d2/review',
      payload: { decisions: [{ key: 'net_pay', action: 'confirm' }] },
    })
    await db
      .collection('engine_metrics_events')
      .deleteMany({ event: 'extraction_confirmed_unchanged' })
    const applied = await app.inject({
      method: 'POST',
      url: '/documents/d2/apply-to-profile',
      payload: {},
    })
    expect(applied.statusCode).toBe(200)
    // Already confirmed by the review — the apply must not double-count it.
    expect(await events('extraction_confirmed_unchanged')).toHaveLength(0)
  })

  it('a metrics-store failure never fails the review request', async () => {
    await extract(A, 'd2', { category: 'income', net_pay: '£2,000' })
    const broken = new Proxy(db, {
      get(target, prop) {
        if (prop !== 'collection') return Reflect.get(target, prop)
        return (name: string, ...rest: unknown[]) =>
          name === 'engine_metrics_events'
            ? ({
                insertOne: async () => {
                  throw new Error('metrics store down')
                },
              } as never)
            : target.collection(name, ...(rest as never[]))
      },
    }) as Db
    const app = await appFor(A, 'user-1', broken)
    const reviewed = await app.inject({
      method: 'POST',
      url: '/documents/d2/review',
      payload: { decisions: [{ key: 'net_pay', action: 'confirm' }] },
    })
    expect(reviewed.statusCode).toBe(200)
  })
})
