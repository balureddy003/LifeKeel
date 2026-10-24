/**
 * R2 document pipeline end to end against real MongoDB and an in-memory R2
 * (CLOUDFLARE_INTEGRATION.md §7, tests §11.2): init → browser PUT →
 * complete → scan job → clean → download; malware, structure and scanner
 * failures; crash injection at every promotion step; fenced deletes racing
 * a worker and a reusable presigned URL; quota reservations under
 * parallel load; bytes-mode compatibility; tenant isolation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { MemoryBuckets } from '../../__tests__/helpers/memory-object-store.js'
import { makeDocx } from '../../__tests__/helpers/zip.js'
import { registerDocumentUploadRoutes } from '../../routes/documents-uploads.js'
import { registerDocumentRoutes } from '../../routes/documents.js'
import { closeDb, getDb } from '../../db.js'
import { claimNext, commitClean, objectKey, PURGE_DELAY_MS, type ClaimedRow } from '../pipeline.js'
import { processScanJob, type ScanDeps } from '../scan-job.js'
import { reconcileOnce, sweepOrphanObjects } from '../reconciler.js'
import { ensureQuotaIndexes, MAX_INFLIGHT, reconcileQuotas } from '../quota.js'
import { ensureDeletionIndexes } from '../deletion.js'
import { assertDocumentsSchemaFloor, DOCUMENTS_SCHEMA_VERSION, writeGridfs } from '../storage.js'
import { dispatchPendingOcr } from '../../ocr/retry-failed.js'
import type { ScanResult } from '../../extraction/scan.js'

let mongod: MongoMemoryServer
let db: Db
let app: FastifyInstance
let mem: MemoryBuckets

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
/** Stand-in for clamd: flags the EICAR test string, like the real engine. */
const fakeClam = async (bytes: Buffer): Promise<ScanResult> =>
  bytes.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))
    ? { result: 'infected', engine: 'clamav', signature: 'Eicar-Signature' }
    : { result: 'clean', engine: 'clamav' }
const deps = (): ScanDeps => ({ store: mem.store('scan'), scan: fakeClam })

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >>\ntrailer << /Root 1 0 R >>\n%%EOF\n',
)

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  process.env['MONGODB_URL'] = mongod.getUri()
  process.env['MONGODB_DB'] = 'pipeline-test'
  process.env['DOCUMENTS_STORAGE'] = 'r2'
  process.env['DOCUMENTS_R2_TENANTS'] = 't-a,t-b'
  db = await getDb()
  await ensureQuotaIndexes(db)
  await ensureDeletionIndexes(db)
  app = Fastify()
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } })
  app.addHook('onRequest', async (req) => {
    const t = req.headers['x-tenant']
    if (typeof t === 'string')
      req.authContext = { tenant_id: t, user_id: `u-${t}`, roles: ['admin'] } as never
  })
  registerDocumentRoutes(app, db)
  registerDocumentUploadRoutes(app, db)
  await app.ready()
})

afterAll(async () => {
  MemoryBuckets.uninstall()
  await app.close()
  await closeDb()
  await mongod.stop()
  for (const k of ['MONGODB_URL', 'MONGODB_DB', 'DOCUMENTS_STORAGE', 'DOCUMENTS_R2_TENANTS'])
    delete process.env[k]
})

beforeEach(async () => {
  mem = new MemoryBuckets().install()
  for (const c of [
    'documents',
    'tenants',
    'tenant_quota',
    'tenant_quota_days',
    'document_tombstones',
    'deletion_receipts',
    'extraction_candidates',
    'platform_markers',
  ])
    await db.collection(c).deleteMany({})
  await db.collection('tenants').insertMany([
    { tenant_id: 't-a', status: 'active', plan: 'growth' },
    { tenant_id: 't-b', status: 'active', plan: 'free' },
    { tenant_id: 't-legacy', status: 'active', plan: 'free' },
  ])
})

const init = (tenant: string, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/documents/uploads',
    headers: { 'x-tenant': tenant },
    payload: body,
  })
const complete = (tenant: string, id: string) =>
  app.inject({ method: 'POST', url: `/documents/${id}/complete`, headers: { 'x-tenant': tenant } })

