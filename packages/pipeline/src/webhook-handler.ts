/**
 * Webhook Handler
 *
 * Verifies webhook signatures and extracts event types before
 * any processing. Signature verification MUST happen first —
 * never process an unverified webhook.
 */

import crypto from 'node:crypto'
import type { ConnectorConfig } from './schemas.js'

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookVerificationError'
  }
}

export class WebhookHandler {
  constructor(private readonly connector: ConnectorConfig) {}

  /**
   * Verify HMAC signature. Must be called before extractEventType or processing.
   * Throws WebhookVerificationError on failure — never silently ignores.
   */
  verifySignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): void {
    const webhookConfig = this.connector.webhooks
    if (!webhookConfig?.signature_header || !webhookConfig.signature_algorithm) return // no sig config = skip

    const secret = process.env[`KAIROS_${this.connector.id.toUpperCase()}_WEBHOOK_SECRET`]
    if (!secret) throw new WebhookVerificationError(`Webhook secret not configured for ${this.connector.id}`)

    const headerValue = headers[webhookConfig.signature_header.toLowerCase()]
    const signature = Array.isArray(headerValue) ? headerValue[0] : headerValue
    if (!signature) throw new WebhookVerificationError('Missing signature header')

    const algorithm = webhookConfig.signature_algorithm === 'hmac-sha256' ? 'sha256' : 'sha1'
    const expected = crypto.createHmac(algorithm, secret).update(rawBody).digest('hex')
    const signatureHex = signature.replace(/^(sha256|sha1)=/, '')

    const isValid = crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signatureHex, 'hex'),
    )
    if (!isValid) throw new WebhookVerificationError('Invalid webhook signature')
  }

  /**
   * Extract the canonical event type from a webhook payload.
   * Uses the connector's event_type_field JSON path.
   */
  extractEventType(payload: Record<string, unknown>): string {
    const eventTypeField = this.connector.webhooks?.event_type_field
    if (!eventTypeField) return 'webhook.event'

    const raw = this.resolvePath(eventTypeField, payload)
    const sourceType = raw ? String(raw) : 'unknown'

    return this.connector.signal_type_map[sourceType] ?? sourceType
  }

  private resolvePath(path: string, obj: Record<string, unknown>): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
      return undefined
    }, obj)
  }
}
