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
 *  - Deletion is resumable (PRD-146): the tenant is marked 'deleting' BEFORE the
 *    wipe, so access dies at once and a wipe that fails halfway is retried by
 *    the nightly erasure-replay instead of being forgotten. It finishes as
 *    'deleted' only when a check afterwards finds nothing left, and the
 *    response carries a receipt (counts by category, the check's result, the
 *    backup window and processor statements; never content).
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
import { getAuditLogger } from '../audit/audit-log.js'
import { eraseTenantDataReport } from '../erasure.js'
import {
  closeReceipt,
  openReceipt,
  publicReceipt,
  saveReceipt,
  type DeletionReceipt,
} from '../deletion/receipt.js'

/** What account deletion deliberately leaves, stated on the receipt. */
export const ACCOUNT_DELETION_KEPT = [
  'A record that this deletion happened, with counts and no content, is kept for 7 years: the audit trail and this receipt.',
  'Billing records are kept as the financial record.',
]

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

    const receipt = openReceipt(tenant_id, 'account')

    // Audit the deletion BEFORE wiping — this entry is part of the retained
    // compliance record the header describes.
    getAuditLogger()?.fromRequest(request, 'account.deleted', 'account', tenant_id, {
      receipt_id: receipt.id,
    })

    // Mark the tenant first. The auth middleware admits only 'active'/'trial',
    // so every outstanding JWT 403s from this point, and if the wipe below
    // fails the erasure-replay job still finds the tenant and finishes it.
    await db.collection('tenants').updateOne(
      { tenant_id },
      {
        $set: {
          status: 'deleting',
          deleting_at: new Date(),
          deletion_receipt_id: receipt.id,
          updated_at: new Date(),
        },
      },
    )
    await saveReceipt(db, receipt)

    // The wipe itself lives in erasure.ts so the account route, the daily
    // erasure-replay cron, and post-restore reconciliation run identical code.
    let closed: DeletionReceipt
    try {
      const report = await eraseTenantDataReport(db, tenant_id)
      closed = closeReceipt(receipt, { ...report, kept: ACCOUNT_DELETION_KEPT })
    } catch (err) {
      request.log.error({ err, tenant_id }, 'Account erasure interrupted; replay will resume it')
      const interrupted: DeletionReceipt = {
        ...receipt,
        status: 'partial',
        kept: [
          'The deletion was interrupted. It is retried automatically and your access is already closed.',
          ...ACCOUNT_DELETION_KEPT,
        ],
      }
      await saveReceipt(db, interrupted)
      return reply.status(202).send({
        deleted: false,
        in_progress: true,
        receipt: publicReceipt(interrupted),
      })
    }

    await saveReceipt(db, closed)
    if (!closed.live_data_erased) {
      // Something was still there after the wipe: stay 'deleting' so the replay retries.
      return reply.status(202).send({
        deleted: false,
        in_progress: true,
        receipt: publicReceipt(closed),
      })
    }

    await db
      .collection('tenants')
      .updateOne(
        { tenant_id },
        { $set: { status: 'deleted', deleted_at: new Date(), updated_at: new Date() } },
      )

    return { deleted: true, receipt: publicReceipt(closed) }
  })

  /**
   * GET /account/deletion-receipts — receipts for the document and mailbox
   * deletions this account has made, newest first. (An account's own deletion
   * receipt is returned once, in the delete response, because the account no
   * longer exists to ask.)
   */
  app.get('/account/deletion-receipts', async (request) => {
    const { tenant_id } = request.authContext
    const rows = (await db
      .collection('deletion_receipts')
      .find({ tenant_id, kind: { $in: ['document', 'mailbox'] } })
      .sort({ requested_at: -1 })
      .limit(50)
      .toArray()) as unknown as DeletionReceipt[]
    return { receipts: rows.map(publicReceipt) }
  })
}
