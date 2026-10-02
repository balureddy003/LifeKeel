/**
 * Digital Estate Vault — adult-only gating, encryption at rest (real
 * encryptBuffer/decryptBuffer round-trip, not mocked), and isolation from
 * the general /documents routes. See vault.ts's module doc for the Tier-3
 * trust-tier reasoning on why this has no release/notification logic.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { Engine, type Insight } from '@agentoak/engine'
import { registerVaultRoutes } from '../vault.js'
import { registerDocumentRoutes } from '../documents.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DETECTORS_DIR = path.resolve(__dirname, '../../../../../detectors')

const gridFsDeleteMock = vi.fn(async () => {})
// fileId -> stored bytes, so openDownloadStream can serve back exactly
// what openUploadStream received (the real encrypted envelope).
const storedFiles = new Map<string, Buffer>()

vi.mock('mongodb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mongodb')>()
  return {
    ...actual,
    GridFSBucket: class {
      openUploadStream(filename: string) {
        const stream = new EventEmitter() as EventEmitter & { id: string; end: (buf: Buffer) => void }
        const id = `gridfs-${filename}-${Math.random()}`
        stream.id = id
        stream.end = (buf: Buffer) => {
          storedFiles.set(id, buf)
          queueMicrotask(() => stream.emit('finish'))
        }
        return stream
      }
      openDownloadStream(id: string) {
        const bytes = storedFiles.get(id) ?? Buffer.alloc(0)
        return { async *[Symbol.asyncIterator]() { yield bytes } }
      }
      async delete() { return gridFsDeleteMock() }
    },
  }
})

const TENANT = 'tenant-vault-1'
const ADULT_ID = 'adult-1'
const CHILD_ID = 'child-1'

let familyMembers: Array<{ id: string; role: string; status: string }> = [
  { id: ADULT_ID, role: 'organizer', status: 'active' },
  { id: CHILD_ID, role: 'child', status: 'active' },
]

function makeDb() {
  const documents: Record<string, unknown>[] = []
  const documentsCol = {
    insertOne: async (doc: Record<string, unknown>) => { documents.push(doc); return { insertedId: doc['id'] } },
    findOne: async (filter: Record<string, unknown>) =>
      documents.find((d) => Object.entries(filter).every(([k, v]) => d[k] === v)) ?? null,
    find: (filter: Record<string, unknown> = {}) => {
      const matched = () => documents.filter((d) => Object.entries(filter).every(([k, v]) => d[k] === v))
      return {
        // The vault list route sorts/limits; the estate re-eval (PRD-121)
        // calls toArray() directly on the cursor.
        toArray: async () => matched(),
        sort: () => ({
          toArray: async () => matched(),
          limit: () => ({ toArray: async () => matched() }),
        }),
      }
    },
    deleteOne: async (filter: Record<string, unknown>) => {
      const i = documents.findIndex((d) => Object.entries(filter).every(([k, v]) => d[k] === v))
      if (i >= 0) documents.splice(i, 1)
      return { deletedCount: i >= 0 ? 1 : 0 }
    },
    updateOne: async () => ({ modifiedCount: 1 }),
  }
  const familyGroupsCol = { findOne: async () => ({ tenant_id: TENANT, members: familyMembers }) }
  const tenantsCol = { findOne: async () => ({ tenant_id: TENANT, plan: 'free' }) }
  // PRD-121: the estate re-eval persists a family.estate signal here and
  // resolves stale insights via the scoped 'insights' collection — both
  // minimal, neither needs real behavior for these tests.
  const signalsCol = {
    updateOne: async () => ({}),
    createIndex: async () => ({}),
  }
  const insightsCol = {
    find: () => ({ toArray: async () => [] }),
    updateMany: async () => ({ modifiedCount: 0 }),
  }
  return {
    collection: (name: string) => {
      if (name === 'documents') return documentsCol
      if (name === 'family_groups') return familyGroupsCol
      if (name === 'signals') return signalsCol
      if (name === 'insights') return insightsCol
      return tenantsCol
    },
  } as any
}

async function buildApp(userId: string, engine?: Engine, onInsights?: (insights: Insight[], tenantId: string) => Promise<void>) {
  const app = Fastify()
  await app.register(multipart)
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: userId }
  })
  const db = makeDb()
  registerVaultRoutes(app, db, engine, onInsights)
  registerDocumentRoutes(app, db)
  return app
}

function multipartPayload(filename: string, content: Buffer, mime = 'application/pdf') {
  const boundary = 'testboundary123'
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return { body, boundary }
}

describe('Digital Estate Vault', () => {
  beforeEach(() => {
    gridFsDeleteMock.mockClear()
    storedFiles.clear()
    process.env['NODE_ENV'] = 'test'
    familyMembers = [
      { id: ADULT_ID, role: 'organizer', status: 'active' },
      { id: CHILD_ID, role: 'child', status: 'active' },
    ]
  })

  it('an adult can upload and the raw GridFS bytes are not the plaintext (real encryption, not a mock)', async () => {
    const app = await buildApp(ADULT_ID)
    const plaintext = Buffer.from('%PDF-1.4 fake will contents')
    const { body, boundary } = multipartPayload('will.pdf', plaintext)
    const res = await app.inject({
      method: 'POST',
      url: '/vault/documents/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(201)
    const [storedBytes] = storedFiles.values()
    expect(storedBytes).toBeDefined()
    expect(Buffer.compare(storedBytes!, plaintext)).not.toBe(0)
    expect(storedBytes!.includes(plaintext)).toBe(false)
  })

  it('a child cannot upload to the vault', async () => {
    const app = await buildApp(CHILD_ID)
    const { body, boundary } = multipartPayload('will.pdf', Buffer.from('x'))
    const res = await app.inject({
      method: 'POST',
      url: '/vault/documents/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(403)
  })

  it('an adult downloads the exact original bytes back (round-trip through real encryption)', async () => {
    const app = await buildApp(ADULT_ID)
    const plaintext = Buffer.from('a real will, in bytes')
    const { body, boundary } = multipartPayload('will.pdf', plaintext)
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/vault/documents/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    const { id } = uploadRes.json()

    const fileRes = await app.inject({ method: 'GET', url: `/vault/documents/${id}/file` })
    expect(fileRes.statusCode).toBe(200)
    expect(Buffer.compare(fileRes.rawPayload, plaintext)).toBe(0)
  })

  it('a child cannot download a vault file', async () => {
    const app = await buildApp(ADULT_ID)
    const { body, boundary } = multipartPayload('will.pdf', Buffer.from('secret'))
    const uploadRes = await app.inject({
      method: 'POST', url: '/vault/documents/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    })
    const { id } = uploadRes.json()

    const childApp = await buildApp(CHILD_ID)
    const res = await childApp.inject({ method: 'GET', url: `/vault/documents/${id}/file` })
    expect(res.statusCode).toBe(403)
  })

  it('lists vault documents for an adult without exposing decrypted content', async () => {
    const app = await buildApp(ADULT_ID)
    const { body, boundary } = multipartPayload('poa.pdf', Buffer.from('power of attorney'))
    await app.inject({
      method: 'POST', url: '/vault/documents/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    })
    const res = await app.inject({ method: 'GET', url: '/vault/documents' })
    expect(res.statusCode).toBe(200)
    const { documents } = res.json()
    expect(documents).toHaveLength(1)
    expect(documents[0].filename).toBe('poa.pdf')
    expect(documents[0].content).toBeUndefined()
  })

  it('a child gets 403 listing vault documents', async () => {
    const app = await buildApp(CHILD_ID)
    const res = await app.inject({ method: 'GET', url: '/vault/documents' })
    expect(res.statusCode).toBe(403)
  })

  it('an adult can delete their own uploaded vault document', async () => {
    const app = await buildApp(ADULT_ID)
    const { body, boundary } = multipartPayload('will.pdf', Buffer.from('x'))
    const uploadRes = await app.inject({
      method: 'POST', url: '/vault/documents/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    })
    const { id } = uploadRes.json()
    const delRes = await app.inject({ method: 'DELETE', url: `/vault/documents/${id}` })
    expect(delRes.statusCode).toBe(200)
    const listRes = await app.inject({ method: 'GET', url: '/vault/documents' })
    expect(listRes.json().documents).toHaveLength(0)
  })

  it('a vault document never appears in the general /documents list', async () => {
    const app = await buildApp(ADULT_ID)
    const { body, boundary } = multipartPayload('will.pdf', Buffer.from('x'))
    await app.inject({
      method: 'POST', url: '/vault/documents/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    })
    const res = await app.inject({ method: 'GET', url: '/documents' })
    expect(res.json().documents).toHaveLength(0)
  })

  it('the general GET /documents/:id/file 404s for a vault document id (isolation)', async () => {
    const app = await buildApp(ADULT_ID)
    const { body, boundary } = multipartPayload('will.pdf', Buffer.from('x'))
    const uploadRes = await app.inject({
      method: 'POST', url: '/vault/documents/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    })
    const { id } = uploadRes.json()
    const res = await app.inject({ method: 'GET', url: `/documents/${id}/file` })
    expect(res.statusCode).toBe(404)
  })

  // PRD-114: doc_type tags what the estate component of /family/readiness
  // counts — user-declared on upload, stored, and returned in listings.
  it('stores and returns a declared doc_type, and rejects an invalid one', async () => {
    const app = await buildApp(ADULT_ID)
    const { body, boundary } = multipartPayload('will.pdf', Buffer.from('x'))
    const bad = await app.inject({
      method: 'POST', url: '/vault/documents/upload?doc_type=bogus',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    })
    expect(bad.statusCode).toBe(400)

    const ok = await app.inject({
      method: 'POST', url: '/vault/documents/upload?doc_type=will',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    })
    expect(ok.statusCode).toBe(201)
    expect(ok.json().docType).toBe('will')

    const list = await app.inject({ method: 'GET', url: '/vault/documents' })
    expect(list.json().documents[0].docType).toBe('will')
    await app.close()
  })

  // PRD-121: vault mutations re-evaluate the estate detector so insights
  // don't wait for the next financial-profile submit.
  it('re-evaluates estate readiness on upload — uploading a will retires the no-will gap', async () => {
    const engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
    const delivered: Insight[] = []
    const app = await buildApp(ADULT_ID, engine, async (insights) => { delivered.push(...insights) })
    const { body, boundary } = multipartPayload('will.pdf', Buffer.from('x'))
    const res = await app.inject({
      method: 'POST', url: '/vault/documents/upload?doc_type=will',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    })
    expect(res.statusCode).toBe(201)
    const estate = delivered.filter((i) => i.detector_id === 'family_estate_readiness')
    expect(estate.map((i) => i.rule_id)).toEqual(['estate_no_power_of_attorney'])
    await app.close()
  })

  it('fires both estate gaps on an untyped vault upload, and still fires them on delete', async () => {
    const engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
    const delivered: Insight[] = []
    const app = await buildApp(ADULT_ID, engine, async (insights) => { delivered.push(...insights) })
    const { body, boundary } = multipartPayload('will.pdf', Buffer.from('x'))
    const uploadRes = await app.inject({
      method: 'POST', url: '/vault/documents/upload?doc_type=will',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body,
    })
    const { id } = uploadRes.json()
    delivered.length = 0
    const delRes = await app.inject({ method: 'DELETE', url: `/vault/documents/${id}` })
    expect(delRes.statusCode).toBe(200)
    const estate = delivered.filter((i) => i.detector_id === 'family_estate_readiness')
    expect(estate.map((i) => i.rule_id).sort()).toEqual(['estate_no_power_of_attorney', 'estate_no_will'])
    await app.close()
  })

  // PRD-134: sealed uploads — the body is a client-encrypted envelope
  // (application/octet-stream), the server wraps it in its own layer and
  // never sees plaintext.
  it('accepts a sealed envelope, stores the declared mime + sealed flag, and returns the envelope intact', async () => {
    const app = await buildApp(ADULT_ID)
    const envelope = Buffer.from([...crypto.getRandomValues(new Uint8Array(28)), 1, 2, 3]) // salt+iv+ciphertext stand-in
    const { body, boundary } = multipartPayload('will.pdf', envelope, 'application/octet-stream')
    const res = await app.inject({
      method: 'POST',
      url: '/vault/documents/upload?sealed=1&mime=application/pdf&doc_type=will',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().sealed).toBe(true)

    const list = await app.inject({ method: 'GET', url: '/vault/documents' })
    expect(list.json().documents[0].sealed).toBe(true)
    expect(list.json().documents[0].mimeType).toBe('application/pdf')

    // Download unwraps the server layer and hands back the sealed
    // envelope byte-for-byte — the client unseals the rest.
    const fileRes = await app.inject({ method: 'GET', url: `/vault/documents/${res.json().id}/file` })
    expect(fileRes.statusCode).toBe(200)
    expect(Buffer.compare(fileRes.rawPayload, envelope)).toBe(0)
    await app.close()
  })

  it('rejects a sealed upload whose declared mime isn’t a document type', async () => {
    const app = await buildApp(ADULT_ID)
    const { body, boundary } = multipartPayload('evil.exe', Buffer.from('x'), 'application/octet-stream')
    const res = await app.inject({
      method: 'POST',
      url: '/vault/documents/upload?sealed=1&mime=application/x-msdownload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(422)
    await app.close()
  })
})
