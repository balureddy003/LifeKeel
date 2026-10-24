/**
 * The single read/write seam for document bytes (CLOUDFLARE_INTEGRATION.md §7.9, §7.13).
 *
 * Every consumer reads through here: `storage.key` (R2) first, else the
 * GridFS `file_id`. This dual-read must stay deployed for as long as any
 * R2-only document exists, which is what makes `DOCUMENTS_STORAGE=r2` safe to
 * flip back: new uploads return to GridFS and R2 documents stay readable.
 *
 * `documents-storage-seam.test.ts` fails if any other file imports
 * GridFSBucket or touches `documents.files`, so the inventory can't drift.
 *
 * Rollback floor: the first R2 write records `required_schema` in
 * `platform_markers`; a build whose DOCUMENTS_SCHEMA_VERSION is lower refuses
 * to boot (assertDocumentsSchemaFloor). Builds from before this seam existed
 * have no such check, so the deploy runbook forbids rolling back past it.
 */
import { GridFSBucket, type Db, type ObjectId } from 'mongodb'
import type { Env } from '../security/boot-guards.js'
import { hasCredential, objectStore, r2Settings, type R2Credential } from './r2.js'

/** 1 = GridFS only. 2 = this seam (dual-read GridFS + R2). */
export const DOCUMENTS_SCHEMA_VERSION = 2

const BUCKET = 'documents'
const gridfs = (db: Db) => new GridFSBucket(db, { bucketName: BUCKET })

// ── Modes ──────────────────────────────────────────────────────────────────

export type StorageMode = 'gridfs' | 'r2'

/**
 * DOCUMENTS_STORAGE=r2 with DOCUMENTS_R2_TENANTS as an allow-list
 * (comma-separated tenant ids, or `*` for all). Default GridFS.
 */
