/**
 * PRD-143 against a real MongoDB: extraction proposes grounded candidates and
 * writes nothing to the profile; confirm-before-commit is enforced by the
 * server; provenance is recorded; a failed extraction leaves nothing partial;
 * the audit trail holds no values; and a second tenant can read, confirm, edit,
 * apply or delete none of it.
 */
import net from 'node:net'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { GridFSBucket, MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import type { DecisionFn, VisionFn } from '@lifekeel/platform'
import { initAuditLogger } from '../../audit/audit-log.js'
import { initTaskGateway } from '../../ai/task-gateway.js'
import { processDocument } from '../../ocr/extract.js'
import { registerDocumentRoutes } from '../../routes/documents.js'
import { loadCandidates } from '../pipeline.js'

const A = 'tenant-a'
const B = 'tenant-b'
const PDF = readFileSync(path.join(__dirname, '../../ocr/__tests__/text-layer.pdf'))
// The fixture's text layer reads: "Policy number TR-123 renews 2026-10-01"

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('extraction-test')
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
  category: 'insurance',
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
  document_date: null,
}

async function seedDoc(tenant: string, id: string, extra: Record<string, unknown> = {}) {
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
    ...extra,
  })
}

/** Extract the fixture PDF for a tenant with the given model answer. */
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

async function appFor(tenant: string, userId = 'user-1'): Promise<FastifyInstance> {
  const app = Fastify()
  await app.register(multipart)
  app.addHook('onRequest', async (req) => {
    ;(req as unknown as { authContext: unknown }).authContext = {
      tenant_id: tenant,
      user_id: userId,
      roles: ['admin'],
    }
  })
  registerDocumentRoutes(app, db)
  await app.ready()
  return app
}
const post = (app: FastifyInstance, url: string, payload: object) =>
  app.inject({ method: 'POST', url, payload })
const profile = (tenant: string) =>
  db.collection('family_financial_profile').findOne({ tenant_id: tenant })

describe('extraction proposes, it does not commit', () => {
  it('stores grounded candidates with spans, classifies with a computed confidence, and touches no profile data', async () => {
    await extract(A, 'd1', {
      policy_number: 'TR-123',
      renewal_date: '2026-10-01',
      provider: 'Acme Assurance',
      has_beneficiary: 'yes',
    })
    const c = (await loadCandidates(db, A, 'd1'))!
    const by = Object.fromEntries(c.fields.map((f) => [f.key, f]))

    expect(by['policy_number']).toMatchObject({
      grounding: 'verbatim_unique',
      needs_review: false,
      status: 'proposed',
    })
    expect(by['policy_number']!.snippet).toContain('TR-123')
    expect(by['renewal_date']).toMatchObject({ grounding: 'verbatim_unique' })
    // Values the document does not contain are flagged, not trusted.
    expect(by['provider']).toMatchObject({ grounding: 'not_found', needs_review: true })
    expect(by['has_beneficiary']).toMatchObject({ grounding: 'not_found', needs_review: true })
    expect(c.extractor.kind).toBe('local')
    expect(c.schema_version).toMatch(/^v1-/)

    const doc = await db.collection('documents').findOne({ id: 'd1' })
    expect(doc).toMatchObject({ status: 'extracted', category: 'insurance' })
    expect(doc?.['raw_text']).toBeUndefined() // the free-text summary is gone
    // Only a single telling word in the text: the type needs a person's confirmation.
    expect(doc?.['classification']).toMatchObject({ needs_confirmation: true, confirmed: false })
    expect(await profile(A)).toBeNull()
    expect(await db.collection('profile_provenance').countDocuments()).toBe(0)
  })

  it('a model answer with a summary, a name or an invalid value stores none of them', async () => {
    await extract(A, 'd1', {
      policy_number: 'TR-123',
      policy_type: 'pet',
      summary: 'Patient has diabetes',
      beneficiary: 'Mrs Jane Doe',
    })
    const dump = JSON.stringify([
      await db.collection('documents').findOne({ id: 'd1' }),
      await loadCandidates(db, A, 'd1'),
    ])
    expect(dump).not.toMatch(/diabetes|Jane Doe|"pet"/)
  })

  it('an invalid answer from the hosted model fails the document with nothing partial stored, and is never repaired', async () => {
    await seedDoc(A, 'd1')
    const bad: VisionFn = async () =>
      'Sure! {"category": "spaceship", "fields": {"provider": "Acme"}}'
    await processDocument(db, 'd1', A, PDF, 'application/pdf', 'x.pdf', undefined, bad)
    expect(await db.collection('documents').findOne({ id: 'd1' })).toMatchObject({
      status: 'error',
    })
    expect(await loadCandidates(db, A, 'd1')).toBeNull()
    expect(
      (await db.collection('documents').findOne({ id: 'd1' }))?.['extracted_data'],
    ).toBeUndefined()

    const noJson: VisionFn = async () => 'I cannot read this.'
    await processDocument(db, 'd1', A, PDF, 'application/pdf', 'x.pdf', undefined, noJson)
    expect(await loadCandidates(db, A, 'd1')).toBeNull()
    expect(await db.collection('documents').findOne({ id: 'd1' })).toMatchObject({
      status: 'error',
    })
  })

  it('a hosted answer that fits the schema is stored with the same grounding', async () => {
    await seedDoc(A, 'd1')
    const good: VisionFn = async () =>
      '{"category":"insurance","fields":{"policy_number":"TR-123","made_up":"x"}}'
    await processDocument(db, 'd1', A, PDF, 'application/pdf', 'x.pdf', undefined, good)
    const c = (await loadCandidates(db, A, 'd1'))!
    expect(c.extractor.kind).toBe('hosted_vision')
    expect(c.fields.map((f) => f.key)).toEqual(['policy_number'])
    expect(c.fields[0]).toMatchObject({ grounding: 'verbatim_unique' })
  })

  it('writes metadata-only audit events: counts and durations, never a value, snippet or file name', async () => {
    await extract(A, 'd1', { policy_number: 'TR-123', provider: 'Acme Assurance' })
    await vi.waitFor(async () => {
      expect(
        await db
          .collection('audit_log')
          .countDocuments({ resource_id: 'd1', action: 'document.extracted' }),
      ).toBe(1)
    })
    const row = await db
      .collection('audit_log')
      .findOne({ resource_id: 'd1', action: 'document.extracted' })
    expect(row?.['metadata']).toMatchObject({ fields: 2, needs_review: 1, extractor: 'local' })
    expect(JSON.stringify(row)).not.toMatch(/TR-123|Acme|x\.pdf|Policy number/)
  })
})

