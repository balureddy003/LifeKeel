/**
 * Resolves the Stripe price id that sells a plan.
 *
 * Order:
 *   1. An explicit env override (STRIPE_PRICE_STARTER_GBP, then
 *      STRIPE_PRICE_STARTER) — for pinning a price during a rollout.
 *   2. A lookup by the `lookup_key` declared in definitions/stripe-config.yaml.
 *      This is the normal path: the reconciler creates the price with that key,
 *      so the same code runs against a sandbox and against live mode with no
 *      edits and no hard-coded price_ ids.
 *   3. Only with a *test* key, the legacy price id baked into
 *      billing-constants.ts — so existing local setups keep working. It is
 *      deliberately NOT used with a live key: a test-mode price id does not
 *      exist in live mode and would fail at checkout.
 */
import { getStripePriceId, type Plan } from './billing-constants.js'
import { loadStripeConfig, lookupKeyFor, type StripeConfig } from './stripe-config.js'

export interface PriceLookupClient {
  prices: {
    list(params: {
      lookup_keys: string[]
      active: boolean
      limit: number
    }): Promise<{ data: Array<{ id: string }> }>
  }
}

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { id: string; at: number }>()

export function clearStripePriceCache(): void {
  cache.clear()
}

function envOverride(plan: Plan, currency: string, interval: 'month' | 'year'): string | null {
  const p = plan.toUpperCase()
  const c = currency.toUpperCase()
  if (interval === 'year') {
    return (
      process.env[`STRIPE_PRICE_${p}_${c}_ANNUAL`] ||
      process.env[`STRIPE_PRICE_${p}_ANNUAL`] ||
      null
    )
  }
  return process.env[`STRIPE_PRICE_${p}_${c}`] || process.env[`STRIPE_PRICE_${p}`] || null
}

function isTestKey(): boolean {
  return /^(sk|rk)_test_/.test(process.env['STRIPE_SECRET_KEY'] ?? '')
}

export async function resolveStripePriceId(
  stripe: PriceLookupClient | null,
  plan: Plan,
  currency: string,
  opts: { config?: StripeConfig; now?: () => number; interval?: 'month' | 'year' } = {},
): Promise<string | null> {
  const interval = opts.interval ?? 'month'
  const override = envOverride(plan, currency, interval)
  if (override) return override

  const now = opts.now ?? Date.now
  let key: string | null = null
  try {
    key = lookupKeyFor(opts.config ?? loadStripeConfig(), plan, currency, interval)
  } catch {
    // Missing or invalid config must not take checkout down; fall through.
  }

  if (key && stripe) {
    const hit = cache.get(key)
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.id
    const res = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 })
    const id = res.data[0]?.id
    if (id) {
      cache.set(key, { id, at: now() })
      return id
    }
  }

  // The legacy baked-in fallback predates billing periods — it only ever
  // sold the monthly price, so it must not stand in for a missing annual one.
  return interval === 'month' && isTestKey() ? getStripePriceId(plan, currency) : null
}
