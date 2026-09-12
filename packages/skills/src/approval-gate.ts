/**
 * Approval Gate
 *
 * Durable approval queue for skill decisions that require human sign-off.
 *
 * Key pattern: write to DB first (durable), then in-memory (fast lookup).
 * On startup, rehydrate from DB — survives serverless scale-to-zero restarts.
 */

import type { SkillDecision } from './schemas.js'

export interface PendingApproval {
  trace_id: string
  skill_id: string
  tenant_id: string
  decision: SkillDecision
  status: 'pending' | 'approved' | 'rejected'
  created_at: Date
  expires_at: Date
  resolved_at?: Date
}

export interface ApprovalStore {
  save(approval: PendingApproval): Promise<void>
  findPending(tenantId: string): Promise<PendingApproval[]>
  update(traceId: string, status: 'approved' | 'rejected', resolvedAt: Date): Promise<void>
}

export class ApprovalGate {
  private pending = new Map<string, PendingApproval>()
  private ttlMs: number

  constructor(
    private readonly store?: ApprovalStore,
    ttlMs = 24 * 60 * 60 * 1000, // 24h default
  ) {
    this.ttlMs = ttlMs
  }

  /** Rehydrate unexpired pending approvals from DB on startup */
  async rehydrate(tenantId: string): Promise<void> {
    if (!this.store) return
    const items = await this.store.findPending(tenantId)
    const now = Date.now()
    for (const item of items) {
      if (item.expires_at.getTime() > now) {
        this.pending.set(item.trace_id, item)
      }
    }
  }

  /** Queue a decision for approval — writes DB first for durability */
  async queue(decision: SkillDecision): Promise<void> {
    const approval: PendingApproval = {
      trace_id: decision.trace_id,
      skill_id: decision.skill_id,
      tenant_id: decision.tenant_id,
      decision,
      status: 'pending',
      created_at: new Date(),
      expires_at: new Date(Date.now() + this.ttlMs),
    }

    if (this.store) await this.store.save(approval)
    this.pending.set(decision.trace_id, approval)
  }

  /** Get all pending approvals for a tenant */
  getPending(tenantId: string): PendingApproval[] {
    if (!tenantId) throw new Error('tenantId is required — prevents cross-tenant leakage')
    return [...this.pending.values()].filter(
      (a) => a.tenant_id === tenantId && a.status === 'pending',
    )
  }

  /** Approve or reject a pending decision */
  async resolve(
    traceId: string,
    tenantId: string,
    status: 'approved' | 'rejected',
  ): Promise<SkillDecision | null> {
    const approval = this.pending.get(traceId)
    if (!approval) return null
    if (approval.tenant_id !== tenantId) {
      throw new Error('Cannot resolve approval for a different tenant')
    }

    const resolvedAt = new Date()
    approval.status = status
    approval.resolved_at = resolvedAt

    if (this.store) await this.store.update(traceId, status, resolvedAt)
    this.pending.delete(traceId)

    return status === 'approved' ? approval.decision : null
  }
}
