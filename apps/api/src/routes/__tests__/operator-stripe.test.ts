import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyRequest } from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, type Db } from 'mongodb'
import { registerOperatorStripeRoutes } from '../operator-stripe.js'
import { fakeStripe } from '../../billing/__tests__/helpers/fake-stripe.js'
import { loadStripeConfig } from '../../billing/stripe-config.js'

const config = loadStripeConfig()
const ORIGINS = { apiOrigin: 'https://api.example.test', appOrigin: 'https://app.example.test' }

describe('operator Billing setup (Stripe)', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db
  let app: ReturnType<typeof Fastify>
  let fake: ReturnType<typeof fakeStripe>

  async function build(
    opts: { apiKey?: string; role?: string; iatAgeSec?: number; noStripe?: boolean } = {},
  ) {
    app = Fastify()
    app.addHook('onRequest', async (request: FastifyRequest) => {
      request.authContext = {
        user_id: 'op-1',
        tenant_id: 'op-t',
        roles: ['admin'],
        iat: Math.floor(Date.now() / 1000) - (opts.iatAgeSec ?? 10),
      } as never
    })
    registerOperatorStripeRoutes(app, db, {
      stripe: opts.noStripe ? null : fake.client,
      apiKey: opts.apiKey ?? 'rk_test_x',
      config,
      ...ORIGINS,
    })
    await app.ready()
  }

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
    db = client.db('operator_stripe_test')
    await db
      .collection('platform_operators')
      .insertOne({ user_id: 'op-1', status: 'active', roles: ['super_admin'] })
    fake = fakeStripe()
  })
  afterEach(async () => {
    await app.close()
    await client.close()
    await mongod.stop()
  })

  const audit = () =>
    db
      .collection('operator_audit_log')
      .find({ action: 'operator.billing.stripe_reconcile' })
      .toArray()

  it('GET shows mode, a restricted key, the dry-run diff, and webhook health — with no secrets', async () => {
    await build()
    await db.collection('stripe_webhook_events').insertMany([
      {
        event_id: 'e1',
        event_type: 'invoice.payment_succeeded',
        status: 'completed',
        processed_at: new Date(),
      },
      {
        event_id: 'e2',
        event_type: 'charge.refunded',
        status: 'failed',
        processed_at: new Date(),
        failed_at: new Date(),
        error: 'boom',
      },
    ])
    const res = await app.inject({ method: 'GET', url: '/operator/billing/stripe' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({
      configured: true,
      mode: 'test',
      key_kind: 'restricted',
      key_warning: null,
    })
    expect(body.reconcile.applied).toBe(false)
    expect(body.reconcile.drift).toBe(true)
    expect(body.webhook).toMatchObject({
      completed_24h: 1,
      failed_24h: 1,
      last_event_type: expect.any(String),
    })
    expect(body.webhook.recent_failures[0]).toMatchObject({ event_id: 'e2', error: 'boom' })
    expect(JSON.stringify(body)).not.toMatch(/sk_|rk_|whsec_/)
    expect(fake.state.calls).toEqual([]) // GET never writes
  })

  it('warns when a full secret key is used instead of a restricted one', async () => {
    await build({ apiKey: 'sk_test_x' })
    const res = await app.inject({ method: 'GET', url: '/operator/billing/stripe' })
    expect(res.json().key_kind).toBe('secret')
    expect(res.json().key_warning).toContain('restricted key')
  })

  it('reports not-configured without crashing', async () => {
    await build({ noStripe: true })
    const res = await app.inject({ method: 'GET', url: '/operator/billing/stripe' })
    expect(res.json()).toMatchObject({ configured: false, reconcile: null })
  })

  it('POST requires a reason', async () => {
    await build()
    const res = await app.inject({
      method: 'POST',
      url: '/operator/billing/stripe/reconcile',
      payload: { apply: true },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST needs a recent login (step-up)', async () => {
    await build({ iatAgeSec: 3 * 60 * 60 })
    const res = await app.inject({
      method: 'POST',
      url: '/operator/billing/stripe/reconcile',
      payload: { reason: 'initial billing setup', apply: true },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('step_up_required')
    expect(fake.state.calls).toEqual([])
  })

  it('POST dry-run writes nothing but is still audited', async () => {
    await build()
    const res = await app.inject({
      method: 'POST',
      url: '/operator/billing/stripe/reconcile',
      payload: { reason: 'preview the diff', apply: false },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ applied: false, drift: true })
    expect(fake.state.calls).toEqual([])
    const rows = await audit()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ reason: 'preview the diff', operator_user_id: 'op-1' })
  })

  it('POST apply creates product, price and portal but never the webhook, and audits what changed', async () => {
    await build()
    const res = await app.inject({
      method: 'POST',
      url: '/operator/billing/stripe/reconcile',
      payload: { reason: 'initial billing setup', apply: true },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.applied).toBe(true)
    expect(fake.state.products).toHaveLength(1)
    expect(fake.state.prices).toHaveLength(2) // monthly anchor + annual (PR #264)
    expect(fake.state.portals).toHaveLength(1)
    expect(fake.state.endpoints).toHaveLength(0)
    expect(fake.state.calls).not.toContain('webhookEndpoints.create')
    expect(JSON.stringify(body)).not.toContain('whsec_')
    const [row] = await audit()
    expect(row!['metadata']).toMatchObject({ applied: true })
    expect((row!['metadata'] as { changes: string[] }).changes).toEqual(
      expect.arrayContaining([
        'create:product:keel_plus',
        'create:price:keel_plus_gbp_monthly',
        'create:portal:portal',
      ]),
    )
  })

  it('replacing a live price needs an explicit confirm_price_change', async () => {
    await build()
    await app.inject({
      method: 'POST',
      url: '/operator/billing/stripe/reconcile',
      payload: { reason: 'initial billing setup', apply: true },
    })
    // Someone changed the price in Stripe's own dashboard.
    fake.state.prices[0]!.unit_amount = 499
    const blocked = await app.inject({
      method: 'POST',
      url: '/operator/billing/stripe/reconcile',
      payload: { reason: 'restore the declared price', apply: true },
    })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().code).toBe('confirm_price_change_required')
    expect(fake.state.prices[0]!.unit_amount).toBe(499)

    const ok = await app.inject({
      method: 'POST',
      url: '/operator/billing/stripe/reconcile',
      payload: { reason: 'restore the declared price', apply: true, confirm_price_change: true },
    })
    expect(ok.statusCode).toBe(200)
    expect(fake.state.prices.find((p) => p.active !== false)!.unit_amount).toBe(5999) // annual is the live price (PR #264)
  })

  it('refuses to apply to a LIVE account without confirm_live, and to an unrecognised key', async () => {
    await build({ apiKey: 'rk_live_x' })
    const live = await app.inject({
      method: 'POST',
      url: '/operator/billing/stripe/reconcile',
      payload: { reason: 'go live setup', apply: true },
    })
    expect(live.statusCode).toBe(409)
    expect(live.json().code).toBe('confirm_live_required')
    expect(fake.state.calls).toEqual([])
    await app.close()

    await build({ apiKey: 'weird' })
    const unknown = await app.inject({
      method: 'POST',
      url: '/operator/billing/stripe/reconcile',
      payload: { reason: 'go live setup', apply: true },
    })
    expect(unknown.statusCode).toBe(409)
  })

  it('a non-operator is refused', async () => {
    await db.collection('platform_operators').deleteMany({})
    await build()
    const res = await app.inject({ method: 'GET', url: '/operator/billing/stripe' })
    expect(res.statusCode).toBe(403)
  })
})
