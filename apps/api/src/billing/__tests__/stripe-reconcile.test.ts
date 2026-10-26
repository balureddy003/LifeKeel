import { describe, expect, it } from 'vitest'
import { reconcileStripe, detectStripeMode } from '../stripe-reconcile.js'
import { fakeStripe } from './helpers/fake-stripe.js'
import { loadStripeConfig, parseStripeConfig } from '../stripe-config.js'

const config = loadStripeConfig()
const opts = {
  apiOrigin: 'https://api.example.test',
  appOrigin: 'https://app.example.test',
  allowWebhookCreate: true,
}

describe('stripe-config', () => {
  it('the checked-in config parses and sells Keel Plus in GBP', () => {
    expect(
      config.prices.find((p) => p.plan === 'starter' && p.currency === 'gbp')?.unit_amount,
    ).toBe(799)
    expect(config.portal.features.cancel.mode).toBe('at_period_end')
  })

  it('rejects an immediate-cancel portal and duplicate lookup keys', () => {
    const raw = JSON.parse(JSON.stringify(config))
    raw.portal.features.cancel.mode = 'immediately'
    expect(() => parseStripeConfig(raw)).toThrow()
    const dup = JSON.parse(JSON.stringify(config))
    dup.prices.push(dup.prices[0])
    expect(() => parseStripeConfig(dup)).toThrow()
  })
})

describe('reconcileStripe', () => {
  it('detects the key mode from its prefix', () => {
    expect(detectStripeMode('sk_test_x')).toBe('test')
    expect(detectStripeMode('rk_live_x')).toBe('live')
    expect(detectStripeMode('nope')).toBe('unknown')
    expect(detectStripeMode(undefined)).toBe('unknown')
  })

  it('dry-run reports the diff and writes nothing', async () => {
    const { client, state } = fakeStripe()
    const res = await reconcileStripe(client, config, 'sk_test_x', { ...opts, apply: false })
    expect(res.applied).toBe(false)
    expect(res.drift).toBe(true)
    expect(
      res.actions
        .filter((a) => a.op === 'create')
        .map((a) => a.object)
        .sort(),
    ).toEqual(['portal', 'price', 'price', 'product', 'webhook'])
    expect(state.calls).toEqual([])
  })

  it('apply creates everything and returns the webhook secret exactly once', async () => {
    const { client, state } = fakeStripe()
    const res = await reconcileStripe(client, config, 'sk_test_x', { ...opts, apply: true })
    expect(res.errors).toEqual([])
    expect(res.webhookSecret).toBe('whsec_FAKE')
    expect(res.ids.product).toBeTruthy()
    expect(res.ids.prices['keel_plus_gbp_monthly']).toBeTruthy()
    expect(state.endpoints[0]!.url).toBe('https://api.example.test/billing/webhook')
    expect(state.endpoints[0]!.enabled_events).toEqual(config.webhook.events)
    expect(JSON.stringify(res.actions)).not.toContain('whsec_')
  })

  it('is idempotent: a second apply is all no-ops and returns no secret', async () => {
    const { client, state } = fakeStripe()
    await reconcileStripe(client, config, 'sk_test_x', { ...opts, apply: true })
    const callsAfterFirst = state.calls.length
    const second = await reconcileStripe(client, config, 'sk_test_x', { ...opts, apply: true })
    expect(second.drift).toBe(false)
    expect(second.actions.every((a) => a.op === 'noop')).toBe(true)
    expect(second.webhookSecret).toBeUndefined()
    expect(state.calls.length).toBe(callsAfterFirst)
  })

  it('a changed amount creates a new price, moves the lookup key and archives the old one', async () => {
    const { client, state } = fakeStripe()
    await reconcileStripe(client, config, 'sk_test_x', { ...opts, apply: true })
    const oldPrice = state.prices[0]!
    const bumped = JSON.parse(JSON.stringify(config))
    bumped.prices[0].unit_amount = 999
    const res = await reconcileStripe(client, parseStripeConfig(bumped), 'sk_test_x', {
      ...opts,
      apply: true,
    })
    const priceAction = res.actions.find((a) => a.object === 'price')!
    expect(priceAction.op).toBe('replace')
    expect(priceAction.details[0]).toContain('799 -> 999')
    const fresh = state.prices.find((p) => p.lookup_key === 'keel_plus_gbp_monthly')!
    expect(fresh.id).not.toBe(oldPrice.id)
    expect(fresh.unit_amount).toBe(999)
    expect(oldPrice.active).toBe(false)
  })

  it('repairs a webhook whose events drifted, without minting a new secret', async () => {
    const { client, state } = fakeStripe()
    await reconcileStripe(client, config, 'sk_test_x', { ...opts, apply: true })
    state.endpoints[0]!.enabled_events = ['invoice.payment_failed']
    const res = await reconcileStripe(client, config, 'sk_test_x', { ...opts, apply: true })
    expect(res.actions.find((a) => a.object === 'webhook')!.op).toBe('update')
    expect(res.webhookSecret).toBeUndefined()
    expect(state.endpoints[0]!.enabled_events).toEqual(config.webhook.events)
  })

  it('flags a portal that allows plan switching or immediate cancel and fixes it', async () => {
    const { client, state } = fakeStripe()
    await reconcileStripe(client, config, 'sk_test_x', { ...opts, apply: true })
    const portal = state.portals[0]!
    portal.features!.subscription_cancel!.mode = 'immediately'
    portal.features!.subscription_update = { enabled: true }
    const dry = await reconcileStripe(client, config, 'sk_test_x', { ...opts, apply: false })
    const diff = dry.actions.find((a) => a.object === 'portal')!.details
    expect(diff).toContain('cancel.mode')
    expect(diff.join(' ')).toContain('subscription_update')
    await reconcileStripe(client, config, 'sk_test_x', { ...opts, apply: true })
    expect(portal.features!.subscription_cancel!.mode).toBe('at_period_end')
    expect(portal.features!.subscription_update!.enabled).toBe(false)
  })

  it('operators (allowWebhookCreate=false) never create the webhook but still see the drift', async () => {
    const { client, state } = fakeStripe()
    const res = await reconcileStripe(client, config, 'sk_test_x', {
      ...opts,
      apply: true,
      allowWebhookCreate: false,
    })
    const hook = res.actions.find((a) => a.object === 'webhook')!
    expect(hook.op).toBe('skipped')
    expect(res.drift).toBe(true)
    expect(res.webhookSecret).toBeUndefined()
    expect(state.endpoints).toHaveLength(0)
    expect(state.products).toHaveLength(1)
  })

  it('collects a per-object error without aborting the rest', async () => {
    const { client } = fakeStripe()
    client.webhookEndpoints.list = async () => {
      throw new Error('permission denied')
    }
    const res = await reconcileStripe(client, config, 'rk_test_x', { ...opts, apply: true })
    expect(res.errors).toEqual([
      {
        object: 'webhook',
        key: 'https://api.example.test/billing/webhook',
        message: 'permission denied',
      },
    ])
    expect(res.actions.some((a) => a.object === 'portal' && a.op === 'create')).toBe(true)
  })
})
