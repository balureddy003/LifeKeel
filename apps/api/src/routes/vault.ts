/**
 * Digital Estate Vault — Phase 3 of the Digital Twin gap audit
 * (/Users/balu/.claude/plans/snazzy-skipping-locket.md), the "stripped-
 * down version" of the vault: encrypted storage for sensitive estate
 * documents (wills, power of attorney, similar), gated to adult family
 * members only.
 *
 * Deliberately does NOT include any crisis-release, notification, or
 * "dead man's switch" logic — a fully autonomous release of legal/estate
 * documents without a live human confirmation step is a Tier 3
 * irreversible action under this repo's trust-tier rule (CLAUDE.md) and
 * needs its own dedicated design sign-off before any of that is built.
 * Every route here requires an authenticated adult family member's own
 * explicit request — nothing here ever runs on its own.
 *
 * Storage: same GridFS bucket + 'documents' collection general uploads
 * use (documents.ts) — distinguished by category: 'estate_vault', which
 * documents.ts's own routes explicitly exclude so a vault file is only
 * ever reachable through the routes below. File bytes are encrypted with
 * encryptBuffer/decryptBuffer (packages/platform/src/crypto.ts, the same
 * AES-256-GCM key material already used for social_connections /
 * connector_credentials) before they ever reach GridFS — unlike general
 * documents, which are stored as plain bytes.
 *
 * PRD-134: `?sealed=1` uploads carry a client-side-encrypted envelope
 * (AES-256-GCM under a family passphrase — see apps/web/src/lib/
 * vault-seal.ts) which the server wraps in its own layer on top. The
 * operator cannot read sealed bytes. Download needs no code path change:
 * decryptBuffer unwraps the outer layer and the client unseals the rest.
 *
 * POST   /vault/documents/upload   — adult-only, encrypts before storing
 * GET    /vault/documents          — adult-only, metadata list (no decrypt)
 * GET    /vault/documents/:id/file — adult-only, decrypts and streams back
 * DELETE /vault/documents/:id      — adult-only
 */

import type { FastifyInstance } from 'fastify'
import type { Engine, Insight } from '@agentoak/engine'
import { GridFSBucket, type Db, type ObjectId } from 'mongodb'
import { randomUUID } from 'node:crypto'
import { createLogger, getTenantCollection, encryptBuffer, decryptBuffer } from '@agentoak/platform'
import { isFamilyAdult } from '../lib/family-permissions.js'
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE, ESTATE_VAULT_CATEGORY } from './documents.js'
import { persistSignal } from '../signals.js'
import { resolveStaleInsights } from '../insights-persist.js'

const log = createLogger({ service: 'vault', version: '0.0.0' })

type VaultDocumentRecord = Record<string, unknown> & {
  uploaded_at?: Date
}

// PRD-114: optional document-type tag on upload — what makes the estate
// component of GET /family/readiness computable ("is there a will? a
// PoA?") instead of just "N files exist". Additive: documents uploaded
// before this field have no doc_type and simply don't satisfy an expected
// category. Types are user-declared, never OCR-guessed — the vault does
// no extraction on these files at all.
export const VAULT_DOC_TYPES = ['will', 'power_of_attorney', 'insurance_policy', 'estate_instruction', 'other'] as const
export type VaultDocType = (typeof VAULT_DOC_TYPES)[number]

// PRD-121: the estate detector's rules — resolved on vault mutations when
// the upload/delete no longer reproduces them (e.g. a will lands, or the
// last PoA is removed).
const ESTATE_DETECTOR_ID = 'family_estate_readiness'
const ESTATE_RULE_IDS = ['estate_no_will', 'estate_no_power_of_attorney'] as const

