/**
 * Extraction queue (intent 97, slice 2) — document field extraction as a job
 * on the Redis QueueManager instead of inside the upload request.
 *
 * The document row is the durable outbox (same shape as the scan pipeline):
 * `extraction_job` records where the job is, so anything Redis loses the
 * reconciler (requeueStuckExtractions, run by the dispatch cron) finds again.
 *
 *   (none) → queued → running → done
 *              ↑        │  retryable failure: back to queued, status stays 'processing'
 *              └────────┘
 *   running → dead  (attempts exhausted — the page's "could not read this,
 *   enter the figures by hand" state; status 'error')
 *   pending = the publish itself failed (Redis down) — reconciler republishes.
 *
 * The job payload is { documentId, tenantId } only — never content. The
 * worker reads the bytes from storage; a filename, a figure or document text
 * can never ride in a payload by construction (CLAUDE.md rule 3).
 *
 * Idempotent per document: the queued→running transition is one conditional
 * update, so a duplicate delivery, a replayed dead job or a reconciler
 * re-publish changes nothing once a run has started.
 *
 * Job outcomes are counted with the slice-1 engine metrics
 * (extraction_run_completed / extraction_run_dead).
 */
import type { Db } from 'mongodb'
import { createLogger, type DecisionFn, type VisionFn } from '@lifekeel/platform'
import { queueManager } from '../queue/QueueManager.js'
import { readDocumentBytes } from '../documents/storage.js'
import { processDocument } from './extract.js'
import { asCategory, emitEngineMetric } from '../resilience/engine-metrics.js'

const log = createLogger({ service: 'extraction-queue', version: '0.0.0' })

export const EXTRACTION_QUEUE = 'document.extraction'
/** Bounded retries: three extraction attempts per document, then dead. */
export const MAX_EXTRACTION_ATTEMPTS = 3
/** A pending publish retried after the queue is seen to be up again. */
const PENDING_STALE_MS = 30_000
/** A queued job this old means the Redis-side job was lost — republish it. */
const QUEUED_STALE_MS = 90_000
/** A run this old means the worker died mid-extraction — reset and requeue. */
const RUNNING_STALE_MS = 10 * 60_000
const REQUEUE_SWEEP_LIMIT = 25

/** The only shape a job may carry — ids, never content. */
export interface ExtractionJobPayload {
  documentId: string
  tenantId: string
}

export interface ExtractionJobDeps {
  decideFor?: (tenantId: string) => DecisionFn | undefined
  visionFor?: (tenantId: string) => Promise<VisionFn | undefined>
}

type PublishFn = (queue: string, payload: ExtractionJobPayload) => Promise<void>
const defaultPublish: PublishFn = (queue, payload) => queueManager.publish(queue, payload)

/** What the page reads: still in line, being read, or gave up. */
export type ExtractionStatus = 'queued' | 'processing' | 'dead'

/** Document statuses extraction can no longer change — the job record is moot. */
const EXTRACTION_TERMINAL = new Set([
  'extracted',
  'applied',
  'stored',
  'infected',
  'rejected',
  'scan_error',
  'failed',
])

/**
 * The page-readable extraction state, derived so a stale job flag cannot lie:
 * a terminal document status always wins over the job record, and an 'error'
 * row with a live job is mid-retry, not dead.
 */
export function extractionStatusOf(doc: Record<string, unknown>): ExtractionStatus | null {
  const status = String(doc['status'] ?? '')
  const job = doc['extraction_job'] as { state?: string } | undefined
  const jobState = job?.state
  if (status === 'processing') return 'processing'
  if (status === 'error') {
    if (jobState === 'dead') return 'dead'
    if (jobState === 'running' || jobState === 'queued') return 'processing'
    return null
  }
  if (EXTRACTION_TERMINAL.has(status)) return null
  if (jobState === 'pending' || jobState === 'queued') return 'queued'
  if (jobState === 'running') return 'processing'
  return null
}

function asJob(raw: unknown): ExtractionJobPayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Record<string, unknown>
  if (typeof p['documentId'] !== 'string' || typeof p['tenantId'] !== 'string') return null
  return { documentId: p['documentId'], tenantId: p['tenantId'] }
}

/**
 * Mark the document for extraction and publish its job. Idempotent: a doc
 * already queued gets a fresh job (a duplicate is harmless — the claim wins),
 * while a doc running, done or dead is left alone. A publish failure leaves
 * the job 'pending' for the reconciler and never throws — the upload it was
 * called from must still succeed.
 */