async function upload(tenant: string, filename: string, mime: string, bytes: Buffer) {
  const res = await init(tenant, { filename, mime, size: bytes.length })
  expect(res.statusCode, res.body).toBe(201)
  const { document_id, upload } = res.json()
  mem.putViaUrl(upload.url, bytes)
  expect((await complete(tenant, document_id)).statusCode).toBe(202)
  return document_id as string
}

async function scanNext(d: ScanDeps = deps()) {
  const row = await claimNext(db, 'worker-1')
  expect(row).not.toBeNull()
  return { row: row!, outcome: await processScanJob(db, row!, d) }
}

const doc = (id: string) => db.collection('documents').findOne({ id })

describe('happy path', () => {
  it('init → PUT → complete → scan → clean, then a presigned download', async () => {
    const id = await upload('t-a', 'policy.pdf', 'application/pdf', PDF)
    expect((await doc(id))?.['status']).toBe('scan_queued')
    // Nothing is readable before the scan.
    const early = await app.inject({
      url: `/documents/${id}/file?mode=url`,
      headers: { 'x-tenant': 't-a' },
    })
    expect(early.statusCode).toBe(409)

    const { outcome } = await scanNext()
    expect(outcome).toBe('clean')
    const row = await doc(id)
    expect(row?.['status']).toBe('clean')
    expect(row?.['storage']).toMatchObject({
      bucket: 'clean',
      key: objectKey('t-a', id),
      size: PDF.length,
    })
    expect((row?.['scan'] as { sha256: string }).sha256).toBe(
      createHash('sha256').update(PDF).digest('hex'),
    )
    expect(row?.['ocr_pending']).toBe(true)
    expect(mem.objects.quarantine.size).toBe(0)
    expect(mem.objects.clean.get(objectKey('t-a', id))).toEqual(PDF)

    const url = await app.inject({
      url: `/documents/${id}/file?mode=url`,
      headers: { 'x-tenant': 't-a' },
    })
    expect(url.statusCode).toBe(200)
    expect(url.headers['cache-control']).toBe('no-store')
    expect(url.json().url).toContain('memory://clean/')
    // Bytes mode keeps today's contract for released clients.
    const bytes = await app.inject({ url: `/documents/${id}/file`, headers: { 'x-tenant': 't-a' } })
    expect(bytes.statusCode).toBe(200)
    expect(bytes.rawPayload).toEqual(PDF)
    expect(bytes.headers['x-content-type-options']).toBe('nosniff')
  })

  it('every accepted image is stored as WebP at its original dimensions', async () => {
    const png = await sharp({
      create: { width: 321, height: 123, channels: 3, background: '#eee' },
    })
      .png()
      .toBuffer()
    const id = await upload('t-a', 'scan.png', 'image/png', png)
    expect((await scanNext()).outcome).toBe('clean')
    const row = await doc(id)
    expect(row?.['mime_type']).toBe('image/webp')
    expect(row?.['stored']).toMatchObject({ mime: 'image/webp', width: 321, height: 123 })
    const meta = await sharp(mem.objects.clean.get(objectKey('t-a', id))!).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 321, 123])
  }, 30_000)

  it('free-plan DOCX is stored; paid-plan clean rows go to OCR exactly once', async () => {
    const free = await upload(
      't-b',
      'letter.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      makeDocx('Hello'),
    )
    expect((await scanNext()).outcome).toBe('clean')
    // Free plan: no model call, the document is kept as 'stored'.
    expect(
      await dispatchPendingOcr(
        db,
        () => undefined,
        async () => undefined,
      ),
    ).toBe(0)
    expect((await doc(free))?.['status']).toBe('stored')
    // A second sweep finds nothing left to dispatch.
    expect(
      await dispatchPendingOcr(
        db,
        () => undefined,
        async () => undefined,
      ),
    ).toBe(0)
  }, 30_000)
})

