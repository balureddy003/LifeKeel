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
  const expected = process.env['LIFEKEEL_ADMIN_KEY']
  return Boolean(expected && headers['x-lifekeel-admin-key'] === expected)
}

// ── Webhook idempotency ──────────────────────────────────────────────────────
//
// C3 fix: store every processed Stripe event ID so retries don't re-process.
//
// KEEL-007: this used to be read-then-process-then-write — isWebhookProcessed
// checked first, the full side-effect switch ran, and only then did
// markWebhookProcessed record the event id (itself .catch(()=>{})-swallowed).
// A crash, or any transient failure on that final insert, between the side
// effects and the mark meant a Stripe retry of the same event would
// re-apply it — double credits, double ledger entry. Now claim-first:
// insertOne happens before any side effect runs, relying on the unique
// index on event_id to make a concurrent/replayed claim fail atomically
// (duplicate-key error) rather than needing a separate read step at all.

async function claimWebhookEvent(db: Db, eventId: string, eventType: string): Promise<boolean> {
  try {
    await db.collection('stripe_webhook_events').insertOne({
      event_id: eventId,
      event_type: eventType,
      status: 'processing',
      processed_at: new Date(),
    })
    return true
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false
    throw err
  }
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
  // KEEL-007: created once at registration, not on every webhook request —
  // claimWebhookEvent's atomicity depends on this index existing.
  db.collection('stripe_webhook_events').createIndex({ event_id: 1 }, { unique: true }).catch(() => {})
  // Promo redemption rate-limit reads — was being created inside the
  // request path on every redemption attempt.
  db.collection('promo_rate_limits').createIndex({ tenant_id: 1, attempted_at: 1 }).catch(() => {})

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

      // Remediation item 23: only `starter` ("Keel Plus") is actually for
      // sale — growth/enterprise entries in PLAN_PRICES are placeholder
      // strings, so a checkout request for either used to sail past the
      // getStripePriceId lookup and die inside Stripe with a 500. Reject
      // them explicitly until real products exist for those tiers.
      if (plan !== 'starter') {
        return reply.status(400).send({ error: `The ${plan} plan isn't available for purchase` })
      }

      const tenant = await db.collection('tenants').findOne({ tenant_id })
      if (!tenant) {
        return reply.status(404).send({ error: 'Tenant not found' })
      }

      // A live subscription must not check out again — Stripe would
      // happily create a second subscription and bill both. Send them to
      // the portal to manage the existing one instead. The stored id alone
      // isn't proof the subscription is live (a missed subscription.deleted
      // webhook, or churn that predates the id cleanup), so confirm against
      // Stripe and clear the stale id if it's dead there.
      if (tenant['stripe_subscription_id']) {
        const storedSubId = tenant['stripe_subscription_id'] as string
        let liveInStripe = false
        try {
          const existing = await stripe.subscriptions.retrieve(storedSubId)
          liveInStripe = existing.status !== 'canceled' && existing.status !== 'incomplete_expired'
        } catch {
          // Retrieve failed (deleted upstream, wrong key, network) — treat
          // as not live rather than blocking the user from ever resubscribing.
        }
        if (liveInStripe) {
          return reply.status(409).send({
            error: 'An active subscription already exists — manage it from the billing portal',
            code: 'ALREADY_SUBSCRIBED',
          })
        }
        await db.collection('tenants').updateOne(
          { tenant_id },
          { $unset: { stripe_subscription_id: '' } },
        )
      }

      // M6: Resolve price ID based on tenant's billing currency
      const currency = String(tenant['billing']?.['currency'] ?? 'GBP')
      const priceId = getStripePriceId(plan, currency)
      if (!priceId) {
        return reply.status(400).send({ error: 'Invalid plan' })
      }

      const appUrl = originApp === 'family'
        ? (process.env['LIFEKEEL_URL'] ?? 'http://localhost:3002')
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
          // Reuse the existing Stripe customer when there is one — passing
          // only customer_email mints a duplicate customer per checkout
          // (e.g. churn → re-subscribe).
          ...(tenant['stripe_customer_id']
            ? { customer: tenant['stripe_customer_id'] as string }
            : { customer_email: tenant['contact_email'] || undefined }),
          metadata: {
            tenant_id,
            plan,
          },
          // tenant_id on the subscription itself — customer.subscription.*
          // events don't carry checkout-session metadata, so this lets the
          // webhook resolve the tenant even if checkout.session.completed
          // never arrived.
          subscription_data: {
            metadata: { tenant_id, plan },
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
        // SDK 22 / Basil: current_period_end moved off the Subscription
        // onto its items — read it there, falling back to the legacy
        // top-level field for events serialized by an older API version.
        const periodEnd =
          sub.items?.data?.[0]?.current_period_end ??
          (sub as unknown as { current_period_end?: number }).current_period_end ??
          null
        subscription = {
          id: sub.id,
          status: sub.status,
          current_period_end: periodEnd,
          cancel_at_period_end: sub.cancel_at_period_end,
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
      // Read from the validated config var (LIFEKEEL_STRIPE_WEBHOOK_SECRET),
      // with fallback to the legacy name for backward compatibility
      const webhookSecret = process.env['LIFEKEEL_STRIPE_WEBHOOK_SECRET'] ?? process.env['STRIPE_WEBHOOK_SECRET']

      if (!sig || !webhookSecret) {
        return reply.status(400).send({ error: 'Webhook signature required' })
      }

      // Signature verification and event processing are separate failure
      // domains — a handler throwing must not be reported to Stripe as a
      // bad signature (400 tells Stripe not to retry and logs the wrong
      // metric), so they get their own try blocks.
      const rawBody = (req as any).rawBody || JSON.stringify(req.body)
      let event: Stripe.Event
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
      } catch (error) {
        app.log.error(error)
        recordWebhookError('signature')
        return reply.status(400).send({ error: 'Webhook signature verification failed' })
      }

      // KEEL-007: claim before any side effect runs — see claimWebhookEvent's
      // doc comment. A false return means either a genuine replay or a
      // concurrent delivery of the same event; either way, this call
      // must not re-apply the switch below. Trade-off, deliberate: if the
      // switch below throws partway through, the event is already
      // claimed, so Stripe's automatic retry will be treated as a no-op
      // duplicate rather than reprocessing — a stuck event needs manual
      // investigation instead of silently retrying. For billing, a stuck
      // webhook that pages someone is preferable to one that might
      // silently double-grant credits or double-record a ledger entry.
      try {
        if (!(await claimWebhookEvent(db, event.id, event.type))) {
          return { received: true, duplicate: true }
        }
      } catch (error) {
        // Non-duplicate claim failure (e.g. Mongo down) — 500 so Stripe retries.
        app.log.error(error)
        recordWebhookError('claim')
        return reply.status(500).send({ error: 'Webhook claim failed' })
      }

      const audit = getAuditLogger()

      try {
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

              // A plan grant tops the balance up, never reduces it — pack,
              // promo, and referral credits the tenant already holds survive
              // the upgrade.
              const oldBalance = Number(tenant?.['billing']?.['credits_balance'] ?? 0)
              const newBalance = planBilling.credits_balance === Number.MAX_SAFE_INTEGER
                ? planBilling.credits_balance
                : Math.max(oldBalance, planBilling.credits_balance)

              await db.collection('tenants').updateOne(
                { tenant_id },
                {
                  $set: {
                    stripe_customer_id: session.customer as string,
                    stripe_subscription_id: session.subscription as string,
                    plan,
                    quotas: PLAN_QUOTAS[plan],
                    status: 'active',
                    'billing.credits_balance': newBalance,
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

              // Record in the append-only credit ledger. The amount is the
              // actual balance movement, not the nominal grant — the ledger
              // is summed for reconciliation, and recording the full grant
              // when the balance only moved by the delta false-flags every
              // upgrade/renewal where the tenant held prior credits.
              const delta = newBalance === Number.MAX_SAFE_INTEGER ? 0 : newBalance - oldBalance
              if (delta !== 0) {
                await recordLedgerEntry(db, {
                  tenantId: tenant_id,
                  type: 'plan_grant',
                  amount: delta,
                  reference: plan,
                  reason: `Plan upgraded to ${plan} via Stripe checkout`,
                  actor: 'stripe_webhook',
                }).catch(() => {})
              }
            }
            break
          }

          case 'customer.subscription.updated': {
            const subscription = event.data.object as Stripe.Subscription
            // Resolve by stored subscription id, falling back to the
            // subscription-level tenant_id metadata set at checkout —
            // covers subscriptions whose checkout.session.completed event
            // never arrived.
            const tenant = await db.collection('tenants').findOne({
              $or: [
                { stripe_subscription_id: subscription.id },
                ...(subscription.metadata?.['tenant_id']
                  ? [{ tenant_id: subscription.metadata['tenant_id'] }]
                  : []),
              ],
            })
            if (!tenant) break

            const updates: Record<string, unknown> = { updated_at: new Date() }
            // Stripe drives dunning itself; 'past_due'/'unpaid' map onto
            // the same grace-period state invoice.payment_failed sets.
            if ((subscription.status === 'unpaid' || subscription.status === 'past_due') && tenant['status'] !== 'suspended') {
              updates['status'] = 'past_due'
              if (!tenant['billing']?.['payment_failed_at']) {
                updates['billing.payment_failed_at'] = new Date()
              }
            } else if (subscription.status === 'active' && tenant['status'] === 'past_due') {
              updates['status'] = 'active'
              updates['billing.payment_failed_at'] = null
            }
            // Plan sync for subscriptions carrying the checkout metadata —
            // covers a plan change made in the Stripe portal.
            const metaPlan = subscription.metadata?.['plan'] as Plan | undefined
            if (metaPlan && metaPlan in PLAN_QUOTAS && metaPlan !== 'free' && metaPlan !== tenant['plan']) {
              updates['plan'] = metaPlan
              updates['quotas'] = PLAN_QUOTAS[metaPlan]
            }
            // Churn reason capture — Stripe's portal collects
            // cancellation_details (reason enum + free-text feedback) when
            // subscription-cancellation reasons are enabled in the
            // Dashboard. Store whatever Stripe reports so the operator
            // funnel can answer "why are people leaving" — the winback
            // sequence reads the timestamp, not the reason.
            const cancelDetail = subscription.cancellation_details
            if (cancelDetail?.reason || cancelDetail?.feedback) {
              updates['billing.churn_reason'] = cancelDetail.reason ?? null
              if (cancelDetail.feedback) updates['billing.churn_feedback'] = String(cancelDetail.feedback).slice(0, 500)
              updates['billing.cancel_at_period_end'] = subscription.cancel_at_period_end === true
            }
            await db.collection('tenants').updateOne(
              { tenant_id: tenant['tenant_id'] },
              { $set: updates },
            )
            break
          }

          case 'customer.subscription.deleted': {
            const subscription = event.data.object as Stripe.Subscription
            const tenant = await db.collection('tenants').findOne({
              $or: [
                { stripe_subscription_id: subscription.id },
                ...(subscription.metadata?.['tenant_id']
                  ? [{ tenant_id: subscription.metadata['tenant_id'] }]
                  : []),
              ],
            })

            if (tenant) {
              // Downgrade to free plan with free-tier quotas and credits.
              // trial_expired is set because paying means the trial is
              // over — refillFreeTierCredits gates on it, and without this
              // a tenant who upgraded mid-trial could never receive the
              // free monthly refill after churning.
              // cancellation_details is on the deleted subscription too —
              // capture it here so a webhook gap on .updated can't lose
              // the churn reason.
              const cancelDetail = subscription.cancellation_details
              await db.collection('tenants').updateOne(
                { tenant_id: tenant.tenant_id },
                {
                  $set: {
                    plan: 'free',
                    quotas: PLAN_QUOTAS['free'],
                    status: 'active',
                    'billing.credits_included': PLAN_CREDITS['free'],
                    'billing.trial_expired': true,
                    'billing.churned_at': new Date(),
                    ...(cancelDetail?.reason || cancelDetail?.feedback
                      ? {
                          'billing.churn_reason': cancelDetail.reason ?? null,
                          ...(cancelDetail.feedback ? { 'billing.churn_feedback': String(cancelDetail.feedback).slice(0, 500) } : {}),
                        }
                      : {}),
                    updated_at: new Date(),
                  },
                  // Clearing the subscription id lets the free-tier refill
                  // and cycle-reset crons see this tenant again — both
                  // filter on stripe_subscription_id being absent. The
                  // customer id stays so a re-checkout reuses it.
                  $unset: { stripe_subscription_id: '' },
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
            // Only subscription invoices drive dunning state — a failed
            // manual or one-off invoice (e.g. settled outcome charges)
            // must not mark the tenant past_due and start the grace clock.
            const failedReason = (invoice as { billing_reason?: string | null }).billing_reason
            if (failedReason && !failedReason.startsWith('subscription')) break

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
            // Only subscription invoices drive the credit cycle — a
            // successful manual/one-off invoice must not reset the billing
            // period or top up credits early.
            const paidReason = (invoice as { billing_reason?: string | null }).billing_reason
            if (paidReason && !paidReason.startsWith('subscription')) break

            const tenant = await db.collection('tenants').findOne({
              stripe_customer_id: invoice.customer as string,
            })

            if (tenant) {
              // H1 fix: Refill credits on successful renewal
              const plan = String(tenant['plan'] ?? 'free') as Plan
              const currency = String(tenant['billing']?.['currency'] ?? 'GBP')
              const planBilling = createPlanBilling(plan, currency)

              // Top up to the plan amount rather than resetting to it —
              // a renewal must not wipe credits the tenant paid for
              // (credit packs, promos, referral rewards).
              const oldBalance = Number(tenant['billing']?.['credits_balance'] ?? 0)
              const newBalance = planBilling.credits_balance === Number.MAX_SAFE_INTEGER
                ? planBilling.credits_balance
                : Math.max(oldBalance, planBilling.credits_balance)

              await db.collection('tenants').updateOne(
                { tenant_id: tenant.tenant_id },
                {
                  $set: {
                    status: 'active',
                    'billing.credits_balance': newBalance,
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

              // Record in the append-only credit ledger — the actual
              // balance delta, not the nominal grant (see checkout grant
              // above for why).
              const delta = newBalance === Number.MAX_SAFE_INTEGER ? 0 : newBalance - oldBalance
              if (delta !== 0) {
                await recordLedgerEntry(db, {
                  tenantId: tenant.tenant_id as string,
                  type: 'plan_grant',
                  amount: delta,
                  reference: plan,
                  reason: `Credits topped up on ${plan} renewal`,
                  actor: 'stripe_webhook',
                }).catch(() => {})
              }
            }
            break
          }
        }
      } catch (error) {
        // The event is already claimed — Stripe's retry will arrive as a
        // no-op duplicate, so a processing failure must be loud: mark the
        // claim row 'failed' (sweepable) and alert, rather than just
        // logging a metric nobody watches.
        const errMsg = error instanceof Error ? error.message : String(error)
        app.log.error(error)
        await db.collection('stripe_webhook_events').updateOne(
          { event_id: event.id },
          { $set: { status: 'failed', error: errMsg.slice(0, 500), failed_at: new Date() } },
        ).catch(() => {})
        await sendBillingAlert({
          title: 'Stripe webhook processing failed',
          message: `Event ${event.id} (${event.type}) was claimed but threw during processing — Stripe retries arrive as duplicates, so the event needs manual re-delivery after investigation. Error: ${errMsg.slice(0, 300)}`,
          severity: 'critical',
        }).catch(() => {})
        recordWebhookError(event.type)
        return reply.status(500).send({ error: 'Webhook processing failed' })
      }

      await db.collection('stripe_webhook_events').updateOne(
        { event_id: event.id },
        { $set: { status: 'completed' } },
      ).catch(() => {})

      return { received: true }
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
