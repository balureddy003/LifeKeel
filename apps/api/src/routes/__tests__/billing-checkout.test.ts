/**
 * POST /billing/checkout — dormant-tier guard (remediation item 23).
 * Only `starter` ("Oak Plus") is actually for sale; growth/enterprise
 * entries in PLAN_PRICES are placeholder strings that used to resolve as
 * truthy price ids and die inside Stripe with a 500. The route now
 * rejects them with a clear 400 before any Stripe call is made.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { registerBillingRoutes } from '../billing.js'

const TENANT = 'tenant-billing-checkout-test'

function makeDb() {
  const col = {
    createIndex: async () => ({}),
    findOne: async () => ({ tenant_id: TENANT, billing: { currency: 'GBP' } }),
  }
  return { collection: () => col } as any
}

async function buildApp() {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: 'user-1' }
  })
  registerBillingRoutes(app, makeDb())
  return app
}

describe('POST /billing/checkout — dormant-tier guard', () => {
  let savedKey: string | undefined

  beforeEach(() => {
    savedKey = process.env['STRIPE_SECRET_KEY']
    // A syntactically-valid fake is enough — the guard returns before the
    // Stripe client is ever called.
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_fake_for_guard_test'
  })

  afterEach(() => {
    if (savedKey === undefined) delete process.env['STRIPE_SECRET_KEY']
    else process.env['STRIPE_SECRET_KEY'] = savedKey
  })

  it('rejects growth and enterprise with a clear 400 — placeholder prices never reach Stripe', async () => {
    const app = await buildApp()
    for (const plan of ['growth', 'enterprise']) {
      const res = await app.inject({ method: 'POST', url: '/billing/checkout', payload: { plan } })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toMatch(/isn't available for purchase/)
    }
  })

  it('still rejects free with its own message', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/billing/checkout', payload: { plan: 'free' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/does not require checkout/)
  })
})
