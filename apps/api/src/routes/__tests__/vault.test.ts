/**
 * Digital Estate Vault — adult-only gating, encryption at rest (real
 * encryptBuffer/decryptBuffer round-trip, not mocked), and isolation from
 * the general /documents routes. See vault.ts's module doc for the Tier-3
 * trust-tier reasoning on why this has no release/notification logic.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { registerVaultRoutes } from '../vault.js'
import { registerDocumentRoutes } from '../documents.js'

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
    find: (filter: Record<string, unknown> = {}) => ({
      sort: () => ({
        toArray: async () => documents.filter((d) => Object.entries(filter).every(([k, v]) => d[k] === v)),
        limit: () => ({ toArray: async () => documents.filter((d) => Object.entries(filter).every(([k, v]) => d[k] === v)) }),
      }),
    }),
    deleteOne: async (filter: Record<string, unknown>) => {
      const i = documents.findIndex((d) => Object.entries(filter).every(([k, v]) => d[k] === v))
      if (i >= 0) documents.splice(i, 1)
      return { deletedCount: i >= 0 ? 1 : 0 }
    },
    updateOne: async () => ({ modifiedCount: 1 }),
  }
  const familyGroupsCol = { findOne: async () => ({ tenant_id: TENANT, members: familyMembers }) }
  const tenantsCol = { findOne: async () => ({ tenant_id: TENANT, plan: 'free' }) }
  return {
    collection: (name: string) => {
      if (name === 'documents') return documentsCol
      if (name === 'family_groups') return familyGroupsCol
      return tenantsCol
    },
  } as any
}

async function buildApp(userId: string) {
  const app = Fastify()
  await app.register(multipart)
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: userId }
  })
  const db = makeDb()
  registerVaultRoutes(app, db)
  registerDocumentRoutes(app, db)
  return app
}

function multipartPayload(filename: string, content: Buffer) {
  const boundary = 'testboundary123'
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`),
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
})