describe('confirm before commit', () => {
  it('refuses to apply anything until the document type is confirmed, then allows it', async () => {
    await extract(A, 'd1', { category: 'insurance', policy_number: 'TR-123', provider: 'Acme' })
    const app = await appFor(A)
    const blocked = await post(app, '/documents/d1/apply-policy', {
      type: 'life',
      provider: 'Acme',
    })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error).toBe('confirm_type')
    expect(await profile(A)).toBeNull()

    expect(
      (await post(app, '/documents/d1/confirm-type', { category: 'nonsense' })).statusCode,
    ).toBe(400)
    const ok = await post(app, '/documents/d1/confirm-type', { category: 'insurance' })
    expect(ok.json()).toEqual({ id: 'd1', category: 'insurance', confirmed: true })
    const doc = await db.collection('documents').findOne({ id: 'd1' })
    expect(doc?.['classification']).toMatchObject({ confirmed: true, confirmed_by: 'user-1' })

    const applied = await post(app, '/documents/d1/apply-policy', {
      type: 'life',
      provider: 'Acme',
      policyNumber: 'TR-123',
    })
    expect(applied.statusCode).toBe(200)
    expect((await profile(A))?.['policies']).toHaveLength(1)
    // Provenance: which document, who, when, how well grounded, which extractor.
    const prov = await db.collection('profile_provenance').findOne({ tenant_id: A })
    expect(prov).toMatchObject({
      ref: 'policy:life:acme:tr-123',
      document_id: 'd1',
      confirmed_by: 'user-1',
    })
    expect(prov?.['extractor']).toMatch(/^local:/)
    expect(prov?.['confirmed_at']).toBeInstanceOf(Date)
  })

  it('refuses to apply a low-confidence field the person has not reviewed, and allows it after they confirm', async () => {
    // Income document; net pay does not appear in the text, so it is flagged low.
    await extract(A, 'd2', { category: 'income', net_pay: '£2,000' })
    const app = await appFor(A)
    await post(app, '/documents/d2/confirm-type', { category: 'income' })

    const blocked = await post(app, '/documents/d2/apply-to-profile', {})
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json()).toMatchObject({ error: 'review_required', fields: ['net_pay'] })
    expect(await profile(A)).toBeNull()

    const reviewed = await post(app, '/documents/d2/review', {
      decisions: [{ key: 'net_pay', action: 'confirm' }],
    })
    expect(reviewed.statusCode).toBe(200)
    const applied = await post(app, '/documents/d2/apply-to-profile', {})
    expect(applied.statusCode).toBe(200)
    expect((await profile(A))?.['household']).toMatchObject({ monthly_salary_minor: 200000 })
    expect(
      await db.collection('profile_provenance').findOne({ ref: 'household.monthly_salary_minor' }),
    ).toMatchObject({ document_id: 'd2', confirmed_by: 'user-1', confidence: 0.2 })
  })

  it('an edited value is what gets applied, a rejected one is never used, and a bad edit changes nothing', async () => {
    await extract(A, 'd2', { category: 'income', net_pay: '£2,000' })
    const app = await appFor(A)
    await post(app, '/documents/d2/confirm-type', { category: 'income' })

    const bad = await post(app, '/documents/d2/review', {
      decisions: [{ key: 'net_pay', action: 'edit', value: 'lots' }],
    })
    expect(bad.statusCode).toBe(400)
    expect((await loadCandidates(db, A, 'd2'))!.fields[0]!.status).toBe('proposed')

    await post(app, '/documents/d2/review', {
      decisions: [{ key: 'net_pay', action: 'edit', value: '£2,500' }],
    })
    await post(app, '/documents/d2/apply-to-profile', {})
    expect((await profile(A))?.['household']).toMatchObject({ monthly_salary_minor: 250000 })
    // Edited by the person, so no automatic confidence is claimed for it.
    expect(
      (
        await db.collection('profile_provenance').findOne({ ref: 'household.monthly_salary_minor' })
      )?.['confidence'],
    ).toBeNull()

    await extract(A, 'd3', { category: 'income', net_pay: '£9,999' })
    await post(app, '/documents/d3/confirm-type', { category: 'income' })
    await post(app, '/documents/d3/review', { decisions: [{ key: 'net_pay', action: 'reject' }] })
    const none = await post(app, '/documents/d3/apply-to-profile', {})
    expect(none.statusCode).toBe(400)
  })

  it('the suggestions a person sees reflect their edits and rejections', async () => {
    await extract(A, 'd2', { category: 'income', net_pay: '£2,000', gross_pay: '£2,600' })
    const app = await appFor(A)
    await post(app, '/documents/d2/confirm-type', { category: 'income' })
    await post(app, '/documents/d2/review', {
      decisions: [
        { key: 'net_pay', action: 'reject' },
        { key: 'gross_pay', action: 'confirm' },
      ],
    })
    const res = await app.inject({ method: 'GET', url: '/documents/d2/profile-suggestions' })
    expect(res.json().suggestions[0]).toMatchObject({
      sourceField: 'gross_pay',
      valueMinor: 260000,
    })
  })

  it('records the review and commit as metadata-only audit events', async () => {
    await extract(A, 'd2', { category: 'income', net_pay: '£2,000' })
    const app = await appFor(A)
    await post(app, '/documents/d2/confirm-type', { category: 'income' })
    await post(app, '/documents/d2/review', { decisions: [{ key: 'net_pay', action: 'confirm' }] })
    await post(app, '/documents/d2/apply-to-profile', {})
    await vi.waitFor(async () => {
      const actions = (await db.collection('audit_log').find({ resource_id: 'd2' }).toArray()).map(
        (r) => r['action'],
      )
      expect(actions).toEqual(
        expect.arrayContaining(['document.extracted', 'document.reviewed', 'document.committed']),
      )
    })
    const rows = await db.collection('audit_log').find({ resource_id: 'd2' }).toArray()
    expect(JSON.stringify(rows)).not.toMatch(/2,000|200000|x\.pdf/)
    expect(rows.find((r) => r['action'] === 'document.committed')).toMatchObject({
      user_id: 'user-1',
      metadata: { paths: 1 },
    })
  })
})

