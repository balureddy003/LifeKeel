/**
 * Push registration routes — browser (VAPID) and native (Expo token).
 * Subscribing is the opt-in: the routes must enable the matching delivery
 * channel for the tenant, and tenant_id always comes from authContext,
 * never from the request body.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { registerPushRoutes } from '../push.js'
import type { DeliveryRouter } from '../../delivery/delivery-router.js'

const TENANT = 'tenant-push-test'

function makeRouter() {
  return {
    savePushSubscription: vi.fn(async () => {}),
    enableWebPush: vi.fn(async () => {}),
    removePushSubscription: vi.fn(async () => {}),
    disableWebPushIfNoSubscriptions: vi.fn(async () => {}),
    saveMobilePushToken: vi.fn(async () => {}),
    enableMobilePush: vi.fn(async () => {}),
    removeMobilePushToken: vi.fn(async () => {}),
    disableMobilePushIfNoTokens: vi.fn(async () => {}),
  }
}

async function buildApp(router?: ReturnType<typeof makeRouter>) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: 'user-1' }
  })
  registerPushRoutes(app, {} as any, router as unknown as DeliveryRouter | undefined)
  return app
}

describe('GET /push/vapid-key', () => {
  const ORIGINAL_KEY = process.env['VAPID_PUBLIC_KEY']
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env['VAPID_PUBLIC_KEY']
    else process.env['VAPID_PUBLIC_KEY'] = ORIGINAL_KEY
  })

  it('returns 503 when the delivery router is unavailable', async () => {
    process.env['VAPID_PUBLIC_KEY'] = 'test-key'
    const app = await buildApp(undefined)
    const res = await app.inject({ method: 'GET', url: '/push/vapid-key' })
    expect(res.statusCode).toBe(503)
  })

  it('returns 503 when VAPID_PUBLIC_KEY is not set', async () => {
    delete process.env['VAPID_PUBLIC_KEY']
    const app = await buildApp(makeRouter())
    const res = await app.inject({ method: 'GET', url: '/push/vapid-key' })
    expect(res.statusCode).toBe(503)
  })

  it('returns the public key when configured', async () => {
    process.env['VAPID_PUBLIC_KEY'] = 'test-key'
    const app = await buildApp(makeRouter())
    const res = await app.inject({ method: 'GET', url: '/push/vapid-key' })
    expect(res.statusCode).toBe(200)
    expect(res.json().publicKey).toBe('test-key')
  })
})

describe('POST /push/subscribe', () => {
  const VALID = {
    endpoint: 'https://push.example.com/sub/abc',
    keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
  }

  it('rejects a non-https endpoint', async () => {
    const app = await buildApp(makeRouter())
    const res = await app.inject({
      method: 'POST',
      url: '/push/subscribe',
      payload: { ...VALID, endpoint: 'http://insecure.example.com' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a missing keys object', async () => {
    const app = await buildApp(makeRouter())
    const res = await app.inject({
      method: 'POST',
      url: '/push/subscribe',
      payload: { endpoint: VALID.endpoint },
    })
    expect(res.statusCode).toBe(400)
  })

  it('stores the subscription and enables web_push for the JWT tenant', async () => {
    const router = makeRouter()
    const app = await buildApp(router)
    const res = await app.inject({
      method: 'POST',
      url: '/push/subscribe',
      // tenant_id in the body must be ignored — authContext wins.
      payload: { ...VALID, tenant_id: 'someone-else' },
    })
    expect(res.statusCode).toBe(200)
    expect(router.savePushSubscription).toHaveBeenCalledWith(TENANT, {
      endpoint: VALID.endpoint,
      keys: { p256dh: VALID.keys.p256dh, auth: VALID.keys.auth },
    })
    expect(router.enableWebPush).toHaveBeenCalledWith(TENANT)
  })
})

describe('POST /push/unsubscribe', () => {
  it('removes the subscription and re-checks whether any remain', async () => {
    const router = makeRouter()
    const app = await buildApp(router)
    const res = await app.inject({
      method: 'POST',
      url: '/push/unsubscribe',
      payload: { endpoint: 'https://push.example.com/sub/abc' },
    })
    expect(res.statusCode).toBe(200)
    expect(router.removePushSubscription).toHaveBeenCalledWith(
      TENANT,
      'https://push.example.com/sub/abc',
    )
    expect(router.disableWebPushIfNoSubscriptions).toHaveBeenCalledWith(TENANT)
  })
})

describe('POST /push/mobile/subscribe', () => {
  it('rejects a missing or implausibly short token', async () => {
    const app = await buildApp(makeRouter())
    for (const token of [undefined, '', 'short']) {
      const res = await app.inject({
        method: 'POST',
        url: '/push/mobile/subscribe',
        payload: { token },
      })
      expect(res.statusCode).toBe(400)
    }
  })

  it('stores the token and enables mobile_push for the JWT tenant', async () => {
    const router = makeRouter()
    const app = await buildApp(router)
    const token = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'
    const res = await app.inject({
      method: 'POST',
      url: '/push/mobile/subscribe',
      payload: { token, tenant_id: 'someone-else' },
    })
    expect(res.statusCode).toBe(200)
    expect(router.saveMobilePushToken).toHaveBeenCalledWith(TENANT, token)
    expect(router.enableMobilePush).toHaveBeenCalledWith(TENANT)
  })
})

describe('POST /push/mobile/unsubscribe', () => {
  it('removes the token and re-checks whether any remain', async () => {
    const router = makeRouter()
    const app = await buildApp(router)
    const token = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'
    const res = await app.inject({
      method: 'POST',
      url: '/push/mobile/unsubscribe',
      payload: { token },
    })
    expect(res.statusCode).toBe(200)
    expect(router.removeMobilePushToken).toHaveBeenCalledWith(TENANT, token)
    expect(router.disableMobilePushIfNoTokens).toHaveBeenCalledWith(TENANT)
  })
})
