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
 *    life-event signals, action receipts, the audit trail, and every other
 *    household record in the erasure catalogue, including derived
 *    inferences. Secrets, device tokens and numeric model weights are left
 *    out (see EXPORT_EXCLUDED).
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
import { DELETABLE_COLLECTIONS, eraseTenantDataReport } from '../erasure.js'
import { isHouseholdEditor } from '../family/family-permissions.js'
import {
  cancelSubscriptionForDeletedTenant,
  markCancellationPending,
} from '../billing/cancel-on-delete.js'
import { Readable } from 'node:stream'
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
  'Your subscription is cancelled. Invoices and payment records are kept for the period tax law requires; they hold no family content.',
]

// The exported user record is an allowlist (R05): anything not named here,
// including password material, MFA secrets and recovery-code hashes, stays out.
const USER_EXPORT_FIELDS = [
  'id',
  'email',
  'name',
  'tenant_id',
  'roles',
  'status',
  'avatar_color',
  'created_at',
  'updated_at',
  'last_seen_at',
  'email_verified',
  'external_provider',
  'mfa_enabled',
  'marketing_consent',
  'attribution',
] as const

function pickUser(user: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(USER_EXPORT_FIELDS.filter((k) => k in user).map((k) => [k, user[k]]))
}

/**
 * Collections in the erasure catalogue that are not exported: key material,
 * credentials and device tokens (secrets, not data about the family), and
 * model state that is numeric weights rather than readable information.
 * Everything else the family product stores about the household is.
 */
const EXPORT_EXCLUDED = new Set<string>([
  'users',
  'tenant_keys',
  'connector_credentials',
  'web_push_subscriptions',
  'mobile_push_tokens',
  'llm_cache',
  'feature_hash_models',
  'feature_hash_model_versions',
  'tenant_level_models',
  'calibration_params',
  'calibration_jobs',
  'calibration_alerts',
  'calibration_ece_history',
  'adaptive_thresholds',
  'adwin_states',
  'cusum_states',
  'exp_smoother_states',
  'change_point_state',
  'novelty_sketches',
  'intent_centroids',
])

/** Bounds memory per collection (R18); the bundle says when a cap was hit. */
const EXPORT_MAX_DOCS_PER_COLLECTION = 10_000

/** Secret-looking fields are removed from every exported record, at any depth. */
const SECRET_FIELD = /(password|secret|token|salt|_hash$|hashes$|api_key|private_key|dek)/i

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('_bsontype' in (value as Record<string, unknown>)) return String(value)
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SECRET_FIELD.test(k))
        .map(([k, v]) => [k, stripSecrets(v)]),
    )
  }
  return value
}

