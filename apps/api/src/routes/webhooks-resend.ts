/**
 * POST /webhooks/resend — Resend event webhook.
 *
 * Parity with /webhooks/sendgrid: lifecycle/campaign sends carry the `lk`
 * ledger key as a Resend tag (mapped from SendGrid-style customArgs in
 * email/transport.ts), so each event joins to the exact send — turning
 * "sent" into measured opens, clicks, and bounces on the operator surfaces.
 *
 * Signature: Resend signs with the Svix scheme — HMAC-SHA256 over
 * `svix-id`.`svix-timestamp`.rawBody, keyed by the base64 secret shown in
 * the webhook's details page (the `whsec_…` value). The `svix-signature`
 * header is a space-separated `v1,<base64>` list; any match validates.
 * Unconfigured → 503 (feature off, not silently trusted). Timestamps older
 * than the tolerance are refused so captured payloads can't be replayed.
 *
 * Unlike SendGrid's batch array, Resend posts one event per request.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createLogger } from '@lifekeel/platform'
import { lifecycleSendsCol } from '../marketing/lifecycle-emails.js'

const log = createLogger({ service: 'resend-webhook', version: '0.0.0' })

const TOLERANCE_SEC = 300

function verifySignature(
  secret: string,
  id: string,
  timestamp: string,
  payload: Buffer,
  signatureHeader: string,
): boolean {
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > TOLERANCE_SEC) {
    return false
  }
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  if (!key.length) return false
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.`)
    .update(payload)
    .digest('base64')
  const expectedBytes = Buffer.from(expected, 'base64')
  for (const part of signatureHeader.split(' ')) {
    const [version, sig] = part.split(',', 2)
    if (version !== 'v1' || !sig) continue
    const actual = Buffer.from(sig, 'base64')
    if (actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes)) {
      return true
    }
  }
  return false
}

interface ResendEvent {
  type?: string
  created_at?: string
  data?: {
    /** Tags sent on the email come back as a name→value object. */
    tags?: Record<string, string>
  }
}

export function registerResendWebhookRoutes(app: FastifyInstance, db: Db): void {
  app.post(
    '/webhooks/resend',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const secret = process.env['RESEND_WEBHOOK_SECRET']
      if (!secret) return reply.status(503).send({ error: 'Event webhook not configured' })

      const id = req.headers['svix-id']
      const timestamp = req.headers['svix-timestamp']
      const signature = req.headers['svix-signature']
      const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody
      if (
        typeof id !== 'string' ||
        typeof timestamp !== 'string' ||
        typeof signature !== 'string' ||
        !rawBody
      ) {
        return reply.status(400).send({ error: 'Missing signature headers' })
      }
      if (!verifySignature(secret, id, timestamp, rawBody, signature)) {
        return reply.status(401).send({ error: 'Invalid signature' })
      }

      const ev = req.body as ResendEvent
      const lk = ev.data?.tags?.['lk']
      if (!lk) return { ok: true, applied: 0 }

      const now = ev.created_at ? new Date(ev.created_at) : new Date()
      const update: Record<string, unknown> = {}
      const inc: Record<string, number> = {}
      const min: Record<string, unknown> = {}
      let suppress = false
      switch (ev.type) {
        case 'email.delivered':
          update['delivered_at'] = now
          break
        // $min keeps the FIRST open/click — $set would overwrite with the last.
        case 'email.opened':
          min['opened_at'] = now
          inc['open_count'] = 1
          break
        case 'email.clicked':
          min['clicked_at'] = now
          inc['click_count'] = 1
          break
        case 'email.bounced':
        case 'email.failed':
          update['bounced'] = true
          break
        case 'email.complained':
          update['spam_reported'] = true
          suppress = true
          break
        default:
          return { ok: true, applied: 0 }
      }
      const res = await lifecycleSendsCol(db).updateOne(
        { key: lk },
        {
          ...(Object.keys(update).length ? { $set: update } : {}),
          ...(Object.keys(min).length ? { $min: min } : {}),
          ...(Object.keys(inc).length ? { $inc: inc } : {}),
        },
      )

      // A spam complaint is a compliance signal — cut all future marketing to
      // that recipient, whichever collection holds them. Same rule as the
      // SendGrid webhook's spamreport.
      if (suppress && res.matchedCount) {
        const row = await lifecycleSendsCol(db).findOne(
          { key: lk },
          { projection: { recipient: 1 } },
        )
        if (row) {
          await db
            .collection('leads')
            .updateOne({ id: row.recipient }, { $set: { suppressed: true } })
          await db
            .collection('users')
            .updateOne({ id: row.recipient }, { $set: { email_opt_out: true } })
        }
      }
      return { ok: true, applied: res.matchedCount }
    },
  )
}
