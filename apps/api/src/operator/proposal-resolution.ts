/**
 * Approve / reject an autopilot Tier-2 proposal. One code path shared by the
 * single-item routes and Mission Control's batch endpoint, so the permission
 * check, the atomic claim, the ledger write and the audit row can never drift
 * between "click one" and "click many".
 */
import type { Db } from 'mongodb'
import type { FastifyRequest } from 'fastify'
import type { LlmFn } from '@lifekeel/platform'
import { PROPOSAL_HANDLERS, actionsCol, type AutopilotActionDoc } from './autopilot.js'
import type { OperatorAuditLogger } from './operator-audit.js'
import {
  hasOperatorPermission,
  type OperatorPermission,
  type PlatformRole,
} from './operator-auth.js'

export interface Resolution {
  status: number
  body: Record<string, unknown>
}

export async function approveProposal(
  db: Db,
  audit: OperatorAuditLogger,
  request: FastifyRequest,
  id: string,
  reason: string,
  llmFor: ((tenantId: string) => LlmFn) | undefined,
): Promise<Resolution> {
  const actions = actionsCol(db)
  const action = await actions.findOne({ id })
  if (!action || action.status !== 'proposed' || !action.proposal) {
    return { status: 404, body: { error: 'Proposal not found or already resolved' } }
  }
  const proposal = action.proposal as NonNullable<AutopilotActionDoc['proposal']>
  const roles = (request.operatorContext?.roles ?? []) as PlatformRole[]
  if (!hasOperatorPermission(roles, proposal.required_permission as OperatorPermission)) {
    return {
      status: 403,
      body: { error: `This proposal requires ${proposal.required_permission}` },
    }
  }
  const handler = PROPOSAL_HANDLERS[proposal.kind]
  if (!handler) return { status: 400, body: { error: `Unknown proposal kind: ${proposal.kind}` } }

  // Claim first: proposed → approved is atomic, so two racing approvers can't
  // both execute the underlying mutation. A crash mid-handler leaves
  // 'approved' — visible as stuck, never silently re-run.
  const claim = await actions.updateOne(
    { id: action.id, status: 'proposed' },
    {
      $set: {
        status: 'approved',
        resolved_by: request.operatorContext?.user_id,
        resolved_at: new Date(),
      },
    },
  )
  if (claim.modifiedCount === 0)
    return { status: 409, body: { error: 'Proposal already resolved' } }

  let result: string
  let finalStatus: 'executed' | 'failed' = 'executed'
  try {
    result = await handler(db, proposal.payload, { llmFor })
  } catch (err) {
    finalStatus = 'failed'
    result = String(err).slice(0, 300)
  }
  await actions.updateOne({ id: action.id }, { $set: { status: finalStatus, result } })
  await audit.log(request, 'operator.autopilot.approve', 'autopilot_action', action.id, reason, {
    kind: proposal.kind,
    target: action.target_id,
    status: finalStatus,
    result,
  })
  if (finalStatus === 'failed')
    return { status: 502, body: { error: `Proposal execution failed: ${result}` } }
  return { status: 200, body: { ok: true, result } }
}

export async function rejectProposal(
  db: Db,
  audit: OperatorAuditLogger,
  request: FastifyRequest,
  id: string,
  reason: string,
): Promise<Resolution> {
  const result = await actionsCol(db).updateOne(
    { id, status: 'proposed' },
    {
      $set: {
        status: 'rejected',
        result: reason,
        resolved_by: request.operatorContext?.user_id,
        resolved_at: new Date(),
      },
    },
  )
  if (result.matchedCount === 0)
    return { status: 404, body: { error: 'Proposal not found or already resolved' } }
  await audit.log(request, 'operator.autopilot.reject', 'autopilot_action', id, reason)
  return { status: 200, body: { ok: true } }
}
