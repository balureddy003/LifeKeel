/**
 * WebPushSender — real browser push notifications via the Web Push API.
 *
 * Uses the `web-push` npm package to send push messages to subscribed
 * browsers. Requires VAPID keys (generated once and stored in env vars).
 *
 * VAPID keys can be generated with:
 *   npx web-push generate-vapid-keys
 *
 * Env vars:
 *   VAPID_PUBLIC_KEY  — public key (shared with the browser)
 *   VAPID_PRIVATE_KEY — private key (server-side only)
 *   VAPID_SUBJECT     — mailto: or URL for the push service
 */

import webpush, { type PushSubscription } from 'web-push'

export interface WebPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export class RealWebPushSender {
  private configured = false

  constructor() {
    const publicKey = process.env['VAPID_PUBLIC_KEY']
    const privateKey = process.env['VAPID_PRIVATE_KEY']
    const subject = process.env['VAPID_SUBJECT'] ?? 'mailto:hello@kairos.ai'

    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey)
      this.configured = true
    }
  }

  isConfigured(): boolean {
    return this.configured
  }

  async send(subscription: WebPushSubscription, payload: string): Promise<void> {
    if (!this.configured) {
      throw new Error('Web push not configured — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY')
    }
    await webpush.sendNotification(subscription as PushSubscription, payload, {
      TTL: 60 * 60 * 24, // 24 hours
    })
  }
}
