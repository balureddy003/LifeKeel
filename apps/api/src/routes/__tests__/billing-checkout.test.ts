/**
 * POST /billing/checkout — dormant-tier guard (remediation item 23).
 * Only `starter` ("Oak Plus") is actually for sale; growth/enterprise
 * entries in PLAN_PRICES are placeholder strings that used to resolve as
 * truthy price ids and die inside Stripe with a 500. The route now
 * rejects them with a clear 400 before any Stripe call is made.
 *
 * The second describe block covers the duplicate-subscription guard: a
 * tenant with a live Stripe subscription is told to use the portal
 * instead of being handed a second checkout, a stale stored subscription
 * id (missed webhook / pre-cleanup churn) is cleared so they can
 * re-subscribe, and an existing Stripe customer is reused rather than
 * minting a duplicate via customer_email.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'

const stripeMocks = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  checkoutCreate: vi.fn(),
}))

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(function FakeStripe() {
    return {
      subscriptions: { retrieve: stripeMocks.subscriptionsRetrieve },
      checkout: { sessions: { create: stripeMocks.checkoutCreate } },
      billingPortal: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn() },
    }
  }),
}))

const { registerBillingRoutes } = await import('../billing.js')

const TENANT = 'tenant-billing-checkout-test'

function makeDb(tenant: Record<string, unknown> = { tenant_id: TENANT, billing: { currency: 'GBP' } }) {
  const tenantCol = {
    createIndex: async () => ({}),
    findOne: async () => tenant,
    updateOne: vi.fn(async () => ({})),
  }
  const genericCol = {
    createIndex: async () => ({}),
    findOne: async () => null,
  }
  return { collection: (name: string) => (name === 'tenants' ? tenantCol : genericCol) } as any
}

async function buildApp(db: any) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: 'user-1' }
  })
  registerBillingRoutes(app, db)
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
    const app = await buildApp(makeDb())
    for (const plan of ['growth', 'enterprise']) {
      const res = await app.inject({ method: 'POST', url: '/billing/checkout', payload: { plan } })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toMatch(/isn't available for purchase/)
    }
  })

  it('still rejects free with its own message', async () => {
    const app = await buildApp(makeDb())
    const res = await app.inject({ method: 'POST', url: '/billing/checkout', payload: { plan: 'free' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/does not require checkout/)
  })
})

describe('POST /billing/checkout — existing subscription guard', () => {
  let savedKey: string | undefined

  beforeEach(() => {
    savedKey = process.env['STRIPE_SECRET_KEY']
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_fake_for_guard_test'
    stripeMocks.subscriptionsRetrieve.mockReset()
    stripeMocks.checkoutCreate.mockReset()
    stripeMocks.checkoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.test/session' })
  })

  afterEach(() => {
    if (savedKey === undefined) delete process.env['STRIPE_SECRET_KEY']
    else process.env['STRIPE_SECRET_KEY'] = savedKey
  })

  it('returns 409 when the stored subscription is still live in Stripe', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue({ status: 'active' })
    const app = await buildApp(makeDb({
      tenant_id: TENANT,
      stripe_subscription_id: 'sub_live',
      billing: { currency: 'GBP' },
    }))

    const res = await app.inject({ method: 'POST', url: '/billing/checkout', payload: { plan: 'starter' } })

    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('ALREADY_SUBSCRIBED')
    expect(stripeMocks.checkoutCreate).not.toHaveBeenCalled()
  })

  it('clears a stale stored subscription id and proceeds when Stripe says it is canceled', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue({ status: 'canceled' })
    const db = makeDb({
      tenant_id: TENANT,
      stripe_subscription_id: 'sub_dead',
      stripe_customer_id: 'cus_existing',
      billing: { currency: 'GBP' },
    })
    const app = await buildApp(db)

    const res = await app.inject({ method: 'POST', url: '/billing/checkout', payload: { plan: 'starter' } })

    expect(res.statusCode).toBe(200)
    expect(res.json().checkout_url).toBe('https://checkout.stripe.test/session')
    const tenantsCol = db.collection('tenants')
    expect(tenantsCol.updateOne).toHaveBeenCalledWith(
      { tenant_id: TENANT },
      { $unset: { stripe_subscription_id: '' } },
    )
    expect(stripeMocks.checkoutCreate).toHaveBeenCalledTimes(1)
  })

  it('reuses the existing Stripe customer and attaches tenant metadata to the subscription', async () => {
    const app = await buildApp(makeDb({
      tenant_id: TENANT,
      stripe_customer_id: 'cus_existing',
      contact_email: 'user@example.com',
      billing: { currency: 'GBP' },
    }))

    const res = await app.inject({ method: 'POST', url: '/billing/checkout', payload: { plan: 'starter' } })

    expect(res.statusCode).toBe(200)
    const createArgs = stripeMocks.checkoutCreate.mock.calls[0]?.[0] as Record<string, unknown>
    // customer reuse — not customer_email, which would mint a duplicate
    // Stripe customer on every re-subscribe.
    expect(createArgs['customer']).toBe('cus_existing')
    expect(createArgs['customer_email']).toBeUndefined()
    // tenant_id on the subscription object lets customer.subscription.*
    // webhooks resolve the tenant even if checkout.session.completed was lost.
    expect(createArgs['subscription_data']).toEqual({
      metadata: { tenant_id: TENANT, plan: 'starter' },
    })
  })
})
