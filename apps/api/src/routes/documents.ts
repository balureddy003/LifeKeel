/**
 * Document Routes — upload, list, and retrieve financial documents.
 *
 * POST   /documents/upload    — multipart upload, triggers async OCR extraction
 * GET    /documents           — list documents for tenant
 * GET    /documents/:id       — single document with extracted data
 * DELETE /documents/:id       — delete a document
 *
 * Files are stored in MongoDB (GridFS bucket 'documents') with metadata
 * in the 'documents' collection. Upload and storage are free on every
 * plan; AI field extraction (GPT-4o vision, via processDocument) is
 * gated behind the 'document_ai_extraction' entitlement — free-plan
 * documents are stored with status 'stored' and never billed for OCR.
 *
 * Security: all routes require JWT auth. tenant_id from JWT, never from body.
 */

import { getAuditLogger } from '../audit/audit-log.js'
import { closeReceipt, openReceipt, publicReceipt, saveReceipt } from '../deletion/receipt.js'
import type { FastifyInstance } from 'fastify'
import { GridFSBucket, type Db, type ObjectId } from 'mongodb'
import { randomUUID } from 'node:crypto'
import type { Engine, Insight } from '@lifekeel/engine'
import { createLogger, getTenantCollection } from '@lifekeel/platform'
import { processDocument } from '../ocr/extract.js'
import { scanUpload } from '../extraction/scan.js'
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

// Exported for vault.ts (Digital Estate Vault) — same allowed types/size
// limit apply to an uploaded will/PoA as to any other document.
export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
])

export const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB — matches multipart limit in server.ts

// Estate Vault documents live in this same GridFS bucket + 'documents'
// collection (see vault.ts's module doc for why), encrypted at rest and
// gated to adult family members only — never mix them into the general
// document list/detail/file routes below, which have no such gating.
// Exported so vault.ts uses the exact same literal, not a copy that could drift.
export const ESTATE_VAULT_CATEGORY = 'estate_vault'

export function registerDocumentRoutes(
  fastify: FastifyInstance,
  db: Db,
  engine?: Engine,
  onInsightsGenerated?: (insights: Insight[], tenantId: string) => Promise<void>,
): void {
  const bucket = new GridFSBucket(db, { bucketName: 'documents' })

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

  fastify.post('/documents/upload', async (req, reply) => {
    const { tenant_id } = req.authContext
    const data = await req.file()
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' })
    }

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

    const documentId = randomUUID()
    const filename = data.filename || `document-${documentId}`
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

    try {
      // Store file in GridFS. KEEL-019: previously `.end(fileBuffer)` wasn't
      // awaited at all — the metadata insert below could race ahead of the
      // GridFS write actually completing. Waiting on 'finish' (the
      // documented way to know a GridFS write has fully landed) closes
      // that race.
      const uploadStream = bucket.openUploadStream(filename, {
        metadata: {
          tenant_id,
          document_id: documentId,
          mime_type: mimeType,
          uploaded_at: new Date(),
        },
      })
      const fileId = uploadStream.id as ObjectId
      await new Promise<void>((resolve, reject) => {
        uploadStream.once('finish', () => resolve())
        uploadStream.once('error', reject)
        uploadStream.end(fileBuffer)
      })

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
        })
      } catch (metaErr) {
        // KEEL-019: the GridFS write above already succeeded — without this,
        // a metadata-insert failure orphaned that blob forever (no
        // `documents` row exists to ever look it up by again). Best-effort:
        // if the cleanup delete itself fails, log and still surface the
        // original error rather than masking it.
        await bucket
          .delete(fileId)
          .catch((cleanupErr) =>
            log.error(
              { cleanupErr, fileId, documentId },
              'Failed to clean up orphaned GridFS blob after metadata insert failure',
            ),
          )
        throw metaErr
      }
      emitDocumentEvent(db, tenant_id, documentId, filename, 'uploaded')

      // Upload and storage are free on every plan — AI field extraction
      // (GPT-4o vision, the actual cost driver) is gated to paid plans.
      const tenant = await getTenantCollection<DocumentRecord>(db, 'tenants', tenant_id).findOne()
      const plan = effectivePlan(tenant)
      // A scanner that is configured but did not answer leaves the file unscanned:
      // it is kept, but not sent for extraction.
      const aiExtractionEnabled =
        hasFeature('document_ai_extraction', plan) && scan.result !== 'error'

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
  })

  // ── GET /documents ──────────────────────────────────────────────────────
  fastify.get<{ Querystring: { category?: string; status?: string; limit?: string } }>(
    '/documents',
    async (req) => {
      const { tenant_id } = req.authContext
      const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
      // Estate Vault documents are encrypted and adult-gated (see vault.ts)
      // — never surfaced through the general, ungated document list even
      // if someone explicitly requests that category.
      const filter: Record<string, unknown> = { category: { $ne: ESTATE_VAULT_CATEGORY } }

      if (req.query.category && req.query.category !== ESTATE_VAULT_CATEGORY)
        filter['category'] = req.query.category
      if (req.query.status) filter['status'] = req.query.status

      const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 100)

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

    if (!doc || doc['category'] === ESTATE_VAULT_CATEGORY) {
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

  // ── GET /documents/:id/file ──────────────────────────────────────────────
  // Streams the original uploaded bytes back from GridFS — added for the AI
  // Memory review drawer (show the source PDF/JPEG next to what Keel
  // extracted from it), which had no way to display the document itself
  // before this. Same tenant-scoped lookup and GridFS read `/reprocess`
  // already uses; this just returns the bytes instead of re-running OCR.
  fastify.get<{ Params: { id: string } }>('/documents/:id/file', async (req, reply) => {
    const { tenant_id } = req.authContext
    const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
    const doc = await documents.findOne({ id: req.params.id })
    if (!doc || !doc['file_id'] || doc['category'] === ESTATE_VAULT_CATEGORY)
      return reply.status(404).send({ error: 'Document not found' })

    const chunks: Buffer[] = []
    for await (const chunk of bucket.openDownloadStream(doc['file_id'] as ObjectId))
      chunks.push(chunk as Buffer)
    reply.header('Content-Type', String(doc['mime_type'] ?? 'application/octet-stream'))
    reply.header(
      'Content-Disposition',
      `inline; filename="${String(doc['filename'] ?? 'document').replace(/"/g, '')}"`,
    )
    return reply.send(Buffer.concat(chunks))
  })

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
    if (!doc || !doc['file_id'] || doc['category'] === ESTATE_VAULT_CATEGORY)
      return reply.status(404).send({ error: 'Document not found' })

    const chunks: Buffer[] = []
    for await (const chunk of bucket.openDownloadStream(doc['file_id'] as ObjectId))
      chunks.push(chunk as Buffer)
    await processDocument(
      db,
      req.params.id,
      tenant_id,
      Buffer.concat(chunks),
      String(doc['mime_type'] ?? ''),
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

    // Delete file from GridFS
    let fileRemoved = 0
    try {
      await bucket.delete(doc['file_id'] as ObjectId)
      fileRemoved = 1
    } catch {
      // File may already be deleted — not critical
    }

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
      {
        category: 'document file',
        count: await db
          .collection('documents.files')
          .countDocuments({ _id: doc['file_id'] as ObjectId }),
      },
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
