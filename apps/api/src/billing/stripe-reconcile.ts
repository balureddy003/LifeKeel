/**
 * Idempotent reconciler: makes the connected Stripe account match
 * definitions/stripe-config.yaml (product, prices, webhook endpoint, Customer
 * Portal) without anyone opening the Dashboard.
 *
 * Properties the tests pin down:
 *  - dry-run by default: `apply: false` only reads, and returns the diff;
 *  - idempotent: applying twice leaves the second run with only no-ops;
 *  - prices are matched by `lookup_key`; a changed amount creates a new price,
 *    moves the key to it (`transfer_lookup_key`) and archives the old one, so
 *    existing subscribers keep their price;
 *  - the webhook signing secret exists only in the response to *creating* the
 *    endpoint, so creation is opt-in (`allowWebhookCreate`) and the secret is
 *    returned to the caller to store — it is never logged here;
 *  - nothing here initiates a charge, refund or payout.
 */
import type { StripeConfig } from './stripe-config.js'

// ── Minimal structural view of the Stripe SDK ───────────────────────────────
// Real `Stripe` instances satisfy these structurally; tests pass a fake.

interface ListResult<T> {
  data: T[]
}

export interface StripeProduct {
  id: string
  name: string
  description?: string | null
  active?: boolean
  metadata?: Record<string, string>
}

export interface StripePrice {
  id: string
  product: string | { id: string }
  currency: string
  unit_amount: number | null
  active?: boolean
  lookup_key?: string | null
  recurring?: { interval: string } | null
}

export interface StripeWebhookEndpoint {
  id: string
  url: string
  status?: string
  description?: string | null
  enabled_events: string[]
  secret?: string
}

export interface StripePortalConfig {
  id: string
  active?: boolean
  is_default?: boolean
  metadata?: Record<string, string>
  business_profile?: { headline?: string | null }
  default_return_url?: string | null
  features?: {
    subscription_cancel?: {
      enabled?: boolean
      mode?: string
      cancellation_reason?: { enabled?: boolean; options?: string[] }
    }
    payment_method_update?: { enabled?: boolean }
    invoice_history?: { enabled?: boolean }
    customer_update?: { enabled?: boolean; allowed_updates?: string[] }
    subscription_update?: { enabled?: boolean }
  }
}

type Params = Record<string, unknown>

export interface StripeAdminClient {
  products: {
    list(p: Params): Promise<ListResult<StripeProduct>>
    create(p: Params): Promise<StripeProduct>
    update(id: string, p: Params): Promise<StripeProduct>
  }
  prices: {
    list(p: Params): Promise<ListResult<StripePrice>>
    create(p: Params): Promise<StripePrice>
    update(id: string, p: Params): Promise<StripePrice>
  }
  webhookEndpoints: {
    list(p: Params): Promise<ListResult<StripeWebhookEndpoint>>
    create(p: Params): Promise<StripeWebhookEndpoint>
    update(id: string, p: Params): Promise<StripeWebhookEndpoint>
  }
  billingPortal: {
    configurations: {
      list(p: Params): Promise<ListResult<StripePortalConfig>>
      create(p: Params): Promise<StripePortalConfig>
      update(id: string, p: Params): Promise<StripePortalConfig>
    }
  }
}

// ── Result types ────────────────────────────────────────────────────────────

export type ReconcileObject = 'product' | 'price' | 'webhook' | 'portal'
export type ReconcileOp = 'create' | 'update' | 'replace' | 'noop' | 'skipped'

export interface ReconcileAction {
  object: ReconcileObject
  key: string
  op: ReconcileOp
  /** Human-readable differences; empty for noop. Never contains secrets. */
  details: string[]
}

export interface ReconcileResult {
  mode: 'test' | 'live' | 'unknown'
  applied: boolean
  actions: ReconcileAction[]
  errors: Array<{ object: ReconcileObject; key: string; message: string }>
  ids: { product?: string; prices: Record<string, string>; webhook?: string; portal?: string }
  /** Present only when this run created the webhook endpoint. Store it once. */
  webhookSecret?: string
  /** True when anything would change (dry-run) or did change (apply). */
  drift: boolean
}

export interface ReconcileOptions {
  apply: boolean
  /** API origin the webhook is served from, e.g. https://api.lifekeel.co.uk */
  apiOrigin?: string
  /** Web app origin used for the portal return URL, e.g. https://app.lifekeel.co.uk */
  appOrigin?: string
  /** Operators may update product/price/portal but must not mint secrets. */
  allowWebhookCreate?: boolean
  /** Restrict to some objects (default: all). */
  only?: ReconcileObject[]
}

export function detectStripeMode(apiKey: string | undefined): 'test' | 'live' | 'unknown' {
  if (!apiKey) return 'unknown'
  if (/^(sk|rk)_test_/.test(apiKey)) return 'test'
  if (/^(sk|rk)_live_/.test(apiKey)) return 'live'
  return 'unknown'
}