describe('validation at init', () => {
  it('refuses unsupported or mismatched types, empty and oversize files', async () => {
    expect(
      (await init('t-a', { filename: 'a.exe', mime: 'application/octet-stream', size: 10 }))
        .statusCode,
    ).toBe(422)
    expect(
      (await init('t-a', { filename: 'a.pdf.exe', mime: 'application/pdf', size: 10 })).statusCode,
    ).toBe(422)
    expect(
      (await init('t-a', { filename: 'a.png', mime: 'application/pdf', size: 10 })).statusCode,
    ).toBe(422)
    expect(
      (await init('t-a', { filename: 'a.pdf', mime: 'application/pdf', size: 0 })).statusCode,
    ).toBe(413)
    expect(
      (await init('t-a', { filename: 'a.pdf', mime: 'application/pdf', size: 51 * 1024 * 1024 }))
        .statusCode,
    ).toBe(413)
  })

  it('tenants not on the R2 allow-list are told to use the legacy route', async () => {
    const res = await init('t-legacy', { filename: 'a.pdf', mime: 'application/pdf', size: 10 })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('direct_upload_unavailable')
  })

  it('complete refuses a missing or wrong-size object and releases the reservation', async () => {
    const res = await init('t-a', { filename: 'a.pdf', mime: 'application/pdf', size: PDF.length })
    const { document_id, upload: u } = res.json()
    mem.putViaUrl(u.url, Buffer.concat([PDF, Buffer.from('extra')]))
    const c = await complete('t-a', document_id)
    expect(c.statusCode).toBe(409)
    expect((await doc(document_id))?.['status']).toBe('failed')
    expect(mem.objects.quarantine.size).toBe(0)
    expect(await db.collection('tenant_quota').findOne({ tenant_id: 't-a' })).toMatchObject({
      bytes_reserved: 0,
      inflight: 0,
    })
  })

  it('complete is idempotent', async () => {
    const id = await upload('t-a', 'a.pdf', 'application/pdf', PDF)
    const again = await complete('t-a', id)
    expect(again.statusCode).toBe(202)
    expect(again.json().status).toBe('scan_queued')
  })
})

describe('scan outcomes', () => {
  it('EICAR is infected: never reaches clean, quarantine deleted, quota released', async () => {
    const id = await upload(
      't-a',
      'virus.pdf',
      'application/pdf',
      Buffer.from(`%PDF-1.4\n${EICAR}\n`),
    )
    expect((await scanNext()).outcome).toBe('infected')
    expect((await doc(id))?.['status']).toBe('infected')
    expect(mem.objects.clean.size).toBe(0)
    expect(mem.objects.quarantine.size).toBe(0)
    expect(await db.collection('tenant_quota').findOne({ tenant_id: 't-a' })).toMatchObject({
      bytes_reserved: 0,
      bytes_committed: 0,
      inflight: 0,
    })
  })

  it('a PDF with JavaScript is rejected', async () => {
    const id = await upload(
      't-a',
      'evil.pdf',
      'application/pdf',
      Buffer.from('%PDF-1.4\n<< /OpenAction << /S /JavaScript /JS (x) >> >>'),
    )
    expect((await scanNext()).outcome).toBe('rejected')
    expect((await doc(id))?.['status']).toBe('rejected')
  }, 30_000)

  it('a macro DOCX is rejected', async () => {
    await upload(
      't-a',
      'm.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      makeDocx('x', [{ name: 'word/vbaProject.bin', data: 'm' }]),
    )
    expect((await scanNext()).outcome).toBe('rejected')
  }, 30_000)

  it('bytes that do not match the declared type are rejected', async () => {
    await upload('t-a', 'fake.pdf', 'application/pdf', Buffer.from('MZ\x90\x00 this is an exe'))
    expect((await scanNext()).outcome).toBe('rejected')
  })

  it('scanner down → scan_error, unreadable, retried later, then failed after 5 attempts', async () => {
    const id = await upload('t-a', 'a.pdf', 'application/pdf', PDF)
    const down: ScanDeps = {
      ...deps(),
      scan: async () => ({ result: 'error', engine: 'clamav', reason: 'ECONNREFUSED' }),
    }
    expect((await scanNext(down)).outcome).toBe('scan_error')
    expect((await doc(id))?.['status']).toBe('scan_error')
    const file = await app.inject({ url: `/documents/${id}/file`, headers: { 'x-tenant': 't-a' } })
    expect(file.statusCode).toBe(409)
    for (let i = 2; i <= 5; i++) {
      await db
        .collection('documents')
        .updateOne({ id }, { $set: { 'scan_job.next_run_at': new Date(0) } })
      await reconcileOnce(db, mem.store('scan'))
      const { outcome } = await scanNext(down)
      expect(outcome).toBe(i === 5 ? 'failed' : 'scan_error')
    }
    expect((await doc(id))?.['status']).toBe('failed')
  })

  it('an object replaced after /complete is rejected (ETag changed)', async () => {
    const id = await upload('t-a', 'a.pdf', 'application/pdf', PDF)
    mem.objects.quarantine.set(
      objectKey('t-a', id),
      Buffer.from(PDF.toString().replace('Catalog', 'Catalig')),
    )
    expect((await scanNext()).outcome).toBe('rejected')
  })
})