export async function enqueueExtraction(
  db: Db,
  documentId: string,
  tenantId: string,
  publish: PublishFn = defaultPublish,
): Promise<'queued' | 'deferred' | 'skipped'> {
  const documents = db.collection('documents')
  const enqueuedAt = new Date()
  const claimed = await documents.updateOne(
    {
      id: documentId,
      tenant_id: tenantId,
      $or: [
        { extraction_job: { $exists: false } },
        { 'extraction_job.state': { $in: ['pending', 'queued'] } },
      ],
    },
    { $set: { 'extraction_job.state': 'queued', 'extraction_job.enqueued_at': enqueuedAt } },
  )
  if (claimed.matchedCount === 0) return 'skipped'
  try {
    await publish(EXTRACTION_QUEUE, { documentId, tenantId })
    return 'queued'
  } catch (err) {
    // Back to 'pending' so the reconciler republishes — the row is the
    // durable record of work still owed, nothing is dropped silently.
    log.warn({ documentId, tenantId, err }, 'Extraction publish failed — job held as pending')
    await documents
      .updateOne(
        {
          id: documentId,
          tenant_id: tenantId,
          'extraction_job.state': 'queued',
          'extraction_job.enqueued_at': enqueuedAt,
        },
        { $set: { 'extraction_job.state': 'pending' } },
      )
      .catch(() => {})
    return 'deferred'
  }
}

/**
 * One queue delivery = at most one extraction run. The claim is atomic, so
 * concurrent duplicates see 'running' and stop. On a retryable failure the
 * job goes back to 'queued' and the throw lets the QueueManager re-deliver;
 * at the attempt cap the document dead-letters and the page can say so.
 * Emits slice-1 outcome events exactly once per outcome.
 */
export async function runExtractionJob(
  db: Db,
  raw: unknown,
  deps: ExtractionJobDeps = {},
): Promise<void> {
  const job = asJob(raw)
  if (!job) {
    log.warn({ raw }, 'Malformed extraction job — dropped')
    return
  }
  const documents = db.collection('documents')
  const now = new Date()
  // The claim: only a 'queued' job under the attempt cap may run, once.
  const claimed = await documents.findOneAndUpdate(
    {
      id: job.documentId,
      tenant_id: job.tenantId,
      'extraction_job.state': 'queued',
      $or: [
        { 'extraction_job.attempts': { $exists: false } },
        { 'extraction_job.attempts': { $lt: MAX_EXTRACTION_ATTEMPTS } },
      ],
    },
    {
      $set: { 'extraction_job.state': 'running', 'extraction_job.started_at': now },
      $inc: { 'extraction_job.attempts': 1 },
    },
    { returnDocument: 'after' },
  )
  if (!claimed) {
    // A job that outlived its attempts (requeued after the doc was already
    // spent) still has to land somewhere: finish it dead, once.
    const spent = await documents.updateOne(
      {
        id: job.documentId,
        tenant_id: job.tenantId,
        'extraction_job.state': 'queued',
        'extraction_job.attempts': { $gte: MAX_EXTRACTION_ATTEMPTS },
      },
      {
        $set: {
          'extraction_job.state': 'dead',
          'extraction_job.dead_at': now,
          status: 'error',
          error_message: 'extraction_failed',
        },
      },
    )
    if (spent.modifiedCount === 1) {
      await emitEngineMetric(db, { tenantId: job.tenantId, event: 'extraction_run_dead' })
    }
    return
  }

  let failure: string | null = null
  try {
    const bytes = await readDocumentBytes(db, claimed)
    if (!bytes) throw new Error('stored bytes not found')
    await processDocument(
      db,
      job.documentId,
      job.tenantId,
      bytes,
      String(
        (claimed['storage'] as { mime?: string } | undefined)?.mime ?? claimed['mime_type'] ?? '',
      ),
      String(claimed['filename'] ?? 'document'),
      deps.decideFor?.(job.tenantId),
      await deps.visionFor?.(job.tenantId),
      claimed['client_screen'] as 'clear' | 'flagged' | 'unscreened' | undefined,
    )
    const after = await documents.findOne(
      { id: job.documentId, tenant_id: job.tenantId },
      { projection: { status: 1, category: 1 } },
    )
    if (after?.['status'] === 'error') {
      failure = String(after['error_message'] ?? 'extraction failed')
    } else {
      await documents.updateOne(
        { id: job.documentId, tenant_id: job.tenantId, 'extraction_job.state': 'running' },
        { $set: { 'extraction_job.state': 'done', 'extraction_job.done_at': new Date() } },
      )
      await emitEngineMetric(db, {
        tenantId: job.tenantId,
        event: 'extraction_run_completed',
        documentCategory: asCategory(after?.['category']),
      })
      return
    }
  } catch (err) {
    failure = (err as Error).message.slice(0, 200)
  }

  const attempts = (claimed['extraction_job'] as { attempts?: number } | undefined)?.attempts ?? 1
  if (attempts >= MAX_EXTRACTION_ATTEMPTS) {
    const dead = await documents.updateOne(
      { id: job.documentId, tenant_id: job.tenantId, 'extraction_job.state': 'running' },
      {
        $set: {
          'extraction_job.state': 'dead',
          'extraction_job.dead_at': new Date(),
          status: 'error',
          error_message: failure ?? 'extraction_failed',
        },
      },
    )
    if (dead.modifiedCount === 1) {
      log.error({ documentId: job.documentId, attempts }, 'Extraction job dead-lettered')
      await emitEngineMetric(db, { tenantId: job.tenantId, event: 'extraction_run_dead' })
    }
    return // consumed — the document row carries the dead-letter, no rethrow
  }

  // Retryable: back to queued for the re-delivery, and keep the page saying
  // "being read" rather than showing the dead-letter card between attempts.
  await documents.updateOne(
    { id: job.documentId, tenant_id: job.tenantId, 'extraction_job.state': 'running' },
    {
      $set: {
        'extraction_job.state': 'queued',
        'extraction_job.enqueued_at': new Date(),
        status: 'processing',
      },
      $unset: { error_message: '' },
    },
  )
  throw new Error(failure ?? 'extraction attempt failed')
}

