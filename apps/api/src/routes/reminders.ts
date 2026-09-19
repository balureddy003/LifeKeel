/**
 * /reminders — the transparency surface for Tier 3 automatic actions.
 *
 * A reminder Oak scheduled or sent on the family's behalf must be visible
 * and reversible: GET lists everything (upcoming, sent, cancelled) and
 * POST /:id/cancel lets any signed-in member of the tenant stop a pending
 * one. Cancelling a reminder can't recall a notification that already
 * went out — it only stops pending sends, which is why the filter is
 * status:'scheduled' and the response says so.
 *
 * Registered under the 'insights' authorization resource (server.ts) —
 * GET is read for any signed-in role; POST maps to 'create' (analyst+),
 * same bar as acting on an insight.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { getAuditLogger } from '../audit/audit-log.js'
import type { PolicyReminderDoc } from '../jobs/policy-renewal-reminders.js'

function toResponse(doc: PolicyReminderDoc) {
  return {
    id: doc.id,
    kind: doc.kind,
    status: doc.status,
    policy: doc.policy,
    renewal_date: doc.renewal_date,
    lead_days: doc.lead_days,
    due_at: doc.due_at,
    sent_at: doc.sent_at ?? null,
    cancelled_reason: doc.cancelled_reason ?? null,
  }
}

export function registerReminderRoutes(app: FastifyInstance, db: Db): void {
  const col = db.collection<PolicyReminderDoc>('reminders')

  app.get('/reminders', async (req) => {
    const { tenant_id } = req.authContext
    const docs = await col
      .find({ tenant_id })
      .sort({ due_at: 1 })
      .limit(100)
      .toArray()
    return { reminders: docs.map(toResponse) }
  })

  app.post<{ Params: { id: string } }>('/reminders/:id/cancel', async (req, reply) => {
    const { tenant_id } = req.authContext
    const result = (await col.findOneAndUpdate(
      { id: req.params.id, tenant_id, status: 'scheduled' },
      { $set: { status: 'cancelled', cancelled_reason: 'user_cancelled', updated_at: new Date() } },
      { returnDocument: 'after' },
    )) as PolicyReminderDoc | null
    if (!result) {
      return reply.status(404).send({ error: 'Reminder not found or already sent' })
    }
    getAuditLogger()?.fromRequest(req, 'reminder.cancelled', 'reminder', req.params.id, { reason: 'user_cancelled' })
    return { reminder: toResponse(result) }
  })
}
