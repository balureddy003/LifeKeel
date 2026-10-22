/**
 * Audit Log — structured, immutable event log for compliance.
 *
 * Every security-relevant action is written to the `audit_log` MongoDB collection.
 * Documents are append-only — no updates or deletes are permitted.
 *
 * Indexed for:
 *   - Tenant-scoped queries (SOC 2 / GDPR access requests)
 *   - Time-range exports
 *   - Action-type filtering (e.g. "all approvals in the last 30 days")
 *
 * Actions audited:
 *   insight.approve / insight.dismiss
 *   detector.create / detector.update / detector.delete / detector.rollback
 *   connector.add / connector.remove
 *   settings.update
 *   auth.login / auth.login_failed
 *   webhook.signature_failed
 *   trade.confirm / trade.execute / trade.reject
 */

import type { Db } from 'mongodb'
import type { FastifyRequest } from 'fastify'

export type AuditAction =
  | 'insight.approve'
  | 'insight.retry_execution'
  | 'insight.dismiss'
  | 'insight.prepare'
  | 'assistant.ask'
  | 'assistant.simulate'
  | 'detector.create'
  | 'detector.eval'
  | 'detector.update'
  | 'detector.delete'
  | 'detector.rollback'
  | 'connector.add'
  | 'connector.remove'
  | 'settings.update'
  | 'auth.login'
  | 'auth.login_failed'
  | 'webhook.signature_failed'
  | 'calibration.fit'
  | 'skill.approved'
  | 'skill.rejected'
  | 'trade.confirm'
  | 'trade.execute'
  | 'trade.reject'
  | 'trade.ambiguous_rejection'
  | 'insight.cleanup_stale'
  | 'billing.plan_upgraded'
  | 'billing.plan_downgraded'
  | 'billing.payment_failed'
  | 'billing.payment_succeeded'
  | 'billing.promo_redeemed'
  | 'billing.credits_adjusted'
  | 'billing.credit_reversed'
  | 'billing.credit_pack_purchased'
  | 'account.exported'
  | 'account.deleted'
  | 'document.deleted'
  | 'document.intake'
  | 'document.extracted'
  | 'document.reviewed'
  | 'document.committed'
  | 'mailbox.deleted'
  | 'family.join_requested'
  | 'family.join_approved'
  | 'family.join_denied'
  | 'family.invite_code_reset'
  | 'family.member_invited'
  | 'family.member_removed'
  | 'family.member_invite_accepted'
  | 'family.continuity_updated'
  | 'family.continuity_check_in_sent'
  | 'family.continuity_alert_sent'
  | 'family.rehearsal_completed'
  | 'life_event.nudge_shown'
  | 'life_event.nudge_dismissed'
  | 'life_event.nudge_acted_on'
  | 'referral.attributed'
  | 'referral.rewarded'
  | 'insight.prepare_on_device'
  | 'insight.review_release'
  | 'insight.review_discard'
  | 'insight.auto_execute'
  | 'reminder.sent'
  | 'reminder.cancelled'
  | 'scope_contract.grant'
  | 'scope_contract.collapse'
  | 'scope_contract.suspend'
  | 'marketing.post_approve'
  | 'marketing.post_reject'
  | 'marketing.post_auto_publish'
  | 'marketing.connection_connect'
  | 'marketing.connection_disconnect'
  | 'marketing.post_generate'
  | 'marketing.post_update'
  | 'marketing.plan_generate'
  | 'marketing.plan_approve'
  | 'marketing.plan_skip'
  | 'marketing.profile_edit'
  | 'marketing.profile_apply'
  | 'legacy.document.read'

export interface AuditEntry {
  tenant_id: string
  user_id: string
  action: AuditAction
  resource_type: string
  resource_id: string
  metadata?: Record<string, unknown>
  ip: string
  user_agent: string
  timestamp: Date
}

import { createLogger } from '@lifekeel/platform'
import { sendOpsAlert } from '../operator/ops-alerts.js'

const auditLog = createLogger({ service: 'audit', version: '0.0.0' })

/** Thrown by the critical path when the audit record can't be written. */
export class AuditWriteError extends Error {}

/**
 * A lost audit record is evidence that no longer exists (R33), so it pages
 * someone instead of only reaching stderr. Names and ids only.
 */
function reportLostAudit(entry: AuditEntry, err: unknown): void {
  auditLog.error(
    { action: entry.action, resource_id: entry.resource_id, err: String(err) },
    'Audit log entry lost',
  )
  void sendOpsAlert({
    title: 'Audit log write failed',
    message: `Action ${entry.action} on ${entry.resource_type}/${entry.resource_id} has no audit record.`,
    severity: 'critical',
    fingerprint: `audit-lost:${entry.action}`,
    tenant_id: entry.tenant_id,
  }).catch(() => {})
}

