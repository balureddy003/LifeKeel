/**
 * Vault deletion against a real MongoDB and GridFS (ISSUES H02): a failed
 * ciphertext delete never reports confirmed deletion, keeps the storage
 * reference for retry, and the retry sweep closes the record only once the
 * object is absent.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { GridFSBucket, MongoClient, type Db, type ObjectId } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerVaultRoutes } from '../../routes/vault.js'
import { deleteGridfs, gridfsExists, writeGridfs } from '../storage.js'
import { retryVaultPurges, VAULT_PURGES } from '../vault-purge.js'

const T = 'family-vault'
let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('vault-purge')
  app = Fastify()
  await app.register(multipart)
  app.addHook('onRequest', async (req) => {
    ;(req as unknown as { authContext: unknown }).authContext = {
      tenant_id: T,
      user_id: 'adult',
      roles: ['owner'],
    }
  })
  registerVaultRoutes(app, db)
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await client.close()
  await mongod.stop()
})
afterEach(() => vi.restoreAllMocks())

let fileId: ObjectId
beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  await db.collection('family_groups').insertOne({
    tenant_id: T,
    members: [{ id: 'adult', role: 'organizer', status: 'active' }],
  })
  fileId = await writeGridfs(db, 'will.pdf', { tenant_id: T }, Buffer.from('ciphertext'))
  await db.collection('documents').insertOne({
    tenant_id: T,
    id: 'v1',
    filename: 'will.pdf',
    category: 'estate_vault',
    status: 'stored',
    file_id: fileId,
  })
})

const failGridfsDelete = () =>
  vi
    .spyOn(GridFSBucket.prototype, 'delete')
    .mockRejectedValue(new Error('connection reset by peer'))

describe('deleteGridfs', () => {
  it('reports an already-absent file as false', async () => {
    await deleteGridfs(db, fileId)
    expect(await deleteGridfs(db, fileId)).toBe(false)
  })

  it('throws when the store fails and the file is still there', async () => {
    failGridfsDelete()
    await expect(deleteGridfs(db, fileId)).rejects.toThrow('connection reset')
    expect(await gridfsExists(db, fileId)).toBe(true)
  })
})

describe('DELETE /vault/documents/:id', () => {
  it('confirms the purge when the object is removed', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/vault/documents/v1' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, purge: 'confirmed' })
    expect(await gridfsExists(db, fileId)).toBe(false)
    expect(await db.collection(VAULT_PURGES).countDocuments()).toBe(0)
  })

  it('reports pending and keeps the storage reference when the object delete fails', async () => {
    failGridfsDelete()
    const res = await app.inject({ method: 'DELETE', url: '/vault/documents/v1' })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ ok: true, purge: 'pending' })
    expect(await db.collection('documents').countDocuments({ id: 'v1' })).toBe(0)
    expect(await gridfsExists(db, fileId)).toBe(true)
    const purge = await db.collection(VAULT_PURGES).findOne({ tenant_id: T, document_id: 'v1' })
    expect(purge?.['file_id']).toEqual(fileId)
    expect(purge?.['attempts']).toBe(1)
    expect(JSON.stringify(purge)).not.toContain('will.pdf')
  })

  it('the retry sweep removes the object and closes the record once storage recovers', async () => {
    const spy = failGridfsDelete()
    await app.inject({ method: 'DELETE', url: '/vault/documents/v1' })
    expect(await retryVaultPurges(db)).toEqual({ confirmed: 0, pending: 1 })
    spy.mockRestore()
    expect(await retryVaultPurges(db)).toEqual({ confirmed: 1, pending: 0 })
    expect(await gridfsExists(db, fileId)).toBe(false)
    expect(await db.collection(VAULT_PURGES).countDocuments()).toBe(0)
  })
})