const MANAGED = { lifekeel_managed: 'true' }

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i])

const productId = (p: StripePrice['product']): string => (typeof p === 'string' ? p : p.id)

// ── Portal ──────────────────────────────────────────────────────────────────

export function desiredPortalPayload(config: StripeConfig, appOrigin?: string): Params {
  const f = config.portal.features
  return {
    business_profile: { headline: config.portal.headline },
    ...(appOrigin
      ? {
          default_return_url: `${appOrigin.replace(/\/$/, '')}${config.portal.default_return_path}`,
        }
      : {}),
    features: {
      subscription_cancel: {
        enabled: true,
        mode: f.cancel.mode,
        cancellation_reason: { enabled: f.cancel.reasons.length > 0, options: f.cancel.reasons },
      },
      payment_method_update: { enabled: f.payment_method_update },
      invoice_history: { enabled: f.invoice_history },
      customer_update: {
        enabled: f.customer_update.length > 0,
        allowed_updates: f.customer_update,
      },
      // One plan only — there is nothing to switch to, so the portal must not
      // offer plan changes.
      subscription_update: { enabled: false },
    },
  }
}

export function portalDiff(
  existing: StripePortalConfig,
  config: StripeConfig,
  appOrigin?: string,
): string[] {
  const f = config.portal.features
  const e = existing.features ?? {}
  const out: string[] = []
  if ((existing.business_profile?.headline ?? '') !== config.portal.headline) out.push('headline')
  if (appOrigin) {
    const want = `${appOrigin.replace(/\/$/, '')}${config.portal.default_return_path}`
    if ((existing.default_return_url ?? '') !== want) out.push('default_return_url')
  }
  if (e.subscription_cancel?.enabled !== true) out.push('cancel.enabled')
  if (e.subscription_cancel?.mode !== f.cancel.mode) out.push('cancel.mode')
  if (!sameSet(e.subscription_cancel?.cancellation_reason?.options ?? [], f.cancel.reasons))
    out.push('cancel.reasons')
  if ((e.payment_method_update?.enabled ?? false) !== f.payment_method_update)
    out.push('payment_method_update')
  if ((e.invoice_history?.enabled ?? false) !== f.invoice_history) out.push('invoice_history')
  if (!sameSet(e.customer_update?.allowed_updates ?? [], f.customer_update))
    out.push('customer_update')
  if (e.subscription_update?.enabled === true) out.push('subscription_update (must be off)')
  return out
}

// ── Reconcile ───────────────────────────────────────────────────────────────

