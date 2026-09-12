/**
 * Shared billing constants — single source of truth for plan quotas, credits,
 * and Stripe price IDs. Imported by signup, webhook handler, admin routes,
 * and the outcome-credits module.
 *
 * Never duplicate these values in route handlers — always import from here.
 */

import { z } from 'zod'

// ── Feature flag ──────────────────────────────────────────────────────────────
//
// BILLING_V2_ENABLED gates the new billing logic (ledger, reconciliation,
// distributed cron lock, MongoDB rate limiter). When false, the system falls
// back to the v1 behavior (no ledger writes, no reconciliation, in-memory
// rate limiter). This allows gradual rollout and instant rollback.
//
// To enable: set BILLING_V2_ENABLED=true in the environment.
// To disable: unset or set to false.

export function isBillingV2Enabled(): boolean {
  return process.env['BILLING_V2_ENABLED'] === 'true'
}

// ── Plan definitions ─────────────────────────────────────────────────────────

export type Plan = 'free' | 'starter' | 'growth' | 'enterprise'

export const PLAN_QUOTAS: Record<Plan, {
  events_per_month: number
  workflows_per_month: number
  detectors_max: number
  connectors_max: number
  users_max: number
  llm_tokens_per_month: number
}> = {
  free:       { events_per_month: 10_000, workflows_per_month: 3, detectors_max: 10, connectors_max: 1, users_max: 1, llm_tokens_per_month: 100_000 },
  starter:    { events_per_month: 100_000, workflows_per_month: 20, detectors_max: 50, connectors_max: 5, users_max: 5, llm_tokens_per_month: 1_000_000 },
  growth:     { events_per_month: 1_000_000, workflows_per_month: 100, detectors_max: -1, connectors_max: 20, users_max: 25, llm_tokens_per_month: 10_000_000 },
  enterprise: { events_per_month: -1, workflows_per_month: -1, detectors_max: -1, connectors_max: -1, users_max: -1, llm_tokens_per_month: -1 },
}

/** Outcome credits granted per billing cycle per plan. -1 = unlimited. */
export const PLAN_CREDITS: Record<Plan, number> = {
  free: 10,
  starter: 50,
  growth: 200,
  enterprise: -1, // unlimited
}

/**
 * Default outcome_price per plan (in major currency units, e.g. GBP pence).
 * When a verified outcome is charged, this amount is billed via Stripe.
 * 0 = no outcome-based billing (subscription only).
 *
 * Set via admin endpoint per-tenant, but these are the defaults applied
 * on plan upgrade/renewal if the tenant hasn't been manually configured.
 */
export const PLAN_OUTCOME_PRICES: Record<Plan, number> = {
  free: 0,        // Free tier: no outcome billing
  starter: 0.50,  // 50p per verified outcome
  growth: 0.25,   // 25p per verified outcome (higher volume, lower unit price)
  enterprise: 0,  // Enterprise: negotiated separately, 0 default
}

/**
 * Charge cooldown in days per plan — how long after charging for a goal+KPI
 * before another charge can occur for the same goal+KPI.
 *
 * Free: 30 days (aggressive — limits free tier usage)
 * Paid: 7 days (generous — they've paid for the credits)
 */
export const PLAN_CHARGE_COOLDOWN_DAYS: Record<Plan, number> = {
  free: 30,
  starter: 7,
  growth: 7,
  enterprise: 7,
}

/**
 * Minimum KPI progress (0-1) required before an outcome charge fires.
 * Lower threshold = more charge events = more revenue.
 */
export const MIN_PROGRESS_THRESHOLD = 0.10

/** Trial credits granted at signup (before any plan purchase). */
export const TRIAL_CREDITS = 10

/** Trial duration in days. After this, the tenant is downgraded to free limits. */
export const TRIAL_DURATION_DAYS = 30

/**
 * Free tier monthly credit refill — how many credits free tenants get
 * per month after their trial expires. Keeps the funnel alive so free
 * users continue to experience value and eventually upgrade.
 */
export const FREE_TIER_MONTHLY_REFILL = 5

// ── Credit packs (top-up purchases) ───────────────────────────────────────────
//
// Users can buy credit packs mid-cycle without upgrading their plan.
// Each pack has a fixed credit amount and a Stripe price ID.
// Prices are in GBP pence (minor units).

