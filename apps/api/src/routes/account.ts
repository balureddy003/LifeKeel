/**
 * /account — self-service data export and account deletion (remediation
 * item 26). The privacy policy previously admitted in fine print that no
 * in-app delete existed — deletion was an email-and-wait request. These are
 * the endpoints that make both rights real.
 *
 * Design decisions (the "scoped design" the remediation plan called for):
 *
 *  - Export is a single JSON bundle of the tenant's own data — everything
 *    the family product writes that is about the family: profile, roster,
 *    documents metadata (not file bytes — originals are downloadable
 *    individually via /documents/:id/file until deletion), insights, goals,
 *    life-event signals, action receipts, and the audit trail. Internal
 *    derived state (ML scorer weights, credit ledgers, webhook logs) is not
 *    user data and is not included.
 *
 *  - Delete is immediate, not request-and-fulfill. The confirmation is the
 *    user's own account email, typed — a stronger check than a checkbox
 *    since it's the one value a confused or coerced click is least likely
 *    to reproduce.
 *
 *  - "Delete" means: every collection that holds tenant-tagged family data
 *    is removed, including GridFS document blobs; the `users` rows go with
 *    it; the `tenants` row is kept but marked status:'deleted' — the auth
 *    middleware only admits 'active'/'trial' tenants, so outstanding JWTs
 *    die functionally on the next request even though they're stateless
 *    and can't be revoked server-side.
 *
 *  - audit_log is deliberately RETAINED, not deleted: it has a documented
 *    7-year TTL as the compliance record of what happened (who approved
 *    what, when this deletion ran). Billing ledger/webhook rows survive on
 *    the same basis — they're the financial record, not personal content.
 *    The privacy page states this retention explicitly.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { GridFSBucket } from 'mongodb'
import { getAuditLogger } from '../audit/audit-log.js'

// Collections holding tenant-tagged family data, wiped on delete. Anything
// tenant-scoped the family product writes must be in this list — internal
// ML/billing/platform collections are intentionally not (see header).
// Exported so the architecture-claims fitness test can keep this list in
// sync with the tenant-scoped collection catalogue.
export const DELETABLE_COLLECTIONS = [
  'users',
  'family_groups',
  'family_financial_profile',
  'documents',
  'signals',
  'insights',
  'goals',
  'goal_kpi_snapshots',
  'inbox_items',
  'tenant_settings',
  'connector_credentials',
  'action_receipts',
  'agent_memory',
  'verified_moments',
  'outcome_events',
  'delivery_preferences',
  'delivery_queue',
  'delivery_receipts',
  'digest_queue',
  'move_rewrite_queue',
  'manual_review_queue',
  'move_judge_verdicts',
  'reminders',
  'web_push_subscriptions',
  'mobile_push_tokens',
] as const

// Fields stripped from the exported user record — auth material, not data
// about the family.
const USER_EXPORT_OMIT = new Set([
  'password_hash',
  'salt',
  'password_reset_token',
  'password_reset_expires',
  'email_verification_token',
  'email_verification_expires',
  'failed_login_attempts',
  'locked_until',
])

export function registerAccountRoutes(app: FastifyInstance, db: Db): void {
  /**
   * GET /account/export — the tenant's own data as a JSON bundle.
   * Read-only; nothing here mutates.
   */
  app.get('/account/export', async (request, reply) => {
    const { tenant_id, user_id } = request.authContext

    const [user, family, profile, documents, insights, goals, signals, receipts, audit, reminders] =
      await Promise.all([
        db.collection('users').findOne({ tenant_id, id: user_id }),
        db.collection('family_groups').findOne({ tenant_id }),
        db.collection('family_financial_profile').findOne({ tenant_id }),
        db.collection('documents').find({ tenant_id }).toArray(),
        db.collection('insights').find({ tenant_id }).toArray(),
        db.collection('goals').find({ tenant_id }).toArray(),
        db.collection('signals').find({ tenant_id }).toArray(),
        db.collection('action_receipts').find({ tenant_id }).toArray(),
        db.collection('audit_log').find({ tenant_id }).toArray(),
        db.collection('reminders').find({ tenant_id }).toArray(),
      ])

    getAuditLogger()?.fromRequest(request, 'account.exported', 'account', tenant_id, {})

    const sanitizedUser = user
      ? Object.fromEntries(Object.entries(user).filter(([k]) => !USER_EXPORT_OMIT.has(k)))
      : null

    // File bytes stay out of the JSON bundle — the documents' own download
    // endpoint serves originals until the account is deleted.
    const documentMeta = documents.map((d) => {
      const { file_id: _fileId, ...rest } = d as Record<string, unknown>
      return rest
    })

    return reply
      .header('Content-Disposition', `attachment; filename="lifekeel-export-${tenant_id}.json"`)
      .send({
        exported_at: new Date().toISOString(),
        tenant_id,
        user: sanitizedUser,
        family_group: family ?? null,
        financial_profile: profile ?? null,
        documents: documentMeta,
        insights,
        goals,
        signals,
        action_receipts: receipts,
        reminders,
        audit_log: audit,
      })
  })

  /**
   * POST /account/delete — immediate, irreversible deletion of the tenant's
   * family data. Body: { confirmation } must equal the account email.
   */
  app.post<{ Body: { confirmation?: string } }>('/account/delete', async (request, reply) => {
    const { tenant_id, user_id } = request.authContext
    const { confirmation } = request.body ?? {}

    const user = await db.collection('users').findOne({ tenant_id, id: user_id })
    if (!user) return reply.status(404).send({ error: 'User not found' })

    const expected = String(user['email'] ?? '').toLowerCase()
    if (!confirmation || confirmation.trim().toLowerCase() !== expected) {
      return reply.status(400).send({ error: 'Type your account email to confirm deletion' })
    }

    // Audit the deletion BEFORE wiping — this entry is part of the retained
    // compliance record the header describes.
    getAuditLogger()?.fromRequest(request, 'account.deleted', 'account', tenant_id, {})

    // GridFS document blobs are keyed by metadata.tenant_id — delete them
    // before the metadata rows below so a partial failure leaves orphaned
    // metadata (harmless: unreferenced) rather than orphaned blobs with no
    // way to identify whose they were.
    const files = await db
      .collection('documents.files')
      .find({ 'metadata.tenant_id': tenant_id })
      .project({ _id: 1 })
      .toArray()
    const bucket = new GridFSBucket(db, { bucketName: 'documents' })
    for (const f of files) {
      try {
        await bucket.delete(f._id)
      } catch {
        /* blob may already be gone */
      }
    }

    for (const name of DELETABLE_COLLECTIONS) {
      await db.collection(name).deleteMany({ tenant_id })
    }

    // Keep the tenants row but make it dead: the auth middleware admits only
    // 'active'/'trial' tenants, so every outstanding JWT 403s from here on.
    await db
      .collection('tenants')
      .updateOne(
        { tenant_id },
        { $set: { status: 'deleted', deleted_at: new Date(), updated_at: new Date() } },
      )

    return { deleted: true }
  })
}
