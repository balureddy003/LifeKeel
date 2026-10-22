/**
 * PRD-146 against a real MongoDB: erasure leaves nothing behind and touches no
 * other tenant, account deletion is resumable and honest about partial
 * failure, receipts say only what is true, and document and mailbox deletes
 * remove what they claim.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { GridFSBucket, MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'

vi.mock('../../erasure.js', async (orig) => {
  const actual = await orig<typeof import('../../erasure.js')>()
  return { ...actual, eraseTenantDataReport: vi.fn(actual.eraseTenantDataReport) }
})

import * as erasure from '../../erasure.js'
import { CUSTOM_DELETES, DELETABLE_COLLECTIONS, eraseTenantDataReport } from '../../erasure.js'
import { registerAccountRoutes } from '../../routes/account.js'
import { registerDocumentRoutes } from '../../routes/documents.js'
import { registerFamilyConnectorRoutes } from '../../routes/family-connectors.js'
import { runErasureReplay } from '../../jobs/erasure-replay.js'
import { RetentionWorker } from '../../jobs/retention-worker.js'
import { backupStatement } from '../receipt.js'
import { initTaskGateway } from '../../ai/task-gateway.js'

const A = 'tenant-a'
const B = 'tenant-b'
let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let bucket: GridFSBucket

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('deletion-test')
  bucket = new GridFSBucket(db, { bucketName: 'documents' })
  initTaskGateway({ collection: () => ({}) } as never) // loads the processor registry for receipts
})
beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  vi.mocked(erasure.eraseTenantDataReport).mockClear()
  delete process.env['BACKUP_RETENTION_DAYS']
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

async function blob(tenant: string, name = 'f.pdf'): Promise<import('mongodb').ObjectId> {
  const up = bucket.openUploadStream(name, { metadata: { tenant_id: tenant } })
  await new Promise<void>((resolve) => {
    up.on('finish', () => resolve())
    up.end(Buffer.from('content'))
  })
  return up.id as import('mongodb').ObjectId
}

/** One row in every erasure-listed collection, for one tenant. */
async function seedEverything(tenant: string) {
  const uid = `u-${tenant}`
  for (const name of DELETABLE_COLLECTIONS) {
    await db.collection(name).insertOne({
      tenant_id: tenant,
      ...(name === 'users' ? { id: uid, email: `${tenant}@x.test` } : {}),
    })
  }
  await db.collection('growth_events').insertOne({ event: 'x', meta: { tenant_id: tenant } })
  await db
    .collection('referrals')
    .insertOne({ referrer_tenant_id: tenant, referred_tenant_id: 'someone' })
  await db.collection('lifecycle_sends').insertOne({ recipient: uid, email: `${tenant}@x.test` })
  // R19: email- and user-keyed records outside the tenant key.
  await db.collection('leads').insertOne({ email: `${tenant}@x.test`, consent_marketing: true })
  await db.collection('login_events').insertOne({ user_id: uid, email: `${tenant}@x.test`, ip: '203.0.113.9' })
  await blob(tenant)
}
const countFor = async (tenant: string) => {
  let n = 0
  for (const name of DELETABLE_COLLECTIONS)
    n += await db.collection(name).countDocuments({ tenant_id: tenant })
  n += await db.collection('documents.files').countDocuments({ 'metadata.tenant_id': tenant })
  return n
}

