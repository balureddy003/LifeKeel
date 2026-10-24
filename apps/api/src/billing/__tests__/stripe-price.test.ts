import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearStripePriceCache,
  resolveStripePriceId,
  type PriceLookupClient,
} from '../stripe-price.js'
import { loadStripeConfig } from '../stripe-config.js'

const config = loadStripeConfig()
const ENV_KEYS = ['STRIPE_PRICE_STARTER', 'STRIPE_PRICE_STARTER_GBP', 'STRIPE_SECRET_KEY']

function client(ids: string[]): PriceLookupClient & { list: ReturnType<typeof vi.fn> } {
  const list = vi.fn(async () => ({ data: ids.map((id) => ({ id })) }))
  return { prices: { list }, list } as unknown as PriceLookupClient & {
    list: ReturnType<typeof vi.fn>
  }
}

describe('resolveStripePriceId', () => {
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
    clearStripePriceCache()
  })
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('finds the price by lookup_key and queries the declared key', async () => {
    const stripe = client(['price_from_lookup'])
    expect(await resolveStripePriceId(stripe, 'starter', 'GBP', { config })).toBe(
      'price_from_lookup',
    )
    expect(stripe.list).toHaveBeenCalledWith({
      lookup_keys: ['keel_plus_gbp_monthly'],
      active: true,
      limit: 1,
    })
  })

  it('caches the lookup for five minutes', async () => {
    const stripe = client(['price_a'])
    let t = 1_000
    const now = () => t
    await resolveStripePriceId(stripe, 'starter', 'GBP', { config, now })
    t += 60_000
    await resolveStripePriceId(stripe, 'starter', 'GBP', { config, now })
    expect(stripe.list).toHaveBeenCalledTimes(1)
    t += 6 * 60_000
    await resolveStripePriceId(stripe, 'starter', 'GBP', { config, now })
    expect(stripe.list).toHaveBeenCalledTimes(2)
  })

  it('an env override wins and skips the Stripe call', async () => {
    process.env['STRIPE_PRICE_STARTER'] = 'price_pinned'
    const stripe = client(['price_from_lookup'])
    expect(await resolveStripePriceId(stripe, 'starter', 'GBP', { config })).toBe('price_pinned')
    expect(stripe.list).not.toHaveBeenCalled()
    process.env['STRIPE_PRICE_STARTER_GBP'] = 'price_pinned_gbp'
    expect(await resolveStripePriceId(stripe, 'starter', 'GBP', { config })).toBe(
      'price_pinned_gbp',
    )
  })

  it('with a LIVE key and no matching price it returns null — never the legacy test-mode id', async () => {
    process.env['STRIPE_SECRET_KEY'] = 'sk_live_x'
    expect(await resolveStripePriceId(client([]), 'starter', 'GBP', { config })).toBeNull()
  })

  it('with a TEST key and no matching price it falls back to the legacy id so old local setups keep working', async () => {
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_x'
    const id = await resolveStripePriceId(client([]), 'starter', 'GBP', { config })
    expect(id).toMatch(/^price_/)
  })

  it('returns null for a plan or currency nothing is declared for', async () => {
    process.env['STRIPE_SECRET_KEY'] = 'sk_live_x'
    expect(await resolveStripePriceId(client(['price_x']), 'starter', 'INR', { config })).toBeNull()
  })
})