export async function reconcileStripe(
  stripe: StripeAdminClient,
  config: StripeConfig,
  apiKey: string | undefined,
  opts: ReconcileOptions,
): Promise<ReconcileResult> {
  const wants = (o: ReconcileObject): boolean => !opts.only || opts.only.includes(o)
  const result: ReconcileResult = {
    mode: detectStripeMode(apiKey),
    applied: opts.apply,
    actions: [],
    errors: [],
    ids: { prices: {} },
    drift: false,
  }
  const push = (a: ReconcileAction): void => {
    result.actions.push(a)
    if (a.op !== 'noop' && a.op !== 'skipped') result.drift = true
  }
  const fail = (object: ReconcileObject, key: string, err: unknown): void => {
    result.errors.push({ object, key, message: err instanceof Error ? err.message : String(err) })
  }

  // Product ------------------------------------------------------------------
  let productIdValue: string | undefined
  if (wants('product') || wants('price')) {
    try {
      const products = await stripe.products.list({ active: true, limit: 100 })
      const found = products.data.find((p) => p.metadata?.['lifekeel_key'] === config.product.key)
      const desc = config.product.description ?? ''
      if (!found) {
        push({
          object: 'product',
          key: config.product.key,
          op: 'create',
          details: [`name=${config.product.name}`],
        })
        if (opts.apply) {
          const created = await stripe.products.create({
            name: config.product.name,
            ...(desc ? { description: desc } : {}),
            metadata: { lifekeel_key: config.product.key, ...MANAGED },
          })
          productIdValue = created.id
        }
      } else {
        productIdValue = found.id
        const diff: string[] = []
        if (found.name !== config.product.name) diff.push('name')
        if ((found.description ?? '') !== desc) diff.push('description')
        if (diff.length === 0)
          push({ object: 'product', key: config.product.key, op: 'noop', details: [] })
        else {
          push({ object: 'product', key: config.product.key, op: 'update', details: diff })
          if (opts.apply) {
            await stripe.products.update(found.id, { name: config.product.name, description: desc })
          }
        }
      }
      if (productIdValue) result.ids.product = productIdValue
    } catch (err) {
      fail('product', config.product.key, err)
    }
  }

  // Prices -------------------------------------------------------------------
  if (wants('price')) {
    for (const price of config.prices) {
      try {
        const res = await stripe.prices.list({
          lookup_keys: [price.lookup_key],
          active: true,
          limit: 1,
        })
        const existing = res.data[0]
        const create = async (transfer: boolean): Promise<StripePrice> =>
          stripe.prices.create({
            product: productIdValue,
            currency: price.currency,
            unit_amount: price.unit_amount,
            recurring: { interval: price.interval },
            lookup_key: price.lookup_key,
            ...(transfer ? { transfer_lookup_key: true } : {}),
            metadata: { plan: price.plan, ...MANAGED },
          })
        if (!existing) {
          push({
            object: 'price',
            key: price.lookup_key,
            op: 'create',
            details: [`${price.unit_amount} ${price.currency}/${price.interval}`],
          })
          if (opts.apply && productIdValue) {
            const created = await create(false)
            result.ids.prices[price.lookup_key] = created.id
          }
          continue
        }
        result.ids.prices[price.lookup_key] = existing.id
        const diff: string[] = []
        if (existing.unit_amount !== price.unit_amount)
          diff.push(`unit_amount ${existing.unit_amount} -> ${price.unit_amount}`)
        if (existing.currency !== price.currency)
          diff.push(`currency ${existing.currency} -> ${price.currency}`)
        if (existing.recurring?.interval !== price.interval)
          diff.push(`interval ${existing.recurring?.interval} -> ${price.interval}`)
        if (productIdValue && productId(existing.product) !== productIdValue) diff.push('product')
        if (diff.length === 0) {
          push({ object: 'price', key: price.lookup_key, op: 'noop', details: [] })
          continue
        }
        // Prices are immutable: replace, keeping the lookup key on the new one.
        push({ object: 'price', key: price.lookup_key, op: 'replace', details: diff })
        if (opts.apply && productIdValue) {
          const created = await create(true)
          await stripe.prices.update(existing.id, { active: false })
          result.ids.prices[price.lookup_key] = created.id
        }
      } catch (err) {
        fail('price', price.lookup_key, err)
      }
    }
  }

  // Webhook ------------------------------------------------------------------
  if (wants('webhook')) {
    const key = 'webhook'
    if (!opts.apiOrigin) {
      push({ object: 'webhook', key, op: 'skipped', details: ['no apiOrigin given'] })
    } else {
      const url = `${opts.apiOrigin.replace(/\/$/, '')}${config.webhook.path}`
      try {
        const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
        const found = endpoints.data.find((e) => e.url === url)
        if (!found) {
          if (!opts.allowWebhookCreate) {
            push({
              object: 'webhook',
              key: url,
              op: 'skipped',
              details: [
                'endpoint missing; creating it returns a signing secret, so it runs from infra only',
              ],
            })
            result.drift = true
          } else {
            push({
              object: 'webhook',
              key: url,
              op: 'create',
              details: [`${config.webhook.events.length} events`],
            })
            if (opts.apply) {
              const created = await stripe.webhookEndpoints.create({
                url,
                enabled_events: config.webhook.events,
                description: config.webhook.description,
                metadata: MANAGED,
              })
              result.ids.webhook = created.id
              if (created.secret) result.webhookSecret = created.secret
            }
          }
        } else {
          result.ids.webhook = found.id
          const diff: string[] = []
          if (!sameSet(found.enabled_events, config.webhook.events)) diff.push('enabled_events')
          if (found.status && found.status !== 'enabled') diff.push(`status=${found.status}`)
          if (diff.length === 0) push({ object: 'webhook', key: url, op: 'noop', details: [] })
          else {
            push({ object: 'webhook', key: url, op: 'update', details: diff })
            if (opts.apply) {
              await stripe.webhookEndpoints.update(found.id, {
                enabled_events: config.webhook.events,
                disabled: false,
              })
            }
          }
        }
      } catch (err) {
        fail('webhook', url, err)
      }
    }
  }

  // Customer Portal ----------------------------------------------------------
  if (wants('portal')) {
    const key = 'portal'
    try {
      const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 100 })
      const found = configs.data.find((c) => c.metadata?.['lifekeel_managed'] === 'true')
      if (!found) {
        push({ object: 'portal', key, op: 'create', details: ['no managed portal configuration'] })
        if (opts.apply) {
          const created = await stripe.billingPortal.configurations.create({
            ...desiredPortalPayload(config, opts.appOrigin),
            metadata: MANAGED,
          })
          result.ids.portal = created.id
        }
      } else {
        result.ids.portal = found.id
        const diff = portalDiff(found, config, opts.appOrigin)
        if (diff.length === 0) push({ object: 'portal', key, op: 'noop', details: [] })
        else {
          push({ object: 'portal', key, op: 'update', details: diff })
          if (opts.apply) {
            await stripe.billingPortal.configurations.update(
              found.id,
              desiredPortalPayload(config, opts.appOrigin),
            )
          }
        }
      }
    } catch (err) {
      fail('portal', key, err)
    }
  }

  return result
}