export function registerVaultRoutes(
  fastify: FastifyInstance,
  db: Db,
  engine?: Engine,
  onInsightsGenerated?: (insights: Insight[], tenantId: string) => Promise<void>,
): void {
  // Reuses documents.ts's own bucket name — see this file's module doc for
  // why a second bucket isn't warranted (account.ts's tenant-deletion sweep
  // and email-scan.ts already address this same bucket by name elsewhere).
  const bucket = new GridFSBucket(db, { bucketName: 'documents' })

  // Re-evaluate estate readiness after any vault mutation. Runs inside a
  // vault-only path so the mutation itself never fails on a detector
  // hiccup — the insight is best-effort, the document write is not.
  async function reevaluateEstate(tenantId: string): Promise<void> {
    if (!engine) return
    try {
      const docTypes = new Set(
        (
          (await db
            .collection('documents')
            .find({ tenant_id: tenantId, category: ESTATE_VAULT_CATEGORY }, { projection: { _id: 0, doc_type: 1 } })
            .toArray()) as { doc_type?: string }[]
        )
          .map((d) => d.doc_type)
          .filter((t): t is string => typeof t === 'string'),
      )
      const eventId = randomUUID()
      const data = {
        has_will: Number(docTypes.has('will')),
        has_power_of_attorney: Number(docTypes.has('power_of_attorney')),
        estate_doc_count: docTypes.size,
      }
      const signalId = await persistSignal(
        {
          tenant_id: tenantId,
          signal_type: 'family.estate',
          source: 'manual-entry',
          external_id: eventId,
          data,
        },
        db,
      )
      const result = await engine.evaluate({
        event_type: 'family.estate',
        tenant_id: tenantId,
        event_id: eventId,
        data,
        derived_from_signals: [signalId],
      })
      if (result.insights.length > 0) await onInsightsGenerated?.(result.insights, tenantId)
      // Fresh eval just happened for every rule — anything not reproduced
      // (e.g. the will was just uploaded) resolves now.
      await resolveStaleInsights(db, tenantId, ESTATE_DETECTOR_ID, [...ESTATE_RULE_IDS], result.insights.map((i) => ({ rule_id: i.rule_id, entity_key: i.entity_key ?? '' })))
    } catch (err) {
      log.warn({ err, tenant_id: tenantId }, 'Estate readiness re-evaluation failed — vault mutation already committed')
    }
  }

  async function requireAdult(req: { authContext: { tenant_id: string; user_id: string } }, reply: { status: (code: number) => { send: (body: unknown) => unknown } }): Promise<boolean> {
    const { tenant_id, user_id } = req.authContext
    if (await isFamilyAdult(db, tenant_id, user_id)) return true
    reply.status(403).send({ error: 'The Digital Estate Vault is visible to adult family members only.' })
    return false
  }

  // ── POST /vault/documents/upload ────────────────────────────────────────
  fastify.post<{ Querystring: { doc_type?: string; sealed?: string; mime?: string } }>('/vault/documents/upload', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id } = req.authContext
    const docType = req.query.doc_type
    if (docType !== undefined && !(VAULT_DOC_TYPES as readonly string[]).includes(docType)) {
      return reply.status(400).send({ error: `Invalid doc_type. Allowed: ${VAULT_DOC_TYPES.join(', ')}` })
    }
    // PRD-134: `sealed=1` means the body is already a client-encrypted
    // envelope (application/octet-stream) — the server's allowlist applies
    // to the *declared* original mime (carried in `mime`) since the blob
    // is opaque by design. The envelope is still wrapped in encryptBuffer
    // on top, so sealed docs are double-encrypted at rest.
    const sealed = req.query.sealed === '1'
    const declaredMime = sealed ? (req.query.mime ?? 'application/octet-stream') : undefined
    if (sealed && !ALLOWED_MIME_TYPES.has(declaredMime!)) {
      return reply.status(422).send({ error: `Unsupported sealed document type: ${declaredMime}` })
    }
    const data = await req.file()
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' })
    }
    if (!sealed && !ALLOWED_MIME_TYPES.has(data.mimetype)) {
      return reply.status(422).send({
        error: `Unsupported file type: ${data.mimetype}. Allowed: images (JPEG, PNG, WebP, HEIC) and PDF.`,
      })
    }

    const fileBuffer = await data.toBuffer()
    if (fileBuffer.length > MAX_FILE_SIZE) {
      return reply.status(413).send({ error: 'File too large (max 50 MB)' })
    }

    const documentId = randomUUID()
    const filename = data.filename || `estate-document-${documentId}`
    const mimeType = sealed ? declaredMime! : data.mimetype
    const encrypted = encryptBuffer(fileBuffer)

    log.info({ documentId, filename, mimeType, size: fileBuffer.length, tenant_id, sealed }, 'Uploading estate vault document')

    try {
      const uploadStream = bucket.openUploadStream(filename, {
        metadata: { tenant_id, document_id: documentId, mime_type: mimeType, uploaded_at: new Date(), category: ESTATE_VAULT_CATEGORY, ...(sealed ? { sealed: true } : {}), ...(docType ? { doc_type: docType } : {}) },
      })
      const fileId = uploadStream.id as ObjectId
      await new Promise<void>((resolve, reject) => {
        uploadStream.once('finish', () => resolve())
        uploadStream.once('error', reject)
        uploadStream.end(encrypted)
      })

      const documents = getTenantCollection<VaultDocumentRecord>(db, 'documents', tenant_id)
      try {
        await documents.insertOne({
          id: documentId,
          filename,
          mime_type: mimeType,
          size: fileBuffer.length,
          category: ESTATE_VAULT_CATEGORY,
          status: 'stored',
          uploaded_at: new Date(),
          uploaded_by: req.authContext.user_id,
          file_id: fileId,
          encrypted: true,
          ...(sealed ? { sealed: true } : {}),
          ...(docType ? { doc_type: docType } : {}),
        })
      } catch (metaErr) {
        await bucket.delete(fileId).catch((cleanupErr) =>
          log.error({ cleanupErr, fileId, documentId }, 'Failed to clean up orphaned GridFS blob after metadata insert failure'),
        )
        throw metaErr
      }

      await reevaluateEstate(tenant_id)

      return reply.status(201).send({
        id: documentId,
        filename,
        category: ESTATE_VAULT_CATEGORY,
        uploadedAt: new Date().toISOString(),
        ...(sealed ? { sealed: true } : {}),
        ...(docType ? { docType } : {}),
      })
    } catch (err) {
      log.error({ err, documentId, filename }, 'Failed to store estate vault document')
      return reply.status(500).send({ error: 'Failed to store document' })
    }
  })

  // ── GET /vault/documents ─────────────────────────────────────────────────
  fastify.get('/vault/documents', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id } = req.authContext
    const documents = getTenantCollection<VaultDocumentRecord>(db, 'documents', tenant_id)
    const docs = await documents.find({ category: ESTATE_VAULT_CATEGORY }).sort({ uploaded_at: -1 }).toArray()
    return {
      documents: docs.map((doc: VaultDocumentRecord) => ({
        id: doc['id'],
        filename: doc['filename'],
        mimeType: doc['mime_type'],
        uploadedAt: doc['uploaded_at']?.toISOString() ?? '',
        uploadedBy: doc['uploaded_by'] ?? null,
        docType: doc['doc_type'] ?? null,
        sealed: doc['sealed'] === true,
      })),
    }
  })

  // ── GET /vault/documents/:id/file ────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/vault/documents/:id/file', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id } = req.authContext
    const documents = getTenantCollection<VaultDocumentRecord>(db, 'documents', tenant_id)
    const doc = await documents.findOne({ id: req.params.id, category: ESTATE_VAULT_CATEGORY })
    if (!doc || !doc['file_id']) return reply.status(404).send({ error: 'Document not found' })

    const chunks: Buffer[] = []
    for await (const chunk of bucket.openDownloadStream(doc['file_id'] as ObjectId)) chunks.push(chunk as Buffer)
    const plaintext = decryptBuffer(Buffer.concat(chunks))
    reply.header('Content-Type', String(doc['mime_type'] ?? 'application/octet-stream'))
    reply.header('Content-Disposition', `inline; filename="${String(doc['filename'] ?? 'document').replace(/"/g, '')}"`)
    return reply.send(plaintext)
  })

  // ── DELETE /vault/documents/:id ──────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/vault/documents/:id', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id } = req.authContext
    const documents = getTenantCollection<VaultDocumentRecord>(db, 'documents', tenant_id)
    const doc = await documents.findOne({ id: req.params.id, category: ESTATE_VAULT_CATEGORY })
    if (!doc) return reply.status(404).send({ error: 'Document not found' })

    if (doc['file_id']) {
      await bucket.delete(doc['file_id'] as ObjectId).catch(() => {
        // File may already be deleted — not critical.
      })
    }
    await documents.deleteOne({ id: req.params.id })
    await reevaluateEstate(tenant_id)
    return { ok: true }
  })
}