export interface CreditPack {
  id: string
  credits: number
  /** Price in minor currency units (pence/cents) */
  price_minor: number
  currency: string
  label: string
  /** Stripe price ID for this pack (one-time payment) */
  stripe_price_id?: string
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: 'pack_25',  credits: 25,   price_minor: 500,   currency: 'GBP', label: '25 Credits — £5' },
  { id: 'pack_50',  credits: 50,   price_minor: 900,   currency: 'GBP', label: '50 Credits — £9 (Best Value)' },
  { id: 'pack_100', credits: 100,  price_minor: 1500,  currency: 'GBP', label: '100 Credits — £15' },
  { id: 'pack_250', credits: 250,  price_minor: 3000,  currency: 'GBP', label: '250 Credits — £30' },
]

/** Find a credit pack by ID. */
export function getCreditPack(packId: string): CreditPack | undefined {
  return CREDIT_PACKS.find(p => p.id === packId)
}

// ── Stripe price IDs ──────────────────────────────────────────────────────────
//
// In production, create one price per currency in the Stripe Dashboard and map
// them here. The checkout endpoint picks the price based on the tenant's
// billing currency. Falls back to the default (GBP) if no currency-specific
// price is configured.

const PLAN_PRICES: Record<Plan, string | null> = {
  free: null,
  // Real Stripe test-mode price ("Oak Plus", £7.99/mo GBP) — created via
  // the Stripe API since no products/prices existed in this account at all.
  // growth/enterprise stay placeholders; nothing currently checks out into them.
  starter: 'price_1U0hS5LkkF6tCgs0cSt7ivDx',
  growth: 'price_growth_monthly',
  enterprise: 'price_enterprise_monthly',
}

/** Currency-specific Stripe price overrides. Keys are `${plan}:${currency}`. */
const PLAN_PRICES_BY_CURRENCY: Record<string, string> = {
  // Example — populate with real Stripe price IDs when multi-currency goes live:
  // 'starter:INR': 'price_starter_monthly_inr',
  // 'growth:USD':  'price_growth_monthly_usd',
}

/** Resolve the Stripe price ID for a plan + currency combination. */
export function getStripePriceId(plan: Plan, currency: string): string | null {
  const currencyKey = `${plan}:${currency.toUpperCase()}`
  return PLAN_PRICES_BY_CURRENCY[currencyKey] ?? PLAN_PRICES[plan] ?? null
}

// ── Payment failure grace period ──────────────────────────────────────────────

export const PAYMENT_GRACE_PERIOD_DAYS = 7
export const PAYMENT_SUSPENSION_DAYS = 14

// ── Billing schema (zod) ──────────────────────────────────────────────────────
//
// Validates the `billing` subdocument on the tenant. Used at signup and
// whenever billing fields are mutated.

const BillingSchema = z.object({
  credits_balance: z.number(),
  credits_included: z.number().default(0),
  credits_used_this_period: z.number().default(0),
  outcome_price: z.number().default(0),
  currency: z.string().default('GBP'),
  billing_period_start: z.date().optional(),
  billing_period_end: z.date().optional(),
  trial_ends_at: z.date().optional(),
})

type Billing = z.infer<typeof BillingSchema>

/** Build the initial billing object for a new tenant. */
export function createInitialBilling(opts: {
  currency: string
  trialCredits?: number
  inviteGrantCredits?: number
}): Billing {
  const trialCredits = opts.trialCredits ?? TRIAL_CREDITS
  const startingCredits = trialCredits + (opts.inviteGrantCredits ?? 0)
  const now = new Date()
  return {
    credits_balance: startingCredits,
    credits_included: trialCredits,
    credits_used_this_period: 0,
    outcome_price: 0,
    currency: opts.currency,
    trial_ends_at: new Date(now.getTime() + TRIAL_DURATION_DAYS * 86_400_000),
  }
}

/** Build the billing object for a plan upgrade / renewal. */
export function createPlanBilling(plan: Plan, currency: string): Billing {
  const credits = PLAN_CREDITS[plan]
  const now = new Date()
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())
  return {
    credits_balance: credits === -1 ? Number.MAX_SAFE_INTEGER : credits,
    credits_included: credits,
    credits_used_this_period: 0,
    outcome_price: PLAN_OUTCOME_PRICES[plan],
    currency,
    billing_period_start: now,
    billing_period_end: periodEnd,
  }
}
