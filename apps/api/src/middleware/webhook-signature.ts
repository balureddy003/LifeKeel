/**
 * Webhook Signature Verification
 *
 * Verifies HMAC signatures on incoming webhook payloads using the connector's
 * signing secret retrieved from the tenant's stored credentials.
 *
 * Supports:
 *   - Stripe:   stripe-signature header with timestamp anti-replay (t=, v1=)
 *   - Shopify:  x-shopify-hmac-sha256 header (base64 HMAC-SHA256)
 *   - Xero:     x-xero-signature header (base64 HMAC-SHA256)
 *   - Generic:  any connector with signature_header + hmac-sha256/hmac-sha1
 *
 * Verification is skipped (with a warning) when:
 *   - The connector has no signature_header defined (connector doesn't sign webhooks)
 *   - The tenant has no webhook_secret stored (not yet configured)
 *   - NODE_ENV=test (allows integration tests without real secrets)
 *
 * Anti-replay:
 *   Stripe embeds a timestamp in the signature header. We reject requests where
 *   |now - t| > 300s (5 minutes) — matches Stripe's own recommendation.
 */

import crypto from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type { Db } from 'mongodb'
import { decryptIfNeeded } from '@kairos/platform'

export interface WebhookConfig {
  signature_header?: string
  signature_algorithm?: 'hmac-sha256' | 'hmac-sha1'
}

export class WebhookSignatureVerifier {
  constructor(private readonly db: Db) {}

  /**
   * Verify the signature on an incoming webhook request.
   * Throws with a descriptive message if verification fails.
   * Returns silently if verification is skipped (no config) or passes.
   */
  async verify(
    request: FastifyRequest,
    tenantId: string,
    connectorId: string,
    config: WebhookConfig,
    rawBody: Buffer,
  ): Promise<void> {
    // Skip if connector doesn't declare a signature scheme
    if (!config.signature_header || !config.signature_algorithm) return

    // Skip in test environment (integration tests use synthetic payloads)
    if (process.env['NODE_ENV'] === 'test') return

    const secret = await this.getWebhookSecret(tenantId, connectorId)
    if (!secret) {
      // No secret stored — warn but allow (tenant hasn't configured webhook secret yet)
      request.log.warn(
        { tenant_id: tenantId, connector_id: connectorId },
        '[webhook] No webhook_secret stored — skipping signature verification. Configure it in connector settings.',
      )
      return
    }

    const header = request.headers[config.signature_header.toLowerCase()] as string | undefined
    if (!header) {
      throw new Error(`Missing signature header: ${config.signature_header}`)
    }

    const algo = config.signature_algorithm

    // Stripe uses a compound header: t=timestamp,v1=sig
    if (config.signature_header.toLowerCase() === 'stripe-signature') {
      this.verifyStripe(rawBody, header, secret)
      return
    }

    // Generic HMAC verification (Shopify, Xero, and others)
    this.verifyHmac(rawBody, header, secret, algo)
  }

  // ── Stripe verification ──────────────────────────────────────────────────────
  // Reference: https://stripe.com/docs/webhooks/signatures
  private verifyStripe(rawBody: Buffer, header: string, secret: string): void {
    const parts = Object.fromEntries(
      header.split(',').map(part => {
        const [k, ...v] = part.split('=')
        return [k!, v.join('=')]
      }),
    )

    const timestamp = parts['t']
    const receivedSig = parts['v1']
    if (!timestamp || !receivedSig) {
      throw new Error('Malformed Stripe signature header')
    }

    // Anti-replay: reject if timestamp is > 5 minutes old
    const age = Math.abs(Date.now() / 1000 - Number(timestamp))
    if (age > 300) {
      throw new Error(`Webhook replay detected: timestamp is ${Math.round(age)}s old (max 300s)`)
    }

    const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`
    const expected = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex')

    if (!timingSafeEqual(expected, receivedSig)) {
      throw new Error('Stripe signature mismatch')
    }
  }

  // ── Generic HMAC (Shopify, Xero, etc.) ───────────────────────────────────────
  private verifyHmac(
    rawBody: Buffer,
    header: string,
    secret: string,
    algo: 'hmac-sha256' | 'hmac-sha1',
  ): void {
    const hmacAlgo = algo === 'hmac-sha256' ? 'sha256' : 'sha1'
    const expected = crypto
      .createHmac(hmacAlgo, secret)
      .update(rawBody)
      .digest('base64')

    // Some providers send hex instead of base64 — try both
    const expectedHex = crypto
      .createHmac(hmacAlgo, secret)
      .update(rawBody)
      .digest('hex')

    if (!timingSafeEqual(expected, header) && !timingSafeEqual(expectedHex, header)) {
      throw new Error(`Webhook signature mismatch (${algo})`)
    }
  }

  // ── Secret retrieval ──────────────────────────────────────────────────────────
  private async getWebhookSecret(tenantId: string, connectorId: string): Promise<string | null> {
    const doc = await this.db.collection('connector_credentials').findOne(
      { tenant_id: tenantId, connector_id: connectorId },
      { projection: { webhook_secret: 1 } },
    ) as { webhook_secret?: string } | null

    if (!doc?.webhook_secret) return null
    const decrypted = decryptIfNeeded(doc.webhook_secret)
    return decrypted ?? null
  }
}

// Constant-time string comparison — prevents timing attacks
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}
