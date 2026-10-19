/**
 * Per-tenant envelope encryption (Stage B4).
 *
 * Each tenant gets its own AES-256-GCM data-encryption key (DEK), itself
 * wrapped by the platform key-encryption key (KEK — the existing
 * `ENCRYPTION_KEY_Vn`/`SETTINGS_ENCRYPTION_KEY` registry in
 * packages/platform). Wrapped DEKs live in `tenant_keys`:
 *
 *   { key_id, tenant_id, dek_wrapped, kek_version, status, created_at }
 *
 * Ciphertexts are self-describing — `dek:{key_id}:{iv}:{tag}:{ct}` — so a
 * decrypt resolves the DEK by key_id without needing the caller's tenant
 * context. That keeps every read site mechanical (`decryptEnveloped` also
 * accepts legacy `v{n}:iv:tag:ct` global-key ciphertexts, so old data
 * decrypts during lazy migration) and gives the two properties B4 wants:
 *
 *   - Rotation: mint a new active DEK per tenant; old ciphertexts still
 *     decrypt through their retired key; re-wrap happens on next write.
 *   - Crypto-shredding: deleting a tenant's key docs makes every
 *     dek:-format ciphertext mathematically unrecoverable — stronger than
 *     deleteMany, which leaves recoverable copies in backups/oplog.
 *
 * Known residual (documented honestly): crypto-shredding is not
 * backup-retroactive — a pre-shred backup still contains the DEK. The
 * erasure SLA is bounded by backup retention until per-backup exclusion
 * exists.
 */
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import type { Db } from 'mongodb'
import { createLogger, defaultKeyRegistry, encryptField, decryptField , decryptIfNeeded, encryptBuffer, decryptBuffer } from '@lifekeel/platform'

const log = createLogger({ service: 'envelope-crypto', version: '0.0.0' })

const ALGORITHM = 'aes-256-gcm'
const DEK_PREFIX = 'dek'
const BUFFER_MAGIC = 0xde

export interface TenantKeyDoc {
  key_id: string
  tenant_id: string
  /** DEK (64-char hex) encrypted under the current KEK version */
  dek_wrapped: string
  kek_version: number
  status: 'active' | 'retired'
  created_at: Date
}

export function tenantKeysCol(db: Db) {
  return db.collection<TenantKeyDoc>('tenant_keys')
}

export function ensureTenantKeyIndexes(db: Db): void {
  tenantKeysCol(db)
    .createIndex({ key_id: 1 }, { unique: true })
    .catch(() => {})
  tenantKeysCol(db)
    .createIndex({ tenant_id: 1, status: 1 })
    .catch(() => {})
}

// ── DEK lifecycle ─────────────────────────────────────────────────────────

async function unwrapDek(doc: TenantKeyDoc): Promise<Buffer> {
  const hex = decryptField(doc.dek_wrapped)
  if (hex.length !== 64) throw new Error('tenant DEK unwrap produced wrong length')
  return Buffer.from(hex, 'hex')
}

/** Fetch or mint the tenant's active DEK. Concurrent first-use may create
 *  two active keys — benign: every ciphertext names its key_id, so both
 *  stay decryptable; the newest wins for writes. */
async function activeTenantKey(db: Db, tenantId: string): Promise<{ keyId: string; dek: Buffer }> {
  const existing = await tenantKeysCol(db).findOne(
    { tenant_id: tenantId, status: 'active' },
    { sort: { created_at: -1 } },
  )
  if (existing) return { keyId: existing.key_id, dek: await unwrapDek(existing) }

  const kekVersion = defaultKeyRegistry.currentVersion()
  const dek = randomBytes(32)
  const doc: TenantKeyDoc = {
    key_id: randomUUID(),
    tenant_id: tenantId,
    dek_wrapped: encryptField(dek.toString('hex')),
    kek_version: kekVersion,
    status: 'active',
    created_at: new Date(),
  }
  ensureTenantKeyIndexes(db)
  try {
    await tenantKeysCol(db).insertOne(doc)
  } catch {
    // Lost a concurrent mint race — fetch whoever won.
    const winner = await tenantKeysCol(db).findOne({ tenant_id: tenantId, status: 'active' })
    if (!winner) throw new Error(`tenant key mint race lost but no winner for ${tenantId}`)
    return { keyId: winner.key_id, dek: await unwrapDek(winner) }
  }
  return { keyId: doc.key_id, dek }
}

async function dekByKeyId(db: Db, keyId: string): Promise<Buffer> {
  const doc = await tenantKeysCol(db).findOne({ key_id: keyId })
  if (!doc) {
    // Deliberately loud — this is either a shredded tenant or corruption.
    // Never fall back to another key: silent wrong-key decryption is worse
    // than an honest error.
    throw new Error(`tenant DEK ${keyId} not found — key shredded or ciphertext corrupt`)
  }
  return unwrapDek(doc)
}

