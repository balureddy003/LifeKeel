/**
 * Reconciler (CLOUDFLARE_INTEGRATION.md §7.3 recovery table, §7.5).
 *
 * Runs every 60 s in the scan worker. Every crash window in the pipeline
 * ends here: a row's durable marker says what is left to do, and each fix is
 * idempotent.
 *
 *   awaiting_upload past its reservation → failed, reservation released, object deleted
 *   scanning past its lease              → scan_queued (attempt kept)
 *   scan_error due                       → scan_queued
 *   clean with quarantine_present        → quarantine deleted, ocr_pending=true
 *   committed-but-held reservation       → committed
 *   deleting past purge_after            → second purge, row removed, receipt closed
 *
 * It also publishes queue age and stuck counts for alerting.
 */
import type { Db } from 'mongodb'
import { createLogger } from '@lifekeel/platform'
import {
  recordDocState,
  recordReconcilerRequeue,
  setDocQueueAge,
  setDocStuck,
} from '../observability/security-metrics.js'
import { objectStore, type ObjectStore } from './r2.js'
import { LEASE_MS } from './pipeline.js'
import { commitReservation, releaseReservation } from './quota.js'
import { finishDuePurges } from './deletion.js'

const log = createLogger({ service: 'doc-reconciler', version: '0.0.0' })

export interface ReconcileReport {
  expired_uploads: number
  leases_requeued: number
  errors_requeued: number
  quarantine_cleaned: number
  reservations_committed: number
  purges: number
}

export async function reconcileOnce(
  db: Db,
  store: ObjectStore = objectStore('scan'),
  now = new Date(),
): Promise<ReconcileReport> {
  const docs = db.collection('documents')
  const report: ReconcileReport = {
    expired_uploads: 0,
    leases_requeued: 0,
    errors_requeued: 0,
    quarantine_cleaned: 0,
    reservations_committed: 0,
    purges: 0,
  }

  // 1. Uploads that never completed.
  for (const row of await docs
    .find({ status: 'awaiting_upload', 'reservation.expires_at': { $lte: now } })
    .limit(200)
    .toArray()) {
    const res = await docs.updateOne(
      { _id: row._id, status: 'awaiting_upload' },
      { $set: { status: 'failed', error_message: 'upload_not_completed' } },
    )
    if (res.modifiedCount === 1) {
      report.expired_uploads++
      recordDocState('failed')
      await releaseReservation(db, String(row['tenant_id']), String(row['id']))
      const key = (row['quarantine'] as { key?: string } | undefined)?.key
      if (key) await store.delete('quarantine', key).catch(() => {})
    }
  }

  // 2. Lost leases: the next attempt starts from quarantine, which is still there.
  const lost = await docs.updateMany(
    { status: 'scanning', lease_until: { $lte: now } },
    {
      $set: { status: 'scan_queued', 'scan_job.next_run_at': now },
      $unset: { lease_owner: '', lease_until: '' },
    },
  )
  report.leases_requeued = lost.modifiedCount
  if (lost.modifiedCount) recordReconcilerRequeue('lease_expired')

  // 3. Scanner errors whose backoff has elapsed.
  const due = await docs.updateMany(
    { status: 'scan_error', 'scan_job.next_run_at': { $lte: now } },
    { $set: { status: 'scan_queued' } },
  )
  report.errors_requeued = due.modifiedCount
  if (due.modifiedCount) recordReconcilerRequeue('scan_error_backoff')

  // 4. Promoted rows whose quarantine copy or OCR hand-off didn't finish.
  for (const row of await docs
    .find({ status: { $in: ['clean', 'stored', 'processing', 'extracted', 'applied'] }, quarantine_present: true })
    .limit(200)
    .toArray()) {
    const key = (row['quarantine'] as { key?: string } | undefined)?.key
    if (key) await store.delete('quarantine', key).catch(() => {})
    const set: Record<string, unknown> = { quarantine_present: false }
    if (row['status'] === 'clean') set['ocr_pending'] = true
    await docs.updateOne({ _id: row._id, quarantine_present: true }, { $set: set })
    report.quarantine_cleaned++
  }

  // 5. Clean rows whose reservation commit was interrupted.
  for (const row of await docs
    .find({
      status: { $in: ['clean', 'stored', 'processing', 'extracted', 'applied', 'error'] },
      'reservation.state': 'held',
      $or: [{ 'storage.key': { $exists: true } }, { file_id: { $exists: true } }],
    })
    .limit(200)
    .toArray()) {
    const size = Number((row['storage'] as { size?: number } | undefined)?.size ?? row['size'] ?? 0)
    if (await commitReservation(db, String(row['tenant_id']), String(row['id']), size))
      report.reservations_committed++
  }

  // 6. Second purge for deletions whose URLs have all expired.
  report.purges = await finishDuePurges(db, store, now)

  // Observability: queue age and stuck rows.
  const oldest = await docs.find({ status: 'scan_queued' }).sort({ 'scan_job.next_run_at': 1 }).limit(1).next()
  const nextRun = (oldest?.['scan_job'] as { next_run_at?: Date } | undefined)?.next_run_at
  setDocQueueAge(nextRun ? Math.max(0, (now.getTime() - nextRun.getTime()) / 1000) : 0)
  setDocStuck(
    'scanning',
    await docs.countDocuments({ status: 'scanning', scan_started_at: { $lte: new Date(now.getTime() - 2 * LEASE_MS) } }),
  )
  setDocStuck(
    'scan_queued',
    await docs.countDocuments({ status: 'scan_queued', 'scan_job.next_run_at': { $lte: new Date(now.getTime() - 5 * 60_000) } }),
  )

  if (Object.values(report).some((n) => n > 0)) log.info({ ...report }, 'Document reconcile pass')
  return report
}

/**
 * Nightly consistency check (§7.14): objects with no live row are orphans
 * (a crash between PUT and commit, or a PUT after the second purge window).
 * Only objects older than a day are removed, so in-flight uploads are safe.
 */
export async function sweepOrphanObjects(
  db: Db,
  store: ObjectStore = objectStore('scan'),
  olderThan = new Date(Date.now() - 24 * 3600_000),
): Promise<{ orphans: number }> {
  let orphans = 0
  for (const role of ['clean', 'quarantine'] as const) {
    for (const key of await store.list(role, '')) {
      const [tenantId, documentId] = key.split('/')
      if (!tenantId || !documentId) continue
      const row = await db
        .collection('documents')
        .findOne({ tenant_id: tenantId, id: documentId }, { projection: { status: 1, uploaded_at: 1 } })
      if (row && row['status'] !== 'failed' && row['status'] !== 'rejected' && row['status'] !== 'infected') continue
      if (row && (row['uploaded_at'] as Date | undefined) && (row['uploaded_at'] as Date) > olderThan) continue
      await store.delete(role, key)
      orphans++
    }
  }
  return { orphans }
}