describe('erasure leaves nothing and touches no one else', () => {
  // Seeds ~95 collections for two tenants against a real server; slow under a parallel run.
  it('removes a row from every listed collection, the blob and the custom-keyed rows, with a clean check', { timeout: 30_000 }, async () => {
    await seedEverything(A)
    await seedEverything(B)
    const before = await countFor(B)
    const report = await eraseTenantDataReport(db, A)

    expect(report.residual).toEqual([])
    expect(await countFor(A)).toBe(0)
    expect(await db.collection('growth_events').countDocuments({ 'meta.tenant_id': A })).toBe(0)
    expect(await db.collection('referrals').countDocuments({ referrer_tenant_id: A })).toBe(0)
    expect(await db.collection('lifecycle_sends').countDocuments({ recipient: `u-${A}` })).toBe(0)
    expect(await db.collection('leads').countDocuments({ email: `${A}@x.test` })).toBe(0)
    expect(await db.collection('login_events').countDocuments({ user_id: `u-${A}` })).toBe(0)
    expect(await db.collection('leads').countDocuments({ email: `${B}@x.test` })).toBe(1)

    // Tenant B is exactly as it was, in every collection.
    expect(await countFor(B)).toBe(before)
    expect(await db.collection('growth_events').countDocuments({ 'meta.tenant_id': B })).toBe(1)
    expect(await db.collection('lifecycle_sends').countDocuments({ recipient: `u-${B}` })).toBe(1)

    const total = report.removed.reduce((n, r) => n + r.count, 0)
    expect(total).toBeGreaterThanOrEqual(DELETABLE_COLLECTIONS.length + CUSTOM_DELETES.length)
    expect(report.removed.map((r) => r.category)).toEqual(
      expect.arrayContaining([
        'account',
        'documents and what was read from them',
        'notification devices',
      ]),
    )
  })

  it('is safe to run again and then reports nothing removed', async () => {
    await seedEverything(A)
    await eraseTenantDataReport(db, A)
    const again = await eraseTenantDataReport(db, A)
    expect(again.removed).toEqual([])
    expect(again.residual).toEqual([])
  })
})

