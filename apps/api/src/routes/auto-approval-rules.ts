/**
 * Auto-Approval Rules Routes — UX-005: Approve Similar
 *
 * POST /auto-approval-rules — create auto-approval rule
 * GET /auto-approval-rules — list rules
 * DELETE /auto-approval-rules/:id — delete rule
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { randomUUID } from 'node:crypto'

export async function registerAutoApprovalRulesRoutes(app: FastifyInstance, db?: Db): Promise<void> {
  /**
   * POST /auto-approval-rules
   * Body: { name: string, scope: { conditions: Record<string, any> } }
   */
  app.post<{
    Body: {
      name: string
      scope: { conditions: Record<string, any> }
    }
  }>('/auto-approval-rules', async (req) => {
    const { tenant_id, user_id } = req.authContext
    const { name, scope } = req.body

    if (!db) {
      return { error: 'Database not connected' }
    }

    try {
      const col = db.collection('auto_approval_rules')
      const rule = {
        id: randomUUID(),
        tenant_id,
        name,
        scope,
        created_at: new Date(),
        created_by: user_id,
        usage_count: 0,
        active: true,
      }

      await col.insertOne(rule)
      return { ok: true, rule }
    } catch (err) {
      return { error: String(err) }
    }
  })

  /**
   * GET /auto-approval-rules
   * Returns list of auto-approval rules for tenant
   */
  app.get('/auto-approval-rules', async (req) => {
    const { tenant_id } = req.authContext

    if (!db) {
      return { rules: [] }
    }

    try {
      const col = db.collection('auto_approval_rules')
      const rules = await col
        .find({ tenant_id, active: true })
        .sort({ created_at: -1 })
        .toArray()

      return { rules }
    } catch {
      return { rules: [] }
    }
  })

  /**
   * DELETE /auto-approval-rules/:id
   * Deletes an auto-approval rule
   */
  app.delete<{ Params: { id: string } }>('/auto-approval-rules/:id', async (req) => {
    const { tenant_id } = req.authContext
    const { id } = req.params

    if (!db) {
      return { error: 'Database not connected' }
    }

    try {
      const col = db.collection('auto_approval_rules')
      const result = await col.findOneAndUpdate(
        { id, tenant_id },
        { $set: { active: false, updated_at: new Date() } },
        { returnDocument: 'after' },
      )

      if (!result) {
        return { error: 'Rule not found' }
      }

      return { ok: true, rule: result }
    } catch (err) {
      return { error: String(err) }
    }
  })
}