describe('tenant isolation', () => {
  it('another tenant cannot read, review, confirm the type of, apply from, or delete a document or its candidates', async () => {
    await extract(A, 'secret', { category: 'income', net_pay: '£2,000', policy_number: 'TR-123' })
    const intruder = await appFor(B, 'user-b')

    expect((await intruder.inject({ method: 'GET', url: '/documents/secret' })).statusCode).toBe(
      404,
    )
    expect(
      (await intruder.inject({ method: 'GET', url: '/documents/secret/profile-suggestions' }))
        .statusCode,
    ).toBe(404)
    expect(
      (
        await post(intruder, '/documents/secret/review', {
          decisions: [{ key: 'net_pay', action: 'confirm' }],
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (await post(intruder, '/documents/secret/confirm-type', { category: 'income' })).statusCode,
    ).toBe(404)
    expect((await post(intruder, '/documents/secret/apply-to-profile', {})).statusCode).toBe(404)
    expect(
      (await post(intruder, '/documents/secret/apply-policy', { type: 'life', provider: 'x' }))
        .statusCode,
    ).toBe(404)
    expect((await intruder.inject({ method: 'DELETE', url: '/documents/secret' })).statusCode).toBe(
      404,
    )

    // Nothing of A's changed, and B has nothing of A's.
    const c = (await loadCandidates(db, A, 'secret'))!
    expect(c.fields.every((f) => f.status === 'proposed')).toBe(true)
    expect(await loadCandidates(db, B, 'secret')).toBeNull()
    expect(await db.collection('documents').countDocuments({ tenant_id: A, id: 'secret' })).toBe(1)
    expect(await profile(B)).toBeNull()
    expect(await db.collection('profile_provenance').countDocuments()).toBe(0)
  })

  it('the same document id in two tenants stays separate through review and delete', async () => {
    await extract(A, 'same', { category: 'income', net_pay: '£2,000' })
    await extract(B, 'same', { category: 'income', net_pay: '£4,000' })
    const a = await appFor(A)
    await post(a, '/documents/same/review', { decisions: [{ key: 'net_pay', action: 'reject' }] })
    expect((await loadCandidates(db, B, 'same'))!.fields[0]!.status).toBe('proposed')
    const del = await a.inject({ method: 'DELETE', url: '/documents/same' })
    expect(del.statusCode).toBe(200)
    expect(del.json().receipt.removed).toEqual(
      expect.arrayContaining([{ category: 'extracted fields', count: 1 }]),
    )
    expect(await loadCandidates(db, A, 'same')).toBeNull()
    expect(await loadCandidates(db, B, 'same')).not.toBeNull()
  })

  it('a vault document is not reachable through any of these routes', async () => {
    await seedDoc(A, 'vault1', { category: 'estate_vault' })
    const app = await appFor(A)
    expect(
      (await post(app, '/documents/vault1/confirm-type', { category: 'income' })).statusCode,
    ).toBe(404)
    expect(
      (
        await post(app, '/documents/vault1/review', {
          decisions: [{ key: 'x', action: 'confirm' }],
        })
      ).statusCode,
    ).toBe(404)
  })
})

describe('upload scan', () => {
  const multipartBody = () => {
    const boundary = '----extract-test'
    return {
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
        ),
        PDF,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    }
  }
  const withClamd = async (reply: string, run: () => Promise<void>) => {
    const sockets: net.Socket[] = []
    const server = net.createServer((socket) => {
      sockets.push(socket)
      let seen = Buffer.alloc(0)
      socket.on('data', (d) => {
        seen = Buffer.concat([seen, d])
        if (seen.subarray(-4).equals(Buffer.alloc(4))) socket.end(`${reply}\0`)
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    process.env['CLAMD_HOST'] = '127.0.0.1'
    process.env['CLAMD_PORT'] = String((server.address() as net.AddressInfo).port)
    try {
      await run()
    } finally {
      delete process.env['CLAMD_HOST']
      delete process.env['CLAMD_PORT']
      sockets.forEach((s) => s.destroy())
      await new Promise<void>((r) => server.close(() => r()))
    }
  }

  it('refuses an infected file and stores nothing', async () => {
    await withClamd('stream: Eicar-Test-Signature FOUND', async () => {
      const res = await (
        await appFor(A)
      ).inject({ method: 'POST', url: '/documents/upload', ...multipartBody() })
      expect(res.statusCode).toBe(422)
      expect(res.json().error).toMatch(/blocked by a security scan/)
    })
    expect(await db.collection('documents').countDocuments()).toBe(0)
    expect(await db.collection('documents.files').countDocuments()).toBe(0)
  })

  it('records not_performed when no scanner is configured, and clean when one looked', async () => {
    const plain = await (
      await appFor(A)
    ).inject({ method: 'POST', url: '/documents/upload', ...multipartBody() })
    expect(plain.statusCode).toBe(201)
    expect((await db.collection('documents').findOne({}))?.['scan']).toMatchObject({
      result: 'not_performed',
    })

    await db.collection('documents').deleteMany({})
    await withClamd('stream: OK', async () => {
      const res = await (
        await appFor(A)
      ).inject({ method: 'POST', url: '/documents/upload', ...multipartBody() })
      expect(res.statusCode).toBe(201)
    })
    expect((await db.collection('documents').findOne({}))?.['scan']).toMatchObject({
      result: 'clean',
      engine: 'clamav',
    })
  })

  it('keeps a file the scanner could not check but does not send it for extraction', async () => {
    await db.collection('tenants').insertOne({ tenant_id: A, plan: 'starter' })
    await withClamd('stream: something unexpected', async () => {
      const res = await (
        await appFor(A)
      ).inject({ method: 'POST', url: '/documents/upload', ...multipartBody() })
      expect(res.statusCode).toBe(201)
      expect(res.json().aiExtractionEnabled).toBe(false)
    })
    expect(await db.collection('documents').findOne({})).toMatchObject({
      scan: { result: 'error' },
      status: 'stored',
    })
  })
})
