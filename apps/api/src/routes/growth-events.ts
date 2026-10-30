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
import { BRIEF_CATALOGUE } from '../briefs/catalogue-entries.js'

// Server-side allowlist, not client-trusted free text — keeps the collection
// from filling up with arbitrary event names from a modified client.
export const KNOWN_EVENTS = new Set([
  // PRD-222 brief funnel (content-free enums; server-side writes only).
  'brief_created',
  'brief_share_link_generated',
  'brief_link_fetched',
  'brief_confirmed_open',
  'brief_door_used',
  'brief_form_step',
  'brief_gate_hit',
  'brief_gate_converted',
  // Engagement on a finished brief (content-free: which feature, never a figure).
  'brief_whatif_used',
  'brief_next_started',
  'brief_update_started',
  // PRD-230 friction budget on the first-value path: counts and timings only.
  // Meta is property-validated below — no figure or free text can ride along.
  'brief_form_started',
  'brief_first_number_shown',
  'landing_view',
  'landing_get_started_click',
  'landing_signin_click',
  // Sent by the current landing page but previously rejected with a 400.
  'landing_quiz_click',
  // New landing (PRD-209): CTA location, sample-day name and pause only, never a typed value.
  'landing_cta_click',
  'landing_scenario_select',
  'landing_pause_click',
  // Sent by the upgrade page but previously rejected with a 400.
  'promo_redeem_attempt',
  'promo_redeemed',
  'signup_completed',
  'family_setup_completed',
  // Setup banner dismissed — a skip is a signal worth counting (no meta sent).
  'family_setup_skipped',
  'upgrade_page_view',
  'upgrade_checkout_start',
  'readiness_quiz_started',
  'readiness_quiz_completed',
  'readiness_share_click',
  // PRD-204: the visitor reopened the answers after seeing the score (no values sent).
  'readiness_quiz_corrected',
  // PRD-141: a click from a Quiet Care digest; meta carries only the variant.
  'digest_click',
  // PRD-139: a click from an alert; counts as a response. The insight id is never
  // stored in this anonymous collection, only in the tenant-keyed value event.
  'alert_click',
  'blog_view',
  'blog_cta_click',
  'guide_view',
  // PRD-210: the signup page was opened; counts as a visit under the link's UTM tags.
  'signup_view',
  // PRD-147: install hint shown, clicked, or completed; meta carries only the platform.
  'pwa_install_shown',
  'pwa_install_clicked',
  'pwa_install_installed',
  // PRD-220: invite/share loop; meta carries only {src: sheet|invite|prompt|settings}.
  'invite_prompt_shown',
  'invite_prompt_clicked',
  'sheet_generated',
  'sheet_shared',
  'referral_link_copied',
])

const SHARE_SRCS = new Set(['sheet', 'invite', 'prompt', 'settings'])

const INSTALL_PLATFORMS = new Set(['prompt', 'ios', 'ios_in_app'])

const DIGEST_VARIANTS = new Set(['all_clear', 'note', 'missed'])

const BRIEF_PROBLEM_IDS = new Set(BRIEF_CATALOGUE.map((e) => e.id))

/** Events whose meta is counts and timings only (PRD-230). */
const FRICTION_EVENTS = new Set(['brief_form_started', 'brief_first_number_shown'])

/** The only properties a friction event may carry — an enum, counts, timings, booleans. */
const FRICTION_META_KEYS = new Set([
  'problem_type',
  'ms_since_form_start',
  'fields_entered',
  'steps_seen',
  'needed_account',
  'needed_connection',
  'needed_upload',
])

/**
 * Reject any friction-event meta that could carry a figure or free text:
 * an unknown property name, a string anywhere but the problem_type enum, a
 * problem_type outside the catalogue, a non-boolean needed_* flag, a
 * non-number count/timing, or a nested value. Rejected outright — never
 * silently stripped — so a client bug surfaces instead of persisting a leak.
 */
function frictionMetaError(meta: unknown): string | null {
  if (meta === undefined || meta === null) return null
  if (typeof meta !== 'object' || Array.isArray(meta)) return 'meta must be an object'
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (!FRICTION_META_KEYS.has(k)) return `Unexpected property: ${k}`
    if (k === 'problem_type') {
      if (typeof v !== 'string' || !BRIEF_PROBLEM_IDS.has(v)) return 'Unknown problem_type'
    } else if (k.startsWith('needed_')) {
      if (typeof v !== 'boolean') return `${k} must be a boolean`
    } else if (typeof v !== 'number' || !Number.isFinite(v)) {
      return `${k} must be a number`
    }
  }
  return null
}

/** digest_click keeps only a known variant; every other event keeps its meta as before. */
function eventMeta(event: string, meta: unknown): Record<string, unknown> | null {
  if (event === 'alert_click') return null
  if (event === 'digest_click') {
    const v = (meta as { v?: unknown } | null)?.v
    return typeof v === 'string' && DIGEST_VARIANTS.has(v) ? { v } : null
  }
  if (event.startsWith('pwa_install_')) {
    const p = (meta as { p?: unknown } | null)?.p
    return typeof p === 'string' && INSTALL_PLATFORMS.has(p) ? { p } : null
  }
  if (
    event === 'invite_prompt_shown' ||
    event === 'invite_prompt_clicked' ||
    event === 'sheet_generated' ||
    event === 'sheet_shared' ||
    event === 'referral_link_copied'
  ) {
    const s = (meta as { src?: unknown } | null)?.src
    return typeof s === 'string' && SHARE_SRCS.has(s) ? { src: s } : null
  }
  return meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : null
}

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
    if (FRICTION_EVENTS.has(event)) {
      const err = frictionMetaError(body.meta)
      if (err) return reply.status(400).send({ error: err })
    }

    const col = getGrowthEventsCollection(db)
    await col.insertOne({
      event,
      path: typeof body.path === 'string' ? body.path.slice(0, 200) : null,
      anon_id: typeof body.anon_id === 'string' ? body.anon_id.slice(0, 100) : null,
      meta: eventMeta(event, body.meta),
      created_at: new Date(),
    })

    // A digest click while signed in is also "received value" for that family
    // (PRD-141). Tenant-keyed, so it is erased with the account.
    const tenantId = (request as { authContext?: { tenant_id?: string } }).authContext?.tenant_id
    const alertId = (body.meta as { i?: unknown } | undefined)?.i
    if (
      event === 'alert_click' &&
      tenantId &&
      typeof alertId === 'string' &&
      alertId.length <= 64
    ) {
      await db
        .collection('value_events')
        .insertOne({ tenant_id: tenantId, kind: 'alert_click', key: alertId, at: new Date() })
        .catch(() => {})
    }
    if (event === 'digest_click' && tenantId) {
      await db
        .collection('value_events')
        .insertOne({ tenant_id: tenantId, kind: 'digest_click', at: new Date() })
        .catch(() => {})
    }

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
