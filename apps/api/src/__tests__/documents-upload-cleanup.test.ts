/**
 * OAK-019: POST /documents/upload writes to GridFS, then inserts a
 * metadata record — if the metadata insert fails after the GridFS write
 * already succeeded, the blob used to be orphaned forever (no `documents`
 * row ever existed to find it by again). Verifies the fix: the upload
 * stream is genuinely awaited before the metadata insert runs, and a
 * metadata-insert failure triggers cleanup of the GridFS blob it orphaned.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { registerDocumentRoutes } from '../routes/documents.js'

const gridFsDeleteMock = vi.fn(async () => {})
let failMetadataInsert = false

vi.mock('mongodb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mongodb')>()
  return {
    ...actual,
    GridFSBucket: class {
      openUploadStream(filename: string) {
        const stream = new EventEmitter() as EventEmitter & { id: string; end: (buf: Buffer) => void }
        stream.id = `gridfs-${filename}-${Math.random()}`
        // Mirrors the real GridFSBucketWriteStream: 'finish' fires
        // asynchronously, after end() is called — not synchronously.
        stream.end = () => { queueMicrotask(() => stream.emit('finish')) }
        return stream
      }
      async delete(...args: unknown[]) { return gridFsDeleteMock(...args) }
    },
  }
})

function makeDb() {
  const documents: Record<string, unknown>[] = []
  const documentsCol = {
    insertOne: async (doc: Record<string, unknown>) => {
      if (failMetadataInsert) throw new Error('simulated metadata insert failure')
      documents.push(doc)
      return { insertedId: doc['id'] }
    },
    updateOne: async () => ({ modifiedCount: 1 }),
    findOne: async (filter: Record<string, unknown>) =>
      documents.find((d) => Object.entries(filter).every(([k, v]) => d[k] === v)) ?? null,
    find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => documents }) }) }),
  }
  const tenantsCol = { findOne: async () => ({ tenant_id: 'tenant-1', plan: 'free' }) }
  const growthEventsCol = { insertOne: async () => ({ insertedId: 'ge-1' }) }
  return {
    collection: (name: string) =>
      name === 'documents' ? documentsCol : name === 'growth_events' ? growthEventsCol : tenantsCol,
  } as any
}

async function buildApp() {
  const app = Fastify()
  await app.register(multipart)
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: 'tenant-1', user_id: 'user-1' }
  })
  registerDocumentRoutes(app, makeDb())
  return app
}

function multipartPayload(filename: string, content: Buffer) {
  const boundary = 'testboundary123'
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return { body, boundary }
}

describe('OAK-019: document upload GridFS/metadata consistency', () => {
  beforeEach(() => {
    gridFsDeleteMock.mockClear()
    failMetadataInsert = false
  })

  it('a normal upload succeeds (the awaited-finish change does not break the happy path)', async () => {
    const app = await buildApp()
    const { body, boundary } = multipartPayload('doc.png', Buffer.from('fake-bytes'))
    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(201)
    expect(gridFsDeleteMock).not.toHaveBeenCalled()
  })

  it('a metadata-insert failure after a successful GridFS write cleans up the orphaned blob', async () => {
    failMetadataInsert = true
    const app = await buildApp()
    const { body, boundary } = multipartPayload('doc.png', Buffer.from('fake-bytes'))
    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(500)
    expect(gridFsDeleteMock).toHaveBeenCalledTimes(1)
  })
})