describe('POST /account/delete', () => {
  async function appFor(tenant: string, userId: string): Promise<FastifyInstance> {
    const app = Fastify()
    app.addHook('onRequest', async (req) => {
      ;(req as unknown as { authContext: unknown }).authContext = {
        tenant_id: tenant,
        user_id: userId,
        roles: ['admin'],
      }
    })
    registerAccountRoutes(app, db)
    await app.ready()
    return app
  }
  const seedAccount = async (tenant: string) => {
    await db.collection('tenants').insertOne({ tenant_id: tenant, status: 'active' })
    await seedEverything(tenant)
    await db
      .collection('users')
      .updateOne({ tenant_id: tenant }, { $set: { id: 'me', email: 'me@x.test' } })
  }
  const del = (app: FastifyInstance, confirmation = 'me@x.test') =>
    app.inject({ method: 'POST', url: '/account/delete', payload: { confirmation } })

  it('deletes, marks the tenant deleted only after a clean check, and returns an honest receipt', async () => {
    process.env['BACKUP_RETENTION_DAYS'] = '35'
    await seedAccount(A)
    await seedAccount(B)
    const res = await del(await appFor(A, 'me'))
    expect(res.statusCode).toBe(200)
    const { deleted, receipt } = res.json()
    expect(deleted).toBe(true)
    expect(receipt).toMatchObject({ kind: 'account', status: 'completed', live_data_erased: true })
    expect(receipt.verification).toEqual({ passed: true, residual: [] })
    expect(receipt.backups).toMatchObject({ retention_days: 35 })
    expect(receipt.backups.statement).toMatch(/up to 35 days/)
    expect(receipt.processors.length).toBeGreaterThan(0)
    expect(
      receipt.processors.every((p: { stated_retention: string }) =>
        /Not confirmed/.test(p.stated_retention),
      ),
    ).toBe(true)
    expect(receipt.kept.join(' ')).toMatch(/7 years/)
    expect(receipt).not.toHaveProperty('tenant_id')

    expect((await db.collection('tenants').findOne({ tenant_id: A }))?.['status']).toBe('deleted')
    expect(await countFor(A)).toBe(0)
    expect(await countFor(B)).toBeGreaterThan(0)
    expect((await db.collection('tenants').findOne({ tenant_id: B }))?.['status']).toBe('active')
    const saved = await db.collection('deletion_receipts').findOne({ id: receipt.id })
    expect(saved).toMatchObject({ tenant_id: A, status: 'completed' })
  })

  it('refuses without the typed email and changes nothing', async () => {
    await seedAccount(A)
    const res = await del(await appFor(A, 'me'), 'wrong@x.test')
    expect(res.statusCode).toBe(400)
    expect((await db.collection('tenants').findOne({ tenant_id: A }))?.['status']).toBe('active')
    expect(await db.collection('deletion_receipts').countDocuments()).toBe(0)
  })

  it('a wipe that fails halfway is reported as partial, access is already closed, and the replay finishes it', async () => {
    await seedAccount(A)
    vi.mocked(erasure.eraseTenantDataReport).mockRejectedValueOnce(new Error('disk on fire'))
    const res = await del(await appFor(A, 'me'))
    expect(res.statusCode).toBe(202)
    expect(res.json()).toMatchObject({
      deleted: false,
      in_progress: true,
      receipt: { status: 'partial', live_data_erased: false },
    })
    expect((await db.collection('tenants').findOne({ tenant_id: A }))?.['status']).toBe('deleting')
    expect(await countFor(A)).toBeGreaterThan(0)

    const replay = await runErasureReplay(db)
    expect(replay.tenants_resumed).toBe(1)
    expect((await db.collection('tenants').findOne({ tenant_id: A }))?.['status']).toBe('deleted')
    expect(await countFor(A)).toBe(0)
    const receipt = await db.collection('deletion_receipts').findOne({ tenant_id: A })
    expect(receipt).toMatchObject({ status: 'completed', live_data_erased: true })
  })

  it('if a check afterwards still finds data it says so and stays resumable', async () => {
    await seedAccount(A)
    vi.mocked(erasure.eraseTenantDataReport).mockResolvedValueOnce({
      removed: [{ category: 'account', count: 1 }],
      residual: [{ category: 'insights and alerts', count: 3 }],
    })
    const res = await del(await appFor(A, 'me'))
    expect(res.statusCode).toBe(202)
    const receipt = res.json().receipt
    expect(receipt).toMatchObject({ status: 'partial', live_data_erased: false })
    expect(receipt.verification).toEqual({
      passed: false,
      residual: [{ category: 'insights and alerts', count: 3 }],
    })
    expect((await db.collection('tenants').findOne({ tenant_id: A }))?.['status']).toBe('deleting')
  })

  it('the wording never says permanent, instant or that nothing exists', async () => {
    await seedAccount(A)
    const text = JSON.stringify((await del(await appFor(A, 'me'))).json())
    expect(text).not.toMatch(/permanent|instant|none exist|no longer exists anywhere/i)
  })

  it('without a configured backup window the receipt says it is not confirmed, never a made-up number', () => {
    expect(backupStatement(undefined)).toMatchObject({ retention_days: null })
    expect(backupStatement(undefined).statement).toMatch(/not yet confirmed/)
    expect(backupStatement('abc').retention_days).toBeNull()
    expect(backupStatement('-3').retention_days).toBeNull()
  })

  it('lists only document and mailbox receipts, for this tenant only', async () => {
    await db.collection('deletion_receipts').insertMany([
      { id: '1', tenant_id: A, kind: 'document', requested_at: new Date('2026-10-01') },
      { id: '2', tenant_id: A, kind: 'mailbox', requested_at: new Date('2026-10-02') },
      { id: '3', tenant_id: A, kind: 'account', requested_at: new Date('2026-10-03') },
      { id: '4', tenant_id: B, kind: 'document', requested_at: new Date('2026-10-04') },
    ])
    const res = await (
      await appFor(A, 'me')
    ).inject({ method: 'GET', url: '/account/deletion-receipts' })
    expect(res.json().receipts.map((r: { id: string }) => r.id)).toEqual(['2', '1'])
    expect(JSON.stringify(res.json())).not.toContain('tenant_id')
  })
})

