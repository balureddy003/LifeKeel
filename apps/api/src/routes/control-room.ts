/**
 * Control Room API — enterprise-level action oversight
 *
 * GET /control-room/summary — high-level stats for admin dashboard
 * GET /control-room/actions — paginated action receipts with filters
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'

interface ControlRoomSummary {
  pending_approvals: number
  blocked_actions: number
  auto_approved_today: number
  learning_paused: boolean
  cost_30d_usd: number
  safe_action_rate_30d: number | null
  policy_violations: Array<{ rule: string; count: number }>
  model_cost_breakdown: Array<{ model: string; cost: number; tokens: number }>
  causal_impact_30d: { total_value_minor_units: number; converted: number }
}

interface ControlRoomAction {
  id: string
  tenant_id: string
  goal_id?: string
  cycle_id?: string
  plan_step_id?: string
  idempotency_key: string
  capability: string
  provider_id: string
  status: 'accepted' | 'confirmed' | 'failed' | 'unknown'
  requested_at: string
  confirmed_at?: string
  external_id?: string
  external_url?: string
  error_code?: string
  error_message?: string
  // Linked data
  insight_hypothesis?: string
  workflow_name?: string
  workflow_id?: string
}

function requireRole(roles: string[]) {
  return (req: any, reply: any) => {
    const userRole = req.authContext.role || 'user'
    if (!roles.includes(userRole)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
  }
}

export async function registerControlRoomRoutes(app: FastifyInstance, db: Db): Promise<void> {
  if (!db) {
    app.log.warn('Control room routes require database connection')
    return
  }

  /**
   * GET /control-room/summary
   * Returns high-level stats for the enterprise control room dashboard
   */
  app.get('/control-room/summary', async (req, reply) => {
    // RBAC check
    const roleCheck = requireRole(['admin', 'manager'])
    roleCheck(req, reply)
    if (reply.statusCode === 403) return

    const { tenant_id } = req.authContext

    // Get pending approvals (insights with pending workflow approval)
    const pendingApprovals = await db.collection('insights').countDocuments({
      tenant_id,
      state: 'identified',
    })

    // Get blocked actions (receipts with policy_blocked outcome)
    const blockedActions = await db.collection('action_receipts').countDocuments({
      tenant_id,
      outcome: 'policy_blocked',
    })

    // Get auto-approved today
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const autoApprovedToday = await db.collection('action_receipts').countDocuments({
      tenant_id,
      status: 'accepted',
      requested_at: { $gte: todayStart.toISOString() },
    })

    // Check if learning is paused (from tenant settings)
    const tenantSettings = await db.collection('tenant_settings').findOne({ tenant_id })
    const learningPaused = tenantSettings?.['automation']?.['learning_paused'] === true

    // Get cost 30d (from cost ledger)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)
    const costAgg = await db.collection('cost_ledger').aggregate([
      { $match: { tenant_id, timestamp: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total_cost: { $sum: '$cost_usd' } } },
    ]).toArray()
    const cost30dUsd = costAgg[0]?.total_cost ?? 0

    // Get safe action rate 30d
    const receiptSummary = await db.collection('action_receipts').aggregate([
      { $match: { tenant_id, requested_at: { $gte: thirtyDaysAgo.toISOString() } } },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        safe: { $sum: { $cond: [{ $in: ['$status', ['accepted', 'confirmed']] }, 1, 0] } },
      }},
    ]).toArray()
    const safeActionRate30d = receiptSummary[0]?.total > 0
      ? receiptSummary[0].safe / receiptSummary[0].total
      : null

    // Get policy violations by rule
    const policyViolations = await db.collection('action_receipts').aggregate([
      { $match: { tenant_id, outcome: 'policy_blocked' } },
      {
        $group: {
          _id: '$error_code',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]).toArray()

    // Get model cost breakdown
    const modelCostBreakdown = await db.collection('cost_ledger').aggregate([
      { $match: { tenant_id, timestamp: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: '$model',
          cost: { $sum: '$cost_usd' },
          tokens: { $sum: '$tokens' },
        },
      },
      { $sort: { cost: -1 } },
    ]).toArray()

    // Get causal impact estimate from attribution
    const causalImpact = await db.collection('attribution_outcomes').aggregate([
      { $match: { tenant_id, recorded_at: { $gte: thirtyDaysAgo.toISOString() } } },
      {
        $group: {
          _id: null,
          total_value: { $sum: '$value_minor_units' },
          converted: { $sum: { $cond: [{ $eq: ['$outcome', 'converted'] }, 1, 0] } },
        },
      },
    ]).toArray()

    const summary: ControlRoomSummary = {
      pending_approvals: pendingApprovals,
      blocked_actions: blockedActions,
      auto_approved_today: autoApprovedToday,
      learning_paused: learningPaused,
      cost_30d_usd: cost30dUsd,
      safe_action_rate_30d: safeActionRate30d,
      policy_violations: policyViolations.map(v => ({ rule: v._id ?? 'unknown', count: v.count })),
      model_cost_breakdown: modelCostBreakdown.map(m => ({ model: m._id ?? 'unknown', cost: m.cost, tokens: m.tokens })),
      causal_impact_30d: {
        total_value_minor_units: causalImpact[0]?.total_value ?? 0,
        converted: causalImpact[0]?.converted ?? 0,
      },
    }

    return { summary }
  })

  /**
   * GET /control-room/actions
   * Returns paginated list of action receipts with linked insight and workflow info
   */
  app.get<{
    Querystring: {
      status?: 'pending' | 'blocked' | 'executed' | 'dismissed'
      limit?: string
      offset?: string
    }
  }>('/control-room/actions', async (req, reply) => {
    // RBAC check
    const roleCheck = requireRole(['admin', 'manager'])
    roleCheck(req, reply)
    if (reply.statusCode === 403) return

    const { tenant_id } = req.authContext
    const status = req.query.status
    const limit = parseInt(req.query.limit ?? '50', 10)
    const offset = parseInt(req.query.offset ?? '0', 10)

    // Build status filter
    const statusFilter: Record<string, unknown> = { tenant_id }
    if (status === 'pending') {
      statusFilter.status = 'unknown'
    } else if (status === 'blocked') {
      statusFilter.status = 'failed'
      statusFilter.error_code = 'policy_blocked'
    } else if (status === 'executed') {
      statusFilter.status = { $in: ['accepted', 'confirmed'] }
    } else if (status === 'dismissed') {
      statusFilter.status = 'failed'
      statusFilter.error_code = { $ne: 'policy_blocked' }
    }

    // Get action receipts with pagination
    const receipts = await db.collection('action_receipts')
      .find(statusFilter)
      .sort({ requested_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray()

    // Enrich with insight and workflow data
    const enrichedActions: ControlRoomAction[] = await Promise.all(
      receipts.map(async (receipt) => {
        const action: ControlRoomAction = {
          id: receipt.id,
          tenant_id: receipt.tenant_id,
          goal_id: receipt.goal_id,
          cycle_id: receipt.cycle_id,
          plan_step_id: receipt.plan_step_id,
          idempotency_key: receipt.idempotency_key,
          capability: receipt.capability,
          provider_id: receipt.provider_id,
          status: receipt.status,
          requested_at: receipt.requested_at,
          confirmed_at: receipt.confirmed_at,
          external_id: receipt.external_id,
          external_url: receipt.external_url,
          error_code: receipt.error_code,
          error_message: receipt.error_message,
        }

        // Try to link to insight if goal_id exists
        if (receipt.goal_id) {
          const insight = await db.collection('insights').findOne(
            { tenant_id, goal_id: receipt.goal_id },
            { projection: { hypothesis: 1, detector_id: 1 } }
          )
          if (insight) {
            action.insight_hypothesis = insight.hypothesis
          }
        }

        // Try to link to workflow if we have detector_id from insight
        if (action.insight_hypothesis) {
          // This is a simplified approach - in production you'd want a more robust linking
          // For now, we'll skip workflow linking as it requires additional data structures
        }

        return action
      })
    )

    // Get total count for pagination
    const total = await db.collection('action_receipts').countDocuments(statusFilter)

    return {
      actions: enrichedActions,
      total,
      limit,
      offset,
    }
  })
}
