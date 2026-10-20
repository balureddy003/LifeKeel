/**
 * Dual control ("four-eyes") for the highest-blast-radius operator actions —
 * user erasure, credit adjustments, bulk campaign sends, operator privilege
 * grants, whole-tenant suspension.
 *
 * Flow: the gated handler calls checkDualApproval(). With no confirmation_id
 * the request first looks for the requester's own CONFIRMED approval bound
 * to the exact action + target + payload hash — a confirmed retry executes
 * immediately. Otherwise it creates a pending approval (bait-and-switch
 * safe) and the handler returns 202. A *different* operator holding the
 * required permission confirms via POST /operator/dual-approvals/:id/confirm.
 * The requester can also retry explicitly with confirmation_id — the
 * approval is validated and consumed atomically so it can only be spent
 * once.
 */

import { createHash, randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import type { FastifyRequest } from 'fastify'
import type { OperatorAuditAction, OperatorAuditLogger } from './operator-audit.js'
import type { OperatorPermission } from './operator-auth.js'

export const DUAL_CONTROL_TTL_MS = 30 * 60 * 1000

export interface DualApprovalDoc {
  id: string
  action: OperatorAuditAction
  target_type: string
  target_id: string
  /** sha256 of {action, target_id, payload} — the approval is only valid for
   *  exactly what the first operator asked to do. */
  payload_hash: string
  required_permission: OperatorPermission
  reason: string
  requested_by: string
  status: 'pending' | 'confirmed' | 'consumed'
  created_at: Date
  expires_at: Date
  confirmed_by?: string
  confirmed_at?: Date
  consumed_at?: Date
}

/** Canonical serialization for hashing: sorted keys, Date→ISO, ObjectId-like
 *  → hex. Only used for evidence hashes, not signatures. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  const maybeHex = value as { toHexString?: () => string }
  if (typeof maybeHex.toHexString === 'function') return JSON.stringify(maybeHex.toHexString())
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
  return `{${entries.join(',')}}`
}

export function hashState(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

function payloadHash(spec: { action: string; targetId: string; payload: unknown }): string {
  return hashState({ action: spec.action, target_id: spec.targetId, payload: spec.payload })
}

export async function ensureDualControlIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection('operator_dual_approvals').createIndex({ id: 1 }, { unique: true }),
    db.collection('operator_dual_approvals').createIndex({ status: 1, created_at: -1 }),
  ]).catch(() => {})
}

export interface DualApprovalSpec {
  action: OperatorAuditAction
  targetType: string
  targetId: string
  /** The exact fields that determine what will happen — reason, amount,
   *  roles. Hash-bound so approving "add £50 credit" can't be spent on
   *  "add £50,000". */
  payload: unknown
  permission: OperatorPermission
  reason: string
}

export type DualGateResult =
  { kind: 'proceed' } | { kind: 'respond'; status: number; body: Record<string, unknown> }

/**
 * Call inside a gated handler after input validation, before any mutation.
 * Anything other than { kind: 'proceed' } should be sent as the response.
 */
export async function checkDualApproval(
  db: Db,
  audit: OperatorAuditLogger,
  request: FastifyRequest,
  spec: DualApprovalSpec,
): Promise<DualGateResult> {
  const approvals = db.collection<DualApprovalDoc>('operator_dual_approvals')
  const operatorId = request.operatorContext?.user_id ?? ''
  const hash = payloadHash(spec)
  const body = (request.body ?? {}) as Record<string, unknown>
  const confirmationId =
    typeof body['confirmation_id'] === 'string' ? body['confirmation_id'] : null

  if (!confirmationId) {
    // Retry path: the requester's own confirmed approval for this exact
    // action+target+payload is spent automatically — the UI loop stays
    // "click once → second operator confirms → click again".
    const spent = await approvals.updateOne(
      {
        requested_by: operatorId,
        action: spec.action,
        target_id: spec.targetId,
        payload_hash: hash,
        status: 'confirmed',
        expires_at: { $gt: new Date() },
      },
      { $set: { status: 'consumed', consumed_at: new Date() } },
    )
    if (spent.modifiedCount > 0) return { kind: 'proceed' }

    // Idempotent initiation: a retry before confirmation returns the SAME
    // pending approval instead of stacking duplicates.
    const existing = await approvals.findOne(
      {
        requested_by: operatorId,
        action: spec.action,
        target_id: spec.targetId,
        payload_hash: hash,
        status: 'pending',
        expires_at: { $gt: new Date() },
      },
      { sort: { created_at: -1 } },
    )
    if (existing) {
      return {
        kind: 'respond',
        status: 202,
        body: {
          approval_required: true,
          approval_id: existing.id,
          expires_at: existing.expires_at.toISOString(),
          message: "Awaiting a second operator's confirmation.",
        },
      }
    }

    const doc: DualApprovalDoc = {
      id: randomUUID(),
      action: spec.action,
      target_type: spec.targetType,
      target_id: spec.targetId,
      payload_hash: hash,
      required_permission: spec.permission,
      reason: spec.reason,
      requested_by: operatorId,
      status: 'pending',
      created_at: new Date(),
      expires_at: new Date(Date.now() + DUAL_CONTROL_TTL_MS),
    }
    await approvals.insertOne(doc)
    await audit.log(
      request,
      'operator.dual_control.request',
      spec.targetType,
      spec.targetId,
      spec.reason,
      { approval_id: doc.id },
    )
    return {
      kind: 'respond',
      status: 202,
      body: {
        approval_required: true,
        approval_id: doc.id,
        expires_at: doc.expires_at.toISOString(),
        message:
          'A second operator must confirm this action: POST /operator/dual-approvals/' +
          `${doc.id}/confirm, then retry with {"confirmation_id": "${doc.id}"}.`,
      },
    }
  }

  const doc = await approvals.findOne({ id: confirmationId })
  if (!doc) return { kind: 'respond', status: 404, body: { error: 'Approval not found' } }
  if (doc.payload_hash !== hash) {
    return {
      kind: 'respond',
      status: 409,
      body: { error: 'Approval does not match this action, target or payload' },
    }
  }
  if (doc.requested_by !== operatorId) {
    return {
      kind: 'respond',
      status: 403,
      body: { error: 'Only the requesting operator can spend this approval' },
    }
  }
  if (doc.expires_at.getTime() < Date.now()) {
    return { kind: 'respond', status: 409, body: { error: 'Approval expired — request a new one' } }
  }
  if (doc.status === 'consumed') {
    return { kind: 'respond', status: 409, body: { error: 'Approval already consumed' } }
  }
  if (doc.status !== 'confirmed') {
    return {
      kind: 'respond',
      status: 409,
      body: { error: 'Approval is awaiting a second operator' },
    }
  }
  // Consume atomically — a confirmed approval can be spent exactly once.
  const consumed = await approvals.updateOne(
    { id: doc.id, status: 'confirmed' },
    { $set: { status: 'consumed', consumed_at: new Date() } },
  )
  if (consumed.modifiedCount === 0) {
    return { kind: 'respond', status: 409, body: { error: 'Approval already consumed' } }
  }
  return { kind: 'proceed' }
}
