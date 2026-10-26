/**
 * Document Routes — upload, list, and retrieve financial documents.
 *
 * POST   /documents/upload    — multipart upload, triggers async OCR extraction
 * GET    /documents           — list documents for tenant
 * GET    /documents/:id       — single document with extracted data
 * DELETE /documents/:id       — delete a document
 *
 * Bytes live in MongoDB GridFS (legacy) or Cloudflare R2 (quarantine →
 * scan → clean, CLOUDFLARE_INTEGRATION.md §7), always read through
 * documents/storage.ts, with metadata in the 'documents' collection. Upload and storage are free on every
 * plan; AI field extraction (GPT-4o vision, via processDocument) is
 * gated behind the 'document_ai_extraction' entitlement — free-plan
 * documents are stored with status 'stored' and never billed for OCR.
 *
 * Security: all routes require JWT auth. tenant_id from JWT, never from body.
 */

import { getAuditLogger } from '../audit/audit-log.js'
import { closeReceipt, openReceipt, publicReceipt, saveReceipt } from '../deletion/receipt.js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from 'mongodb'
import { randomUUID } from 'node:crypto'
import type { Engine, Insight } from '@lifekeel/engine'
import { createLogger, getTenantCollection } from '@lifekeel/platform'
import { processDocument } from '../ocr/extract.js'
import { mayParse, scanUpload } from '../extraction/scan.js'
import { signatureMatchesMime } from '../extraction/file-signature.js'
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  VAULT_ALLOWED_MIME_TYPES,
  checkDeclaredType,
  sanitizeFilename,
  signatureMatches,
} from '../documents/formats.js'
import {
  deleteGridfs,
  documentStorageMode,
  gridfsExists,
  locate,
  presignDocumentGet,
  readDocumentBytes,
  writeGridfs,
} from '../documents/storage.js'
import { commitReservation, releaseReservation, reserveUpload } from '../documents/quota.js'
import {
  createAwaitingUpload,
  markScanQueued,
  READABLE_STATUSES,
  wakeScanWorker,
} from '../documents/pipeline.js'
import { beginFencedDelete, isPipelineRow } from '../documents/deletion.js'
import { objectStore, attachmentDisposition } from '../documents/r2.js'
import { CATEGORIES } from '../extraction/schema.js'
import {
  applyReview,
  auditStep,
  loadCandidates,
  saveCandidates,
  type ExtractionCandidates,
  type ReviewDecision,
} from '../extraction/pipeline.js'
import { extractorLabel, policyRef, saveProvenance } from '../extraction/provenance.js'
import { localDecisionFromEnv } from '../local-model.js'
import { taskDecide, taskVision } from '../ai/task-gateway.js'
import {
  evaluateProfileAndGenerateInsights,
  FinancialProfileSchema,
} from './family-financial-profile.js'
import {
  mapExtractedFieldsToProfileSuggestions,
  isApplicableProfilePath,
  mapExtractedFieldsToPolicySuggestion,
  type PolicyType,
} from '../ocr/profile-mapping.js'
import { effectivePlan, hasFeature } from '../entitlements.js'
import { recordInsightAction } from '../insights/insight-attribution.js'
import { buildDedupeKey, emitReadinessEvent } from '../feed/emit.js'
import { isHouseholdEditor } from '../family/family-permissions.js'

// PRD-136: one feed event per document pipeline stage (uploaded /
// extracted / applied), deduped per (document, stage) so a reprocess or
// retry refreshes the day's row rather than stacking copies.
function emitDocumentEvent(
  db: Db,
  tenantId: string,
  documentId: string,
  filename: string,
  stage: 'uploaded' | 'extracted' | 'applied',
): void {
  const titles = {
    uploaded: `Document uploaded: ${filename}`,
    extracted: `Document read: ${filename}`,
    applied: `Document applied to your profile: ${filename}`,
  } as const
  const summaries = {
    uploaded: 'Keel stored the file and queued it for field extraction.',
    extracted: 'Keel finished reading the document — extracted fields are ready to review.',
    applied: 'Fields you confirmed from this document are now on your financial profile.',
  } as const
  emitReadinessEvent(db, tenantId, {
    type: 'document_processed',
    severity: 'info',
    direction: 'up',
    member_id: null,
    domain: 'documents',
    title: titles[stage].slice(0, 120),
    summary: summaries[stage],
    evidence: [{ label: 'Stage', value: stage }],
    links: [{ kind: 'document', id: documentId }],
    next_check_at: null,
    dedupe_key: buildDedupeKey('document_processed', `${documentId}:${stage}`),
  })
}

const log = createLogger({ service: 'documents', version: '0.0.0' })

type DocumentRecord = Record<string, unknown> & {
  uploaded_at?: Date
  processing_started_at?: Date
  processing_completed_at?: Date
}

// The multipart route's list when bytes go to GridFS: no DOCX there, since
// only the R2 pipeline runs the zip structure checks DOCX needs. Kept equal
// to the vault's own list (documents/formats.ts is the source of truth).
export const ALLOWED_MIME_TYPES: ReadonlySet<string> = VAULT_ALLOWED_MIME_TYPES

export const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB — matches multipart limit in server.ts

// Estate Vault documents live in this same GridFS bucket + 'documents'
// collection (see vault.ts's module doc for why), encrypted at rest and
// gated to adult family members only — never mix them into the general
// document list/detail/file routes below, which have no such gating.
// Exported so vault.ts uses the exact same literal, not a copy that could drift.
export const ESTATE_VAULT_CATEGORY = 'estate_vault'