describe('DELETE /documents/:id', () => {
  async function appFor(tenant: string): Promise<FastifyInstance> {
    const app = Fastify()
    await app.register(multipart)
    app.addHook('onRequest', async (req) => {
      ;(req as unknown as { authContext: unknown }).authContext = {
        tenant_id: tenant,
        user_id: 'me',
      }
    })
    registerDocumentRoutes(app, db)
    await app.ready()
    return app
  }

  it('removes the file, the record and what was read, returns a receipt, and leaves other tenants and documents alone', async () => {
    const fileA = await blob(A)
    const fileA2 = await blob(A, 'keep.pdf')
    const fileB = await blob(B)
    await db.collection('documents').insertMany([
      {
        tenant_id: A,
        id: 'd1',
        file_id: fileA,
        extracted_data: { sum: 1 },
        raw_text: 'secret words',
      },
      { tenant_id: A, id: 'd2', file_id: fileA2 },
      { tenant_id: B, id: 'd1', file_id: fileB, extracted_data: { sum: 2 } },
    ])
    const res = await (await appFor(A)).inject({ method: 'DELETE', url: '/documents/d1' })
    expect(res.statusCode).toBe(200)
    const { success, receipt } = res.json()
    expect(success).toBe(true)
    expect(receipt).toMatchObject({ kind: 'document', status: 'completed', live_data_erased: true })
    expect(receipt.removed).toEqual(
      expect.arrayContaining([
        { category: 'document file', count: 1 },
        { category: 'document record', count: 1 },
        { category: 'what was read from the document', count: 1 },
      ]),
    )
    expect(receipt.kept.join(' ')).toMatch(/saved details from this document to your profile/)
    expect(JSON.stringify(receipt)).not.toMatch(/secret words/)

    expect(await db.collection('documents').countDocuments({ tenant_id: A, id: 'd1' })).toBe(0)
    expect(await db.collection('documents.files').countDocuments({ _id: fileA })).toBe(0)
    expect(await db.collection('documents').countDocuments({ tenant_id: A, id: 'd2' })).toBe(1)
    expect(await db.collection('documents.files').countDocuments({ _id: fileA2 })).toBe(1)
    expect(await db.collection('documents').countDocuments({ tenant_id: B, id: 'd1' })).toBe(1)
    expect(await db.collection('documents.files').countDocuments({ _id: fileB })).toBe(1)
    expect(
      await db.collection('deletion_receipts').countDocuments({ tenant_id: A, kind: 'document' }),
    ).toBe(1)
  })

  it('a missing document is a 404 and writes no receipt', async () => {
    const res = await (await appFor(A)).inject({ method: 'DELETE', url: '/documents/nope' })
    expect(res.statusCode).toBe(404)
    expect(await db.collection('deletion_receipts').countDocuments()).toBe(0)
  })
})

