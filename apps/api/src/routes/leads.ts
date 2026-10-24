/**
 * POST /leads — public, unauthenticated lead capture.
 *
 * The readiness quiz itself stays anonymous by design (nothing the visitor
 * answers is persisted against an identifier). This endpoint is the
 * *optional, explicit* opt-in that may follow it: the visitor types their
 * email and ticks a consent box, and only then does a record exist.
 *
 * Captured leads land in the `leads` collection for the operator console's
 * CRM. A repeat submission from the same email updates consent/source in
 * place rather than duplicating the lead — and never clears an existing
 * suppression or pipeline stage.
 */

import crypto from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { getGrowthEventsCollection } from '../db.js'
import {
  verifyUnsubscribeToken,
  verifyUserUnsubscribeToken,
} from '../marketing/lifecycle-emails.js'

const LeadSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().max(200).optional(),
  source: z.string().trim().max(60).default('web'),
  score_band: z.string().trim().max(10).optional(),
  consent_marketing: z.literal(true),
  attribution: z.record(z.string(), z.unknown()).optional(),
})

const ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'referrer',
  'landing_path',
  'captured_at',
]

export async function registerLeadRoutes(app: FastifyInstance, db: Db): Promise<void> {
  const leads = db.collection('leads')
  await leads.createIndex({ email: 1 }, { unique: true }).catch(() => {})
  await leads.createIndex({ stage: 1, created_at: -1 }).catch(() => {})

  app.post(
    '/leads',
    // Same ceiling as the quiz: unauthenticated, so the global limiter keys
    // off req.ip, then Turnstile (§4.1 group G).
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' }, turnstile: 'lead' } },
    async (req, reply) => {
      const parsed = LeadSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: 'Invalid lead submission', issues: parsed.error.issues })
      }
      const { email, name, source, score_band, consent_marketing, attribution } = parsed.data
      const normalizedEmail = email.toLowerCase()
      const now = new Date()
      // Client-supplied, unverifiable — analytics only. Only known keys kept.
      const cleanAttribution = attribution
        ? Object.fromEntries(
            Object.entries(attribution)
              .filter(
                ([key, value]) =>
                  ATTRIBUTION_KEYS.includes(key) && typeof value === 'string' && value.length > 0,
              )
              .map(([key, value]) => [key, (value as string).slice(0, 300)]),
          )
        : undefined

      try {
        await leads.updateOne(
          { email: normalizedEmail },
          {
            $set: {
              ...(name !== undefined ? { name } : {}),
              source,
              ...(score_band !== undefined ? { score_band } : {}),
              'consent.marketing': consent_marketing,
              'consent.captured_at': now,
              'consent.source': source,
              updated_at: now,
            },
            $setOnInsert: {
              id: crypto.randomUUID(),
              email: normalizedEmail,
              stage: 'new',
              suppressed: false,
              notes: [],
              // First-touch only — a repeat capture never rewrites where the
              // lead originally came from.
              ...(cleanAttribution ? { attribution: cleanAttribution } : {}),
              created_at: now,
            },
          },
          { upsert: true },
        )

        // Anonymized funnel event — source and score band only, never the
        // email itself (same rule as the quiz's events).
        await getGrowthEventsCollection(db)
          .insertOne({
            event: 'lead_captured',
            meta: { source, ...(score_band ? { score_band } : {}) },
            created_at: now,
          })
          .catch(() => {})

        // Uniform response — doesn't reveal whether the email was already
        // on file.
        return reply.send({ ok: true })
      } catch (err) {
        req.log.warn({ err }, 'Lead capture failed')
        return reply
          .status(500)
          .send({ error: "Couldn't save your details right now — please try again later." })
      }
    },
  )

  // One-click unsubscribe for lifecycle nurture email. The sig is an HMAC
  // of the lead id — possession of the email is the proof; no login needed.
  // Sets the same `suppressed` flag the operator suppress action uses.
  app.get<{ Querystring: { id?: string; sig?: string } }>(
    '/leads/unsubscribe',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id, sig } = req.query
      const done = (msg: string, status = 200) =>
        reply
          .status(status)
          .type('text/html')
          .send(
            `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:80vh;"><p style="max-width:420px;text-align:center;color:#444;">${msg}</p></body></html>`,
          )
      if (!id || !sig || !verifyUnsubscribeToken(id, sig)) {
        return done('This unsubscribe link is invalid or has expired.', 400)
      }
      const result = await leads.updateOne(
        { id },
        { $set: { suppressed: true, suppressed_at: new Date(), updated_at: new Date() } },
      )
      if (result.matchedCount === 0)
        return done('This unsubscribe link is invalid or has expired.', 400)
      return done("You're unsubscribed — no more emails from us.")
    },
  )

  // Same one-click opt-out for signed-up users — campaign email to users
  // carries this link (List-Unsubscribe + footer). Sets `email_opt_out`
  // on the user doc; account/transactional mail (trial-ending, security)
  // is unaffected — it never checks this flag.
  app.get<{ Querystring: { id?: string; sig?: string } }>(
    '/users/unsubscribe',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id, sig } = req.query
      const done = (msg: string, status = 200) =>
        reply
          .status(status)
          .type('text/html')
          .send(
            `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:80vh;"><p style="max-width:420px;text-align:center;color:#444;">${msg}</p></body></html>`,
          )
      if (!id || !sig || !verifyUserUnsubscribeToken(id, sig)) {
        return done('This unsubscribe link is invalid or has expired.', 400)
      }
      const result = await db
        .collection('users')
        .updateOne({ id }, { $set: { email_opt_out: true, email_opt_out_at: new Date() } })
      if (result.matchedCount === 0)
        return done('This unsubscribe link is invalid or has expired.', 400)
      return done("You're unsubscribed — you'll still get account emails, but no more marketing.")
    },
  )
}
