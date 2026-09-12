/**
 * Family Inbox Routes — AI-summarized financial notifications.
 *
 * GET  /inbox           — list inbox items for tenant (from email scanning pipeline)
 * POST /inbox/:id/dismiss — dismiss an inbox item
 *
 * Inbox items are created by the email scanning pipeline (gmail connector
 * → classify → summarize → create inbox item). When no email is connected,
 * the endpoint returns an empty list and the frontend shows mock data.
 *
 * Security: all routes require JWT auth. tenant_id from JWT, never from body.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'family-inbox', version: '0.0.0' })

export interface InboxItemDoc {
  id: string
  tenant_id: string
  source: string
  subject: string
  ai_summary: string
  action_label: string
  action_type: 'review' | 'renew' | 'compare' | 'update' | 'info'
  priority: 'high' | 'medium' | 'low'
  date: string
  read: boolean
  dismissed: boolean
  created_at: Date
  email_message_id?: string
  connector_id?: string
}

export function registerFamilyInboxRoutes(
  fastify: FastifyInstance,
  db: Db,
): void {
  const col = db.collection<InboxItemDoc>('inbox_items')

  // ── GET /inbox ──────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { limit?: string; unread_only?: string } }>(
    '/inbox',
    async (req) => {
      const { tenant_id } = req.authContext
      const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 100)
      const unreadOnly = req.query.unread_only === 'true'

      const filter: Record<string, unknown> = {
        tenant_id,
        dismissed: { $ne: true },
      }
      if (unreadOnly) filter['read'] = false

      const items = await col
        .find(filter)
        .sort({ created_at: -1 })
        .limit(limit)
        .toArray()

      return {
        items: items.map((item) => ({
          id: item.id,
          emoji: '',
          source: item.source,
          subject: item.subject,
          aiSummary: item.ai_summary,
          actionLabel: item.action_label,
          actionType: item.action_type,
          priority: item.priority,
          date: item.date,
          read: item.read,
        })),
      }
    },
  )

  // ── POST /inbox/:id/dismiss ─────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/inbox/:id/dismiss', async (req, reply) => {
    const { tenant_id } = req.authContext

    const result = await col.findOneAndUpdate(
      { id: req.params.id, tenant_id },
      {
        $set: {
          dismissed: true,
          dismissed_at: new Date(),
        },
      },
      { returnDocument: 'after' },
    )

    if (!result) {
      return reply.status(404).send({ error: 'Inbox item not found' })
    }

    log.info({ itemId: req.params.id, tenant_id }, 'Inbox item dismissed')

    return { success: true }
  })

  // ── POST /inbox/:id/read ────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/inbox/:id/read', async (req, reply) => {
    const { tenant_id } = req.authContext

    const result = await col.findOneAndUpdate(
      { id: req.params.id, tenant_id },
      { $set: { read: true, read_at: new Date() } },
      { returnDocument: 'after' },
    )

    if (!result) {
      return reply.status(404).send({ error: 'Inbox item not found' })
    }

    return { success: true }
  })
}
