/**
 * Billing & Subscription Routes
 *
 * Integrates with Stripe for subscription management, payment processing,
 * and billing lifecycle events.
 *
 * Features:
 * - Stripe checkout session creation (multi-currency)
 * - Webhook handling with idempotency protection
 * - Plan management and upgrades/downgrades
 * - Outcome credit refills on renewal
 * - Payment failure grace period + automatic downgrade
 * - Usage tracking against quotas
 * - Promo code redemption with rate limiting
 * - Admin credit adjustment endpoints
 * - Billing audit trail
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import Stripe from 'stripe'
import { redeemPromoCode } from '../billing/promo-codes.js'
import {
  PLAN_QUOTAS,
  PLAN_CREDITS,
  createPlanBilling,
  getStripePriceId,
  CREDIT_PACKS,
  getCreditPack,
  type Plan,
} from '../billing/billing-constants.js'
import { getAuditLogger } from '../audit/audit-log.js'
import { recordPaymentFailure, recordWebhookError } from './metrics.js'
import { recordLedgerEntry, getLedgerHistory, reconcileCredits } from '../billing/credit-ledger.js'
import { sendBillingAlert } from '../billing/billing-alerts.js'

function adminAuthorized(headers: Record<string, unknown>): boolean {
  const expected = process.env['KAIROS_ADMIN_KEY']
  return Boolean(expected && headers['x-kairos-admin-key'] === expected)
}

// ── Webhook idempotency ──────────────────────────────────────────────────────
//
// C3 fix: Store every processed Stripe event ID so retries don't re-process.

async function isWebhookProcessed(db: Db, eventId: string): Promise<boolean> {
  const existing = await db.collection('stripe_webhook_events').findOne({ event_id: eventId })
  return !!existing
}

async function markWebhookProcessed(db: Db, eventId: string, eventType: string): Promise<void> {
  await db.collection('stripe_webhook_events').insertOne({
    event_id: eventId,
    event_type: eventType,
    processed_at: new Date(),
  }).catch(() => {})
  // Create index on first call
  await db.collection('stripe_webhook_events').createIndex({ event_id: 1 }, { unique: true }).catch(() => {})
}

// ── Promo code rate limiting (M8) ────────────────────────────────────────────
//
// Track failed redemption attempts per tenant to prevent brute-force guessing.
// Uses MongoDB for persistence so the limit works across multiple API instances.

const PROMO_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const PROMO_RATE_LIMIT_MAX = 10 // 10 attempts per hour

async function checkPromoRateLimit(db: Db, tenantId: string): Promise<boolean> {
  const now = Date.now()
  const windowStart = new Date(now - PROMO_RATE_LIMIT_WINDOW_MS)

  // Ensure index on first call
  await db.collection('promo_rate_limits').createIndex({ tenant_id: 1, attempted_at: 1 }).catch(() => {})

  // Count attempts in the current window
  const count = await db.collection('promo_rate_limits').countDocuments({
    tenant_id: tenantId,
    attempted_at: { $gte: windowStart },
  })

  if (count >= PROMO_RATE_LIMIT_MAX) {
    return false
  }

  // Record this attempt
  await db.collection('promo_rate_limits').insertOne({
    tenant_id: tenantId,
    attempted_at: new Date(now),
  })

  // Periodically clean up old entries (1% chance per call to avoid overhead)
  if (Math.random() < 0.01) {
    await db.collection('promo_rate_limits').deleteMany({
      attempted_at: { $lt: windowStart },
    }).catch(() => {})
  }

  return true
}

export function registerBillingRoutes(app: FastifyInstance, db: Db): void {
  const stripe = process.env['STRIPE_SECRET_KEY']
    ? new Stripe(process.env['STRIPE_SECRET_KEY'])
    : null

  /**
   * POST /billing/checkout
   * Creates a Stripe checkout session for plan subscription.
   * M6: Uses tenant's billing currency to select the correct Stripe price.
   */
  app.post<{ Body: { plan: Plan; app?: 'family' | 'studio'; success_url?: string; cancel_url?: string } }>(
    '/billing/checkout',
    async (req, reply) => {
      if (!stripe) {
        return reply.status(501).send({ error: 'Stripe not configured' })
      }

      const { plan, app: originApp, success_url, cancel_url } = req.body
      const tenant_id = req.authContext?.tenant_id

      if (!tenant_id) {
        return reply.status(401).send({ error: 'Authentication required' })
      }

      if (plan === 'free') {
        return reply.status(400).send({ error: 'Free plan does not require checkout' })
      }

      const tenant = await db.collection('tenants').findOne({ tenant_id })
      if (!tenant) {
        return reply.status(404).send({ error: 'Tenant not found' })
      }

      // M6: Resolve price ID based on tenant's billing currency
      const currency = String(tenant['billing']?.['currency'] ?? 'GBP')
      const priceId = getStripePriceId(plan, currency)
      if (!priceId) {
        return reply.status(400).send({ error: 'Invalid plan' })
      }

      const appUrl = originApp === 'family'
        ? (process.env['AGENT_OAK_URL'] ?? 'http://localhost:3002')
        : (process.env['STUDIO_URL'] ?? 'http://localhost:3000')
      const defaultSuccessUrl = originApp === 'family'
        ? `${appUrl}/upgrade?success=true`
        : `${appUrl}/settings/billing?success=true`
      const defaultCancelUrl = originApp === 'family'
        ? `${appUrl}/upgrade?canceled=true`
        : `${appUrl}/settings/billing?canceled=true`

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [
            {
              price: priceId,
              quantity: 1,
            },
          ],
          mode: 'subscription',
          success_url: success_url || defaultSuccessUrl,
          cancel_url: cancel_url || defaultCancelUrl,
          customer_email: tenant.contact_email || undefined,
          metadata: {
            tenant_id,
            plan,
          },
        })

        return { checkout_url: session.url }
      } catch (error) {
        app.log.error(error)
        return reply.status(500).send({ error: 'Failed to create checkout session' })
      }
    }
  )

  /**
   * GET /billing/credit-packs
   * Returns available credit packs for purchase.
   */
  app.get('/billing/credit-packs', async () => {
    return { packs: CREDIT_PACKS }
  })

  /**
   * POST /billing/credits/purchase
   * Creates a Stripe checkout session for a one-time credit pack purchase.
   * Uses Stripe's payment mode (not subscription) for one-time payments.
   */
  app.post<{ Body: { pack_id: string; success_url?: string; cancel_url?: string } }>(
    '/billing/credits/purchase',
    async (req, reply) => {
      if (!stripe) {
        return reply.status(501).send({ error: 'Stripe not configured' })
      }

      const tenant_id = req.authContext?.tenant_id
      if (!tenant_id) {
        return reply.status(401).send({ error: 'Authentication required' })
      }

      const { pack_id, success_url, cancel_url } = req.body
      const pack = getCreditPack(pack_id)
      if (!pack) {
        return reply.status(400).send({ error: 'Invalid credit pack' })
      }

      const tenant = await db.collection('tenants').findOne({ tenant_id })
      if (!tenant) {
        return reply.status(404).send({ error: 'Tenant not found' })
      }

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: pack.stripe_price_id
            ? [{ price: pack.stripe_price_id, quantity: 1 }]
            : [{
                price_data: {
                  currency: pack.currency.toLowerCase(),
                  product_data: {
                    name: pack.label,
                    metadata: { type: 'credit_pack', credits: String(pack.credits) },
                  },
                  unit_amount: pack.price_minor,
                },
                quantity: 1,
              }],
          mode: 'payment',
          success_url: success_url || `${process.env['STUDIO_URL']}/settings/billing?credits=success`,
          cancel_url: cancel_url || `${process.env['STUDIO_URL']}/settings/billing?credits=canceled`,
          customer_email: tenant.contact_email || undefined,
          metadata: {
            tenant_id,
            credit_pack_id: pack.id,
            credit_amount: String(pack.credits),
            purchase_type: 'credit_pack',
          },
        })

        return { checkout_url: session.url }
      } catch (error) {
        app.log.error(error)
        return reply.status(500).send({ error: 'Failed to create checkout session' })
      }
    }
  )

  /**
   * POST /billing/portal
   * Creates a Stripe customer portal session for managing subscriptions
   */
  app.post<{ Body: { return_url?: string } }>('/billing/portal', async (req, reply) => {
    if (!stripe) {
      return reply.status(501).send({ error: 'Stripe not configured' })
    }

    const { return_url } = req.body
    const tenant_id = req.authContext?.tenant_id

    if (!tenant_id) {
      return reply.status(401).send({ error: 'Authentication required' })
    }

    const tenant = await db.collection('tenants').findOne({ tenant_id })
    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found' })
    }

    if (!tenant.stripe_customer_id) {
      return reply.status(400).send({ error: 'No active subscription' })
    }

    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: tenant.stripe_customer_id,
        return_url: return_url || `${process.env['STUDIO_URL']}/settings/billing`,
      })

      return { portal_url: session.url }
    } catch (error) {
      app.log.error(error)
      return reply.status(500).send({ error: 'Failed to create portal session' })
    }
  })

  /**
   * GET /billing/subscription
   * Returns current subscription status and usage
   */
  app.get('/billing/subscription', async (req, reply) => {
    const tenant_id = req.authContext?.tenant_id

    if (!tenant_id) {
      return reply.status(401).send({ error: 'Authentication required' })
    }

    const tenant = await db.collection('tenants').findOne({ tenant_id })
    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found' })
    }

    let subscription = null
    if (stripe && tenant.stripe_subscription_id) {
      try {
        const sub = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id)
        subscription = {
          id: sub.id,
          status: sub.status,
          current_period_end: (sub as any).current_period_end,
          cancel_at_period_end: (sub as any).cancel_at_period_end,
        }
      } catch (error) {
        app.log.error(error)
      }
    }

    return {
      plan: tenant.plan,
      status: tenant.status,
      quotas: tenant.quotas,
      billing: tenant['billing'] ?? {
        credits_balance: 0,
        credits_included: 0,
        credits_used_this_period: 0,
        outcome_price: 0,
        currency: 'GBP',
      },
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            current_period_end: subscription.current_period_end,
            cancel_at_period_end: subscription.cancel_at_period_end,
          }
        : null,
    }
  })

  /**
   * POST /billing/webhook
   * Handles Stripe webhook events with idempotency protection (C3).
   */
  app.post<{ Body: { type: string; data: { object: Record<string, unknown> } } }>(
    '/billing/webhook',
    async (req, reply) => {
      if (!stripe) {
        return reply.status(501).send({ error: 'Stripe not configured' })
      }

      const sig = req.headers['stripe-signature'] as string
      // Read from the validated config var (KAIROS_STRIPE_WEBHOOK_SECRET),
      // with fallback to the legacy name for backward compatibility
      const webhookSecret = process.env['KAIROS_STRIPE_WEBHOOK_SECRET'] ?? process.env['STRIPE_WEBHOOK_SECRET']

      if (!sig || !webhookSecret) {
        return reply.status(400).send({ error: 'Webhook signature required' })
      }

      try {
        // Get raw body from request
        const rawBody = (req as any).rawBody || JSON.stringify(req.body)
        const event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)

        // C3 fix: Idempotency check — skip if already processed
        if (await isWebhookProcessed(db, event.id)) {
          return { received: true, duplicate: true }
        }

        const audit = getAuditLogger()

        switch (event.type) {
          case 'checkout.session.completed': {
            const session = event.data.object as Stripe.Checkout.Session
            const tenant_id = session.metadata?.tenant_id
            const plan = session.metadata?.plan as Plan
            const purchaseType = session.metadata?.purchase_type

            // ── Credit pack purchase (one-time payment) ──────────────────────
            if (tenant_id && purchaseType === 'credit_pack') {
              const creditAmount = Number(session.metadata?.credit_amount ?? 0)
              if (creditAmount > 0) {
                await db.collection('tenants').updateOne(
                  { tenant_id },
                  {
                    $inc: { 'billing.credits_balance': creditAmount },
                    $set: { updated_at: new Date() },
                  },
                )

                // Record in the append-only credit ledger
                await recordLedgerEntry(db, {
                  tenantId: tenant_id,
                  type: 'plan_grant',
                  amount: creditAmount,
                  reference: session.metadata?.credit_pack_id,
                  reason: `Credit pack purchase: ${creditAmount} credits`,
                  actor: 'stripe_webhook',
                }).catch(() => {})

                audit?.log({
                  tenant_id,
                  user_id: 'stripe_webhook',
                  action: 'billing.credit_pack_purchased',
                  resource_type: 'tenant',
                  resource_id: tenant_id,
                  metadata: { credits: creditAmount, pack_id: session.metadata?.credit_pack_id, event_id: event.id },
                  ip: '',
                  user_agent: 'stripe',
                  timestamp: new Date(),
                })
              }
              break
            }

            // ── Plan subscription checkout ───────────────────────────────────
            if (tenant_id && plan) {
              // H2 fix: Grant plan-based credits on upgrade
              const tenant = await db.collection('tenants').findOne({ tenant_id })
              const currency = String(tenant?.['billing']?.['currency'] ?? 'GBP')
              const planBilling = createPlanBilling(plan, currency)

              await db.collection('tenants').updateOne(
                { tenant_id },
                {
                  $set: {
                    stripe_customer_id: session.customer as string,
                    stripe_subscription_id: session.subscription as string,
                    plan,
                    quotas: PLAN_QUOTAS[plan],
                    status: 'active',
                    'billing.credits_balance': planBilling.credits_balance,
                    'billing.credits_included': planBilling.credits_included,
                    'billing.credits_used_this_period': 0,
                    'billing.billing_period_start': planBilling.billing_period_start,
                    'billing.billing_period_end': planBilling.billing_period_end,
                    updated_at: new Date(),
                  },
                }
              )

              // M4: Audit trail
              audit?.log({
                tenant_id,
                user_id: 'stripe_webhook',
                action: 'billing.plan_upgraded',
                resource_type: 'tenant',
                resource_id: tenant_id,
                metadata: { plan, event_id: event.id },
                ip: '',
                user_agent: 'stripe',
                timestamp: new Date(),
              })

              // Record in the append-only credit ledger
              await recordLedgerEntry(db, {
                tenantId: tenant_id,
                type: 'plan_grant',
                amount: planBilling.credits_balance === Number.MAX_SAFE_INTEGER ? 0 : planBilling.credits_balance,
                reference: plan,
                reason: `Plan upgraded to ${plan} via Stripe checkout`,
                actor: 'stripe_webhook',
              }).catch(() => {})
            }
            break
          }

          case 'customer.subscription.deleted': {
            const subscription = event.data.object as Stripe.Subscription
            const tenant = await db.collection('tenants').findOne({
              stripe_subscription_id: subscription.id,
            })

            if (tenant) {
              // Downgrade to free plan with free-tier quotas and credits
              await db.collection('tenants').updateOne(
                { tenant_id: tenant.tenant_id },
                {
                  $set: {
                    plan: 'free',
                    quotas: PLAN_QUOTAS['free'],
                    status: 'active',
                    'billing.credits_included': PLAN_CREDITS['free'],
                    updated_at: new Date(),
                  },
                }
              )

              audit?.log({
                tenant_id: tenant.tenant_id,
                user_id: 'stripe_webhook',
                action: 'billing.plan_downgraded',
                resource_type: 'tenant',
                resource_id: tenant.tenant_id,
                metadata: { plan: 'free', event_id: event.id },
                ip: '',
                user_agent: 'stripe',
                timestamp: new Date(),
              })
            }
            break
          }

          case 'invoice.payment_failed': {
            const invoice = event.data.object as Stripe.Invoice
            const tenant = await db.collection('tenants').findOne({
              stripe_customer_id: invoice.customer as string,
            })

            if (tenant) {
              // H6: Record the payment failure timestamp for grace period tracking
              recordPaymentFailure(tenant.tenant_id as string)
              await db.collection('tenants').updateOne(
                { tenant_id: tenant.tenant_id },
                {
                  $set: {
                    status: 'past_due',
                    'billing.payment_failed_at': new Date(),
                    updated_at: new Date(),
                  },
                }
              )

              audit?.log({
                tenant_id: tenant.tenant_id,
                user_id: 'stripe_webhook',
                action: 'billing.payment_failed',
                resource_type: 'tenant',
                resource_id: tenant.tenant_id,
                metadata: { event_id: event.id },
                ip: '',
                user_agent: 'stripe',
                timestamp: new Date(),
              })

              // Billing alert: notify on payment failure
              await sendBillingAlert({
                title: 'Invoice payment failed',
                message: `Stripe invoice payment failed for tenant. Invoice ID: ${invoice.id}, event ID: ${event.id}. Tenant marked as past_due and grace period tracking started.`,
                severity: 'warning',
                tenant_id: tenant.tenant_id as string,
              })
            }
            break
          }

          case 'invoice.payment_succeeded': {
            const invoice = event.data.object as Stripe.Invoice
            const tenant = await db.collection('tenants').findOne({
              stripe_customer_id: invoice.customer as string,
            })

            if (tenant) {
              // H1 fix: Refill credits on successful renewal
              const plan = String(tenant['plan'] ?? 'free') as Plan
              const currency = String(tenant['billing']?.['currency'] ?? 'GBP')
              const planBilling = createPlanBilling(plan, currency)

              await db.collection('tenants').updateOne(
                { tenant_id: tenant.tenant_id },
                {
                  $set: {
                    status: 'active',
                    'billing.credits_balance': planBilling.credits_balance,
                    'billing.credits_used_this_period': 0,
                    'billing.billing_period_start': planBilling.billing_period_start,
                    'billing.billing_period_end': planBilling.billing_period_end,
                    'billing.payment_failed_at': null,
                    updated_at: new Date(),
                  },
                }
              )

              audit?.log({
                tenant_id: tenant.tenant_id,
                user_id: 'stripe_webhook',
                action: 'billing.payment_succeeded',
                resource_type: 'tenant',
                resource_id: tenant.tenant_id,
                metadata: { plan, event_id: event.id },
                ip: '',
                user_agent: 'stripe',
                timestamp: new Date(),
              })

              // Record in the append-only credit ledger
              await recordLedgerEntry(db, {
                tenantId: tenant.tenant_id as string,
                type: 'plan_grant',
                amount: planBilling.credits_balance === Number.MAX_SAFE_INTEGER ? 0 : planBilling.credits_balance,
                reference: plan,
                reason: `Credits refilled on ${plan} renewal`,
                actor: 'stripe_webhook',
              }).catch(() => {})
            }
            break
          }
        }

        // C3: Mark as processed
        await markWebhookProcessed(db, event.id, event.type)

        return { received: true }
      } catch (error) {
        app.log.error(error)
        recordWebhookError('unknown')
        return reply.status(400).send({ error: 'Webhook signature verification failed' })
      }
    }
  )

  /**
   * GET /billing/usage
   * Returns current usage against quotas
   */
  app.get('/billing/usage', async (req, reply) => {
    const tenant_id = req.authContext?.tenant_id

    if (!tenant_id) {
      return reply.status(401).send({ error: 'Authentication required' })
    }

    const tenant = await db.collection('tenants').findOne({ tenant_id })
    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found' })
    }

    const quotas = tenant.quotas
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    // Count events this month
    const eventsCount = await db.collection('events').countDocuments({
      tenant_id,
      created_at: { $gte: startOfMonth },
    })

    // Count workflows this month
    const workflowsCount = await db.collection('workflow_runs').countDocuments({
      tenant_id,
      created_at: { $gte: startOfMonth },
    })

    // Count detectors
    const detectorsCount = await db.collection('detectors').countDocuments({
      tenant_id,
    })

    // Count connectors
    const connectorsCount = await db.collection('connector_credentials').countDocuments({
      tenant_id,
    })

    // Count users
    const usersCount = await db.collection('users').countDocuments({
      tenant_id,
    })

    return {
      quotas,
      usage: {
        events_per_month: eventsCount,
        workflows_per_month: workflowsCount,
        detectors_max: detectorsCount,
        connectors_max: connectorsCount,
        users_max: usersCount,
      },
    }
  })

  /**
   * POST /billing/redeem-promo-code
   * Redeems a promo code and adds outcome credits to the tenant.
   * M8: Rate limited to prevent brute-force guessing.
   */
  app.post<{ Body: { code: string } }>('/billing/redeem-promo-code', async (req, reply) => {
    const tenant_id = req.authContext?.tenant_id
    if (!tenant_id) {
      return reply.status(401).send({ error: 'Authentication required' })
    }

    // M8: Rate limit check (MongoDB-backed for multi-instance safety)
    if (!(await checkPromoRateLimit(db, tenant_id))) {
      return reply.status(429).send({ error: 'Too many promo code attempts. Please try again later.' })
    }

    const { code } = req.body
    const result = await redeemPromoCode(db, tenant_id, code)

    if (!result.ok) {
      return reply.status(400).send({ error: result.reason ?? 'Failed to redeem promo code' })
    }

    // M4: Audit trail
    getAuditLogger()?.log({
      tenant_id,
      user_id: req.authContext?.user_id ?? 'unknown',
      action: 'billing.promo_redeemed',
      resource_type: 'promo_code',
      resource_id: code.trim().toUpperCase(),
      metadata: { grant_credits: result.grant_credits, new_balance: result.new_balance },
      ip: req.ip,
      user_agent: req.headers['user-agent'] ?? '',
      timestamp: new Date(),
    })

    return {
      ok: true,
      grant_credits: result.grant_credits,
      credits_balance: result.new_balance,
    }
  })

  // ── M7: Admin credit adjustment endpoints ────────────────────────────────

  app.post<{ Params: { id: string }; Body: { credits: number; reason: string } }>(
    '/admin/tenants/:id/credits',
    async (req, reply) => {
      if (!adminAuthorized(req.headers)) {
        return reply.status(403).send({ error: 'Admin key required' })
      }

      const { credits, reason } = req.body
      if (!Number.isInteger(credits) || credits === 0) {
        return reply.status(400).send({ error: 'credits must be a non-zero integer' })
      }
      if (!reason?.trim()) {
        return reply.status(400).send({ error: 'reason required' })
      }

      const result = await db.collection('tenants').findOneAndUpdate(
        { tenant_id: req.params.id },
        { $inc: { 'billing.credits_balance': credits }, $set: { updated_at: new Date() } },
        { returnDocument: 'after' },
      )

      if (!result) {
        return reply.status(404).send({ error: 'Tenant not found' })
      }

      const newBalance = Number((result as Record<string, any>)?.['billing']?.['credits_balance'] ?? 0)

      // M4: Audit trail
      getAuditLogger()?.logWithRetry({
        tenant_id: req.params.id,
        user_id: 'admin',
        action: 'billing.credits_adjusted',
        resource_type: 'tenant',
        resource_id: req.params.id,
        metadata: { credits, reason, new_balance: newBalance },
        ip: req.ip,
        user_agent: req.headers['user-agent'] ?? '',
        timestamp: new Date(),
      })

      // Record in the append-only credit ledger
      await recordLedgerEntry(db, {
        tenantId: req.params.id,
        type: 'admin_adjustment',
        amount: credits,
        reference: 'admin',
        reason,
        actor: 'admin',
      }).catch(() => {})

      return { ok: true, credits_balance: newBalance }
    }
  )

  app.put<{ Params: { id: string }; Body: { outcome_price: number } }>(
    '/admin/tenants/:id/outcome-price',
    async (req, reply) => {
      if (!adminAuthorized(req.headers)) {
        return reply.status(403).send({ error: 'Admin key required' })
      }

      const { outcome_price } = req.body
      if (typeof outcome_price !== 'number' || outcome_price < 0) {
        return reply.status(400).send({ error: 'outcome_price must be a non-negative number' })
      }

      await db.collection('tenants').updateOne(
        { tenant_id: req.params.id },
        { $set: { 'billing.outcome_price': outcome_price, updated_at: new Date() } },
      )

      return { ok: true, outcome_price }
    }
  )

  // ── L3: Admin credit reversal endpoint ───────────────────────────────────

  app.post<{ Params: { id: string }; Body: { event_id: string; reason: string } }>(
    '/admin/tenants/:id/credits/reverse',
    async (req, reply) => {
      if (!adminAuthorized(req.headers)) {
        return reply.status(403).send({ error: 'Admin key required' })
      }

      const { OutcomeCredits } = await import('../billing/outcome-credits.js')
      const outcomeCredits = new OutcomeCredits(db)
      const reversed = await outcomeCredits.reverseCharge({
        tenantId: req.params.id,
        eventId: req.body.event_id,
        reason: req.body.reason,
      })

      if (!reversed) {
        return reply.status(404).send({ error: 'Outcome event not found or already reversed' })
      }

      getAuditLogger()?.logWithRetry({
        tenant_id: req.params.id,
        user_id: 'admin',
        action: 'billing.credit_reversed',
        resource_type: 'outcome_event',
        resource_id: req.body.event_id,
        metadata: { reason: req.body.reason },
        ip: req.ip,
        user_agent: req.headers['user-agent'] ?? '',
        timestamp: new Date(),
      })

      return { ok: true, reversed: true }
    }
  )

  // ── Billing history endpoint ──────────────────────────────────────────────

  app.get<{
    Querystring: { type?: string; limit?: number; cursor?: string }
  }>('/billing/history', async (req, reply) => {
    const tenant_id = req.authContext?.tenant_id
    if (!tenant_id) {
      return reply.status(401).send({ error: 'Authentication required' })
    }

    const result = await getLedgerHistory(db, {
      tenantId: tenant_id,
      type: req.query.type as any,
      limit: req.query.limit ? Number(req.query.limit) : 50,
      cursor: req.query.cursor ? new Date(req.query.cursor) : undefined,
    })

    return {
      entries: result.entries,
      has_more: result.has_more,
    }
  })

  // ── Admin reconciliation endpoint ──────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/admin/tenants/:id/credits/reconcile',
    async (req, reply) => {
      if (!adminAuthorized(req.headers)) {
        return reply.status(403).send({ error: 'Admin key required' })
      }

      const result = await reconcileCredits(db, { tenantId: req.params.id })
      return result
    }
  )
}