export class AuditLogger {
  private col: any
  private enabled: boolean

  constructor(db: Db, enabled = true) {
    this.enabled = enabled
    this.col = db.collection('audit_log')
    // Indexes for compliance queries
    Promise.all([
      this.col.createIndex({ tenant_id: 1, timestamp: -1 }),
      this.col.createIndex({ tenant_id: 1, action: 1, timestamp: -1 }),
      this.col.createIndex({ tenant_id: 1, resource_id: 1 }),
      // TTL index: auto-delete after 7 years (retention policy)
      this.col.createIndex({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 * 7 }),
    ]).catch((err: unknown) =>
      auditLog.error(
        { err: String(err) },
        'Audit log index creation failed — retention TTL may be missing',
      ),
    )
  }

  /** Write a structured audit event. Fire-and-forget — never blocks the request. */
  log(entry: AuditEntry): void {
    if (!this.enabled) return
    this.col.insertOne(entry).catch((err: unknown) => {
      // Never crashes the request, but never silent either.
      reportLostAudit(entry, err)
    })
  }

  /**
   * Write a structured audit event with retry — for financial actions where
   * dropping the audit record is not acceptable.
   *
   * Unlike `log` (fire-and-forget), this method awaits the insert and retries
   * up to 3 times with exponential backoff (100ms, 200ms, 400ms). If all
   * retries fail, logs to stderr — the caller's underlying record has already
   * been persisted through a separate path, so it survives even if the audit
   * record doesn't.
   */
  async logWithRetry(entry: AuditEntry, maxRetries = 3): Promise<void> {
    if (!this.enabled) return
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.col.insertOne(entry)
        return
      } catch (err) {
        if (attempt === maxRetries) {
          reportLostAudit(entry, err)
          return
        }
        // Exponential backoff: 100ms * 2^(attempt-1)
        await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)))
      }
    }
  }

  /**
   * For operations whose record is part of the operation (R33): account
   * deletion and export, approvals of external effects. Retries, then
   * throws, so the caller stops before doing something it can't account for.
   */
  async logCritical(entry: AuditEntry, maxRetries = 3): Promise<void> {
    if (!this.enabled) return
    let lastErr: unknown
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.col.insertOne(entry)
        return
      } catch (err) {
        lastErr = err
        await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)))
      }
    }
    reportLostAudit(entry, lastErr)
    throw new AuditWriteError(`audit write failed for ${entry.action}`)
  }

  async fromRequestCritical(
    request: FastifyRequest,
    action: AuditAction,
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const auth = request.authContext as { tenant_id: string; user_id: string } | undefined
    await this.logCritical({
      tenant_id: auth?.tenant_id ?? 'unknown',
      user_id: auth?.user_id ?? 'unknown',
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      ...(metadata !== undefined && { metadata }),
      ip: request.ip,
      user_agent: request.headers['user-agent'] ?? '',
      timestamp: new Date(),
    })
  }

  /** Convenience: build entry from a Fastify request + fields. */
  fromRequest(
    request: FastifyRequest,
    action: AuditAction,
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, unknown>,
  ): void {
    const auth = request.authContext as { tenant_id: string; user_id: string } | undefined
    this.log({
      tenant_id: auth?.tenant_id ?? 'unknown',
      user_id: auth?.user_id ?? 'unknown',
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      ...(metadata !== undefined && { metadata }),
      ip: request.ip,
      user_agent: request.headers['user-agent'] ?? '',
      timestamp: new Date(),
    })
  }

  /** Query audit log for a tenant (for Studio audit page). */
  async query(
    tenantId: string,
    opts: { action?: AuditAction; limit?: number; before?: Date },
  ): Promise<AuditEntry[]> {
    const filter: Record<string, unknown> = { tenant_id: tenantId }
    if (opts.action) filter['action'] = opts.action
    if (opts.before) filter['timestamp'] = { $lt: opts.before }

    return this.col
      .find(filter)
      .sort({ timestamp: -1 })
      .limit(opts.limit ?? 100)
      .toArray() as Promise<AuditEntry[]>
  }
}

// Singleton — shared across all route handlers
let _auditLogger: AuditLogger | null = null

export function initAuditLogger(db: Db, enabled: boolean): AuditLogger {
  _auditLogger = new AuditLogger(db, enabled)
  return _auditLogger
}

export function getAuditLogger(): AuditLogger | null {
  return _auditLogger
}