describe('POST /connectors/:id/disconnect', () => {
  async function appFor(tenant: string): Promise<FastifyInstance> {
    const app = Fastify()
    app.addHook('onRequest', async (req) => {
      ;(req as unknown as { authContext: unknown }).authContext = {
        tenant_id: tenant,
        user_id: 'me',
      }
    })
    registerFamilyConnectorRoutes(app, db)
    await app.ready()
    return app
  }
  async function seedMailbox(tenant: string) {
    const f = await blob(tenant, 'att.pdf')
    const manual = await blob(tenant, 'mine.pdf')
    await db.collection('connector_credentials').insertMany([
      { tenant_id: tenant, connector_id: 'email' },
      { tenant_id: tenant, connector_id: 'gmail' },
      { tenant_id: tenant, connector_id: 'open-banking' },
    ])
    await db
      .collection('connector_sync_state')
      .insertOne({ tenant_id: tenant, connector_id: 'email' })
    await db.collection('inbox_items').insertMany([
      { tenant_id: tenant, id: 'i1', email_message_id: 'm1', connector_id: 'email' },
      { tenant_id: tenant, id: 'i2', email_message_id: 'm2', connector_id: 'email' },
      { tenant_id: tenant, id: 'manual' }, // not from a mailbox
    ])
    await db.collection('documents').insertMany([
      { tenant_id: tenant, id: 'from-mail', source: 'email', file_id: f },
      { tenant_id: tenant, id: 'uploaded', file_id: manual },
    ])
    await db
      .collection('email_classify_failures')
      .insertOne({ tenant_id: tenant, email_message_id: 'm9' })
  }
  const disconnect = (app: FastifyInstance, id: string, body?: object) =>
    app.inject({ method: 'POST', url: `/connectors/${id}/disconnect`, payload: body ?? {} })

  it('with delete_data removes the connection and everything read from it, and nothing else', async () => {
    await seedMailbox(A)
    await seedMailbox(B)
    const res = await disconnect(await appFor(A), 'email', { delete_data: true })
    expect(res.statusCode).toBe(200)
    const { receipt } = res.json()
    expect(receipt).toMatchObject({ kind: 'mailbox', status: 'completed', live_data_erased: true })
    expect(receipt.removed).toEqual(
      expect.arrayContaining([
        { category: 'inbox summaries', count: 2 },
        { category: 'documents saved from attachments', count: 1 },
        { category: 'attachment files', count: 1 },
        { category: 'mailbox connection', count: 2 }, // email and its gmail mirror
        { category: 'sync state', count: 1 },
        { category: 'scan failure log', count: 1 },
      ]),
    )
    expect(receipt.kept.join(' ')).toMatch(/stay there until you change them/)

    expect(
      await db
        .collection('connector_credentials')
        .countDocuments({ tenant_id: A, connector_id: { $in: ['email', 'gmail'] } }),
    ).toBe(0)
    // Kept: another connector, a manual inbox item, a document the family uploaded themselves.
    expect(
      await db
        .collection('connector_credentials')
        .countDocuments({ tenant_id: A, connector_id: 'open-banking' }),
    ).toBe(1)
    expect(await db.collection('inbox_items').countDocuments({ tenant_id: A, id: 'manual' })).toBe(
      1,
    )
    expect(await db.collection('documents').countDocuments({ tenant_id: A, id: 'uploaded' })).toBe(
      1,
    )
    expect(await db.collection('documents.files').countDocuments({ 'metadata.tenant_id': A })).toBe(
      1,
    )
    // Tenant B untouched.
    expect(await db.collection('inbox_items').countDocuments({ tenant_id: B })).toBe(3)
    expect(await db.collection('documents').countDocuments({ tenant_id: B })).toBe(2)
    expect(await db.collection('connector_credentials').countDocuments({ tenant_id: B })).toBe(3)
    expect(await db.collection('documents.files').countDocuments({ 'metadata.tenant_id': B })).toBe(
      2,
    )
  })

  it('works after an earlier plain disconnect, which is how a family removes what it left behind', async () => {
    await seedMailbox(A)
    await db
      .collection('connector_credentials')
      .deleteMany({ tenant_id: A, connector_id: { $in: ['email', 'gmail'] } })
    const res = await disconnect(await appFor(A), 'email', { delete_data: true })
    expect(res.statusCode).toBe(200)
    expect(res.json().receipt.removed).toEqual(
      expect.arrayContaining([{ category: 'inbox summaries', count: 2 }]),
    )
  })

  it('without delete_data it only revokes access and says the rest is kept', async () => {
    await seedMailbox(A)
    const res = await disconnect(await appFor(A), 'email')
    expect(res.json()).toEqual({ success: true, derived_data_kept: true })
    expect(await db.collection('inbox_items').countDocuments({ tenant_id: A })).toBe(3)
    expect(await db.collection('deletion_receipts').countDocuments()).toBe(0)
  })

  it('a non-mailbox connector behaves as before, and delete_data does not apply to it', async () => {
    await seedMailbox(A)
    const res = await disconnect(await appFor(A), 'open-banking', { delete_data: true })
    expect(res.json()).toEqual({ success: true })
    expect(await db.collection('inbox_items').countDocuments({ tenant_id: A })).toBe(3)
    expect((await disconnect(await appFor(A), 'open-banking')).statusCode).toBe(404)
  })
})

describe('retention sweep', () => {
  it('removes old derived data, never a document, and records the run', async () => {
    const old = new Date(Date.now() - 5 * 365 * 86_400_000)
    await db.collection('tenants').insertOne({ tenant_id: A, status: 'active' })
    await db.collection('signals').insertOne({ tenant_id: A, created_at: old })
    await db
      .collection('documents')
      .insertOne({ tenant_id: A, id: 'ancient', uploaded_at: old, created_at: old })
    await db
      .collection('family_financial_profile')
      .insertOne({ tenant_id: A, updated_at: old, created_at: old })
    const deleted = await new RetentionWorker(db).run()
    expect(deleted['signals']).toBe(1)
    expect(await db.collection('documents').countDocuments({ tenant_id: A })).toBe(1)
    expect(await db.collection('family_financial_profile').countDocuments({ tenant_id: A })).toBe(1)
    expect(await db.collection('job_runs').countDocuments({ job: 'retention', signals: 1 })).toBe(1)
  })
})
