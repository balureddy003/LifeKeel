/**
 * Push Routes — browser + native push registration.
 *
 * GET  /push/vapid-key          — public VAPID key the browser needs to subscribe
 * POST /push/subscribe          — store a PushSubscription + enable web_push delivery
 * POST /push/unsubscribe        — remove a subscription by endpoint
 * POST /push/mobile/subscribe   — store an Expo push token + enable mobile_push
 * POST /push/mobile/unsubscribe — remove a device token
 *
 * The sending half already exists (DeliveryRouter + RealWebPushSender +
 * RealMobilePushSender); these routes are the registration surface.
 * Subscribing is itself the opt-in — the OS/browser permission prompt is
 * the explicit user gesture, and the $addToSet surgery in
 * enableWebPush/enableMobilePush puts the channel in the tenant's list
 * without touching other preferences.
 *
 * Security: subscribe/unsubscribe require JWT auth; tenant_id from JWT,
 * never from body. /push/vapid-key is safe to expose — the public key is
 * designed to ship to browsers.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createLogger } from '@lifekeel/platform'
import type { DeliveryRouter } from '../delivery/delivery-router.js'
import type { WebPushSubscription } from '../delivery/web-push-sender.js'

const log = createLogger({ service: 'push', version: '0.0.0' })

export function registerPushRoutes(
  fastify: FastifyInstance,
  _db: Db,
  deliveryRouter: DeliveryRouter | undefined,
): void {
  // ── GET /push/vapid-key ──────────────────────────────────────────────────
  fastify.get('/push/vapid-key', async (_req, reply) => {
    const publicKey = process.env['VAPID_PUBLIC_KEY']
    if (!publicKey || !deliveryRouter) {
      return reply.code(503).send({ error: 'Push notifications are not configured on this server' })
    }
    return { publicKey }
  })

  // ── POST /push/subscribe ─────────────────────────────────────────────────
  fastify.post<{
    Body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  }>('/push/subscribe', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { endpoint, keys } = req.body ?? {}
    if (!endpoint || typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
      return reply.code(400).send({ error: 'endpoint must be a valid https URL' })
    }
    if (!keys?.p256dh || !keys?.auth) {
      return reply.code(400).send({ error: 'keys.p256dh and keys.auth are required' })
    }
    if (!deliveryRouter) {
      return reply.code(503).send({ error: 'Push notifications are not configured on this server' })
    }

    const subscription: WebPushSubscription = {
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
    }
    await deliveryRouter.savePushSubscription(tenant_id, subscription)
    await deliveryRouter.enableWebPush(tenant_id)
    log.info({ tenant_id }, 'Web push subscription saved')
    return { ok: true }
  })

  // ── POST /push/unsubscribe ───────────────────────────────────────────────
  fastify.post<{
    Body: { endpoint?: string }
  }>('/push/unsubscribe', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { endpoint } = req.body ?? {}
    if (!endpoint || typeof endpoint !== 'string') {
      return reply.code(400).send({ error: 'endpoint is required' })
    }
    if (!deliveryRouter) {
      return reply.code(503).send({ error: 'Push notifications are not configured on this server' })
    }
    await deliveryRouter.removePushSubscription(tenant_id, endpoint)
    await deliveryRouter.disableWebPushIfNoSubscriptions(tenant_id)
    log.info({ tenant_id }, 'Web push subscription removed')
    return { ok: true }
  })

  // ── POST /push/mobile/subscribe ────────────────────────────────────────────
  // The registration surface the Expo sender in channels.ts was missing — a
  // native client (or Expo app) registers its push token here once it has OS
  // notification permission.
  fastify.post<{
    Body: { token?: string }
  }>('/push/mobile/subscribe', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { token } = req.body ?? {}
    if (!token || typeof token !== 'string' || token.length < 10 || token.length > 512) {
      return reply.code(400).send({ error: 'token must be a valid push token string' })
    }
    if (!deliveryRouter) {
      return reply.code(503).send({ error: 'Push notifications are not configured on this server' })
    }
    await deliveryRouter.saveMobilePushToken(tenant_id, token)
    await deliveryRouter.enableMobilePush(tenant_id)
    log.info({ tenant_id }, 'Mobile push token saved')
    return { ok: true }
  })

  // ── POST /push/mobile/unsubscribe ──────────────────────────────────────────
  fastify.post<{
    Body: { token?: string }
  }>('/push/mobile/unsubscribe', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { token } = req.body ?? {}
    if (!token || typeof token !== 'string') {
      return reply.code(400).send({ error: 'token is required' })
    }
    if (!deliveryRouter) {
      return reply.code(503).send({ error: 'Push notifications are not configured on this server' })
    }
    await deliveryRouter.removeMobilePushToken(tenant_id, token)
    await deliveryRouter.disableMobilePushIfNoTokens(tenant_id)
    log.info({ tenant_id }, 'Mobile push token removed')
    return { ok: true }
  })
}
