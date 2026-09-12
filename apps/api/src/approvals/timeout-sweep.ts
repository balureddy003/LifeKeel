/**
 * Approval timeout sweep.
 *
 * Nothing previously moved an approval's status off 'pending' when its
 * timeout_at passed — the "Expired" label shown on the Review page was
 * purely a client-side clock comparison, completely disconnected from the
 * approval's actual status and from timeout_action (escalate/auto_dismiss/
 * skip/auto_approve), which every human_approval node declares but nothing
 * ever read. A lapsed approval just sat 'pending' forever, its run stuck in
 * 'waiting_approval' forever, contributing to "N pending" counts for
 * decisions nobody could actually act on anymore.
 *
 * This sweep finds every still-pending approval past its timeout, looks up
 * the workflow node that raised it for its configured timeout_action, and
 * resolves it exactly the way a human clicking that action would —
 * WorkflowEngine.resume() already knows how to turn an action string into
 * an __outcome and continue the run (see NodeExecutor's handling of
 * 'auto_approve' for the existing precedent). The one difference from a
 * real human response: resolvedVia: 'timeout' marks the approval record
 * 'timed_out' rather than 'approved', since auto_dismiss/skip/escalate are
 * not actual approvals and showing them as one would misrepresent the audit
 * trail.
 */

import type { Db } from 'mongodb'
import type { WorkflowEngine, WorkflowLoader, ApprovalRequest } from '@kairos/workflows'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'approval-timeout-sweep', version: '0.0.0' })

const VALID_TIMEOUT_ACTIONS = new Set(['escalate', 'auto_approve', 'auto_dismiss', 'reject', 'skip'])

export async function runApprovalTimeoutSweep(
  db: Db,
  workflowEngine: WorkflowEngine,
  workflowLoader: WorkflowLoader,
): Promise<void> {
  const approvalsCol = db.collection<ApprovalRequest>('workflow_approvals')
  const expired = await approvalsCol
    .find({ status: 'pending', timeout_at: { $lt: new Date() } })
    .limit(200) // bounded per sweep tick — a backlog drains over successive runs rather than blocking the cron
    .toArray()

  for (const approval of expired) {
    try {
      const def = workflowLoader.get(approval.workflow_id)
      if (!def) {
        log.warn({ approval_id: approval.id, workflow_id: approval.workflow_id }, 'Workflow definition not found for expired approval, skipping')
        continue
      }
      const node = def.nodes.find(n => n.id === approval.node_id)
      const configuredAction = node?.config?.['timeout_action']
      const timeoutAction = typeof configuredAction === 'string' && VALID_TIMEOUT_ACTIONS.has(configuredAction)
        ? configuredAction
        : 'escalate' // no timeout_action configured — escalate is the conservative default, never silently auto-act

      await workflowEngine.resume(
        def,
        approval.workflow_run_id,
        approval.node_id,
        timeoutAction,
        approval.tenant_id,
        undefined,
        undefined,
        'timeout',
      )
      log.info({ approval_id: approval.id, workflow_id: approval.workflow_id, timeout_action: timeoutAction }, 'Resolved expired approval via timeout_action')
    } catch (err) {
      // One bad approval (e.g. its run already ended some other way) shouldn't
      // stop the sweep from resolving the rest.
      log.error({ approval_id: approval.id, err }, 'Failed to resolve expired approval')
    }
  }
}
