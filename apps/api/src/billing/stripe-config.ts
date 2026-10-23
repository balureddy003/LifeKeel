/**
 * Typed loader for definitions/stripe-config.yaml — the declarative source of
 * truth for the Stripe objects LifeKeel depends on (product, prices, webhook
 * endpoint, Customer Portal). Pure parsing and validation; talking to Stripe
 * is stripe-reconcile.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { z } from 'zod'
import { repoRoot } from '@lifekeel/platform'

/** Events the webhook handler in routes/billing.ts knows how to process. */
export const HANDLED_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.payment_succeeded',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
] as const

const CANCEL_REASONS = [
  'too_expensive',
  'missing_features',
  'switched_service',
  'unused',
  'customer_service',
  'low_quality',
  'too_complex',
  'other',
] as const

const PriceSchema = z.object({
  lookup_key: z.string().min(3),
  plan: z.enum(['starter']),
  currency: z.string().length(3).toLowerCase(),
  unit_amount: z.number().int().positive(),
  interval: z.enum(['month', 'year']),
})

const StripeConfigSchema = z
  .object({
    version: z.literal(1),
    product: z.object({
      key: z.string().min(2),
      name: z.string().min(2),
      description: z.string().optional(),
    }),
    prices: z.array(PriceSchema).min(1),
    webhook: z.object({
      path: z.string().startsWith('/'),
      description: z.string().default('LifeKeel billing events'),
      events: z.array(z.enum(HANDLED_WEBHOOK_EVENTS)).min(1),
    }),
    portal: z.object({
      headline: z.string().max(60),
      default_return_path: z.string().startsWith('/'),
      features: z.object({
        cancel: z.object({
          mode: z.enum(['at_period_end', 'immediately']),
          reasons: z.array(z.enum(CANCEL_REASONS)).default([]),
        }),
        payment_method_update: z.boolean(),
        invoice_history: z.boolean(),
        customer_update: z
          .array(z.enum(['email', 'address', 'phone', 'name', 'shipping', 'tax_id']))
          .default([]),
      }),
    }),
  })
  .superRefine((cfg, ctx) => {
    const keys = cfg.prices.map((p) => p.lookup_key)
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'prices[].lookup_key must be unique',
        path: ['prices'],
      })
    }
    // `immediately` would end paid access mid-period with no refund — a
    // consumer-hostile default we do not want to ship by accident.
    if (cfg.portal.features.cancel.mode !== 'at_period_end') {
      ctx.addIssue({
        code: 'custom',
        message: 'portal.features.cancel.mode must be at_period_end',
        path: ['portal', 'features', 'cancel', 'mode'],
      })
    }
  })

export type StripeConfig = z.infer<typeof StripeConfigSchema>
export type StripePriceConfig = z.infer<typeof PriceSchema>

export function parseStripeConfig(raw: unknown): StripeConfig {
  return StripeConfigSchema.parse(raw)
}

export function loadStripeConfig(file?: string): StripeConfig {
  const path = file ?? join(repoRoot(), 'definitions', 'stripe-config.yaml')
  return parseStripeConfig(loadYaml(readFileSync(path, 'utf8')))
}

/** The lookup key that sells a plan in a currency, or null if none is declared. */
export function lookupKeyFor(config: StripeConfig, plan: string, currency: string): string | null {
  const wanted = currency.toLowerCase()
  return config.prices.find((p) => p.plan === plan && p.currency === wanted)?.lookup_key ?? null
}