export function documentStorageMode(tenantId: string, env: Env = process.env): StorageMode {
  if (env['DOCUMENTS_STORAGE'] !== 'r2') return 'gridfs'
  const list = (env['DOCUMENTS_R2_TENANTS'] ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  return list.includes('*') || list.includes(tenantId) ? 'r2' : 'gridfs'
}

export function vaultStorageMode(env: Env = process.env): StorageMode {
  return env['VAULT_STORAGE'] === 'r2' ? 'r2' : 'gridfs'
}

/** Boot-time check for the API process (the scan worker checks its own key). */
export function evaluateStorageBoot(
  env: Env,
  deploymentMode: string,
): { violations: string[]; exceptions: string[] } {
  const violations: string[] = []
  const needs: R2Credential[] = []
  if (env['DOCUMENTS_STORAGE'] === 'r2') needs.push('presign', 'serve', 'delete')
  if (env['VAULT_STORAGE'] === 'r2') needs.push('vault')
  if (needs.length > 0) {
    const s = r2Settings(env)
    if (!s) violations.push('DOCUMENTS_STORAGE/VAULT_STORAGE=r2 needs R2_ACCOUNT_ID or R2_ENDPOINT')
    else
      for (const c of needs)
        if (!s.keys[c])
          violations.push(
            `R2 credential '${c}' missing (R2_${c.toUpperCase()}_ACCESS_KEY_ID/_SECRET_ACCESS_KEY)`,
          )
    if (deploymentMode !== 'dev' && !env['REDIS_URL'])
      violations.push('DOCUMENTS_STORAGE=r2 needs REDIS_URL for scan wake-ups')
  }
  return { violations, exceptions: [] }
}

// ── Schema floor ───────────────────────────────────────────────────────────

const MARKERS = 'platform_markers'
const FLOOR_ID = 'documents_schema_floor'

export async function raiseDocumentsSchemaFloor(db: Db): Promise<void> {
  await db
    .collection<{ _id: string; required_schema: number; raised_at: Date }>(MARKERS)
    .updateOne(
      { _id: FLOOR_ID, required_schema: { $not: { $gte: DOCUMENTS_SCHEMA_VERSION } } },
      { $set: { required_schema: DOCUMENTS_SCHEMA_VERSION, raised_at: new Date() } },
      { upsert: true },
    )
    .catch((err: { code?: number }) => {
      if (err?.code !== 11000) throw err // already at or above the floor
    })
}

/** Throws when the database holds documents this build cannot read. */
export async function assertDocumentsSchemaFloor(db: Db): Promise<void> {
  const marker = await db
    .collection<{ _id: string; required_schema?: number }>(MARKERS)
    .findOne({ _id: FLOOR_ID })
  const required = marker?.required_schema ?? 1
  if (required > DOCUMENTS_SCHEMA_VERSION) {
    throw new Error(
      `Database requires documents schema ${required}; this build supports ${DOCUMENTS_SCHEMA_VERSION}. Deploy a newer release.`,
    )
  }
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** A document row; only `storage`, `file_id`, `mime_type` and `filename` are read. */
export type StoredRef = Record<string, unknown>

const storageOf = (doc: StoredRef) =>
  doc['storage'] as { bucket?: string; key?: string; mime?: string; size?: number } | undefined

/** Where a row's bytes live, or null if it has none (yet). */
export function locate(doc: StoredRef): 'r2_clean' | 'r2_vault' | 'gridfs' | null {
  const st = storageOf(doc)
  if (st?.key && st.bucket === 'clean') return 'r2_clean'
  if (st?.key && st.bucket === 'vault') return 'r2_vault'
  if (doc['file_id']) return 'gridfs'
  return null
}

async function gridfsRead(db: Db, fileId: ObjectId): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of gridfs(db).openDownloadStream(fileId)) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/**
 * Verified document bytes for parsing or the bytes-mode download. Vault rows
 * return their ciphertext (callers decrypt). Never reads quarantine.
 */
export async function readDocumentBytes(db: Db, doc: StoredRef): Promise<Buffer | null> {
  switch (locate(doc)) {
    case 'r2_clean':
      return objectStore('serve').get('clean', storageOf(doc)!.key!)
    case 'r2_vault':
      return objectStore('vault').get('vault', storageOf(doc)!.key!)
    case 'gridfs':
      return gridfsRead(db, doc['file_id'] as ObjectId)
    default:
      return null
  }
}

export const PRESIGNED_GET_TTL_S = 60

/** Short-lived attachment URL for a clean R2 row; null for GridFS rows. */
export async function presignDocumentGet(
  doc: StoredRef,
): Promise<{ url: string; expires_at: string } | null> {
  if (locate(doc) !== 'r2_clean') return null
  const st = storageOf(doc)!
  const url = await objectStore('serve').presignGet('clean', st.key!, {
    ttlS: PRESIGNED_GET_TTL_S,
    filename: String(doc['filename'] ?? 'document'),
    contentType: String(st.mime ?? doc['mime_type'] ?? 'application/octet-stream'),
  })
  return { url, expires_at: new Date(Date.now() + PRESIGNED_GET_TTL_S * 1000).toISOString() }
}

// ── GridFS writes (legacy mode, vault in GridFS mode, mailbox attachments) ──

export async function writeGridfs(
  db: Db,
  filename: string,
  metadata: Record<string, unknown>,
  bytes: Buffer,
): Promise<ObjectId> {
  // Wait on 'finish' so a metadata insert can't race the blob (KEEL-019).
  const stream = gridfs(db).openUploadStream(filename, { metadata })
  const id = stream.id as ObjectId
  await new Promise<void>((resolve, reject) => {
    stream.once('finish', () => resolve())
    stream.once('error', reject)
    stream.end(bytes)
  })
  return id
}

export async function deleteGridfs(db: Db, fileId: unknown): Promise<boolean> {
  if (!fileId) return false
  try {
    await gridfs(db).delete(fileId as ObjectId)
    return true
  } catch {
    return false // already gone
  }
}

export async function gridfsExists(db: Db, fileId: unknown): Promise<boolean> {
  if (!fileId) return false
  return (await db.collection(`${BUCKET}.files`).countDocuments({ _id: fileId as ObjectId })) > 0
}

/** Every GridFS blob a tenant owns (erasure). */
export async function deleteTenantGridfs(db: Db, tenantId: string): Promise<number> {
  const files = await db
    .collection(`${BUCKET}.files`)
    .find({ 'metadata.tenant_id': tenantId })
    .project({ _id: 1 })
    .toArray()
  let n = 0
  for (const f of files) if (await deleteGridfs(db, f._id)) n++
  return n
}

export async function countTenantGridfs(db: Db, tenantId: string): Promise<number> {
  return db.collection(`${BUCKET}.files`).countDocuments({ 'metadata.tenant_id': tenantId })
}

// ── Vault ciphertext ───────────────────────────────────────────────────────

/** Ciphertext only (§7.10): the caller has already applied the tenant envelope. */
export async function writeVaultCiphertext(
  db: Db,
  input: {
    tenantId: string
    documentId: string
    filename: string
    metadata: Record<string, unknown>
  },
  ciphertext: Buffer,
): Promise<{ file_id?: ObjectId; storage?: { bucket: 'vault'; key: string; size: number } }> {
  if (vaultStorageMode() === 'r2') {
    const key = `${input.tenantId}/${input.documentId}`
    await objectStore('vault').put('vault', key, ciphertext, 'application/octet-stream')
    await raiseDocumentsSchemaFloor(db)
    return { storage: { bucket: 'vault', key, size: ciphertext.length } }
  }
  return { file_id: await writeGridfs(db, input.filename, input.metadata, ciphertext) }
}

export async function deleteVaultObject(db: Db, doc: StoredRef): Promise<boolean> {
  if (locate(doc) === 'r2_vault') {
    await objectStore('vault').delete('vault', storageOf(doc)!.key!)
    return true
  }
  return deleteGridfs(db, doc['file_id'])
}

/** Erasure: every vault object under the tenant prefix. */
export async function deleteTenantVaultObjects(tenantId: string): Promise<number> {
  if (!hasCredential('vault')) return 0
  const store = objectStore('vault')
  const keys = await store.list('vault', `${tenantId}/`)
  for (const k of keys) await store.delete('vault', k)
  return keys.length
}
