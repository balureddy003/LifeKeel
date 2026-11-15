/**
 * Intent 97 slice 2, against a real MongoDB: extraction runs as a job on the
 * Redis queue, not inside the upload request. The document row is the durable
 * outbox — a publish that fails leaves the doc 'pending' for the reconciler,
 * never lost. The job payload is a document id and tenant id only: content
 * stays in storage and the worker reads it there. Retries are bounded; the
 * dead-letter state is what the page shows as "could not read this".
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { GridFSBucket, MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { DecisionFn } from '@lifekeel/platform'
import { initAuditLogger } from '../../audit/audit-log.js'
import { initTaskGateway } from '../../ai/task-gateway.js'
import { queueManager } from '../../queue/QueueManager.js'
import {
  enqueueExtraction,
  extractionStatusOf,
  MAX_EXTRACTION_ATTEMPTS,
  requeueStuckExtractions,
  runExtractionJob,
  type ExtractionJobPayload,
} from '../extraction-queue.js'
import { registerDocumentRoutes } from '../../routes/documents.js'

const A = 'tenant-a'
const PDF = readFileSync(path.join(__dirname, 'text-layer.pdf'))

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('extraction-queue-test')
  initAuditLogger(db, true)
  initTaskGateway({ collection: () => ({}) } as never)
})
beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  // 'growth' carries the document_ai_extraction entitlement.
  await db.collection('tenants').insertMany([{ tenant_id: A, status: 'active', plan: 'growth' }])
})
afterEach(() => {
  vi.restoreAllMocks()
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

const published: ExtractionJobPayload[] = []
const capturingPublish = async (_queue: string, payload: ExtractionJobPayload) => {
  published.push(payload)
}

const decideReturning = (value: Record<string, unknown>) =>
  (async () => ({ value, model: 'local', latency_ms: 1 })) as unknown as DecisionFn
const decideFailing = () =>
  (async () => {
    throw new Error('local model unavailable')
  }) as unknown as DecisionFn

const extracted = {
  category: 'income',
  net_pay: '£2,000',
  gross_pay: '£2,600',
}

async function seedDoc(tenant: string, id: string, job?: Record<string, unknown>) {
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
    ...(job ? { extraction_job: job } : {}),
  })
}

const doc = (id: string) => db.collection('documents').findOne({ id })
const events = (name: string) =>
  db.collection('engine_metrics_events').find({ tenant_id: A, event: name }).toArray()

async function appFor(tenant: string): Promise<FastifyInstance> {
  const app = Fastify()
  await app.register(multipart)
  app.addHook('onRequest', async (req) => {
    ;(req as unknown as { authContext: unknown }).authContext = {
      tenant_id: tenant,
      user_id: 'user-1',
      roles: ['admin'],
    }
  })
  registerDocumentRoutes(app, db)
  await app.ready()
  return app
}

function multipartPayload(filename: string, content: Buffer) {
  const boundary = 'testboundary123'
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return { body, boundary }
}

describe('enqueueExtraction', () => {
  it('publishes a job payload with document id and tenant id only — never content', async () => {
    await seedDoc(A, 'd1')
    published.length = 0
    expect(await enqueueExtraction(db, 'd1', A, capturingPublish)).toBe('queued')
    expect(published).toHaveLength(1)
    expect(published[0]).toEqual({ documentId: 'd1', tenantId: A })
    expect(Object.keys(published[0]! as object).sort()).toEqual(['documentId', 'tenantId'])
    // No document content, filename or field data may ride in the payload.
    expect(JSON.stringify(published[0])).not.toMatch(/x\.pdf|%PDF|£/)
    const d = await doc('d1')
    expect((d?.['extraction_job'] as { state: string }).state).toBe('queued')
    expect(extractionStatusOf(d!)).toBe('queued')
  })

  it("refuses to enqueue another tenant's document — no publish, no state change", async () => {
    await seedDoc(A, 'd1')
    published.length = 0
    expect(await enqueueExtraction(db, 'd1', 'tenant-b', capturingPublish)).toBe('skipped')
    expect(published).toHaveLength(0)
    expect((await doc('d1'))?.['extraction_job']).toBeUndefined()
  })

  it('a publish failure marks the job pending, and the reconciler retries it later', async () => {
    await seedDoc(A, 'd1')
    published.length = 0
    const failing = async () => {
      throw new Error('redis down')
    }
    expect(await enqueueExtraction(db, 'd1', A, failing)).toBe('deferred')
    const d = await doc('d1')
    expect((d?.['extraction_job'] as { state: string }).state).toBe('pending')
    // Nothing lost: the reconciler picks 'pending' docs up and publishes them.
    published.length = 0
    const n = await requeueStuckExtractions(db, new Date(Date.now() + 60_000), capturingPublish)
    expect(n).toBe(1)
    expect(published).toEqual([{ documentId: 'd1', tenantId: A }])
    expect((await doc('d1'))?.['extraction_job']).toMatchObject({ state: 'queued' })
  })
})

describe('runExtractionJob', () => {
  it('runs once per document — a duplicate delivery is a no-op', async () => {
    await seedDoc(A, 'd1')
    published.length = 0
    await enqueueExtraction(db, 'd1', A, capturingPublish)
    const payload = published[0]!
    let calls = 0
    const deps = {
      decideFor: () => {
        calls += 1
        return decideReturning(extracted)
      },
      visionFor: async () => undefined,
    }
    await Promise.all([runExtractionJob(db, payload, deps), runExtractionJob(db, payload, deps)])
    expect(calls).toBe(1)
    const d = await doc('d1')
    expect(d?.['status']).toBe('extracted')
    expect(d?.['extraction_job']).toMatchObject({ state: 'done', attempts: 1 })
    // Delivered again after completion: still no second run.
    await runExtractionJob(db, payload, deps)
    expect(calls).toBe(1)
  })

  it('a successful run writes candidates and one content-free outcome event', async () => {
    await seedDoc(A, 'd1')
    await enqueueExtraction(db, 'd1', A, capturingPublish)
    await runExtractionJob(db, published.pop()!, {
      decideFor: () => decideReturning(extracted),
      visionFor: async () => undefined,
    })
    const candidates = await db
      .collection('extraction_candidates')
      .findOne({ tenant_id: A, document_id: 'd1' })
    expect(candidates).not.toBeNull()
    const completed = await events('extraction_run_completed')
    expect(completed).toHaveLength(1)
    expect(JSON.stringify(completed)).not.toMatch(/2,000|x\.pdf/)
  })

  it('retries a failed run, then dead-letters after the attempt cap — once', async () => {
    await seedDoc(A, 'd1')
    published.length = 0
    await enqueueExtraction(db, 'd1', A, capturingPublish)
    const payload = published[0]!
    const deps = { decideFor: () => decideFailing(), visionFor: async () => undefined }

    await expect(runExtractionJob(db, payload, deps)).rejects.toThrow()
    let d = await doc('d1')
    expect(d?.['extraction_job']).toMatchObject({ state: 'queued', attempts: 1 })
    // A retryable failure is still "being read" — not the dead-letter card.
    expect(d?.['status']).toBe('processing')
    expect(extractionStatusOf(d!)).toBe('processing')

    await expect(runExtractionJob(db, payload, deps)).rejects.toThrow()
    await runExtractionJob(db, payload, deps) // third attempt resolves — dead, nothing to retry

    d = await doc('d1')
    expect(d?.['status']).toBe('error')
    expect(d?.['extraction_job']).toMatchObject({
      state: 'dead',
      attempts: MAX_EXTRACTION_ATTEMPTS,
    })
    expect(extractionStatusOf(d!)).toBe('dead')
    const dead = await events('extraction_run_dead')
    expect(dead).toHaveLength(1)
    // A stray fourth delivery does not emit the event again or re-run.
    let calls = 0
    await runExtractionJob(db, payload, {
      decideFor: () => {
        calls += 1
        return decideFailing()
      },
      visionFor: async () => undefined,
    })
    expect(calls).toBe(0)
    expect(await events('extraction_run_dead')).toHaveLength(1)
  })

  it("a job naming another tenant's document never runs it", async () => {
    await seedDoc(A, 'd1', { state: 'queued', attempts: 0, enqueued_at: new Date() })
    let calls = 0
    await runExtractionJob(
      db,
      { documentId: 'd1', tenantId: 'tenant-b' },
      {
        decideFor: () => {
          calls += 1
          return decideReturning(extracted)
        },
        visionFor: async () => undefined,
      },
    )
    expect(calls).toBe(0)
    expect((await doc('d1'))?.['status']).toBe('uploaded')
  })

  it('a job for a doc already at the attempt cap finishes it dead instead of running', async () => {
    await seedDoc(A, 'd1', {
      state: 'queued',
      attempts: MAX_EXTRACTION_ATTEMPTS,
      enqueued_at: new Date(),
    })
    let calls = 0
    await runExtractionJob(
      db,
      { documentId: 'd1', tenantId: A },
      {
        decideFor: () => {
          calls += 1
          return decideReturning(extracted)
        },
        visionFor: async () => undefined,
      },
    )
    expect(calls).toBe(0)
    expect((await doc('d1'))?.['extraction_job']).toMatchObject({ state: 'dead' })
    expect(await events('extraction_run_dead')).toHaveLength(1)
  })
})

describe('requeueStuckExtractions', () => {
  it('republishes lost or stalled jobs, leaves fresh ones alone', async () => {
    const stale = new Date(Date.now() - 10 * 60_000)
    await seedDoc(A, 'd-pending', { state: 'pending', enqueued_at: stale })
    await seedDoc(A, 'd-queued-stale', { state: 'queued', attempts: 1, enqueued_at: stale })
    await seedDoc(A, 'd-queued-fresh', { state: 'queued', attempts: 0, enqueued_at: new Date() })
    await seedDoc(A, 'd-running-stale', { state: 'running', attempts: 1, started_at: stale })
    published.length = 0
    const n = await requeueStuckExtractions(db, new Date(), capturingPublish)
    expect(n).toBe(3)
    expect(published.map((p) => p.documentId).sort()).toEqual([
      'd-pending',
      'd-queued-stale',
      'd-running-stale',
    ])
    expect((await doc('d-queued-fresh'))?.['extraction_job']).toMatchObject({ state: 'queued' })
  })
})

describe('upload route', () => {
  it('enqueues extraction on upload instead of running it on the request path', async () => {
    const app = await appFor(A)
    published.length = 0
    vi.spyOn(queueManager, 'publish').mockImplementation(
      async (queue: string, payload: unknown) => {
        published.push(payload as ExtractionJobPayload)
      },
    )
    const { body, boundary } = multipartPayload('pay.pdf', PDF)
    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(201)
    const id = res.json().id as string
    expect(published).toEqual([{ documentId: id, tenantId: A }])
    const d = await doc(id)
    expect(d?.['extraction_job']).toMatchObject({ state: 'queued' })
    // The page can read the queue position from the document it already polls.
    const detail = await app.inject({ method: 'GET', url: `/documents/${id}` })
    expect(detail.json().extractionStatus).toBe('queued')
  })

  it('a queue publish failure still returns 201 and the doc is retried later — nothing lost', async () => {
    const app = await appFor(A)
    vi.spyOn(queueManager, 'publish').mockRejectedValue(new Error('redis down'))
    const { body, boundary } = multipartPayload('pay.pdf', PDF)
    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(201)
    const id = res.json().id as string
    expect((await doc(id))?.['extraction_job']).toMatchObject({ state: 'pending' })
    // Reconciler recovers it.
    published.length = 0
    await requeueStuckExtractions(db, new Date(Date.now() + 60_000), capturingPublish)
    expect(published).toEqual([{ documentId: id, tenantId: A }])
  })
})
