/**
 * Document upload state machine (CLOUDFLARE_INTEGRATION.md §7.3).
 *
 * The document row is the durable work queue; Redis is only a wake-up and
 * anything it loses the reconciler finds again. Every transition is a
 * conditional update on the expected status (and, for the worker, its lease
 * and the generation it claimed), so a stale worker changes nothing.
 *
 *   awaiting_upload → scan_queued → scanning → clean → processing → extracted → applied
 *                                            ↘ infected | rejected | scan_error → (retry) | failed
 *   any non-terminal → deleting → (purged)
 *
 * Only clean, stored, processing, extracted and applied rows are readable;
 * mayParse() still gates OCR.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import { Redis } from 'ioredis'
import { recordDocState } from '../observability/security-metrics.js'
import { RESERVATION_TTL_MS } from './quota.js'
import type { FormatKind } from './formats.js'

export const DOC_STATUS = {
  awaiting_upload: 'awaiting_upload',
  scan_queued: 'scan_queued',
  scanning: 'scanning',
  clean: 'clean',
  stored: 'stored',
  processing: 'processing',
  extracted: 'extracted',
  applied: 'applied',
  infected: 'infected',
  rejected: 'rejected',
  scan_error: 'scan_error',
  failed: 'failed',
  deleting: 'deleting',
} as const

/** Statuses whose bytes may be served or parsed. Legacy rows use 'uploaded'/'error' too. */
export const READABLE_STATUSES = new Set([
  'clean',
  'stored',
  'processing',
  'extracted',
  'applied',
  'uploaded',
  'error',
])

export const PIPELINE_ONLY_STATUSES = new Set([
  'awaiting_upload',
  'scan_queued',
  'scanning',
  'scan_error',
  'infected',
  'rejected',
  'failed',
  'deleting',
])

export const LEASE_MS = 5 * 60 * 1000
export const MAX_SCAN_ATTEMPTS = 5
/** Presigned PUT lifetime; also bounds how late a client can overwrite quarantine. */
export const PRESIGNED_PUT_TTL_S = 5 * 60
/** Second purge waits until every presigned URL for the object has expired. */
export const PURGE_DELAY_MS = PRESIGNED_PUT_TTL_S * 1000 + 5 * 60 * 1000

export const objectKey = (tenantId: string, documentId: string) => `${tenantId}/${documentId}`

export interface NewUpload {
  tenantId: string
  userId: string
  filename: string
  mime: string
  kind: FormatKind
  size: number
  sha256?: string | undefined
  category: string
  source?: 'upload' | 'email' | 'legacy_upload'
  /** 'flagged' from the device is authoritative at extraction time. */
  clientScreen?: 'clear' | 'flagged' | 'unscreened' | undefined
}

export async function createAwaitingUpload(db: Db, input: NewUpload, now = new Date()) {
  const id = randomUUID()
  const key = objectKey(input.tenantId, id)
  const row = {
    id,
    tenant_id: input.tenantId,
    filename: input.filename,
    mime_type: input.mime,
    size: input.size,
    category: input.category,
    status: DOC_STATUS.awaiting_upload,
    generation: 1,
    source: input.source ?? 'upload',
    uploaded_by: input.userId,
    uploaded_at: now,
    declared: {
      filename: input.filename,
      mime: input.mime,
      size: input.size,
      kind: input.kind,
      ...(input.sha256 ? { sha256: input.sha256 } : {}),
    },
    quarantine: { key },
    quarantine_present: false,
    ocr_pending: false,
    ...(input.clientScreen ? { client_screen: input.clientScreen } : {}),
    scan_job: { attempt: 0, next_run_at: null as Date | null },
    reservation: {
      size: input.size,
      state: 'held',
      expires_at: new Date(now.getTime() + RESERVATION_TTL_MS),
    },
  }
  await db.collection('documents').insertOne(row)
  recordDocState(DOC_STATUS.awaiting_upload)
  return row
}

/** awaiting_upload → scan_queued: ONE conditional write (the durable outbox). */
export async function markScanQueued(
  db: Db,
  tenantId: string,
  documentId: string,
  etag: string | undefined,
  now = new Date(),
): Promise<boolean> {
  const res = await db.collection('documents').updateOne(
    { tenant_id: tenantId, id: documentId, status: DOC_STATUS.awaiting_upload },
    {
      $set: {
        status: DOC_STATUS.scan_queued,
        quarantine_present: true,
        'quarantine.etag': etag ?? null,
        'scan_job.next_run_at': now,
        completed_at: now,
      },
    },
  )
  if (res.modifiedCount === 1) recordDocState(DOC_STATUS.scan_queued)
  return res.modifiedCount === 1
}

// ── Wake-up (best effort) ──────────────────────────────────────────────────

export const WAKE_KEY = 'lifekeel:doc-scan:wake'
let wakeRedis: Redis | null | undefined

/** A lost wake-up is harmless: the reconciler finds every due row within 60 s. */
export async function wakeScanWorker(): Promise<void> {
  if (wakeRedis === undefined) {
    const url = process.env['REDIS_URL']
    wakeRedis = url
      ? new Redis(url, { connectTimeout: 2000, maxRetriesPerRequest: 1, enableOfflineQueue: false })
      : null
    wakeRedis?.on('error', () => {})
  }
  if (!wakeRedis) return
  try {
    await wakeRedis.lpush(WAKE_KEY, '1')
    await wakeRedis.ltrim(WAKE_KEY, 0, 99)
  } catch {
    /* best effort */
  }
}