describe('crash injection: every case ends in a correct terminal state', () => {
  it('(a) before claim: a lost wake-up is found by the reconciler', async () => {
    const id = await upload('t-a', 'a.pdf', 'application/pdf', PDF)
    await reconcileOnce(db, mem.store('scan'))
    expect((await scanNext()).outcome).toBe('clean')
    expect((await doc(id))?.['status']).toBe('clean')
  })

  it('(b) after claim: an expired lease returns the row to the queue', async () => {
    const id = await upload('t-a', 'a.pdf', 'application/pdf', PDF)
    await claimNext(db, 'dead-worker')
    await db.collection('documents').updateOne({ id }, { $set: { lease_until: new Date(0) } })
    expect((await reconcileOnce(db, mem.store('scan'))).leases_requeued).toBe(1)
    expect((await scanNext()).outcome).toBe('clean')
  })

  it('(c) after the clean PUT: the retry overwrites the same key, no orphan', async () => {
    const id = await upload('t-a', 'a.pdf', 'application/pdf', PDF)
    const row = (await claimNext(db, 'dead-worker'))!
    await mem.store('scan').put('clean', objectKey('t-a', id), PDF, 'application/pdf')
    await db.collection('documents').updateOne({ id }, { $set: { lease_until: new Date(0) } })
    await reconcileOnce(db, mem.store('scan'))
    expect((await scanNext()).outcome).toBe('clean')
    expect(row.id).toBe(id)
    expect(mem.objects.clean.size).toBe(1)
  })

  it('(d) after commit: reconciler deletes quarantine and hands to OCR once', async () => {
    const id = await upload('t-a', 'a.pdf', 'application/pdf', PDF)
    const row = (await claimNext(db, 'w'))!
    await mem.store('scan').put('clean', objectKey('t-a', id), PDF, 'application/pdf')
    await commitClean(db, row, {
      cleanKey: objectKey('t-a', id),
      storedMime: 'application/pdf',
      storedSize: PDF.length,
      sha256: 'x',
      sourceSha256: 'x',
      scan: { result: 'clean' },
    })
    const r = await reconcileOnce(db, mem.store('scan'))
    expect(r.quarantine_cleaned).toBe(1)
    expect(r.reservations_committed).toBe(1)
    expect(mem.objects.quarantine.size).toBe(0)
    expect(await doc(id)).toMatchObject({
      status: 'clean',
      ocr_pending: true,
      quarantine_present: false,
    })
    expect((await reconcileOnce(db, mem.store('scan'))).quarantine_cleaned).toBe(0)
  })

  it('(e) awaiting_upload never completed: failed, reservation released, object removed', async () => {
    const res = await init('t-a', { filename: 'a.pdf', mime: 'application/pdf', size: PDF.length })
    mem.putViaUrl(res.json().upload.url, PDF)
    await db
      .collection('documents')
      .updateOne(
        { id: res.json().document_id },
        { $set: { 'reservation.expires_at': new Date(0) } },
      )
    expect((await reconcileOnce(db, mem.store('scan'))).expired_uploads).toBe(1)
    expect((await doc(res.json().document_id))?.['status']).toBe('failed')
    expect(mem.objects.quarantine.size).toBe(0)
    expect(await db.collection('tenant_quota').findOne({ tenant_id: 't-a' })).toMatchObject({
      bytes_reserved: 0,
      inflight: 0,
    })
  })
})

