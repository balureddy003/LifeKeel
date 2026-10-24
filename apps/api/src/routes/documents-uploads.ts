/**
 * Direct-to-R2 document upload (CLOUDFLARE_INTEGRATION.md §7.4).
 *
 *   POST /documents/uploads         { filename, mime, size, sha256?, category? }
 *        → 201 { document_id, upload: { method: PUT, url, headers, expires_at } }
 *   POST /documents/:id/complete    → 202 { status: 'scan_queued' }
 *
 * The browser PUTs bytes straight into the private quarantine bucket with a
 * 5-minute presigned URL; nothing in quarantine is ever readable. /complete
 * HEADs the object (exists, exact declared size), then does ONE conditional
 * write (awaiting_upload → scan_queued, the durable outbox) and a
 * best-effort Redis wake-up. The scan worker does the rest.
 *
 * Tenants not on the R2 allow-list get 409 direct_upload_unavailable and the
 * web client falls back to the legacy multipart route.
 *
 * Every query takes tenant_id from the JWT, never the body (API1).
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { getAuditLogger } from '../audit/audit-log.js'
import { isHouseholdEditor } from '../family/family-permissions.js'
import { CATEGORIES } from '../extraction/schema.js'
import { checkDeclaredType, MAX_UPLOAD_BYTES, sanitizeFilename } from '../documents/formats.js'
import { objectStore } from '../documents/r2.js'
import { documentStorageMode } from '../documents/storage.js'
import { reserveUpload, releaseReservation } from '../documents/quota.js'
import {
  createAwaitingUpload,
  markScanQueued,
  PRESIGNED_PUT_TTL_S,
  wakeScanWorker,
} from '../documents/pipeline.js'

const InitSchema = z
  .object({
    filename: z.string().min(1).max(512),
    mime: z.string().min(1).max(200),
    size: z.number().int().nonnegative(),
    sha256: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/)
      .optional(),
    category: z.string().max(64).optional(),
    /** On-device special-category screen (see apps/web on-device-doc-screen.ts). */
    client_screen: z.enum(['clear', 'flagged', 'unscreened']).optional(),
  })
  .strip()

async function tenantDeleting(db: Db, tenantId: string): Promise<boolean> {
  const t = await db
    .collection('tenants')
    .findOne({ $or: [{ tenant_id: tenantId }, { id: tenantId }] }, { projection: { status: 1 } })
  return t?.['status'] === 'deleting' || t?.['status'] === 'deleted'
}

export function registerDocumentUploadRoutes(app: FastifyInstance, db: Db): void {
  app.post(
    '/documents/uploads',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { tenant_id, user_id, roles } = req.authContext
      if (!(await isHouseholdEditor(db, tenant_id, user_id, roles)))
        return reply.status(403).send({ error: 'Only household editors can upload documents' })
      if (documentStorageMode(tenant_id) !== 'r2')
        return reply.status(409).send({ error: 'direct_upload_unavailable' })
      if (await tenantDeleting(db, tenant_id))
        return reply.status(409).send({ error: 'tenant_deleting' })

      const parsed = InitSchema.safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: 'invalid_request' })
      const body = parsed.data
      const filename = sanitizeFilename(body.filename)
      const type = checkDeclaredType(filename, body.mime)
      if (!type.ok)
        return reply.status(422).send({
          error: 'unsupported_type',
          message: 'Allowed: PDF, Word (.docx), and images (JPEG, PNG, WebP, GIF, HEIC).',
        })
      if (body.size === 0 || body.size > MAX_UPLOAD_BYTES)
        return reply
          .status(413)
          .send({ error: 'too_large', message: 'Files must be 1 byte to 50 MB.' })
      const category =
        body.category && (CATEGORIES as readonly string[]).includes(body.category)
          ? body.category
          : 'other'

      const refusal = await reserveUpload(db, tenant_id, body.size)
      if (refusal)
        return reply.status(refusal.status).send({ error: refusal.error, message: refusal.message })

      let row: Awaited<ReturnType<typeof createAwaitingUpload>>
      try {
        row = await createAwaitingUpload(db, {
          tenantId: tenant_id,
          userId: user_id,
          filename,
          mime: type.mime,
          kind: type.kind,
          size: body.size,
          sha256: body.sha256?.toLowerCase(),
          category,
          clientScreen: body.client_screen,
        })
      } catch (err) {
        // No row means nothing would ever release this reservation.
        await db
          .collection('tenant_quota')
          .updateOne({ tenant_id }, { $inc: { bytes_reserved: -body.size, inflight: -1 } })
        throw err
      }

      const url = await objectStore('presign').presignPut(
        'quarantine',
        row.quarantine.key,
        type.mime,
        PRESIGNED_PUT_TTL_S,
      )
      getAuditLogger()?.fromRequest(req, 'document.uploaded', 'document', row.id, {
        stage: 'init',
        mime: type.mime,
        size: body.size,
      })
      return reply.status(201).send({
        document_id: row.id,
        upload: {
          method: 'PUT',
          url,
          // The browser sets Content-Length itself; scripts may not.
          headers: { 'Content-Type': type.mime },
          expires_at: new Date(Date.now() + PRESIGNED_PUT_TTL_S * 1000).toISOString(),
        },
      })
    },
  )

  app.post<{ Params: { id: string } }>(
    '/documents/:id/complete',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const docs = db.collection('documents')
      const row = await docs.findOne({ tenant_id, id: req.params.id })
      if (!row || !row['quarantine']) return reply.status(404).send({ error: 'Document not found' })
      // Idempotent: a repeat after the transition reports where the row is.
      if (row['status'] !== 'awaiting_upload')
        return reply.status(202).send({ status: row['status'] })
      if (await tenantDeleting(db, tenant_id))
        return reply.status(409).send({ error: 'tenant_deleting' })

      const key = (row['quarantine'] as { key: string }).key
      const declared = row['declared'] as { size: number }
      const store = objectStore('presign')
      const head = await store.head('quarantine', key)
      if (!head || head.size !== declared.size) {
        const failed = await docs.updateOne(
          { tenant_id, id: req.params.id, status: 'awaiting_upload' },
          { $set: { status: 'failed', error_message: head ? 'size_mismatch' : 'upload_missing' } },
        )
        if (failed.modifiedCount === 1) {
          await releaseReservation(db, tenant_id, req.params.id)
          await store.delete('quarantine', key).catch(() => {})
        }
        return reply.status(409).send({ error: head ? 'size_mismatch' : 'upload_missing' })
      }
      if (!(await markScanQueued(db, tenant_id, req.params.id, head.etag))) {
        const now = await docs.findOne(
          { tenant_id, id: req.params.id },
          { projection: { status: 1 } },
        )
        return reply.status(202).send({ status: now?.['status'] ?? 'unknown' })
      }
      void wakeScanWorker()
      return reply.status(202).send({ status: 'scan_queued' })
    },
  )
}
