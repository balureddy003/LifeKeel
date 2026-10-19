/**
 * Growth/funnel event tracking — POST /growth/events
 *
 * First-party, minimal funnel analytics for the public marketing surfaces
 * (the landing page and onboarding), which had zero visibility into
 * conversion before this: no tool anywhere in either app recorded a landing
 * view, a "Get started" click, a completed signup, or an upgrade attempt.
 * This is deliberately not a full analytics vendor — no PII beyond an
 * anonymous, client-generated id, no cross-site tracking, just enough to
 * answer "where do visitors drop off" without a third-party account.
 *
 * Public (unauthenticated) by design — most of what it needs to capture
 * happens before a visitor has signed up. Registered in the open-routes
 * allowlist in server.ts.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { getGrowthEventsCollection } from '../db.js'

// Server-side allowlist, not client-trusted free text — keeps the collection
// from filling up with arbitrary event names from a modified client.
export const KNOWN_EVENTS = new Set([
  'landing_view',
  'landing_get_started_click',
  'landing_signin_click',
  // Sent by the current landing page but previously rejected with a 400.
  'landing_quiz_click',
  // New landing (PRD-209): where the visitor clicked, which sample day they picked, and
  // whether they paused the animation. Meta carries a location or a scenario name only,
  // never a value the visitor typed.
  'landing_cta_click',
  'landing_scenario_select',
  'landing_pause_click',
  // Sent by the upgrade page but previously rejected with a 400.
  'promo_redeem_attempt',
  'promo_redeemed',
  'signup_completed',
  'family_setup_completed',
  'upgrade_page_view',
  'upgrade_checkout_start',
  'readiness_quiz_started',
  'readiness_quiz_completed',
  'readiness_share_click',
  'blog_view',
  'blog_cta_click',
  'guide_view',
])

export async function registerGrowthEventRoutes(app: FastifyInstance, db: Db): Promise<void> {
  /** POST /growth/events — record one funnel event. */
  app.post('/growth/events', async (request, reply) => {
    const body = request.body as {
      event?: string
      path?: string
      anon_id?: string
      meta?: Record<string, unknown>
    }
    const event = typeof body?.event === 'string' ? body.event : ''
    if (!KNOWN_EVENTS.has(event)) {
      return reply.status(400).send({ error: 'Unknown event' })
    }

    const col = getGrowthEventsCollection(db)
    await col.insertOne({
      event,
      path: typeof body.path === 'string' ? body.path.slice(0, 200) : null,
      anon_id: typeof body.anon_id === 'string' ? body.anon_id.slice(0, 100) : null,
      meta: body.meta && typeof body.meta === 'object' ? body.meta : null,
      created_at: new Date(),
    })

    return reply.status(204).send()
  })

  /** GET /growth/summary?days=14 — counts per event, for a quick funnel read. Authenticated
   *  (deliberately a separate path prefix from POST /growth/events — that route is public,
   *  and the auth allowlist matches by prefix, so this can't share its prefix). */
  app.get('/growth/summary', async (request, reply) => {
    const days = Number((request.query as Record<string, string>).days ?? 14)
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const col = getGrowthEventsCollection(db)

    const counts = await col
      .aggregate([
        { $match: { created_at: { $gte: since } } },
        { $group: { _id: '$event', count: { $sum: 1 }, unique_anon: { $addToSet: '$anon_id' } } },
        {
          $project: {
            event: '$_id',
            count: 1,
            unique_anon_count: { $size: '$unique_anon' },
            _id: 0,
          },
        },
        { $sort: { count: -1 } },
      ])
      .toArray()

    return reply.send({ since: since.toISOString(), events: counts })
  })
}
