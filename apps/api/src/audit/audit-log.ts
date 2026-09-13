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
  | 'insight.dismiss'
  | 'insight.prepare'
  | 'assistant.ask'
  | 'detector.create'
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

import { createLogger } from '@agentoak/platform'

const auditLog = createLogger({ service: 'audit', version: '0.0.0' })

export class AuditLogger {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    ]).catch(() => {})
  }

  /** Write a structured audit event. Fire-and-forget — never blocks the request. */
  log(entry: AuditEntry): void {
    if (!this.enabled) return
    this.col.insertOne(entry).catch(() => {
      // Audit log write failures must never crash the API — log to stderr only
      auditLog.error({ action: entry.action, resource_id: entry.resource_id }, 'Failed to write audit log entry')
    })
  }

  /**
   * Write a structured audit event with retry — for financial actions where
   * dropping the audit record is not acceptable (gap #27,
   * TRADING_ENGINE_GAPS.md).
   *
   * Unlike `log` (fire-and-forget), this method awaits the insert and retries
   * up to 3 times with exponential backoff (100ms, 200ms, 400ms). If all
   * retries fail, logs to stderr — the caller's trade has already been
   * persisted to pending_trades through a separate path, so the financial
   * record survives even if the audit record doesn't.
   */
  async logWithRetry(entry: AuditEntry, maxRetries = 3): Promise<void> {
    if (!this.enabled) return
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.col.insertOne(entry)
        return
      } catch (err) {
        if (attempt === maxRetries) {
          auditLog.error(
            { action: entry.action, resource_id: entry.resource_id, attempt, err: String(err) },
            'Failed to write audit log entry after all retries',
          )
          return
        }
        // Exponential backoff: 100ms * 2^(attempt-1)
        await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)))
      }
    }
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
      user_id:   auth?.user_id   ?? 'unknown',
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
