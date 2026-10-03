/**
 * POST /webhooks/sendgrid — SendGrid Event Webhook.
 *
 * Every lifecycle/campaign send carries custom_args.lk = its lifecycle_sends
 * ledger key, so each event here joins to the exact send — which is what
 * turns "sent" into measured opens, clicks, and bounces on the operator
 * surfaces.
 *
 * Signature: SendGrid signs `timestamp + rawBody` with Ed25519; the
 * verification key comes from Mail Settings → Signed Event Webhook in the
 * SendGrid console. Unconfigured → 503 (feature off, not silently trusted).
 */
import { createPublicKey, verify } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createLogger } from '@agentoak/platform'
import { lifecycleSendsCol } from '../marketing/lifecycle-emails.js'

const log = createLogger({ service: 'sendgrid-webhook', version: '0.0.0' })

// Ed25519 SPKI DER prefix — SendGrid's console key is the raw 32-byte key,
// base64'd; wrapping it in the standard prefix makes it a valid SPKI.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function verifySignature(publicKeyB64: string, timestamp: string, payload: Buffer, signatureB64: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyB64, 'base64')]),
      format: 'der',
      type: 'spki',
    })
    return verify(null, Buffer.concat([Buffer.from(timestamp), payload]), key, Buffer.from(signatureB64, 'base64'))
  } catch {
    return false
  }
}

interface SendGridEvent {
  event?: string
  /** custom_args surface as top-level fields on each event. */
  lk?: string
  timestamp?: number
}

export function registerSendgridWebhookRoutes(app: FastifyInstance, db: Db): void {
  app.post('/webhooks/sendgrid', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
    const publicKey = process.env['SENDGRID_EVENT_WEBHOOK_KEY']
    if (!publicKey) return reply.status(503).send({ error: 'Event webhook not configured' })

    const timestamp = req.headers['x-twilio-email-event-webhook-timestamp']
    const signature = req.headers['x-twilio-email-event-webhook-signature']
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody
    if (typeof timestamp !== 'string' || typeof signature !== 'string' || !rawBody) {
      return reply.status(400).send({ error: 'Missing signature headers' })
    }
    if (!verifySignature(publicKey, timestamp, rawBody, signature)) {
      return reply.status(401).send({ error: 'Invalid signature' })
    }

    const events = Array.isArray(req.body) ? (req.body as SendGridEvent[]) : []
    let applied = 0
    for (const ev of events) {
      if (!ev.lk) continue
      const now = new Date((ev.timestamp ?? 0) * 1000 || Date.now())
      const update: Record<string, unknown> = {}
      const inc: Record<string, number> = {}
      const min: Record<string, unknown> = {}
      switch (ev.event) {
        case 'delivered': update['delivered_at'] = now; break
        // $min keeps the FIRST open/click — $set would overwrite with the last.
        case 'open': min['opened_at'] = now; inc['open_count'] = 1; break
        case 'click': min['clicked_at'] = now; inc['click_count'] = 1; break
        case 'bounce': case 'dropped': update['bounced'] = true; break
        case 'spamreport': update['spam_reported'] = true; break
        default: continue
      }
      const res = await lifecycleSendsCol(db).updateOne(
        { key: ev.lk },
        {
          ...(Object.keys(update).length ? { $set: update } : {}),
          ...(Object.keys(min).length ? { $min: min } : {}),
          ...(Object.keys(inc).length ? { $inc: inc } : {}),
        },
      )
      if (res.matchedCount) applied++

      // A spam report is a compliance signal — cut all future marketing to
      // that recipient, whichever collection holds them.
      if (ev.event === 'spamreport' && res.matchedCount) {
        const row = await lifecycleSendsCol(db).findOne({ key: ev.lk }, { projection: { recipient: 1 } })
        if (row) {
          await db.collection('leads').updateOne({ id: row.recipient }, { $set: { suppressed: true } })
          await db.collection('users').updateOne({ id: row.recipient }, { $set: { email_opt_out: true } })
        }
      }
    }
    log.info({ events: events.length, applied }, 'sendgrid event batch')
    return { ok: true, applied }
  })
}