// ── Worker transitions ─────────────────────────────────────────────────────

export interface ClaimedRow {
  id: string
  tenant_id: string
  generation: number
  lease_owner: string
  declared: { filename: string; mime: string; size: number; kind: FormatKind; sha256?: string }
  quarantine: { key: string; etag?: string | null }
  scan_job: { attempt: number }
  filename: string
  category: string
  source?: string
}

/** scan_queued (due) → scanning, with a lease. Oldest due first. */
export async function claimNext(db: Db, workerId: string, now = new Date()): Promise<ClaimedRow | null> {
  const row = await db.collection('documents').findOneAndUpdate(
    { status: DOC_STATUS.scan_queued, 'scan_job.next_run_at': { $lte: now } },
    {
      $set: {
        status: DOC_STATUS.scanning,
        lease_owner: workerId,
        lease_until: new Date(now.getTime() + LEASE_MS),
        scan_started_at: now,
      },
      $inc: { 'scan_job.attempt': 1 },
    },
    { sort: { 'scan_job.next_run_at': 1 }, returnDocument: 'after' },
  )
  if (row) recordDocState(DOC_STATUS.scanning)
  return row as unknown as ClaimedRow | null
}

const leaseFilter = (row: ClaimedRow) => ({
  tenant_id: row.tenant_id,
  id: row.id,
  status: DOC_STATUS.scanning,
  lease_owner: row.lease_owner,
  generation: row.generation,
})

export async function renewLease(db: Db, row: ClaimedRow, now = new Date()): Promise<boolean> {
  const res = await db
    .collection('documents')
    .updateOne(leaseFilter(row), { $set: { lease_until: new Date(now.getTime() + LEASE_MS) } })
  return res.matchedCount === 1
}

async function tenantDeleting(db: Db, tenantId: string): Promise<boolean> {
  const t = await db
    .collection('tenants')
    .findOne({ $or: [{ tenant_id: tenantId }, { id: tenantId }] }, { projection: { status: 1 } })
  return t?.['status'] === 'deleting' || t?.['status'] === 'deleted'
}

/**
 * scanning → clean, conditional on lease and generation, and refused for a
 * tenant being erased. On refusal the caller deletes the clean key it wrote.
 */
export async function commitClean(
  db: Db,
  row: ClaimedRow,
  result: {
    cleanKey: string
    storedMime: string
    storedSize: number
    sha256: string
    sourceSha256: string
    scan: Record<string, unknown>
    stored?: { mime: string; width: number; height: number } | undefined
  },
  now = new Date(),
): Promise<boolean> {
  if (await tenantDeleting(db, row.tenant_id)) return false
  const res = await db.collection('documents').updateOne(leaseFilter(row), {
    $set: {
      status: DOC_STATUS.clean,
      storage: { bucket: 'clean', key: result.cleanKey, mime: result.storedMime, size: result.storedSize },
      mime_type: result.storedMime,
      size: result.storedSize,
      scan: { ...result.scan, sha256: result.sha256, source_sha256: result.sourceSha256, at: now },
      ...(result.stored ? { stored: { ...result.stored, sha256: result.sha256 } } : {}),
    },
    $unset: { lease_owner: '', lease_until: '' },
  })
  if (res.modifiedCount === 1) recordDocState(DOC_STATUS.clean)
  return res.modifiedCount === 1
}

/** After the quarantine copy is gone: hand the row to the OCR dispatcher. */
export async function markPromoted(db: Db, tenantId: string, documentId: string): Promise<void> {
  await db
    .collection('documents')
    .updateOne(
      { tenant_id: tenantId, id: documentId, status: DOC_STATUS.clean },
      { $set: { quarantine_present: false, ocr_pending: true } },
    )
}

export async function commitTerminal(
  db: Db,
  row: ClaimedRow,
  status: 'infected' | 'rejected' | 'failed',
  detail: Record<string, unknown>,
  now = new Date(),
): Promise<boolean> {
  const res = await db.collection('documents').updateOne(leaseFilter(row), {
    $set: { status, scan: { ...detail, at: now }, error_message: String(detail['reason'] ?? status) },
    $unset: { lease_owner: '', lease_until: '' },
  })
  if (res.modifiedCount === 1) recordDocState(status)
  return res.modifiedCount === 1
}

export function backoffMs(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1))
}

/** scanning → scan_error with backoff; the reconciler re-queues it when due. */
export async function commitScanError(
  db: Db,
  row: ClaimedRow,
  reason: string,
  now = new Date(),
): Promise<'retry' | 'exhausted' | 'lost'> {
  const exhausted = row.scan_job.attempt >= MAX_SCAN_ATTEMPTS
  const res = await db.collection('documents').updateOne(leaseFilter(row), {
    $set: exhausted
      ? { status: DOC_STATUS.failed, error_message: `scan_error: ${reason}` }
      : {
          status: DOC_STATUS.scan_error,
          'scan_job.next_run_at': new Date(now.getTime() + backoffMs(row.scan_job.attempt)),
          'scan_job.last_error': reason,
        },
    $unset: { lease_owner: '', lease_until: '' },
  })
  if (res.modifiedCount !== 1) return 'lost'
  recordDocState(exhausted ? DOC_STATUS.failed : DOC_STATUS.scan_error)
  return exhausted ? 'exhausted' : 'retry'
}