/**
 * The reconciler half of the outbox: any job the queue lost — a publish that
 * never landed ('pending'), a 'queued' job Redis dropped, a 'running' job
 * whose worker died — is (re)published. Bounded per sweep; the document row
 * means nothing is lost silently even while Redis is down.
 */
export async function requeueStuckExtractions(
  db: Db,
  now = new Date(),
  publish: PublishFn = defaultPublish,
): Promise<number> {
  const documents = db.collection('documents')
  const stuck = await documents
    .find({
      $or: [
        {
          'extraction_job.state': 'pending',
          'extraction_job.enqueued_at': { $lt: new Date(now.getTime() - PENDING_STALE_MS) },
        },
        { 'extraction_job.state': 'pending', 'extraction_job.enqueued_at': { $exists: false } },
        {
          'extraction_job.state': 'queued',
          'extraction_job.enqueued_at': { $lt: new Date(now.getTime() - QUEUED_STALE_MS) },
        },
        {
          'extraction_job.state': 'running',
          'extraction_job.started_at': { $lt: new Date(now.getTime() - RUNNING_STALE_MS) },
        },
      ],
    })
    .sort({ 'extraction_job.enqueued_at': 1 })
    .limit(REQUEUE_SWEEP_LIMIT)
    .toArray()

  let republished = 0
  for (const d of stuck) {
    const job = d['extraction_job'] as { state?: string; started_at?: Date } | undefined
    if (job?.state === 'running') {
      // Reset only if it is still the same stale run — a live worker that
      // finished in between is left alone.
      const reset = await documents.updateOne(
        {
          _id: d['_id'],
          'extraction_job.state': 'running',
          'extraction_job.started_at': job.started_at,
        },
        { $set: { 'extraction_job.state': 'pending' } },
      )
      if (reset.modifiedCount !== 1) continue
    }
    const r = await enqueueExtraction(db, String(d['id']), String(d['tenant_id']), publish)
    if (r === 'queued') republished += 1
  }
  return republished
}

/**
 * The queue consumer. One in-flight extraction per tenant per process — a
 * local model call is the scarce resource, and a burst from one household
 * must not occupy every worker.
 */
export function startExtractionWorker(db: Db, deps: ExtractionJobDeps): void {
  queueManager.subscribe(EXTRACTION_QUEUE, (payload) => runExtractionJob(db, payload, deps), {
    concurrency: 2,
    tenantKey: (p) => (p as ExtractionJobPayload).tenantId,
    perTenantConcurrency: 1,
  })
}
