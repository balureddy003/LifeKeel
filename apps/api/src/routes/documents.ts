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

import type { FastifyInstance } from 'fastify'
import { GridFSBucket, type Db, type ObjectId } from 'mongodb'
import { randomUUID } from 'node:crypto'
import { createLogger, getTenantCollection } from '@agentoak/platform'
import { processDocument } from '../ocr/extract.js'
import { mapExtractedFieldsToProfileSuggestions, isApplicableProfilePath } from '../ocr/profile-mapping.js'
import { hasFeature, type Plan } from '../entitlements.js'

const log = createLogger({ service: 'documents', version: '0.0.0' })

type DocumentRecord = Record<string, unknown> & {
  uploaded_at?: Date
  processing_started_at?: Date
  processing_completed_at?: Date
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
])

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB — matches multipart limit in server.ts

export function registerDocumentRoutes(
  fastify: FastifyInstance,
  db: Db,
): void {
  const bucket = new GridFSBucket(db, { bucketName: 'documents' })

  // ── POST /documents/upload ──────────────────────────────────────────────
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

    if (fileBuffer.length > MAX_FILE_SIZE) {
      return reply.status(413).send({ error: 'File too large (max 50 MB)' })
    }

    const documentId = randomUUID()
    const filename = data.filename || `document-${documentId}`
    const mimeType = data.mimetype

    log.info({ documentId, filename, mimeType, size: fileBuffer.length, tenant_id }, 'Uploading document')

    try {
      // Store file in GridFS. OAK-019: previously `.end(fileBuffer)` wasn't
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
        })
      } catch (metaErr) {
        // OAK-019: the GridFS write above already succeeded — without this,
        // a metadata-insert failure orphaned that blob forever (no
        // `documents` row exists to ever look it up by again). Best-effort:
        // if the cleanup delete itself fails, log and still surface the
        // original error rather than masking it.
        await bucket.delete(fileId).catch((cleanupErr) =>
          log.error({ cleanupErr, fileId, documentId }, 'Failed to clean up orphaned GridFS blob after metadata insert failure'),
        )
        throw metaErr
      }

      // Upload and storage are free on every plan — AI field extraction
      // (GPT-4o vision, the actual cost driver) is gated to paid plans.
      const tenant = await getTenantCollection<DocumentRecord>(db, 'tenants', tenant_id).findOne()
      const plan = (tenant?.['plan'] ?? 'free') as Plan
      const aiExtractionEnabled = hasFeature('document_ai_extraction', plan)

      if (aiExtractionEnabled) {
        log.info({ documentId, filename, tenant_id }, 'Document stored, starting OCR processing')
        // Trigger async OCR processing (non-blocking — errors handled in processDocument)
        processDocument(db, documentId, tenant_id, fileBuffer, mimeType, filename).catch((err) => {
          log.error({ err, documentId }, 'OCR processing threw unhandled error')
        })
      } else {
        log.info({ documentId, filename, tenant_id, plan }, 'Document stored — AI extraction requires a paid plan')
        await documents.updateOne(
          { id: documentId },
          { $set: { status: 'stored' } },
        )
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
      log.error({ err, documentId, filename }, 'Failed to store document')
      return reply.status(500).send({ error: 'Failed to store document' })
    }
  })

  // ── GET /documents ──────────────────────────────────────────────────────
  fastify.get<{ Querystring: { category?: string; status?: string; limit?: string } }>(
    '/documents',
    async (req) => {
      const { tenant_id } = req.authContext
      const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
      const filter: Record<string, unknown> = {}

      if (req.query.category) filter['category'] = req.query.category
      if (req.query.status) filter['status'] = req.query.status

      const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 100)

      const docs = await documents
        .find(filter)
        .sort({ uploaded_at: -1 })
        .limit(limit)
        .toArray()

      const tenant = await getTenantCollection<DocumentRecord>(db, 'tenants', tenant_id).findOne()
      const plan = (tenant?.['plan'] ?? 'free') as Plan
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

    if (!doc) {
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
      rawText: doc['raw_text'] ?? '',
      processingStartedAt: doc['processing_started_at']?.toISOString() ?? null,
      processingCompletedAt: doc['processing_completed_at']?.toISOString() ?? null,
      errorMessage: doc['error_message'] ?? null,
    }
  })

  // ── GET /documents/:id/profile-suggestions ──────────────────────────────
  // extractDocumentFields() pulls structured fields out of a document, but
  // nothing ever surfaced them back to the Financial Profile — the user had
  // to retype numbers already sitting on a document they just uploaded.
  fastify.get<{ Params: { id: string } }>('/documents/:id/profile-suggestions', async (req, reply) => {
    const { tenant_id } = req.authContext
    const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
    const doc = await documents.findOne({ id: req.params.id })
    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' })
    }
    const suggestions = mapExtractedFieldsToProfileSuggestions(
      (doc['category'] as string) ?? 'other',
      (doc['extracted_data'] as Record<string, string>) ?? {},
    )
    return { suggestions }
  })

  // ── POST /documents/:id/apply-to-profile ────────────────────────────────
  // Applies one or more of the suggestions above to the tenant's Financial
  // Profile. A scoped $set on an explicit whitelist of dotted paths — never
  // accepts arbitrary paths from the client — and never triggers detector
  // evaluation itself; that stays an explicit action on the Financial
  // Profile page (Save & Generate Insights), consistent with the wizard's
  // existing autosave-doesn't-generate-insights design.
  fastify.post<{ Params: { id: string }; Body: { paths?: string[] } }>(
    '/documents/:id/apply-to-profile',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
      const doc = await documents.findOne({ id: req.params.id })
      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' })
      }

      const suggestions = mapExtractedFieldsToProfileSuggestions(
        (doc['category'] as string) ?? 'other',
        (doc['extracted_data'] as Record<string, string>) ?? {},
      )
      const requestedPaths = new Set((req.body.paths ?? suggestions.map((s) => s.path)).filter(isApplicableProfilePath))
      const toApply = suggestions.filter((s) => requestedPaths.has(s.path))
      if (toApply.length === 0) {
        return reply.status(400).send({ error: 'No applicable profile suggestions for this document' })
      }

      const profiles = getTenantCollection<Record<string, unknown>>(db, 'family_financial_profile', tenant_id)
      const update: Record<string, unknown> = { updated_at: new Date() }
      for (const s of toApply) update[s.path] = s.valueMinor
      await profiles.updateOne({}, { $set: update }, { upsert: true })

      log.info(
        { documentId: req.params.id, tenant_id, applied: toApply.map((s) => s.path) },
        'Applied document fields to financial profile',
      )

      return { applied: toApply.map((s) => ({ path: s.path, label: s.label, valueMinor: s.valueMinor })) }
    },
  )

  // ── DELETE /documents/:id ───────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/documents/:id', async (req, reply) => {
    const { tenant_id } = req.authContext
    const documents = getTenantCollection<DocumentRecord>(db, 'documents', tenant_id)
    const doc = await documents.findOne({
      id: req.params.id,
    })

    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' })
    }

    // Delete file from GridFS
    try {
      await bucket.delete(doc['file_id'] as ObjectId)
    } catch {
      // File may already be deleted — not critical
    }

    // Delete metadata
    await documents.deleteOne({
      id: req.params.id,
    })

    log.info({ documentId: req.params.id, tenant_id }, 'Document deleted')

    return { success: true }
  })
}
