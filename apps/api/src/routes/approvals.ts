/**
 * Approval Routes — human-approval gates for the workflow engine
 *
 * GET  /approvals?status=pending&limit=50 — pending workflow approval queue
 * GET  /approvals/:id — single approval
 * POST /approvals/:id/respond — approve/reject/custom-action, resumes the workflow run
 * POST /approvals/batch-approve — bulk approve insights (legacy insight-review queue)
 * POST /approvals/batch-dismiss — bulk dismiss insights (legacy insight-review queue)
 * POST /approvals/:id/snooze — snooze an insight for later (legacy insight-review queue)
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import type { WorkflowEngine, WorkflowLoader } from '@kairos/workflows'
import { getInsightsCollection } from '../db.js'

export async function registerApprovalRoutes(
  app: FastifyInstance,
  db?: Db,
  workflowEngine?: WorkflowEngine,
  workflowLoader?: WorkflowLoader,
): Promise<void> {
  /**
   * GET /approvals
   * Query params: status (default: pending), limit (default 50)
   * Returns pending human-approval gates raised by the workflow engine —
   * the AI-drafted review notes waiting on the tenant's approve/reject decision.
   */
  app.get('/approvals', async (request) => {
    const { tenant_id } = request.authContext
    const query = request.query as { status?: string; limit?: string }

    if (!workflowEngine) return { approvals: [], total: 0, actionable_total: 0 }

    const limit = Math.min(parseInt(query.limit ?? '50', 10), 100)
    // Only "pending" is backed by a public engine method today — other statuses
    // (approved/rejected/timed_out history) aren't queried by any current caller.
    if (query.status && query.status !== 'pending') return { approvals: [], total: 0, actionable_total: 0 }

    try {
      const approvals = await workflowEngine.getPendingApprovals(tenant_id)
      const now = Date.now()
      // "Actionable" excludes items whose approval window has already timed
      // out — same rule the Activity → Review page applies to its own badge
      // count, computed once here so every surface agrees on one number.
      const actionableTotal = approvals.filter((a) => new Date(a.timeout_at).getTime() > now).length
      return { approvals: approvals.slice(0, limit), total: approvals.length, actionable_total: actionableTotal }
    } catch {
      return { approvals: [], total: 0, actionable_total: 0 }
    }
  })

  /**
   * POST /approvals/:id/respond
   * Body: { action: string, edits?: Record<string, string> }
   * Resolves a pending human-approval gate and resumes the suspended workflow run.
   */
  app.post<{ Params: { id: string }; Body: { action: string; edits?: Record<string, string> } }>(
    '/approvals/:id/respond',
    async (request, reply) => {
      const { tenant_id } = request.authContext
      const { id } = request.params
      const { action, edits } = request.body

      if (!workflowEngine || !workflowLoader) {
        return reply.status(503).send({ ok: false, error: 'Workflow engine not available' })
      }

      const approval = await workflowEngine.getApproval(id, tenant_id)
      if (!approval) return reply.status(404).send({ ok: false, error: 'Approval not found' })
      if (approval.status !== 'pending') {
        return reply.status(409).send({ ok: false, error: `Approval already ${approval.status}` })
      }

      const def = workflowLoader.get(approval.workflow_id)
      if (!def) return reply.status(404).send({ ok: false, error: `Workflow ${approval.workflow_id} not found` })

      try {
        await workflowEngine.resume(def, approval.workflow_run_id, approval.node_id, action, tenant_id, edits)
        return { ok: true, action, run_id: approval.workflow_run_id }
      } catch (err) {
        return reply.status(500).send({ ok: false, error: String(err) })
      }
    },
  )

  /**
   * POST /approvals/batch-approve
   * Body: { ids: string[], comment?: string }
   */
  app.post<{ Body: { ids: string[]; comment?: string } }>(
    '/approvals/batch-approve',
    async (request) => {
      const { tenant_id, user_id } = request.authContext
      const { ids, comment } = request.body

      if (!db) {
        return { ok: false, error: 'Database not connected' }
      }

      try {
        const col = await getInsightsCollection()
        const result = await col.updateMany(
          {
            id: { $in: ids },
            tenant_id,
            state: { $in: ['identified', 'sent'] },
          },
          {
            $set: {
              state: 'completed',
              approved_at: new Date(),
              approved_by: user_id,
              ...(comment && { approval_note: comment }),
            },
          },
        )

        return {
          ok: true,
          approved_count: result.modifiedCount,
        }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    }
  )

  /**
   * POST /approvals/batch-dismiss
   * Body: { ids: string[], reason?: string }
   */
  app.post<{ Body: { ids: string[]; reason?: string } }>(
    '/approvals/batch-dismiss',
    async (request) => {
      const { tenant_id, user_id } = request.authContext
      const { ids, reason } = request.body

      if (!db) {
        return { ok: false, error: 'Database not connected' }
      }

      try {
        const col = await getInsightsCollection()
        const result = await col.updateMany(
          {
            id: { $in: ids },
            tenant_id,
            state: { $in: ['identified', 'sent'] },
          },
          {
            $set: {
              state: 'dismissed',
              dismissed_at: new Date(),
              dismissed_by: user_id,
              ...(reason && { dismiss_reason: reason }),
            },
          },
        )

        return {
          ok: true,
          dismissed_count: result.modifiedCount,
        }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    }
  )

  /**
   * POST /approvals/:id/snooze
   * Body: { snooze_until?: string }
   */
  app.post<{ Params: { id: string }; Body: { snooze_until?: string } }>(
    '/approvals/:id/snooze',
    async (request) => {
      const { tenant_id, user_id } = request.authContext
      const { id } = request.params
      const { snooze_until } = request.body

      if (!db) {
        return { ok: false, error: 'Database not connected' }
      }

      try {
        const col = await getInsightsCollection()
        const result = await col.findOneAndUpdate(
          { id, tenant_id, state: { $in: ['identified', 'sent'] } },
          {
            $set: {
              state: 'snoozed',
              snoozed_at: new Date(),
              snoozed_by: user_id,
              ...(snooze_until && { snooze_until: new Date(snooze_until) }),
            },
          },
          { returnDocument: 'after' },
        )

        if (!result) {
          return { ok: false, error: 'Insight not found or already actioned' }
        }

        return { ok: true, insight: result }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    }
  )

  /**
   * GET /approvals/:id — get single workflow approval (tenant-scoped)
   */
  app.get<{ Params: { id: string } }>('/approvals/:id', async (request, reply) => {
    const { tenant_id } = request.authContext
    const { id } = request.params

    if (!workflowEngine) return reply.status(503).send({ error: 'Workflow engine not available' })

    try {
      const approval = await workflowEngine.getApproval(id, tenant_id)
      if (!approval) return reply.status(404).send({ error: 'Approval not found' })
      return { approval }
    } catch (err) {
      return reply.status(500).send({ error: String(err) })
    }
  })
}
