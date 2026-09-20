/**
 * Family Inbox Routes — Oak's recommendations feed (NOT a mail reader).
 *
 * GET  /inbox           — what Oak noticed and what to do next: open family
 *                         insights (protection/retirement/… gaps) plus
 *                         policy details found in the connected mailbox
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
import { createLogger, getTenantCollection } from '@agentoak/platform'

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
  /** Policy facts stated in the email (see email/classify.ts). */
  policy_details?: import('../email/classify.js').EmailPolicyDetails
}

const INSIGHT_PREFIX = 'insight:'

const URGENCY_TO_PRIORITY: Record<string, 'high' | 'medium' | 'low'> = {
  critical: 'high',
  high: 'high',
  medium: 'medium',
  low: 'low',
}

const DETECTOR_ROUTE: Record<string, string> = {
  family_protection_gap: '/health/protection',
  family_retirement_gap: '/health/wealth',
  family_education_shortfall: '/health/goals',
  family_emergency_fund_adequacy: '/health/savings',
}

/** An open insight, shaped as a feed item ("Oak noticed X — here's the next step"). */
function insightToFeedItem(i: Record<string, unknown>) {
  const actions = Array.isArray(i['actions']) ? (i['actions'] as unknown[]).filter((a): a is string => typeof a === 'string') : []
  const created = i['created_at'] instanceof Date ? i['created_at'].toISOString() : String(i['created_at'] ?? '')
  return {
    id: `${INSIGHT_PREFIX}${String(i['id'])}`,
    emoji: '',
    source: 'Oak',
    subject: String(i['hypothesis'] ?? 'Oak noticed something'),
    aiSummary: String(i['reasoning'] ?? '').slice(0, 400),
    actionLabel: (actions[0] ?? 'Review').slice(0, 80),
    actionType: 'review' as const,
    priority: URGENCY_TO_PRIORITY[String(i['urgency'])] ?? 'medium',
    date: created,
    read: false,
    route: DETECTOR_ROUTE[String(i['detector_id'])] ?? '/health/protection',
  }
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

      // Only emails that carried policy details are recommendations —
      // transaction alerts and receipts (and anything scanned before the
      // classifier was narrowed) are not surfaced. They are hidden, not
      // deleted.
      const filter: Record<string, unknown> = {
        tenant_id,
        dismissed: { $ne: true },
        policy_details: { $exists: true },
      }
      if (unreadOnly) filter['read'] = false

      const items = await col
        .find(filter)
        .sort({ created_at: -1 })
        .limit(limit)
        .toArray()

      const insightDocs = unreadOnly
        ? []
        : await getTenantCollection<Record<string, unknown>>(db, 'insights', tenant_id)
            .find({ detector_id: { $regex: '^family_' }, state: { $in: ['identified', 'sent'] } })
            .sort({ created_at: -1 })
            .limit(limit)
            .toArray()

      const fromInsights = insightDocs.map((i: Record<string, unknown>) => insightToFeedItem(i))
      const fromEmail = {
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
          ...(item.policy_details ? { policy: item.policy_details } : {}),
        })),
      }
      const merged = [...fromInsights, ...fromEmail.items].sort((a, b) => (a.date < b.date ? 1 : -1))
      return { items: merged.slice(0, limit) }
    },
  )

  // ── POST /inbox/:id/dismiss ─────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/inbox/:id/dismiss', async (req, reply) => {
    const { tenant_id } = req.authContext

    if (req.params.id.startsWith(INSIGHT_PREFIX)) {
      const res = await getTenantCollection<Record<string, unknown>>(db, 'insights', tenant_id).updateOne(
        { id: req.params.id.slice(INSIGHT_PREFIX.length) },
        { $set: { state: 'dismissed', dismissed_at: new Date() } },
      )
      if (!(res as { matchedCount?: number }).matchedCount) return reply.status(404).send({ error: 'Inbox item not found' })
      return { success: true }
    }

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

    // Insight-backed items have no read state of their own.
    if (req.params.id.startsWith(INSIGHT_PREFIX)) return { success: true }

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
