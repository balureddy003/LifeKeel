/**
 * Per-tenant envelope encryption (B4): DEK mint/wrap, self-describing
 * ciphertexts, rotation, crypto-shredding, and legacy passthrough.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { encryptField } from '@lifekeel/platform'
import {
  encryptForTenant,
  decryptEnveloped,
  encryptBufferForTenant,
  decryptBufferEnveloped,
  rotateTenantDek,
  cryptoShredTenantKeys,
  tenantKeysCol,
} from '../envelope.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('envelope-test')
})

beforeEach(async () => {
  for (const name of await db.listCollections().toArray()) {
    await db.collection(name.name).deleteMany({})
  }
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('per-tenant envelope encryption', () => {
  it('round-trips a secret through a tenant DEK', async () => {
    const enc = await encryptForTenant(db, 't1', 'sk-ant-secret')
    expect(enc.startsWith('dek:')).toBe(true)
    expect(enc).not.toContain('sk-ant-secret')
    expect(await decryptEnveloped(db, enc)).toBe('sk-ant-secret')
  })

  it('mints one DEK per tenant and reuses it', async () => {
    await encryptForTenant(db, 't1', 'a')
    await encryptForTenant(db, 't1', 'b')
    await encryptForTenant(db, 't2', 'c')
    const keys = await tenantKeysCol(db).find({ status: 'active' }).toArray()
    expect(keys.map((k) => k.tenant_id).sort()).toEqual(['t1', 't2'])
  })

  it('wrapped DEKs are not plaintext keys', async () => {
    await encryptForTenant(db, 't1', 'x')
    const doc = await tenantKeysCol(db).findOne({ tenant_id: 't1' })
    expect(doc!['dek_wrapped']).not.toMatch(/^[0-9a-f]{64}$/)
  })

  it('crypto-shredding makes ciphertext unrecoverable — by error, not by decryption', async () => {
    const enc = await encryptForTenant(db, 't1', 'the family vault secret')
    expect(await decryptEnveloped(db, enc)).toBe('the family vault secret')
    const shredded = await cryptoShredTenantKeys(db, 't1')
    expect(shredded).toBe(1)
    await expect(decryptEnveloped(db, enc)).rejects.toThrow('not found')
  })

  it('shredding one tenant does not disturb another', async () => {
    const encA = await encryptForTenant(db, 't1', 'alpha')
    const encB = await encryptForTenant(db, 't2', 'bravo')
    await cryptoShredTenantKeys(db, 't1')
    await expect(decryptEnveloped(db, encA)).rejects.toThrow()
    expect(await decryptEnveloped(db, encB)).toBe('bravo')
  })

  it('rotation keeps old ciphertexts readable through the retired key', async () => {
    const enc = await encryptForTenant(db, 't1', 'old secret')
    const newKeyId = await rotateTenantDek(db, 't1')
    expect(await decryptEnveloped(db, enc)).toBe('old secret')
    // New writes bind to the new key.
    const enc2 = await encryptForTenant(db, 't1', 'new secret')
    expect(enc2.startsWith(`dek:${newKeyId}:`)).toBe(true)
    // Shredding the tenant kills BOTH eras of ciphertext.
    await cryptoShredTenantKeys(db, 't1')
    await expect(decryptEnveloped(db, enc)).rejects.toThrow()
    await expect(decryptEnveloped(db, enc2)).rejects.toThrow()
  })

  it('legacy global-key ciphertexts still decrypt (lazy migration)', async () => {
    const legacy = encryptField('pre-envelope secret')
    expect(await decryptEnveloped(db, legacy)).toBe('pre-envelope secret')
    // Plaintext passthrough for unencrypted dev values too.
    expect(await decryptEnveloped(db, 'plain')).toBe('plain')
    expect(await decryptEnveloped(db, undefined)).toBeUndefined()
  })

  it('buffer envelopes round-trip and reject the wrong tenant', async () => {
    const payload = Buffer.from('vault document bytes', 'utf8')
    const enc = await encryptBufferForTenant(db, 't1', payload)
    expect(enc.readUInt8(0)).toBe(0xde)
    expect(await decryptBufferEnveloped(db, enc)).toEqual(payload)
    await cryptoShredTenantKeys(db, 't1')
    await expect(decryptBufferEnveloped(db, enc)).rejects.toThrow()
  })
})