// ── String envelope ─────────────────────────────────────────────────────────

/** Encrypt under the tenant's active DEK. Returns dek:{key_id}:{iv}:{tag}:{ct}. */
export async function encryptForTenant(
  db: Db,
  tenantId: string,
  plaintext: string,
): Promise<string> {
  const { keyId, dek } = await activeTenantKey(db, tenantId)
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, dek, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return `${DEK_PREFIX}:${keyId}:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`
}

/**
 * Decrypt any supported ciphertext: dek:-format via the named tenant key,
 * legacy v{n}:iv:tag:ct / iv:tag:ct via the global key registry. Use this
 * for every credential read — it accepts both old and new formats.
 */
export async function decryptEnveloped(
  db: Db,
  value: string | undefined | null,
): Promise<string | undefined> {
  if (!value) return undefined
  if (value.startsWith(`${DEK_PREFIX}:`)) {
    const parts = value.split(':')
    if (parts.length !== 5) throw new Error('[envelope] malformed dek ciphertext')
    const [, keyId, ivHex, tagHex, dataHex] = parts as [string, string, string, string, string]
    const dek = await dekByKeyId(db, keyId)
    const decipher = createDecipheriv(ALGORITHM, dek, Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString(
      'utf8',
    )
  }
  return decryptIfNeeded(value)
}

// ── Buffer envelope (GridFS / vault documents) ───────────────────────────────
// Layout: [1B magic 0xDE][36B key_id ascii][12B iv][16B tag][ciphertext].
// Legacy encryptBuffer output starts [1B version][12B iv][16B tag][ct] —
// version bytes are 0-255 so 0xDE would collide in theory, but the version
// is always < 0xDE in practice and the key_id length validates the parse.

export async function encryptBufferForTenant(
  db: Db,
  tenantId: string,
  plaintext: Buffer,
): Promise<Buffer> {
  const { keyId, dek } = await activeTenantKey(db, tenantId)
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, dek, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([
    Buffer.from([BUFFER_MAGIC]),
    Buffer.from(keyId, 'ascii'),
    iv,
    cipher.getAuthTag(),
    encrypted,
  ])
}

export async function decryptBufferEnveloped(db: Db, envelope: Buffer): Promise<Buffer> {
  const KEY_ID_LEN = 36
  const HEADER = 1 + KEY_ID_LEN + 12 + 16
  if (envelope.length > HEADER && envelope.readUInt8(0) === BUFFER_MAGIC) {
    const keyId = envelope.subarray(1, 1 + KEY_ID_LEN).toString('ascii')
    const dek = await dekByKeyId(db, keyId)
    const iv = envelope.subarray(1 + KEY_ID_LEN, 1 + KEY_ID_LEN + 12)
    const tag = envelope.subarray(1 + KEY_ID_LEN + 12, HEADER)
    const data = envelope.subarray(HEADER)
    const decipher = createDecipheriv(ALGORITHM, dek, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()])
  }
  return decryptBuffer(envelope)
}

// ── Rotation & shredding ─────────────────────────────────────────────────────

/** Mint a fresh DEK and retire the old. Old ciphertexts keep decrypting —
 * their key_id still resolves to the retired doc until a crypto-shred. */
export async function rotateTenantDek(db: Db, tenantId: string): Promise<string> {
  ensureTenantKeyIndexes(db)
  const kekVersion = defaultKeyRegistry.currentVersion()
  const dek = randomBytes(32)
  const doc: TenantKeyDoc = {
    key_id: randomUUID(),
    tenant_id: tenantId,
    dek_wrapped: encryptField(dek.toString('hex')),
    kek_version: kekVersion,
    status: 'active',
    created_at: new Date(),
  }
  await tenantKeysCol(db).insertOne(doc)
  await tenantKeysCol(db).updateMany(
    { tenant_id: tenantId, key_id: { $ne: doc.key_id }, status: 'active' },
    { $set: { status: 'retired' } },
  )
  log.info({ tenant_id: tenantId, key_id: doc.key_id }, 'Tenant DEK rotated')
  return doc.key_id
}

/**
 * Destroy every DEK doc for a tenant — crypto-shredding. All dek:-format
 * ciphertexts for the tenant become permanently undecryptable. Called by
 * the erasure path after the data wipe so a restore of family documents
 * restores only noise.
 */
export async function cryptoShredTenantKeys(db: Db, tenantId: string): Promise<number> {
  const res = await tenantKeysCol(db).deleteMany({ tenant_id: tenantId })
  if (res.deletedCount > 0) {
    log.info({ tenant_id: tenantId, keys: res.deletedCount }, 'Tenant DEKs shredded')
  }
  return res.deletedCount
}