export function registerAccountRoutes(app: FastifyInstance, db: Db): void {
  /**
   * GET /account/export — the tenant's own data as a JSON bundle.
   * Read-only; nothing here mutates.
   *
   * Household editors (the organizer and other non-viewer adults) get the
   * household's records. Anyone else gets their own account and roster
   * entry only: a viewer can read shared pages in the app, but a portable
   * copy of every family member's data is the household's to take (R05).
   * Collections are read one at a time with a cap and streamed out, so a
   * large household can't exhaust API memory (R18).
   */
  app.get('/account/export', async (request, reply) => {
    const { tenant_id, user_id, roles } = request.authContext
    const editor = await isHouseholdEditor(db, tenant_id, user_id, roles)

    try {
      await getAuditLogger()?.fromRequestCritical(
        request,
        'account.exported',
        'account',
        tenant_id,
        {
          scope: editor ? 'household' : 'self',
        },
      )
    } catch {
      return reply
        .status(503)
        .send({ error: 'Export is unavailable right now. Please try again shortly.' })
    }

    const user = await db.collection('users').findOne({ tenant_id, id: user_id })
    const family = await db.collection('family_groups').findOne({ tenant_id })
    const ownMember = (family?.['members'] as Array<Record<string, unknown>> | undefined)?.find(
      (m) => m['id'] === user_id || m['user_id'] === user_id,
    )

    async function* bundle(): AsyncGenerator<string> {
      const field = (key: string, value: unknown, first = false) =>
        `${first ? '' : ','}${JSON.stringify(key)}:${JSON.stringify(stripSecrets(value) ?? null)}`
      yield '{'
      yield field('exported_at', new Date().toISOString(), true)
      yield field('tenant_id', tenant_id)
      yield field('scope', editor ? 'household' : 'self')
      yield field('user', user ? pickUser(user) : null)
      if (!editor) {
        yield field('family_member', ownMember ?? null)
        yield '}'
        return
      }

      const read = async (name: string, filter: Record<string, unknown> = { tenant_id }) => {
        const docs = await db
          .collection(name)
          .find(filter, { limit: EXPORT_MAX_DOCS_PER_COLLECTION })
          .toArray()
        return docs
      }
      const truncated: string[] = []
      const capped = (name: string, docs: unknown[]) => {
        if (docs.length >= EXPORT_MAX_DOCS_PER_COLLECTION) truncated.push(name)
        return docs
      }

      const householdUsers = await read('users')
      yield field(
        'household_users',
        householdUsers.map((u) => pickUser(u)),
      )
      yield field('family_group', family ?? null)
      yield field(
        'financial_profile',
        await db.collection('family_financial_profile').findOne({ tenant_id }),
      )

      // File bytes stay out of the JSON bundle — the documents' own download
      // endpoint serves originals until the account is deleted.
      const documents = await read('documents')
      yield field(
        'documents',
        capped('documents', documents).map((d) => {
          const { file_id: _fileId, ...rest } = d as Record<string, unknown>
          return rest
        }),
      )
      for (const name of [
        'insights',
        'goals',
        'signals',
        'action_receipts',
        'reminders',
        'audit_log',
      ]) {
        yield field(name, capped(name, await read(name)))
      }

      // The rest of the catalogue, including derived inferences about the
      // family (they are personal data even where portability doesn't apply).
      const listed = new Set([
        'family_groups',
        'family_financial_profile',
        'documents',
        'insights',
        'goals',
        'signals',
        'action_receipts',
        'reminders',
      ])
      yield ',"other_records":{'
      let first = true
      for (const name of DELETABLE_COLLECTIONS) {
        if (EXPORT_EXCLUDED.has(name) || listed.has(name)) continue
        const docs = await read(name)
        if (docs.length === 0) continue
        yield field(name, capped(name, docs), first)
        first = false
      }
      yield '}'
      yield field('truncated_collections', truncated)
      yield '}'
    }

    return reply
      .type('application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="lifekeel-export-${tenant_id}.json"`)
      .send(Readable.from(bundle()))
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
    if (typeof confirmation !== 'string' || confirmation.trim().toLowerCase() !== expected) {
      return reply.status(400).send({ error: 'Type your account email to confirm deletion' })
    }

    // Deleting the household erases every member's data, so it is the
    // household editors' decision, not any signed-in member's.
    if (!(await isHouseholdEditor(db, tenant_id, user_id, request.authContext.roles))) {
      return reply.status(403).send({
        error:
          'Only the household organizer can delete the household. Ask them to remove you from the family, which ends your access.',
      })
    }

    const receipt = openReceipt(tenant_id, 'account')

    // Audit the deletion BEFORE wiping — this entry is part of the retained
    // compliance record the header describes.
    // R33: no deletion without its record — if the audit write fails, stop here.
    try {
      await getAuditLogger()?.fromRequestCritical(
        request,
        'account.deleted',
        'account',
        tenant_id,
        {
          receipt_id: receipt.id,
        },
      )
    } catch {
      return reply
        .status(503)
        .send({ error: 'Deletion could not start. Please try again shortly.' })
    }

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

    // Stop billing (R09). The pending flag is durable, so a Stripe failure
    // here is retried by the nightly erasure replay rather than lost.
    await markCancellationPending(db, tenant_id)
    await cancelSubscriptionForDeletedTenant(db, tenant_id).catch((err) =>
      request.log.error({ err, tenant_id }, 'Subscription cancellation deferred to replay'),
    )

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