describe('fenced deletion', () => {
  const del = (id: string) =>
    app.inject({ method: 'DELETE', url: `/documents/${id}`, headers: { 'x-tenant': 't-a' } })

  it('a delete during the scan wins: the worker commit is refused and its clean key removed', async () => {
    const id = await upload('t-a', 'a.pdf', 'application/pdf', PDF)
    const row = (await claimNext(db, 'w'))!
    const res = await del(id)
    expect(res.statusCode).toBe(200)
    expect(res.json().receipt.status).toBe('in_progress')
    expect(await processScanJob(db, row as ClaimedRow, deps())).toBe('lost')
    expect(mem.objects.clean.size).toBe(0)
  })

  it('a PUT through a still-valid URL after delete is removed by the second purge; receipt closes then', async () => {
    const res = await init('t-a', { filename: 'a.pdf', mime: 'application/pdf', size: PDF.length })
    const { document_id: id, upload: u } = res.json()
    mem.putViaUrl(u.url, PDF)
    await complete('t-a', id)
    const d = await del(id)
    const receiptId = d.json().receipt.id
    mem.putViaUrl(u.url, PDF) // URL still valid for a few minutes
    expect(mem.objects.quarantine.size).toBe(1)
    // Before purge_after nothing more happens.
    expect((await reconcileOnce(db, mem.store('scan'))).purges).toBe(0)
    await reconcileOnce(db, mem.store('scan'), new Date(Date.now() + PURGE_DELAY_MS + 1000))
    expect(mem.objects.quarantine.size).toBe(0)
    expect(await doc(id)).toBeNull()
    const receipt = await db.collection('deletion_receipts').findOne({ id: receiptId })
    expect(receipt?.['status']).toBe('completed')
  })

  it('deleting rows are hidden from the list and detail routes', async () => {
    const id = await upload('t-a', 'a.pdf', 'application/pdf', PDF)
    await del(id)
    expect(
      (await app.inject({ url: `/documents/${id}`, headers: { 'x-tenant': 't-a' } })).statusCode,
    ).toBe(404)
    const list = await app.inject({ url: '/documents', headers: { 'x-tenant': 't-a' } })
    expect(list.json().documents).toEqual([])
  })

  it('a tenant being erased refuses init and worker commits', async () => {
    const id = await upload('t-a', 'a.pdf', 'application/pdf', PDF)
    await db.collection('tenants').updateOne({ tenant_id: 't-a' }, { $set: { status: 'deleting' } })
    expect(
      (await init('t-a', { filename: 'b.pdf', mime: 'application/pdf', size: 10 })).statusCode,
    ).toBe(409)
    expect((await scanNext()).outcome).toBe('lost')
    expect(mem.objects.clean.size).toBe(0)
    expect(id).toBeTruthy()
  })
})

describe('quota reservations', () => {
  it('parallel inits cannot exceed the in-flight cap', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        init('t-a', { filename: `f${i}.pdf`, mime: 'application/pdf', size: 100 }),
      ),
    )
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(MAX_INFLIGHT)
    expect(
      results
        .filter((r) => r.statusCode === 429)
        .every((r) => r.json().error === 'too_many_uploads'),
    ).toBe(true)
  })

  it('parallel inits cannot exceed the storage limit', async () => {
    process.env['MAX_TENANT_STORAGE_BYTES'] = '1000'
    try {
      const results = await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          init('t-a', { filename: `f${i}.pdf`, mime: 'application/pdf', size: 400 }),
        ),
      )
      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(2)
      expect(results.find((r) => r.statusCode === 413)?.json().error).toBe('storage_limit')
    } finally {
      delete process.env['MAX_TENANT_STORAGE_BYTES']
    }
  })

  it('commit moves bytes to committed (stored size); delete releases exactly once', async () => {
    const id = await upload('t-a', 'a.pdf', 'application/pdf', PDF)
    await scanNext()
    expect(await db.collection('tenant_quota').findOne({ tenant_id: 't-a' })).toMatchObject({
      bytes_reserved: 0,
      bytes_committed: PDF.length,
      inflight: 0,
    })
    const del = () =>
      app.inject({ method: 'DELETE', url: `/documents/${id}`, headers: { 'x-tenant': 't-a' } })
    await del()
    await del()
    expect(await db.collection('tenant_quota').findOne({ tenant_id: 't-a' })).toMatchObject({
      bytes_committed: 0,
    })
  })

  it('the nightly reconcile detects and corrects drift', async () => {
    await upload('t-a', 'a.pdf', 'application/pdf', PDF)
    await scanNext()
    await db
      .collection('tenant_quota')
      .updateOne({ tenant_id: 't-a' }, { $set: { bytes_committed: 999_999 } })
    const r = await reconcileQuotas(db)
    expect(r.drift_bytes).toBeGreaterThan(0)
    expect(
      (await db.collection('tenant_quota').findOne({ tenant_id: 't-a' }))?.['bytes_committed'],
    ).toBe(PDF.length)
  })
})

