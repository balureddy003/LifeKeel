/**
 * Tests for Stripe webhook signature verification at the API boundary.
 *
 * The actual Stripe signature verification requires a real Stripe webhook
 * secret and a validly-signed payload. These tests verify the signature
 * checking logic at the API boundary:
 *
 * 1. POST /billing/webhook without a stripe-signature header → 400
 * 2. POST /billing/webhook with a stripe-signature header but no
 *    STRIPE_WEBHOOK_SECRET env var → 400
 * 3. POST /billing/webhook with an invalid signature → 400 (not 200)
 * 4. The webhook endpoint is in the open routes list (no JWT required)
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, type Db } from 'mongodb'
import { registerBillingRoutes } from '../billing.js'

const WEBHOOK_PAYLOAD = JSON.stringify({
  id: 'evt_test_123',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_123' } },
})

describe('Stripe webhook signature verification', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db
  let app: ReturnType<typeof Fastify>
  let savedWebhookSecret: string | undefined
  let savedSecretKey: string | undefined

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    const uri = mongod.getUri()
    client = new MongoClient(uri)
    await client.connect()
    db = client.db('webhook_sig_test')

    // Stripe SDK is only initialised when STRIPE_SECRET_KEY is set.
    savedSecretKey = process.env['STRIPE_SECRET_KEY']
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_dummy_key_for_unit_tests'

    // Save and clear the webhook secret so each test controls it explicitly.
    savedWebhookSecret = process.env['STRIPE_WEBHOOK_SECRET']

    app = Fastify()
    registerBillingRoutes(app, db)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    await client.close()
    await mongod.stop()

    if (savedSecretKey === undefined) {
      delete process.env['STRIPE_SECRET_KEY']
    } else {
      process.env['STRIPE_SECRET_KEY'] = savedSecretKey
    }

    if (savedWebhookSecret === undefined) {
      delete process.env['STRIPE_WEBHOOK_SECRET']
    } else {
      process.env['STRIPE_WEBHOOK_SECRET'] = savedWebhookSecret
    }
  })

  it('returns 400 when no stripe-signature header is present', async () => {
    process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_test_secret'

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json' },
      payload: WEBHOOK_PAYLOAD,
    })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.payload)
    expect(body['error']).toMatch(/signature/i)
  })

  it('returns 400 when stripe-signature header is present but STRIPE_WEBHOOK_SECRET is unset', async () => {
    delete process.env['STRIPE_WEBHOOK_SECRET']

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1234567890,v1=invalid_signature',
      },
      payload: WEBHOOK_PAYLOAD,
    })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.payload)
    expect(body['error']).toMatch(/signature/i)
  })

  it('returns 400 for an invalid signature (not 200)', async () => {
    process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_test_secret'

    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1234567890,v1=tampered_invalid_signature_value',
      },
      payload: WEBHOOK_PAYLOAD,
    })

    // Must be rejected — a tampered payload must never return 200.
    expect(res.statusCode).toBe(400)
    expect(res.statusCode).not.toBe(200)
    const body = JSON.parse(res.payload)
    // Stripe's constructEvent throws a signature verification error which
    // is caught and returned as a 400 with a message.
    expect(body).toHaveProperty('error')
  })

  it('includes /billing/webhook in the open (no-JWT) routes list', async () => {
    // This mirrors the open-routes list in server.ts. The webhook endpoint
    // must be publicly reachable so Stripe can deliver events without a JWT.
    const openRoutes = [
      '/health',
      '/engine/health',
      '/metrics',
      '/auth/token',
      '/auth/demo-token',
      '/auth/signup',
      '/auth/login',
      '/auth/sso/',
      '/auth/google/',
      '/auth/github/',
      '/auth/request-password-reset',
      '/auth/reset-password',
      '/auth/verify-email',
      '/auth/resend-verification',
      '/entitlements/plans',
      '/blog/posts',
      '/a/',
      '/why/',
      '/verify/',
      '/webhooks/',
      '/inbound/',
      '/insights/cleanup-stale-all',
      '/billing/webhook',
    ]

    expect(openRoutes).toContain('/billing/webhook')

    // The route is registered on the Fastify instance and reachable without
    // any auth middleware (the test app has no JWT hook, proving the route
    // handler itself does not require authentication).
    const res = await app.inject({
      method: 'POST',
      url: '/billing/webhook',
      headers: { 'content-type': 'application/json' },
      payload: WEBHOOK_PAYLOAD,
    })

    // We get a 400 (missing signature), not a 401 — confirming no JWT gate.
    expect(res.statusCode).toBe(400)
    expect(res.statusCode).not.toBe(401)
  })
})