// Aggregate intake limits (R25), on top of the 50 MB per-file cap: shared
// atomic reservations across instances (documents/quota.ts), replacing the
// per-instance Map and the GridFS-only usage sum.

/** Statuses the general list and detail routes never show. */
const HIDDEN_STATUSES = ['awaiting_upload', 'deleting']

export function registerDocumentRoutes(
  fastify: FastifyInstance,
  db: Db,
  engine?: Engine,
  onInsightsGenerated?: (insights: Insight[], tenantId: string) => Promise<void>,
): void {
  // Applying extracted data is an explicit, user-reviewed profile mutation —
  // the document-detail card makes the user confirm every suggestion before
  // it lands. The remediation review flagged that the mutation used to stop
  // there: nothing surfaced until the user separately re-submitted the
  // Financial Profile wizard's "Save & Generate Insights". So a successful
  // apply now re-runs the detector pass in-request — but only when the
  // stored document parses as a complete FinancialProfile. An upsert-created
  // skeleton of a couple of OCR fields fails schema validation, which keeps
  // first-time profile creation (and its generation boundary) in the wizard.
  const regenerateInsights = async (tenantId: string): Promise<number> => {
    if (!engine) return 0
    const profiles = getTenantCollection<Record<string, unknown>>(
      db,
      'family_financial_profile',
      tenantId,
    )
    const doc = await profiles.findOne({})
    if (!doc) return 0
    const parsed = FinancialProfileSchema.safeParse(doc)
    if (!parsed.success) return 0
    return evaluateProfileAndGenerateInsights(
      parsed.data,
      tenantId,
      engine,
      db,
      onInsightsGenerated,
    )
  }

  // ── POST /documents/upload ──────────────────────────────────────────────
  /**
   * The gate every profile write from a document passes (PRD-143 items 1 and 4):
   * the document's type must be trusted or confirmed, and the fields it would
   * use must not be low-confidence and unreviewed. Returns the usable fields
   * (a rejected field is never used; an edited one uses the edited value), or
   * the error to send.
   */
  async function gate(
    tenantId: string,
    doc: Record<string, unknown>,
    sourceKeys: string[] | null,
    opts: { block?: boolean } = {},
  ): Promise<
    | { ok: true; fields: Record<string, string>; candidates: ExtractionCandidates | null }
    | { ok: false; status: number; body: Record<string, unknown> }
  > {
    const block = opts.block !== false
    const cls = doc['classification'] as
      { needs_confirmation?: boolean; confirmed?: boolean } | undefined
    if (block && cls?.needs_confirmation && !cls.confirmed) {
      return {
        ok: false,
        status: 409,
        body: { error: 'confirm_type', message: 'Confirm what this document is first.' },
      }
    }
    const candidates = await loadCandidates(db, tenantId, String(doc['id']))
    // Documents read before candidates existed fall back to their stored fields.
    if (!candidates) {
      return {
        ok: true,
        fields: (doc['extracted_data'] as Record<string, string>) ?? {},
        candidates: null,
      }
    }
    const usable: Record<string, string> = {}
    const blocked: string[] = []
    for (const f of candidates.fields) {
      if (f.status === 'rejected') continue
      if (
        block &&
        f.needs_review &&
        f.status === 'proposed' &&
        sourceKeys !== null &&
        sourceKeys.includes(f.key)
      ) {
        blocked.push(f.key)
        continue
      }
      usable[f.key] =
        f.status === 'edited' && f.edited_value !== undefined ? f.edited_value : f.value
    }
    if (blocked.length > 0) {
      return {
        ok: false,
        status: 409,
        body: {
          error: 'review_required',
          fields: blocked,
          message: 'Check these fields against the document first.',
        },
      }
    }
    return { ok: true, fields: usable, candidates }
  }

  // Legacy multipart upload (CLOUDFLARE_INTEGRATION.md §7.4): kept for one
  // release for older clients. For tenants on R2 it writes to quarantine and
  // follows the same scan job as the direct upload — one pipeline, not two.
  // Concurrency, storage and daily limits are the shared reservations.
  fastify.post(
    '/documents/upload',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => handleUpload(req, reply),
  )

  async function handleUpload(req: FastifyRequest, reply: FastifyReply) {
    const { tenant_id } = req.authContext
    const data = await req.file()
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' })
    }
    const r2 = documentStorageMode(tenant_id) === 'r2'
    if (r2) return handleQuarantineUpload(req, reply, data)

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(data.mimetype)) {
      return reply.status(422).send({
        error: `Unsupported file type: ${data.mimetype}. Allowed: images (JPEG, PNG, WebP, HEIC) and PDF.`,
      })
    }

    // Read file into buffer (we need it for both GridFS and OCR)
    const fileBuffer = await data.toBuffer()

    // On-device screen outcome from the client (see apps/web's
    // on-device-doc-screen.ts). Whitelist-validated — anything else is
    // ignored. 'flagged' is authoritative; the server still re-screens.
    const rawClientScreen = (data.fields as Record<string, unknown> | undefined)?.['clientScreen']
    const clientScreenValue =
      rawClientScreen &&
      typeof rawClientScreen === 'object' &&
      'value' in rawClientScreen &&
      typeof (rawClientScreen as { value: unknown }).value === 'string'
        ? ((rawClientScreen as { value: string }).value as string)
        : undefined
    const clientScreen =
      clientScreenValue === 'clear' ||
      clientScreenValue === 'flagged' ||
      clientScreenValue === 'unscreened'
        ? clientScreenValue
        : undefined

    if (fileBuffer.length > MAX_FILE_SIZE) {
      return reply.status(413).send({ error: 'File too large (max 50 MB)' })
    }

    // The declared MIME type is client-supplied — check the bytes match
    // it before storing (UAT D3: an executable renamed .pdf sailed
    // through the allowlist).
    if (!signatureMatchesMime(fileBuffer, data.mimetype)) {
      return reply.status(422).send({
        error:
          "The file's contents don't match its type. Allowed: images (JPEG, PNG, WebP, HEIC) and PDF.",
      })
    }

    const documentId = randomUUID()
    const filename = sanitizeFilename(data.filename || `document-${documentId}`)
    const mimeType = data.mimetype

    // Never log the filename: it can carry names ("Dad's will.pdf").
    log.info({ documentId, mimeType, size: fileBuffer.length, tenant_id }, 'Uploading document')

    // Optional malware scan (PRD-143 item 1). With no scanner configured this
    // says `not_performed`; it never reports a file clean that nothing looked at.
    const scan = await scanUpload(fileBuffer)
    auditStep(tenant_id, req.authContext.user_id ?? 'unknown', 'document.intake', documentId, {
      size: fileBuffer.length,
      mime: mimeType,
      scan: scan.result,
    })
    if (scan.result === 'infected') {
      log.warn({ documentId, tenant_id }, 'Upload refused by malware scan')
      return reply
        .status(422)
        .send({ error: 'This file was blocked by a security scan and was not stored.' })
    }

    const refusal = await reserveUpload(db, tenant_id, fileBuffer.length)
    if (refusal) return reply.status(refusal.status).send({ error: refusal.message })

    try {
      // Store file in GridFS (KEEL-019: the seam waits for 'finish').
      let fileId: unknown
      try {
        fileId = await writeGridfs(
          db,
          filename,
          { tenant_id, document_id: documentId, mime_type: mimeType, uploaded_at: new Date() },
          fileBuffer,
        )
      } catch (err) {
        await db
          .collection('tenant_quota')
          .updateOne({ tenant_id }, { $inc: { bytes_reserved: -fileBuffer.length, inflight: -1 } })
        throw err
      }

      // Create document metadata record
      const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
      const tenants = getTenantCollection<DocumentRecord>(db, 'tenants', tenant_id)
      try {
        await documents.insertOne({
          id: documentId,
          filename,
          mime_type: mimeType,
          size: fileBuffer.length,
          category: 'other',
          status: 'uploaded',
          uploaded_at: new Date(),
          file_id: fileId,
          scan: { ...scan, at: new Date() },
          reservation: { size: fileBuffer.length, state: 'held' },
        })
      } catch (metaErr) {
        // KEEL-019: the GridFS write above already succeeded — without this,
        // a metadata-insert failure orphaned that blob forever (no
        // `documents` row exists to ever look it up by again). Best-effort:
        // if the cleanup delete itself fails, log and still surface the
        // original error rather than masking it.
        if (!(await deleteGridfs(db, fileId)))
          log.error(
            { fileId, documentId },
            'Failed to clean up orphaned GridFS blob after metadata insert failure',
          )
        await db
          .collection('tenant_quota')
          .updateOne({ tenant_id }, { $inc: { bytes_reserved: -fileBuffer.length, inflight: -1 } })
        throw metaErr
      }
      await commitReservation(db, tenant_id, documentId, fileBuffer.length)
      emitDocumentEvent(db, tenant_id, documentId, filename, 'uploaded')

      // Upload and storage are free on every plan — AI field extraction
      // (GPT-4o vision, the actual cost driver) is gated to paid plans.
      const tenant = await getTenantCollection<DocumentRecord>(db, 'tenants', tenant_id).findOne()
      const plan = effectivePlan(tenant)
      // A scanner that is configured but did not answer leaves the file unscanned:
      // it is kept, but not sent for extraction.
      // and with a scanner required (production default) an unscanned file
      // is kept but never handed to a parser (R25).
      const aiExtractionEnabled = hasFeature('document_ai_extraction', plan) && mayParse(scan)

      if (aiExtractionEnabled) {
        log.info({ documentId, tenant_id }, 'Document stored, starting OCR processing')
        // Trigger async OCR processing (non-blocking — errors handled in processDocument)
        void (async () => {
          await processDocument(
            db,
            documentId,
            tenant_id,
            fileBuffer,
            mimeType,
            filename,
            taskDecide('document.extract.v1', tenant_id, localDecisionFromEnv('ocr')),
            await taskVision('document.extract.v1', tenant_id),
            clientScreen,
          )
        })().catch((err) => {
          log.error({ err, documentId }, 'OCR processing threw unhandled error')
        })
      } else {
        log.info(
          { documentId, tenant_id, plan, scan: scan.result },
          'Document stored — AI extraction not run (paid plan required, or the scan did not complete)',
        )
        // They uploaded expecting extraction — the strongest upgrade-intent
        // signal. Feeds the lifecycle upgrade sequence's targeting.
        db.collection('growth_events')
          .insertOne({
            event: 'upgrade_intent',
            meta: { tenant_id, feature: 'document_ai_extraction', plan },
            created_at: new Date(),
          })
          .catch(() => {})
        await documents.updateOne({ id: documentId }, { $set: { status: 'stored' } })
      }

      // Return immediately — client can poll /documents/:id for AI status
      const doc = await documents.findOne({ id: documentId })
      return reply.status(201).send({
        id: documentId,
        filename,
        category: 'other',
        status: doc?.['status'] ?? 'uploaded',
        uploadedAt: doc?.['uploaded_at']?.toISOString() ?? new Date().toISOString(),
        aiExtractionEnabled,
      })
    } catch (err) {
      log.error({ err, documentId }, 'Failed to store document')
      return reply.status(500).send({ error: 'Failed to store document' })
    }
  }

  /** R2 tenants: the multipart bytes go to quarantine and join the scan pipeline. */
  async function handleQuarantineUpload(
    req: FastifyRequest,
    reply: FastifyReply,
    data: NonNullable<Awaited<ReturnType<FastifyRequest['file']>>>,
  ) {
    const { tenant_id, user_id } = req.authContext
    const filename = sanitizeFilename(data.filename || 'document')
    const type = checkDeclaredType(filename, data.mimetype)
    if (!type.ok || !ALLOWED_UPLOAD_MIME_TYPES.has(data.mimetype))
      return reply.status(422).send({
        error:
          'Unsupported file type. Allowed: PDF, Word (.docx), and images (JPEG, PNG, WebP, GIF, HEIC).',
      })
    const bytes = await data.toBuffer()
    if (bytes.length === 0 || bytes.length > MAX_FILE_SIZE)
      return reply.status(413).send({ error: 'File too large (max 50 MB)' })
    if (!signatureMatches(bytes, type.mime))
      return reply.status(422).send({ error: "The file's contents don't match its type." })
    const refusal = await reserveUpload(db, tenant_id, bytes.length)
    if (refusal) return reply.status(refusal.status).send({ error: refusal.message })
    const row = await createAwaitingUpload(db, {
      tenantId: tenant_id,
      userId: user_id ?? 'unknown',
      filename,
      mime: type.mime,
      kind: type.kind,
      size: bytes.length,
      category: 'other',
      source: 'legacy_upload',
    })
    try {
      await objectStore('presign').put('quarantine', row.quarantine.key, bytes, type.mime)
    } catch (err) {
      await db
        .collection('documents')
        .updateOne(
          { tenant_id, id: row.id },
          { $set: { status: 'failed', error_message: 'quarantine_write_failed' } },
        )
      await releaseReservation(db, tenant_id, row.id)
      throw err
    }
    const head = await objectStore('presign').head('quarantine', row.quarantine.key)
    await markScanQueued(db, tenant_id, row.id, head?.etag)
    void wakeScanWorker()
    emitDocumentEvent(db, tenant_id, row.id, filename, 'uploaded')
    return reply.status(201).send({
      id: row.id,
      filename,
      category: 'other',
      status: 'scan_queued',
      uploadedAt: row.uploaded_at.toISOString(),
      aiExtractionEnabled: false,
    })
  }

  // ── GET /documents ──────────────────────────────────────────────────────
  fastify.get<{ Querystring: { category?: string; status?: string; limit?: string } }>(
    '/documents',
    async (req) => {
      const { tenant_id } = req.authContext
      const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
      // Estate Vault documents are encrypted and adult-gated (see vault.ts)
      // — never surfaced through the general, ungated document list even
      // if someone explicitly requests that category.
      const filter: Record<string, unknown> = {
        category: { $ne: ESTATE_VAULT_CATEGORY },
        status: { $nin: HIDDEN_STATUSES },
      }

      if (req.query.category && req.query.category !== ESTATE_VAULT_CATEGORY)
        filter['category'] = req.query.category
      if (typeof req.query.status === 'string' && !HIDDEN_STATUSES.includes(req.query.status))
        filter['status'] = req.query.status

      // A finite integer in [1, 100] (R26): 0, negatives and NaN would
      // otherwise reach MongoDB, where limit(0) means "no limit".
      const requested = Number.parseInt(String(req.query.limit ?? '50'), 10)
      const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 100) : 50

      const docs = await documents.find(filter).sort({ uploaded_at: -1 }).limit(limit).toArray()

      const tenant = await getTenantCollection<DocumentRecord>(db, 'tenants', tenant_id).findOne()
      const plan = effectivePlan(tenant)
      const aiExtractionEnabled = hasFeature('document_ai_extraction', plan)

      return {
        documents: docs.map((doc: DocumentRecord) => ({
          id: doc['id'],
          filename: doc['filename'],
          category: doc['category'] ?? 'other',
          status: doc['status'] ?? 'uploaded',
          uploadedAt: doc['uploaded_at']?.toISOString() ?? '',
          extractedData: doc['extracted_data'] ?? {},
          // Free tier can set this manually — the renewal detectors read it.
          renewalDate: doc['renewal_date'] ?? null,
        })),
        aiExtractionEnabled,
      }
    },
  )

  // ── GET /documents/:id ──────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/documents/:id', async (req, reply) => {
    const { tenant_id } = req.authContext
    const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
    const doc = await documents.findOne({
      id: req.params.id,
    })

    if (
      !doc ||
      doc['category'] === ESTATE_VAULT_CATEGORY ||
      // The uploader polls an awaiting_upload row; a deleting one is gone.
      doc['status'] === 'deleting'
    ) {
      return reply.status(404).send({ error: 'Document not found' })
    }

    return {
      id: doc['id'],
      filename: doc['filename'],
      mimeType: doc['mime_type'],
      category: doc['category'] ?? 'other',
      status: doc['status'] ?? 'uploaded',
      uploadedAt: doc['uploaded_at']?.toISOString() ?? '',
      extractedData: doc['extracted_data'] ?? {},
      // The free-text summary is no longer stored (PRD-143); kept in the shape for older clients.
      rawText: '',
      classification: doc['classification'] ?? null,
      documentDate: doc['document_date'] ?? null,
      renewalDate: doc['renewal_date'] ?? null,
      scan: (doc['scan'] as { result?: string } | undefined)?.result ?? 'not_performed',
      candidates: (await loadCandidates(db, tenant_id, req.params.id))?.fields ?? [],
      processingStartedAt: doc['processing_started_at']?.toISOString() ?? null,
      processingCompletedAt: doc['processing_completed_at']?.toISOString() ?? null,
      errorMessage: doc['error_message'] ?? null,
      // Art. 9 screen outcome: 'flagged' docs were held from hosted
      // extraction (special-category markers found), 'unscreened' means no
      // readable text existed to check. Lets the UI say why a doc is
      // 'stored' instead of silently looking like a failed read.
      specialCategory: doc['special_category'] ?? null,
      extractionHeldReason: doc['extraction_held_reason'] ?? null,
    }
  })

  // ── PATCH /documents/:id — set/clear a stored document's renewal date ───
  // Intent 59: free-tier "Stored — renews on X" confirmation. Optional,
  // editable, and the renewal detectors read it.
  fastify.patch<{ Params: { id: string }; Body: { renewal_date?: string | null } }>(
    '/documents/:id',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const renewal = req.body?.renewal_date
      if (renewal !== undefined && renewal !== null && !/^\d{4}-\d{2}-\d{2}$/.test(renewal)) {
        return reply.status(400).send({ error: 'renewal_date must be YYYY-MM-DD or null' })
      }
      const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
      const doc = await documents.findOne({ id: req.params.id })
      if (!doc) return reply.status(404).send({ error: 'Document not found' })
      await documents.updateOne({ id: req.params.id }, { $set: { renewal_date: renewal ?? null } })
      return { id: req.params.id, renewalDate: renewal ?? null }
    },
  )

  // ── GET /documents/:id/file ──────────────────────────────────────────────
  // Original bytes for the AI Memory review drawer (source next to what Keel
  // extracted). Two modes (CLOUDFLARE_INTEGRATION.md §7.4):
  //   ?mode=url  → { url, expires_at }: a 60 s presigned attachment GET
  //                from the clean bucket (R2 rows only; GridFS rows answer
  //                409 not_in_object_store and the client uses bytes mode)
  //   (default)  → the bytes, streamed through the API: today's contract,
  //                kept for released mobile builds until they age out.
  // Nothing is readable before its scan says clean.
  fastify.get<{ Params: { id: string }; Querystring: { mode?: string } }>(
    '/documents/:id/file',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
      const doc = await documents.findOne({ id: req.params.id })
      if (!doc || doc['category'] === ESTATE_VAULT_CATEGORY || !locate(doc))
        return reply
          .status(doc && !locate(doc) ? 409 : 404)
          .send(doc && !locate(doc) ? { error: 'not_ready' } : { error: 'Document not found' })
      if (!READABLE_STATUSES.has(String(doc['status'] ?? 'uploaded')))
        return reply.status(409).send({ error: 'not_ready', status: doc['status'] })

      getAuditLogger()?.fromRequest(req, 'document.accessed', 'document', req.params.id, {
        mode: req.query.mode === 'url' ? 'url' : 'bytes',
      })
      reply.header('Cache-Control', 'no-store')
      reply.header('X-Content-Type-Options', 'nosniff')

      if (req.query.mode === 'url') {
        const signed = await presignDocumentGet(doc)
        if (!signed) return reply.status(409).send({ error: 'not_in_object_store' })
        return reply.send(signed)
      }

      const bytes = await readDocumentBytes(db, doc)
      if (!bytes) return reply.status(404).send({ error: 'Document not found' })
      reply.header(
        'Content-Type',
        String(
          (doc['storage'] as { mime?: string } | undefined)?.mime ??
            doc['mime_type'] ??
            'application/octet-stream',
        ),
      )
      reply.header(
        'Content-Disposition',
        attachmentDisposition(String(doc['filename'] ?? 'document')).replace(
          /^attachment/,
          'inline',
        ),
      )
      return reply.send(bytes)
    },
  )

  // ── GET /documents/:id/profile-suggestions ──────────────────────────────
  // extractDocumentFields() pulls structured fields out of a document, but
  // nothing ever surfaced them back to the Financial Profile — the user had
  // to retype numbers already sitting on a document they just uploaded.
  fastify.get<{ Params: { id: string } }>(
    '/documents/:id/profile-suggestions',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
      const doc = await documents.findOne({ id: req.params.id })
      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' })
      }
      const category = (doc['category'] as string) ?? 'other'
      // For display: what a person has not rejected, with edits applied. Whether
      // it may be applied is decided by the apply routes.
      const view = await gate(tenant_id, doc, null, { block: false })
      const extractedData = view.ok ? view.fields : {}
      const suggestions = mapExtractedFieldsToProfileSuggestions(category, extractedData)
      const policySuggestion = mapExtractedFieldsToPolicySuggestion(category, extractedData)
      return { suggestions, policySuggestion }
    },
  )

  // ── POST /documents/:id/reprocess ───────────────────────────────────────
  // Re-runs extraction on a stored file — for documents whose first pass
  // produced nothing (e.g. PDFs before they were read as text). Reads the
  // original bytes back from GridFS; nothing is re-uploaded.
  fastify.post<{ Params: { id: string } }>('/documents/:id/reprocess', async (req, reply) => {
    const { tenant_id } = req.authContext
    const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
    const doc = await documents.findOne({ id: req.params.id })
    if (!doc || !locate(doc) || doc['category'] === ESTATE_VAULT_CATEGORY)
      return reply.status(404).send({ error: 'Document not found' })
    if (!READABLE_STATUSES.has(String(doc['status'] ?? 'uploaded')))
      return reply.status(409).send({ error: 'not_ready', status: doc['status'] })

    const bytes = await readDocumentBytes(db, doc)
    if (!bytes) return reply.status(404).send({ error: 'Document not found' })
    await processDocument(
      db,
      req.params.id,
      tenant_id,
      bytes,
      String((doc['storage'] as { mime?: string } | undefined)?.mime ?? doc['mime_type'] ?? ''),
      String(doc['filename'] ?? 'document'),
      taskDecide('document.extract.v1', tenant_id, localDecisionFromEnv('ocr')),
      await taskVision('document.extract.v1', tenant_id),
    )
    const after = await documents.findOne({ id: req.params.id })
    return {
      id: req.params.id,
      category: after?.['category'],
      status: after?.['status'],
      fieldCount: Object.keys((after?.['extracted_data'] as object) ?? {}).length,
    }
  })

  // ── POST /documents/:id/confirm-type ────────────────────────────────────
  // When the document's own words don't firmly support the type the model
  // chose, nothing is applied until the user says what it is (PRD-143 item 1).
  // The choice is recorded with who made it and when.
  fastify.post<{ Params: { id: string }; Body: { category?: string } }>(
    '/documents/:id/confirm-type',
    async (req, reply) => {
      const { tenant_id, user_id } = req.authContext
      const category = req.body?.category
      if (!category || !(CATEGORIES as readonly string[]).includes(category)) {
        return reply.status(400).send({ error: 'Choose one of the document types' })
      }
      const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
      const doc = await documents.findOne({ id: req.params.id })
      if (!doc || doc['category'] === ESTATE_VAULT_CATEGORY) {
        return reply.status(404).send({ error: 'Document not found' })
      }
      await documents.updateOne(
        { id: req.params.id },
        {
          $set: {
            category,
            'classification.category': category,
            'classification.confirmed': true,
            'classification.confirmed_by': user_id,
            'classification.confirmed_at': new Date(),
          },
        },
      )
      auditStep(tenant_id, user_id, 'document.reviewed', req.params.id, { step: 'type_confirmed' })
      return { id: req.params.id, category, confirmed: true }
    },
  )

  // ── POST /documents/:id/review ──────────────────────────────────────────
  // The review step: confirm, edit or reject each extracted field. Only
  // confirmed or edited values are ever used downstream. All or nothing: one
  // invalid decision rejects the batch and changes nothing. Writes no
  // profile data; that is a separate, explicit apply.
  fastify.post<{ Params: { id: string }; Body: { decisions?: ReviewDecision[] } }>(
    '/documents/:id/review',
    async (req, reply) => {
      const { tenant_id, user_id } = req.authContext
      const decisions = req.body?.decisions
      if (!Array.isArray(decisions) || decisions.length === 0 || decisions.length > 50) {
        return reply.status(400).send({ error: 'Send between 1 and 50 decisions' })
      }
      const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
      const doc = await documents.findOne({ id: req.params.id })
      if (!doc || doc['category'] === ESTATE_VAULT_CATEGORY) {
        return reply.status(404).send({ error: 'Document not found' })
      }
      const candidates = await loadCandidates(db, tenant_id, req.params.id)
      if (!candidates)
        return reply
          .status(409)
          .send({ error: 'Nothing has been extracted from this document yet' })
      const result = applyReview(candidates, decisions, user_id)
      if (!result.ok)
        return reply.status(400).send({ error: 'Invalid review', problems: result.errors })
      await saveCandidates(db, result.candidates)
      auditStep(tenant_id, user_id, 'document.reviewed', req.params.id, {
        confirmed: decisions.filter((d) => d.action === 'confirm').length,
        edited: decisions.filter((d) => d.action === 'edit').length,
        rejected: decisions.filter((d) => d.action === 'reject').length,
      })
      return { candidates: result.candidates.fields }
    },
  )

  // ── POST /documents/:id/apply-to-profile ────────────────────────────────
  // Applies one or more of the suggestions above to the tenant's Financial
  // Profile. A scoped $set on an explicit whitelist of dotted paths — never
  // accepts arbitrary paths from the client. Because the apply is itself an
  // explicit user-confirmed submit (not an autosave), it re-runs detector
  // evaluation via regenerateInsights() once the profile has been mutated —
  // see the helper's comment for the complete-profile gate.
  fastify.post<{ Params: { id: string }; Body: { paths?: string[] } }>(
    '/documents/:id/apply-to-profile',
    async (req, reply) => {
      if (
        !(await isHouseholdEditor(
          db,
          req.authContext.tenant_id,
          req.authContext.user_id,
          req.authContext.roles,
        ))
      )
        return reply.status(403).send({ error: 'Only household editors can change shared records' })
      const { tenant_id } = req.authContext
      const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
      const doc = await documents.findOne({ id: req.params.id })
      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' })
      }

      const view = await gate(tenant_id, doc, null, { block: false })
      const suggestions = mapExtractedFieldsToProfileSuggestions(
        (doc['category'] as string) ?? 'other',
        view.ok ? view.fields : {},
      )
      const requestedPaths = new Set(
        (req.body.paths ?? suggestions.map((s) => s.path)).filter(isApplicableProfilePath),
      )
      const toApply = suggestions.filter((s) => requestedPaths.has(s.path))
      if (toApply.length === 0) {
        return reply
          .status(400)
          .send({ error: 'No applicable profile suggestions for this document' })
      }

      // PRD-143: the type must be trusted or confirmed, and no field this write
      // uses may be low-confidence and unreviewed. Checked before anything is written.
      const checked = await gate(
        tenant_id,
        doc,
        toApply.map((s) => s.sourceField),
      )
      if (!checked.ok) return reply.status(checked.status).send(checked.body)

      // Provenance: which document, who confirmed, when, how well grounded. The
      // user chose these suggestions in the apply, so the source fields count as confirmed.
      const confirmedAt = new Date()
      await saveProvenance(
        db,
        tenant_id,
        toApply.map((s) => {
          const f = checked.candidates?.fields.find((x) => x.key === s.sourceField)
          return {
            ref: s.path,
            document_id: req.params.id,
            confirmed_by: req.authContext.user_id,
            confirmed_at: confirmedAt,
            confidence: f && f.status !== 'edited' ? f.confidence : null,
            extractor: extractorLabel(checked.candidates),
            schema_version: checked.candidates?.schema_version ?? 'legacy',
          }
        }),
      )
      const profiles = getTenantCollection<Record<string, unknown>>(
        db,
        'family_financial_profile',
        tenant_id,
      )
      const update: Record<string, unknown> = { updated_at: new Date() }
      for (const s of toApply) update[s.path] = s.valueMinor
      await profiles.updateOne({}, { $set: update }, { upsert: true })

      if (checked.candidates) {
        const used = new Set(toApply.map((s) => s.sourceField))
        await saveCandidates(db, {
          ...checked.candidates,
          updated_at: confirmedAt,
          fields: checked.candidates.fields.map((f) =>
            used.has(f.key) && f.status === 'proposed'
              ? {
                  ...f,
                  status: 'confirmed' as const,
                  decided_by: req.authContext.user_id,
                  decided_at: confirmedAt,
                }
              : f,
          ),
        })
      }
      auditStep(tenant_id, req.authContext.user_id, 'document.committed', req.params.id, {
        paths: toApply.length,
      })

      // The Inbox feed's "policy found" / "review this" recommendation for
      // this document exists to get the user here — once they've actually
      // applied a suggestion, it has done its job and re-showing it every
      // visit is noise (confirmed live: it kept nudging to review a
      // document already applied to the profile).
      await documents.updateOne({ id: req.params.id }, { $set: { feed_dismissed: true } })

      // Insight→action attribution before regenerateInsights — the apply
      // is a response to whatever was already flagged, not to what this
      // re-run is about to create.
      await recordInsightAction(db, tenant_id, 'document_applied').catch(() => {})
      emitDocumentEvent(
        db,
        tenant_id,
        req.params.id,
        String(doc['filename'] ?? 'document'),
        'applied',
      )

      const insightsGenerated = await regenerateInsights(tenant_id)

      log.info(
        {
          documentId: req.params.id,
          tenant_id,
          applied: toApply.map((s) => s.path),
          insights_generated: insightsGenerated,
        },
        'Applied document fields to financial profile',
      )

      return {
        applied: toApply.map((s) => ({ path: s.path, label: s.label, valueMinor: s.valueMinor })),
        insights_generated: insightsGenerated,
      }
    },
  )

  // ── POST /documents/:id/apply-policy ────────────────────────────────────
  // Separate from apply-to-profile above: that endpoint only ever $sets one
  // of 3 whitelisted scalar paths, structurally incapable of appending an
  // array element. This pushes a full policies[] entry — reviewed/editable
  // by the user in the document-detail card, never applied from raw OCR
  // output without a chance to correct it (same "surfaced to confirm, never
  // applied silently" posture as apply-to-profile). And like that endpoint,
  // the user-confirmed apply re-runs detector evaluation in-request via
  // regenerateInsights() — a new policy is exactly the kind of change
  // (renewal windows, cover gaps) the detectors reason about.
  const POLICY_TYPES = new Set<PolicyType>([
    'life',
    'income_protection',
    'health',
    'critical_illness',
    'car',
    'home',
    'travel',
  ])
  interface ApplyPolicyBody {
    type?: string
    provider?: string
    coverageAmountMinor?: number
    monthlyPremiumMinor?: number
    renewalDate?: string
    policyNumber?: string
    contactPhone?: string
    contactEmail?: string
    // PRD-110: optional roster-member attribution — only ever user-picked
    // in the review card, never guessed from the document.
    memberId?: string
  }
  fastify.post<{ Params: { id: string }; Body: ApplyPolicyBody }>(
    '/documents/:id/apply-policy',
    async (req, reply) => {
      if (
        !(await isHouseholdEditor(
          db,
          req.authContext.tenant_id,
          req.authContext.user_id,
          req.authContext.roles,
        ))
      )
        return reply.status(403).send({ error: 'Only household editors can change shared records' })
      const { tenant_id } = req.authContext
      const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
      const doc = await documents.findOne({ id: req.params.id })
      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' })
      }
      // The editable draft is itself the review, so only the type gate applies.
      const checked = await gate(tenant_id, doc, [])
      if (!checked.ok) return reply.status(checked.status).send(checked.body)

      const {
        type,
        provider,
        coverageAmountMinor,
        monthlyPremiumMinor,
        renewalDate,
        policyNumber,
        memberId,
        contactPhone,
        contactEmail,
      } = req.body
      if (!type || !POLICY_TYPES.has(type as PolicyType)) {
        return reply.status(400).send({ error: 'A valid policy type is required' })
      }
      if (!provider || !provider.trim()) {
        return reply.status(400).send({ error: 'A provider name is required' })
      }

      const policy: Record<string, unknown> = {
        type,
        provider: provider.trim(),
        coverage_amount_minor:
          Number.isFinite(coverageAmountMinor) && (coverageAmountMinor as number) >= 0
            ? coverageAmountMinor
            : 0,
        monthly_premium_minor:
          Number.isFinite(monthlyPremiumMinor) && (monthlyPremiumMinor as number) >= 0
            ? monthlyPremiumMinor
            : 0,
      }
      if (renewalDate) policy['renewal_date'] = renewalDate
      if (policyNumber) policy['policy_number'] = policyNumber
      if (contactPhone?.trim()) policy['contact_phone'] = contactPhone.trim()
      if (contactEmail?.trim()) policy['contact_email'] = contactEmail.trim()
      if (typeof memberId === 'string' && memberId.trim()) policy['member_id'] = memberId.trim()

      // Provenance for the policy: the document, the person who submitted the
      // reviewed draft, and the weakest grounding among the fields it was drafted from.
      const grounded = (checked.candidates?.fields ?? []).filter((f) => f.status !== 'rejected')
      await saveProvenance(db, tenant_id, [
        {
          ref: policyRef(type, provider, policyNumber),
          document_id: req.params.id,
          confirmed_by: req.authContext.user_id,
          confirmed_at: new Date(),
          confidence: grounded.length > 0 ? Math.min(...grounded.map((f) => f.confidence)) : null,
          extractor: extractorLabel(checked.candidates),
          schema_version: checked.candidates?.schema_version ?? 'legacy',
        },
      ])
      auditStep(tenant_id, req.authContext.user_id, 'document.committed', req.params.id, {
        policies: 1,
      })

      const profiles = getTenantCollection<Record<string, unknown>>(
        db,
        'family_financial_profile',
        tenant_id,
      )
      await profiles.updateOne(
        {},
        { $push: { policies: policy }, $set: { updated_at: new Date() } },
        { upsert: true },
      )

      // See the matching comment in apply-to-profile above.
      await documents.updateOne({ id: req.params.id }, { $set: { feed_dismissed: true } })

      await recordInsightAction(db, tenant_id, 'policy_added').catch(() => {})

      const insightsGenerated = await regenerateInsights(tenant_id)

      log.info(
        {
          documentId: req.params.id,
          tenant_id,
          policyType: type,
          provider,
          insights_generated: insightsGenerated,
        },
        'Applied document as a financial-profile policy',
      )

      return { applied: policy, insights_generated: insightsGenerated }
    },
  )

  // ── DELETE /documents/:id ───────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/documents/:id', async (req, reply) => {
    const { tenant_id } = req.authContext
    const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
    const doc = await documents.findOne({
      id: req.params.id,
    })

    if (!doc || doc['category'] === ESTATE_VAULT_CATEGORY) {
      return reply.status(404).send({ error: 'Document not found' })
    }

    // PRD-146: the deletion returns a receipt (counts by category, no content).
    const receipt = openReceipt(tenant_id, 'document')
    getAuditLogger()?.fromRequest(req, 'document.deleted', 'document', req.params.id, {
      receipt_id: receipt.id,
    })

    // R2 pipeline rows: fenced delete (§7.7). The receipt stays in progress
    // until the reconciler's second purge, after every presigned URL for the
    // object has expired.
    if (isPipelineRow(doc)) {
      const first = await beginFencedDelete(db, tenant_id, req.params.id, receipt)
      const pending = {
        ...receipt,
        removed: first?.removed ?? [],
        kept: [
          'If you saved details from this document to your profile, they stay there until you change them.',
          'A note of which document a saved value came from stays with that value. It holds no content.',
        ],
      }
      await saveReceipt(db, pending)
      log.info({ documentId: req.params.id, tenant_id }, 'Document deletion started (fenced)')
      return { success: true, receipt: publicReceipt(pending) }
    }

    // Delete file from GridFS
    const fileRemoved = (await deleteGridfs(db, doc['file_id'])) ? 1 : 0
    await releaseReservation(db, tenant_id, req.params.id)

    // Delete metadata: this record also holds what was read from the document
    // (extracted fields and its text), so they go with it.
    await documents.deleteOne({
      id: req.params.id,
    })

    // The extracted candidates (values, snippets, spans) go with the document.
    const candidatesRemoved = (
      await db
        .collection('extraction_candidates')
        .deleteMany({ tenant_id, document_id: req.params.id })
    ).deletedCount
    const hasReadData =
      Object.keys((doc['extracted_data'] as Record<string, unknown> | undefined) ?? {}).length >
        0 ||
      Boolean(doc['raw_text']) ||
      candidatesRemoved > 0
    const residual: { category: string; count: number }[] = [
      {
        category: 'document record',
        count: await db.collection('documents').countDocuments({ tenant_id, id: req.params.id }),
      },
      { category: 'document file', count: (await gridfsExists(db, doc['file_id'])) ? 1 : 0 },
    ]
    const closed = closeReceipt(receipt, {
      removed: [
        { category: 'document file', count: fileRemoved },
        { category: 'document record', count: 1 },
        { category: 'what was read from the document', count: hasReadData ? 1 : 0 },
        { category: 'extracted fields', count: candidatesRemoved },
      ],
      residual,
      kept: [
        'If you saved details from this document to your profile, they stay there until you change them.',
        'A note of which document a saved value came from stays with that value. It holds no content.',
      ],
    })
    await saveReceipt(db, closed)

    log.info({ documentId: req.params.id, tenant_id }, 'Document deleted')

    return { success: true, receipt: publicReceipt(closed) }
  })
}