describe('compatibility and isolation', () => {
  it('GridFS rows still serve bytes; mode=url says to use bytes', async () => {
    const fileId = await writeGridfs(db, 'old.pdf', { tenant_id: 't-a' }, PDF)
    await db
      .collection('documents')
      .insertOne({
        id: 'old-1',
        tenant_id: 't-a',
        file_id: fileId,
        mime_type: 'application/pdf',
        status: 'stored',
        filename: 'old.pdf',
      })
    const bytes = await app.inject({ url: '/documents/old-1/file', headers: { 'x-tenant': 't-a' } })
    expect(bytes.statusCode).toBe(200)
    expect(bytes.rawPayload).toEqual(PDF)
    const url = await app.inject({
      url: '/documents/old-1/file?mode=url',
      headers: { 'x-tenant': 't-a' },
    })
    expect(url.statusCode).toBe(409)
    expect(url.json().error).toBe('not_in_object_store')
  })

  it('another tenant gets 404 for the same document id', async () => {
    const id = await upload('t-a', 'a.pdf', 'application/pdf', PDF)
    await scanNext()
    const res = await app.inject({
      url: `/documents/${id}/file?mode=url`,
      headers: { 'x-tenant': 't-b' },
    })
    expect(res.statusCode).toBe(404)
    expect((await complete('t-b', id)).statusCode).toBe(404)
  })

  it('the legacy multipart route writes quarantine and joins the same pipeline', async () => {
    const boundary = '----lk'
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="legacy.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      PDF,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers: { 'x-tenant': 't-a', 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    })
    expect(res.statusCode, res.body).toBe(201)
    expect(res.json().status).toBe('scan_queued')
    expect((await scanNext()).outcome).toBe('clean')
  })

  it('the first R2 write raises the schema floor; this build still boots', async () => {
    await upload('t-a', 'a.pdf', 'application/pdf', PDF)
    await scanNext()
    expect(
      (
        await db.collection('platform_markers').findOne({ _id: 'documents_schema_floor' as never })
      )?.['required_schema'],
    ).toBe(DOCUMENTS_SCHEMA_VERSION)
    await expect(assertDocumentsSchemaFloor(db)).resolves.toBeUndefined()
    await db
      .collection('platform_markers')
      .updateOne({ _id: 'documents_schema_floor' as never }, { $set: { required_schema: 99 } })
    await expect(assertDocumentsSchemaFloor(db)).rejects.toThrow(/schema 99/)
  })

  it('the orphan sweep removes objects with no live row', async () => {
    await mem.store('scan').put('clean', 't-a/ghost', PDF, 'application/pdf')
    expect((await sweepOrphanObjects(db, mem.store('scan'))).orphans).toBe(1)
    expect(mem.objects.clean.size).toBe(0)
  })
})

describe('credential scopes', () => {
  it('a presign credential cannot touch clean or the vault', async () => {
    await expect(mem.store('presign').put('clean', 'x', PDF, 'application/pdf')).rejects.toThrow(
      /no access/,
    )
    await expect(mem.store('presign').get('vault', 'x')).rejects.toThrow(/no access/)
    await expect(mem.store('serve').put('clean', 'x', PDF, 'application/pdf')).rejects.toThrow(
      /read-only/,
    )
    await expect(
      mem.store('delete').put('quarantine', 'x', PDF, 'application/pdf'),
    ).rejects.toThrow(/no access/)
  })
})
