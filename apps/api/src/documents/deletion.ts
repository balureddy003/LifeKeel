/**
 * Fenced document deletion (CLOUDFLARE_INTEGRATION.md §7.7).
 *
 * Presigned URLs stay usable until they expire and a scan worker may be
 * mid-promotion when a delete lands, so deleting rows and objects once is
 * not enough:
 *
 *   1. conditional set status=deleting, generation+1 (every worker commit is
 *      conditional on the generation it claimed, so it now fails and the
 *      worker deletes the clean key it wrote), plus a tombstone whose
 *      purge_after outlives every URL;
 *   2. first purge: clean and quarantine objects, extracted candidates,
 *      quota released;
 *   3. after purge_after the reconciler deletes both keys again (catching a
 *      PUT through a still-valid URL), removes row and tombstone, and only
 *      then closes the receipt.
 *
 * Closing the receipt earlier would claim an erasure that an unexpired
 * upload URL or a worker could still undo.
 */
import type { Db } from 'mongodb'
import {
  closeReceipt,
  loadReceipt,
  saveReceipt,
  type DeletionReceipt,
} from '../deletion/receipt.js'
import { hasCredential, objectStore, type ObjectStore } from './r2.js'
import { objectKey, PURGE_DELAY_MS } from './pipeline.js'
import { releaseReservation } from './quota.js'
import { recordDocState } from '../observability/security-metrics.js'

export const TOMBSTONES = 'document_tombstones'

export interface Tombstone {
  tenant_id: string
  document_id: string
  deleted_at: Date
  purge_after: Date
  receipt_id: string | null
}

export async function ensureDeletionIndexes(db: Db): Promise<void> {
  await db.collection(TOMBSTONES).createIndex({ tenant_id: 1, document_id: 1 }, { unique: true })
  await db.collection(TOMBSTONES).createIndex({ purge_after: 1 })
}

/** Rows written by the R2 pipeline (any state); GridFS rows delete synchronously as before. */
export function isPipelineRow(doc: Record<string, unknown>): boolean {
  return Boolean(doc['quarantine'] || (doc['storage'] as { key?: string } | undefined)?.key)
}

/**
 * Steps 1 and 2. Returns the removed counts for the receipt, or null when the
 * row was already being deleted (idempotent repeat).
 */
export async function beginFencedDelete(
  db: Db,
  tenantId: string,
  documentId: string,
  receipt: DeletionReceipt | null,
  stores: { clean?: ObjectStore; quarantine?: ObjectStore } = {},
  now = new Date(),
): Promise<{ removed: { category: string; count: number }[] } | null> {
  const purgeAfter = new Date(now.getTime() + PURGE_DELAY_MS)
  const row = await db.collection('documents').findOneAndUpdate(
    { tenant_id: tenantId, id: documentId, status: { $ne: 'deleting' } },
    {
      $set: { status: 'deleting', deleted_at: now, purge_after: purgeAfter, ocr_pending: false },
      $inc: { generation: 1 },
      $unset: { lease_owner: '', lease_until: '' },
    },
  )
  if (!row) return null
  recordDocState('deleting')
  await db.collection<Tombstone>(TOMBSTONES).updateOne(
    { tenant_id: tenantId, document_id: documentId },
    {
      $setOnInsert: {
        tenant_id: tenantId,
        document_id: documentId,
        deleted_at: now,
        purge_after: purgeAfter,
        receipt_id: receipt?.id ?? null,
      },
    },
    { upsert: true },
  )

  const key = objectKey(tenantId, documentId)
  const clean = stores.clean ?? objectStore('delete')
  const quarantine = stores.quarantine ?? objectStore('presign')
  let files = 0
  if ((row['storage'] as { key?: string } | undefined)?.key) {
    await clean.delete('clean', key).catch(() => {})
    files++
  }
  await quarantine.delete('quarantine', key).catch(() => {})
  const candidates = (
    await db
      .collection('extraction_candidates')
      .deleteMany({ tenant_id: tenantId, document_id: documentId })
  ).deletedCount
  await releaseReservation(db, tenantId, documentId)
  const extracted = row['extracted_data'] as Record<string, unknown> | undefined
  return {
    removed: [
      { category: 'document file', count: files },
      {
        category: 'what was read from the document',
        count: extracted && Object.keys(extracted).length > 0 ? 1 : 0,
      },
      { category: 'extracted fields', count: candidates },
    ],
  }
}

/**
 * Step 3, run by the reconciler once purge_after has passed: second purge,
 * remove row and tombstone, close the receipt with a residual check.
 */
export async function finishDuePurges(
  db: Db,
  store: ObjectStore = objectStore('scan'),
  now = new Date(),
): Promise<number> {
  const due = await db
    .collection<Tombstone>(TOMBSTONES)
    .find({ purge_after: { $lte: now } })
    .limit(100)
    .toArray()
  for (const t of due) {
    const key = objectKey(t.tenant_id, t.document_id)
    await store.delete('clean', key)
    await store.delete('quarantine', key)
    const rows = await db
      .collection('documents')
      .deleteMany({ tenant_id: t.tenant_id, id: t.document_id, status: 'deleting' })
    const residual = [
      {
        category: 'document record',
        count: await db
          .collection('documents')
          .countDocuments({ tenant_id: t.tenant_id, id: t.document_id }),
      },
      { category: 'document file', count: (await store.head('clean', key)) ? 1 : 0 },
      {
        category: 'uploaded copy awaiting scan',
        count: (await store.head('quarantine', key)) ? 1 : 0,
      },
    ]
    // Never claim erasure is complete while bytes or rows remain. Keep the
    // tombstone and retry the second purge on the next reconciliation pass.
    if (!residual.every((r) => r.count === 0)) continue
    if (t.receipt_id) {
      const receipt = await loadReceipt(db, t.receipt_id)
      if (receipt) {
        await saveReceipt(
          db,
          closeReceipt(receipt, {
            removed: [{ category: 'document record', count: rows.deletedCount }],
            residual,
          }),
        )
      }
    }
    await db
      .collection(TOMBSTONES)
      .deleteOne({ tenant_id: t.tenant_id, document_id: t.document_id })
  }
  return due.length
}

/**
 * Erasure: every R2 object under the tenant prefix in quarantine and clean.
 * Runs with the API's own credentials (presign: quarantine RW, delete:
 * clean RW). The erasure-replay job re-runs the whole wipe later, which is
 * the second pass for objects an unexpired URL wrote in between.
 */
export async function purgeTenantObjects(
  tenantId: string,
  stores: { clean?: ObjectStore; quarantine?: ObjectStore } = {},
): Promise<number> {
  const plan: Array<[ObjectStore, 'quarantine' | 'clean']> = []
  if (stores.quarantine || hasCredential('presign'))
    plan.push([stores.quarantine ?? objectStore('presign'), 'quarantine'])
  if (stores.clean || hasCredential('delete'))
    plan.push([stores.clean ?? objectStore('delete'), 'clean'])
  let n = 0
  for (const [store, role] of plan) {
    for (const k of await store.list(role, `${tenantId}/`)) {
      await store.delete(role, k)
      n++
    }
  }
  return n
}
