import { GridFSBucket, type Db, type ObjectId } from 'mongodb'
import { createLogger, type DecisionFn } from '@agentoak/platform'
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
export async function retryFailedDocuments(db: Db, decide: DecisionFn, now = new Date()): Promise<number> {
  const documents = db.collection('documents')
  const due = await documents
    .find({
      status: 'error',
      file_id: { $exists: true },
      retry_count: { $lt: MAX_DOCUMENT_ATTEMPTS },
      processing_completed_at: { $lte: new Date(now.getTime() - RETRY_AFTER_MS) },
    })
    .sort({ processing_completed_at: 1 })
    .limit(SWEEP_LIMIT)
    .toArray()

  const bucket = new GridFSBucket(db, { bucketName: 'documents' })
  let attempted = 0
  for (const doc of due) {
    const tenantId = doc['tenant_id'] as string | undefined
    if (!tenantId) continue
    try {
      const chunks: Buffer[] = []
      for await (const chunk of bucket.openDownloadStream(doc['file_id'] as ObjectId)) chunks.push(chunk as Buffer)
      attempted += 1
      await processDocument(db, doc['id'] as string, tenantId, Buffer.concat(chunks), String(doc['mime_type'] ?? ''), String(doc['filename'] ?? 'document'), decide)
    } catch (err) {
      // Reading the stored file failed. Count it so a missing blob cannot be retried forever.
      log.error({ err, documentId: doc['id'], tenantId }, 'Could not read stored document for retry')
      await documents.updateOne(
        { _id: doc['_id'] },
        { $inc: { retry_count: 1 }, $set: { processing_completed_at: new Date(), error_message: `Retry could not read file: ${(err as Error).message}` } },
      )
    }
  }
  if (attempted > 0) {
    recordDocumentExtractionRetries(attempted)
    log.info({ attempted }, 'Retried failed document extractions')
  }
  return attempted
}
