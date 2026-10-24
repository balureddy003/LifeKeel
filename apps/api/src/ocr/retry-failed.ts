import type { Db } from 'mongodb'
import { readDocumentBytes } from '../documents/storage.js'
import { effectivePlan, hasFeature } from '../entitlements.js'
import { mayParse, type ScanResult } from '../extraction/scan.js'
import { createLogger, type DecisionFn, type VisionFn } from '@lifekeel/platform'
import { processDocument } from './extract.js'
import { recordDocumentExtractionRetries } from '../routes/metrics.js'

const log = createLogger({ service: 'ocr-retry', version: '0.0.0' })

/** After this many failed extractions a document stays in 'error' for a human (the reprocess route still works). */
export const MAX_DOCUMENT_ATTEMPTS = 3
/** Let a transient outage clear before retrying, and avoid hammering a struggling model. */
const RETRY_AFTER_MS = 5 * 60_000
/** Bounded per sweep: local extraction is slow (~30s each), so one sweep must stay short. */
const SWEEP_LIMIT = 5

/**
 * Retries documents whose local extraction failed (status 'error', set by
 * processDocument). Run under a cron lock so replicas do not retry the same file.
 * Returns how many documents were attempted.
 */
export async function retryFailedDocuments(
  db: Db,
  decideFor: (tenantId: string) => DecisionFn | undefined,
  visionFor: (tenantId: string) => Promise<VisionFn | undefined>,
  now = new Date(),
): Promise<number> {
  const documents = db.collection('documents')
  const due = await documents
    .find({
      status: 'error',
      $or: [{ file_id: { $exists: true } }, { 'storage.key': { $exists: true } }],
      retry_count: { $lt: MAX_DOCUMENT_ATTEMPTS },
      processing_completed_at: { $lte: new Date(now.getTime() - RETRY_AFTER_MS) },
    })
    .sort({ processing_completed_at: 1 })
    .limit(SWEEP_LIMIT)
    .toArray()

  let attempted = 0
  for (const doc of due) {
    const tenantId = doc['tenant_id'] as string | undefined
    if (!tenantId) continue
    try {
      const bytes = await readDocumentBytes(db, doc)
      if (!bytes) throw new Error('stored bytes not found')
      attempted += 1
      await processDocument(
        db,
        doc['id'] as string,
        tenantId,
        bytes,
        String(doc['mime_type'] ?? ''),
        String(doc['filename'] ?? 'document'),
        decideFor(tenantId),
        await visionFor(tenantId),
      )
    } catch (err) {
      // Reading the stored file failed. Count it so a missing blob cannot be retried forever.
      log.error(
        { err, documentId: doc['id'], tenantId },
        'Could not read stored document for retry',
      )
      await documents.updateOne(
        { _id: doc['_id'] },
        {
          $inc: { retry_count: 1 },
          $set: {
            processing_completed_at: new Date(),
            error_message: `Retry could not read file: ${(err as Error).message}`,
          },
        },
      )
    }
  }
  if (attempted > 0) {
    recordDocumentExtractionRetries(attempted)
    log.info({ attempted }, 'Retried failed document extractions')
  }
  return attempted
}

/**
 * OCR hand-off for documents the scan worker promoted (CLOUDFLARE_INTEGRATION.md
 * §7.3): rows in `clean` with `ocr_pending`. Each row is claimed with a
 * conditional update, so exactly one dispatch happens per document whichever
 * replica runs the sweep. Same free/paid split as the upload route: without
 * `document_ai_extraction` (or with a scan that doesn't allow parsing) the
 * document is kept as `stored` and never sent to a model.
 */
export async function dispatchPendingOcr(
  db: Db,
  decideFor: (tenantId: string) => DecisionFn | undefined,
  visionFor: (tenantId: string) => Promise<VisionFn | undefined>,
  limit = 10,
): Promise<number> {
  const documents = db.collection('documents')
  let dispatched = 0
  for (let i = 0; i < limit; i++) {
    const doc = await documents.findOneAndUpdate(
      { status: 'clean', ocr_pending: true },
      { $set: { ocr_pending: false, ocr_dispatched_at: new Date() } },
      { sort: { uploaded_at: 1 } },
    )
    if (!doc) break
    const tenantId = String(doc['tenant_id'])
    const tenant = await db.collection('tenants').findOne({ tenant_id: tenantId })
    const scan = (doc['scan'] as ScanResult | undefined) ?? { result: 'not_performed' }
    const entitled = hasFeature('document_ai_extraction', effectivePlan(tenant)) && mayParse(scan)
    if (!entitled) {
      await documents.updateOne({ _id: doc._id, status: 'clean' }, { $set: { status: 'stored' } })
      continue
    }
    try {
      const bytes = await readDocumentBytes(db, doc)
      if (!bytes) throw new Error('clean object missing')
      dispatched++
      await processDocument(
        db,
        String(doc['id']),
        tenantId,
        bytes,
        String((doc['storage'] as { mime?: string } | undefined)?.mime ?? doc['mime_type'] ?? ''),
        String(doc['filename'] ?? 'document'),
        decideFor(tenantId),
        await visionFor(tenantId),
        doc['client_screen'] as 'clear' | 'flagged' | 'unscreened' | undefined,
      )
    } catch (err) {
      log.error({ err, documentId: doc['id'], tenantId }, 'OCR dispatch failed')
      await documents.updateOne(
        { _id: doc._id },
        {
          $set: {
            status: 'error',
            processing_completed_at: new Date(),
            error_message: 'OCR dispatch failed',
          },
        },
      )
    }
  }
  return dispatched
}
