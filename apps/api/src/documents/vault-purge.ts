/**
 * Durable vault ciphertext deletion (ISSUES H02).
 *
 * A vault delete removes the metadata row at once (the family asked for it
 * gone), but the ciphertext delete can fail on a storage outage. The storage
 * reference is written to `vault_purges` before the row is removed, and the
 * record stays until the object is confirmed absent. The vault-purge-retry
 * job retries what is left. Records hold ids and storage keys only, no
 * filenames or content.
 */
import type { Db } from 'mongodb'
import { deleteVaultObject, type StoredRef } from './storage.js'

export const VAULT_PURGES = 'vault_purges'

export interface VaultPurge {
  tenant_id: string
  document_id: string
  file_id?: unknown
  storage?: { bucket?: string; key?: string }
  requested_at: Date
  attempts: number
  last_attempt_at?: Date
}

export type PurgeOutcome = 'confirmed' | 'pending'

export async function ensureVaultPurgeIndexes(db: Db): Promise<void> {
  await db.collection(VAULT_PURGES).createIndex({ tenant_id: 1, document_id: 1 }, { unique: true })
}

/** Record the storage reference durably. Call before removing the metadata row. */
export async function recordVaultPurge(
  db: Db,
  tenantId: string,
  documentId: string,
  doc: StoredRef,
  now = new Date(),
): Promise<void> {
  await db.collection<VaultPurge>(VAULT_PURGES).updateOne(
    { tenant_id: tenantId, document_id: documentId },
    {
      $setOnInsert: {
        tenant_id: tenantId,
        document_id: documentId,
        ...(doc['file_id'] ? { file_id: doc['file_id'] } : {}),
        ...(doc['storage'] ? { storage: doc['storage'] as VaultPurge['storage'] } : {}),
        requested_at: now,
        attempts: 0,
      },
    },
    { upsert: true },
  )
}

/** Delete the object; close the record only once the object is absent. */
export async function attemptVaultPurge(
  db: Db,
  tenantId: string,
  documentId: string,
  now = new Date(),
): Promise<PurgeOutcome> {
  const filter = { tenant_id: tenantId, document_id: documentId }
  const purge = await db.collection<VaultPurge>(VAULT_PURGES).findOne(filter)
  if (!purge) return 'confirmed'
  try {
    // true = removed now, false = already absent: both are confirmed absence.
    await deleteVaultObject(db, purge as unknown as StoredRef)
  } catch {
    await db
      .collection<VaultPurge>(VAULT_PURGES)
      .updateOne(filter, { $inc: { attempts: 1 }, $set: { last_attempt_at: now } })
    return 'pending'
  }
  await db.collection(VAULT_PURGES).deleteOne(filter)
  return 'confirmed'
}

/** Retry sweep for the scheduled job. Oldest first, bounded per run. */
export async function retryVaultPurges(
  db: Db,
  limit = 100,
  now = new Date(),
): Promise<{ confirmed: number; pending: number }> {
  const due = await db
    .collection<VaultPurge>(VAULT_PURGES)
    .find({}, { projection: { tenant_id: 1, document_id: 1 } })
    .sort({ requested_at: 1 })
    .limit(limit)
    .toArray()
  let confirmed = 0
  let pending = 0
  for (const p of due) {
    if ((await attemptVaultPurge(db, p.tenant_id, p.document_id, now)) === 'confirmed') confirmed++
    else pending++
  }
  return { confirmed, pending }
}
