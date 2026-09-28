import type { FastifyRequest } from 'fastify'
import type { Db } from 'mongodb'

export type OperatorAuditAction =
  | 'operator.user.suspend'
  | 'operator.user.reactivate'
  | 'operator.user.password_reset'
  | 'operator.tenant.suspend'
  | 'operator.tenant.reactivate'
  | 'operator.operator.create'
  | 'operator.operator.update_roles'
  | 'operator.operator.suspend'
  | 'operator.operator.reactivate'
  | 'operator.marketing.approve'
  | 'operator.marketing.reject'
  | 'operator.marketing.retry'
  | 'operator.configuration.update'
  | 'operator.lead.update_stage'
  | 'operator.lead.add_note'
  | 'operator.lead.suppress'
  | 'operator.promotion.create'
  | 'operator.promotion.deactivate'
  | 'operator.promotion.reactivate'
  | 'operator.blog.create'
  | 'operator.blog.update'
  | 'operator.blog.publish'
  | 'operator.blog.unpublish'
  | 'operator.billing.adjust_credits'
  | 'operator.reminder.retry'
  | 'operator.user.revoke_sessions'
  | 'operator.queue.requeue_dead'
  | 'operator.connector.revoke'
  | 'operator.configuration.update'
  | 'operator.infrastructure.record_cost'
  | 'operator.user.unlock'
  | 'operator.user.export'
  | 'operator.user.erase'
  | 'operator.support.reply'
  | 'operator.support.resolve'
  | 'operator.support.reopen'
  | 'operator.alert.ack'
  | 'operator.alert.snooze'
  | 'operator.alert.resolve'
  | 'operator.alert.reopen'
  | 'operator.autopilot.update'
  | 'autopilot.action'

export interface OperatorAuditEntry {
  operator_user_id: string
  operator_roles: string[]
  /** 'database' | 'bootstrap' — distinguishes audited actions taken through
   *  the env break-glass path from DB-managed operators. */
  operator_source: string
  action: OperatorAuditAction
  target_type: string
  target_id: string
  reason: string
  metadata?: Record<string, unknown>
  request_id: string
  ip: string
  user_agent: string
  created_at: Date
}

export class OperatorAuditLogger {
  constructor(private readonly db: Db) {
    Promise.all([
      db.collection('operator_audit_log').createIndex({ created_at: -1 }),
      db.collection('operator_audit_log').createIndex({ operator_user_id: 1, created_at: -1 }),
      db.collection('operator_audit_log').createIndex({ target_type: 1, target_id: 1, created_at: -1 }),
    ]).catch(() => {})
  }

  async log(
    request: FastifyRequest,
    action: OperatorAuditAction,
    targetType: string,
    targetId: string,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const operator = request.operatorContext
    if (!operator) throw new Error('Operator context missing')
    const entry: OperatorAuditEntry = {
      operator_user_id: operator.user_id,
      operator_roles: operator.roles,
      operator_source: operator.source,
      action,
      target_type: targetType,
      target_id: targetId,
      reason,
      ...(metadata ? { metadata } : {}),
      request_id: request.id,
      ip: request.ip,
      user_agent: request.headers['user-agent'] ?? '',
      created_at: new Date(),
    }
    await this.db.collection<OperatorAuditEntry>('operator_audit_log').insertOne(entry)
  }
}
