/**
 * POST /social/manual-entry — audience-growth vertical's answer to
 * ExternalPositionsPanel: postiz has a connector schema but no live sync
 * implementation yet, so this is how an audience-growth tenant gets real
 * per-post performance into Kairos today.
 *
 * Fires the exact same `social.post.performance` event shape
 * SocialAnalyticsPoller already proves end-to-end (see fetchAndFire() in
 * jobs/social-analytics-poller.ts) — persist-signal -> engine.evaluate()
 * synchronously -> deliver, the platform's established pattern for turning
 * a data write into a live insight.
 */

import crypto from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Engine, Insight } from '@kairos/engine'
import { getDb } from '../db.js'
import { persistSignal } from '../signals.js'

const SocialEntrySchema = z.object({
  platform: z.enum(['twitter', 'linkedin', 'instagram']).default('twitter'),
  post_id: z.string().min(1).optional(),
  impressions: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative().default(0),
  comments: z.number().int().nonnegative().default(0),
  shares: z.number().int().nonnegative().default(0),
})

type SocialEntry = z.infer<typeof SocialEntrySchema>

export async function registerSocialRoutes(
  app: FastifyInstance,
  engine: Engine,
  onInsightsGenerated?: (insights: Insight[], tenantId: string) => Promise<void>,
): Promise<void> {
  app.post<{ Body: SocialEntry }>('/social/manual-entry', async (request, reply) => {
    const parsed = SocialEntrySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid social entry', issues: parsed.error.issues })
    }
    const { tenant_id } = request.authContext
    const entry = parsed.data
    const postId = entry.post_id ?? crypto.randomUUID()
    const engagementRate = entry.impressions > 0
      ? Math.round(((entry.likes + entry.comments + entry.shares) / entry.impressions) * 10000) / 10000
      : 0
    const eventId = crypto.randomUUID()

    const data = {
      post_id: postId,
      platform: entry.platform,
      impressions: entry.impressions,
      likes: entry.likes,
      comments: entry.comments,
      shares: entry.shares,
      engagement_rate: engagementRate,
      posted_at: new Date().toISOString(),
    }

    const signalId = await persistSignal({
      tenant_id,
      signal_type: 'social.post.performance',
      source: 'manual-entry',
      external_id: eventId,
      data,
    })

    const result = await engine.evaluate({
      event_type: 'social.post.performance',
      tenant_id,
      event_id: eventId,
      data,
      derived_from_signals: [signalId],
    })

    if (result.insights.length > 0 && onInsightsGenerated) {
      await onInsightsGenerated(result.insights, tenant_id)
    }

    return reply.send({ ok: true, engagement_rate: engagementRate, insights_generated: result.insights.length })
  })

  app.get('/social/manual-entry', async (request, reply) => {
    const { tenant_id } = request.authContext
    const db = await getDb()
    const docs = await db
      .collection('signals')
      .find({ tenant_id, signal_type: 'social.post.performance', source: 'manual-entry' })
      .sort({ created_at: -1 })
      .limit(200)
      .toArray()
    return reply.send({ posts: docs.map((d) => d['data']) })
  })
}
