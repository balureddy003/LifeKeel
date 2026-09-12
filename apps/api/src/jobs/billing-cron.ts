/**
 * Billing cron jobs — runs daily to handle:
 *
 * H3: Outcome charge settlement — aggregates pending outcome_charges per
 *     tenant and creates Stripe invoice items for them.
 * H5: Trial expiration — checks trial_ends_at and downgrades expired trials.
 * H6: Payment failure recovery — downgrades/suspends past_due tenants
 *     after grace period.
 * H4: Billing cycle reset — resets credits_used_this_period when the
 *     billing period ends (for non-Stripe tenants).
 *
 * All jobs are idempotent — safe to run multiple times.
 */

import type { Db } from 'mongodb'
import { createLogger } from '@agentoak/platform'
import Stripe from 'stripe'
import {
  PLAN_QUOTAS,
  PLAN_CREDITS,
  createPlanBilling,
  PAYMENT_GRACE_PERIOD_DAYS,
  PAYMENT_SUSPENSION_DAYS,
  FREE_TIER_MONTHLY_REFILL,
  type Plan,
} from '../billing/billing-constants.js'
import { recordLedgerEntry, reconcileCredits } from '../billing/credit-ledger.js'
import { isBillingV2Enabled } from '../billing/billing-constants.js'
import { sendBillingAlert } from '../billing/billing-alerts.js'

const log = createLogger({ service: 'billing-cron', version: '0.0.0' })

// ── Distributed cron lock ──────────────────────────────────────────────────────
//
// Prevents multiple API instances from running the billing cron simultaneously.
// Uses a MongoDB document as a lock — findOneAndUpdate with an expiry timestamp.
// The lock auto-expires after 5 minutes (in case the process crashes).

const LOCK_TTL_MS = 5 * 60 * 1000

async function acquireCronLock(db: Db): Promise<boolean> {
  const now = new Date()
  const result = await db.collection('cron_locks').findOneAndUpdate(
    { name: 'billing', expires_at: { $lt: now } },
    { $set: { name: 'billing', acquired_at: now, expires_at: new Date(now.getTime() + LOCK_TTL_MS) } },
    { upsert: true, returnDocument: 'after' },
  ) as Record<string, unknown> | null
  return !!result
}

async function releaseCronLock(db: Db): Promise<void> {
  await db.collection('cron_locks').deleteOne({ name: 'billing' }).catch(() => {})
}

// ── H3: Outcome charge settlement ────────────────────────────────────────────

export async function settleOutcomeCharges(db: Db): Promise<{ tenants_processed: number; charges_settled: number }> {
  const stripe = process.env['STRIPE_SECRET_KEY']
    ? new Stripe(process.env['STRIPE_SECRET_KEY'])
    : null

  // Aggregate pending charges per tenant
  const pipeline = [
    { $match: { status: 'pending' } },
    { $group: { _id: '$tenant_id', total_minor: { $sum: '$amount_minor' }, currency: { $first: '$currency' }, charge_ids: { $push: '$_id' } } },
  ]
  const aggregates = await db.collection('outcome_charges').aggregate(pipeline).toArray()

  let tenantsProcessed = 0
  let chargesSettled = 0

  for (const agg of aggregates) {
    const tenantId = String(agg['_id'])
    const totalMinor = Number(agg['total_minor'])
    const currency = String(agg['currency'] ?? 'GBP')
    const chargeIds = agg['charge_ids'] as unknown[] as import('mongodb').ObjectId[]

    if (stripe) {
      // Find the tenant's Stripe customer ID
      const tenant = await db.collection('tenants').findOne({ tenant_id: tenantId })
      const customerId = tenant?.['stripe_customer_id'] as string | undefined

      if (customerId && totalMinor > 0) {
        try {
          // Create a Stripe invoice item for the accumulated charges
          await stripe.invoiceItems.create({
            customer: customerId,
            amount: totalMinor,
            currency: currency.toLowerCase(),
            description: `Outcome credits — ${chargeIds.length} verified outcomes`,
          })
        } catch (err) {
          log.error({ tenant_id: tenantId, err: String(err) }, 'Failed to create Stripe invoice item for outcome charges')
          await sendBillingAlert({
            title: 'Stripe invoice item creation failed',
            message: `Failed to create a Stripe invoice item for outcome charges (${chargeIds.length} charges, ${totalMinor} minor units). Error: ${String(err)}`,
            severity: 'warning',
            tenant_id: tenantId,
          })
          continue // Don't mark as settled if Stripe failed
        }
      }
    }

    // Mark all charges as invoiced
    await db.collection('outcome_charges').updateMany(
      { _id: { $in: chargeIds } },
      { $set: { status: 'invoiced', invoiced_at: new Date() } },
    )

    tenantsProcessed++
    chargesSettled += chargeIds.length
  }

  if (chargesSettled > 0) {
    log.info({ tenants_processed: tenantsProcessed, charges_settled: chargesSettled }, 'Outcome charges settled')
  }

  return { tenants_processed: tenantsProcessed, charges_settled: chargesSettled }
}

// ── H5: Trial expiration ─────────────────────────────────────────────────────

export async function expireTrials(db: Db): Promise<{ expired: number }> {
  const now = new Date()
  // Find tenants whose trial has ended and are still on free plan with active status
  const expiredTenants = await db.collection('tenants').find({
    plan: 'free',
    status: 'active',
    'billing.trial_ends_at': { $lt: now },
    'billing.trial_expired': { $ne: true },
  }).toArray()

  let expired = 0
  for (const tenant of expiredTenants) {
    const tenantId = tenant['tenant_id'] as string
    const currentBalance = Number(tenant['billing']?.['credits_balance'] ?? 0)
    await db.collection('tenants').updateOne(
      { tenant_id: tenantId },
      {
        $set: {
          'billing.trial_expired': true,
          'billing.credits_balance': 0,
          'billing.credits_included': 0,
          updated_at: now,
        },
      },
    )
    // Record in the append-only credit ledger
    if (currentBalance > 0) {
      await recordLedgerEntry(db, {
        tenantId,
        type: 'trial_expiry',
        amount: -currentBalance,
        reference: 'trial_expired',
        reason: 'Trial expired — credits zeroed',
        actor: 'system',
      }).catch(() => {})
    }
    expired++
  }

  if (expired > 0) {
    log.info({ expired }, 'Trials expired')
  }

  return { expired }
}

// ── H6: Payment failure recovery ─────────────────────────────────────────────

export async function recoverPastDueTenants(db: Db): Promise<{ downgraded: number; suspended: number }> {
  const now = new Date()
  const gracePeriodMs = PAYMENT_GRACE_PERIOD_DAYS * 86_400_000
  const suspensionMs = PAYMENT_SUSPENSION_DAYS * 86_400_000

  // Find past_due tenants
  const pastDueTenants = await db.collection('tenants').find({
    status: 'past_due',
    'billing.payment_failed_at': { $exists: true, $ne: null },
  }).toArray()

  let downgraded = 0
  let suspended = 0

  for (const tenant of pastDueTenants) {
    const tenantId = tenant['tenant_id'] as string
    const failedAt = tenant['billing']?.['payment_failed_at'] as Date | undefined
    if (!failedAt) continue

    const elapsed = now.getTime() - new Date(failedAt).getTime()

    if (elapsed >= suspensionMs) {
      // Suspend after suspension period
      const currentBalance = Number(tenant['billing']?.['credits_balance'] ?? 0)
      await db.collection('tenants').updateOne(
        { tenant_id: tenantId },
        {
          $set: {
            status: 'suspended',
            plan: 'free',
            quotas: PLAN_QUOTAS['free'],
            'billing.credits_balance': 0,
            'billing.credits_included': 0,
            updated_at: now,
          },
        },
      )
      // Record in the append-only credit ledger
      if (currentBalance > 0) {
        await recordLedgerEntry(db, {
          tenantId,
          type: 'plan_downgrade',
          amount: -currentBalance,
          reference: 'suspended',
          reason: 'Tenant suspended after payment failure grace period',
          actor: 'system',
        }).catch(() => {})
      }
      suspended++
    } else if (elapsed >= gracePeriodMs) {
      // Downgrade to free after grace period
      const oldBalance = Number(tenant['billing']?.['credits_balance'] ?? 0)
      const newCredits = PLAN_CREDITS['free']
      await db.collection('tenants').updateOne(
        { tenant_id: tenantId },
        {
          $set: {
            plan: 'free',
            quotas: PLAN_QUOTAS['free'],
            'billing.credits_balance': newCredits,
            'billing.credits_included': newCredits,
            updated_at: now,
          },
        },
      )
      // Record in the append-only credit ledger
      const delta = newCredits - oldBalance
      if (delta !== 0) {
        await recordLedgerEntry(db, {
          tenantId,
          type: 'plan_downgrade',
          amount: delta,
          reference: 'downgraded',
          reason: 'Downgraded to free after payment failure grace period',
          actor: 'system',
        }).catch(() => {})
      }
      downgraded++
    }
  }

  if (downgraded > 0 || suspended > 0) {
    log.info({ downgraded, suspended }, 'Past-due tenants processed')
  }

  return { downgraded, suspended }
}

// ── H4: Billing cycle reset (for non-Stripe tenants) ─────────────────────────
//
// Tenants without a Stripe subscription (free plan or manual provisioning)
// don't get the invoice.payment_succeeded webhook to reset their cycle.
// This job resets credits_used_this_period when billing_period_end has passed.

export async function resetBillingCycles(db: Db): Promise<{ reset: number }> {
  const now = new Date()

  // Find tenants whose billing period has ended
  const tenantsToReset = await db.collection('tenants').find({
    'billing.billing_period_end': { $lt: now },
    stripe_subscription_id: { $exists: false },
  }).toArray()

  let reset = 0
  for (const tenant of tenantsToReset) {
    const tenantId = tenant['tenant_id'] as string
    const plan = String(tenant['plan'] ?? 'free') as Plan
    const currency = String(tenant['billing']?.['currency'] ?? 'GBP')
    const planBilling = createPlanBilling(plan, currency)
    const oldBalance = Number(tenant['billing']?.['credits_balance'] ?? 0)

    await db.collection('tenants').updateOne(
      { tenant_id: tenantId },
      {
        $set: {
          'billing.credits_balance': planBilling.credits_balance,
          'billing.credits_used_this_period': 0,
          'billing.billing_period_start': planBilling.billing_period_start,
          'billing.billing_period_end': planBilling.billing_period_end,
          updated_at: now,
        },
      },
    )
    // Record in the append-only credit ledger
    const newBalance = planBilling.credits_balance === Number.MAX_SAFE_INTEGER ? 0 : planBilling.credits_balance
    const delta = newBalance - oldBalance
    if (delta !== 0) {
      await recordLedgerEntry(db, {
        tenantId,
        type: 'cycle_reset',
        amount: delta,
        reference: plan,
        reason: `Billing cycle reset for ${plan} plan`,
        actor: 'system',
      }).catch(() => {})
    }
    reset++
  }

  if (reset > 0) {
    log.info({ reset }, 'Billing cycles reset')
  }

  return { reset }
}

// ── Free tier monthly credit refill ──────────────────────────────────────────
//
// Free tenants (trial expired, no Stripe subscription) get a small monthly
// credit refill to keep the funnel alive. Without this, free users hit 0
// credits after their trial and have no path forward except upgrade or promo
// code — most just churn.
//
// Refills happen on the 1st of each month. The `billing.free_refill_at` field
// tracks when the next refill is due.

export async function refillFreeTierCredits(db: Db): Promise<{ refilled: number }> {
  const now = new Date()

  // Find free tenants whose trial has expired and who are due for a refill
  const tenantsToRefill = await db.collection('tenants').find({
    plan: 'free',
    status: 'active',
    'billing.trial_expired': true,
    stripe_subscription_id: { $exists: false },
    $or: [
      { 'billing.free_refill_at': { $lte: now } },
      { 'billing.free_refill_at': { $exists: false } },
    ],
  }).toArray()

  let refilled = 0
  for (const tenant of tenantsToRefill) {
    const tenantId = tenant['tenant_id'] as string
    const currentBalance = Number(tenant['billing']?.['credits_balance'] ?? 0)

    // Only refill if below the refill amount (don't stack)
    if (currentBalance >= FREE_TIER_MONTHLY_REFILL) {
      // Still update the next refill date
      await db.collection('tenants').updateOne(
        { tenant_id: tenantId },
        { $set: { 'billing.free_refill_at': new Date(now.getFullYear(), now.getMonth() + 1, 1) } },
      )
      continue
    }

    const grantAmount = FREE_TIER_MONTHLY_REFILL - currentBalance
    await db.collection('tenants').updateOne(
      { tenant_id: tenantId },
      {
        $inc: { 'billing.credits_balance': grantAmount },
        $set: {
          'billing.credits_included': FREE_TIER_MONTHLY_REFILL,
          'billing.free_refill_at': new Date(now.getFullYear(), now.getMonth() + 1, 1),
          updated_at: now,
        },
      },
    )

    // Record in the append-only credit ledger
    await recordLedgerEntry(db, {
      tenantId,
      type: 'cycle_reset',
      amount: grantAmount,
      reference: 'free_refill',
      reason: `Free tier monthly credit refill (${FREE_TIER_MONTHLY_REFILL} credits)`,
      actor: 'system',
    }).catch(() => {})

    refilled++
  }

  if (refilled > 0) {
    log.info({ refilled }, 'Free tier credits refilled')
  }

  return { refilled }
}

// ── Orphaned event cleanup ────────────────────────────────────────────────────
//
// If measureAndCharge inserts an outcome_event but the process crashes before
// the credit deduction (or before the cleanup on insufficient balance), the
// orphaned event blocks future charges for that moment (unique index prevents
// re-insertion). This job removes events older than 1 hour that have no
// corresponding credit deduction.

export async function cleanupOrphanedEvents(db: Db): Promise<{ cleaned: number }> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000) // 1 hour ago

  // Find outcome_events older than 1 hour that don't have a corresponding
  // ledger entry (meaning the deduction never happened)
  const orphans = await db.collection('outcome_events').find({
    measured_at: { $lt: cutoff },
    reversed_at: { $exists: false },
  }).toArray()

  let cleaned = 0
  for (const event of orphans) {
    const eventId = event['id'] as string
    const tenantId = event['tenant_id'] as string

    // Check if a ledger entry exists for this event
    const ledgerEntry = await db.collection('credit_ledger').findOne({
      tenant_id: tenantId,
      reference: eventId,
      type: 'outcome_charge',
    })

    if (!ledgerEntry) {
      // No deduction happened — this is an orphan. Delete it.
      await db.collection('outcome_events').deleteOne({ id: eventId }).catch(() => {})
      cleaned++
    }
  }

  if (cleaned > 0) {
    log.info({ cleaned }, 'Orphaned outcome events cleaned up')
  }

  return { cleaned }
}

// ── Reconciliation ──────────────────────────────────────────────────────────────
//
// Daily reconciliation — verifies that the sum of credit ledger entries matches
// the tenant's current credits_balance for all tenants. Logs discrepancies.

export async function runReconciliation(db: Db): Promise<{ checked: number; discrepancies: number }> {
  const tenants = await db.collection('tenants').find({}, { projection: { tenant_id: 1, 'billing.credits_balance': 1 } }).toArray()

  let checked = 0
  let discrepancies = 0

  for (const tenant of tenants) {
    const tenantId = tenant['tenant_id'] as string
    const result = await reconcileCredits(db, { tenantId })
    checked++

    if (!result.reconciled) {
      discrepancies++
      log.error({
        tenant_id: tenantId,
        ledger_sum: result.ledger_sum,
        tenant_balance: result.tenant_balance,
        discrepancy: result.discrepancy,
      }, 'Credit ledger discrepancy detected')
      await sendBillingAlert({
        title: 'Credit ledger reconciliation discrepancy',
        message: `Credit ledger discrepancy detected. Ledger sum: ${result.ledger_sum}, tenant balance: ${result.tenant_balance}, discrepancy: ${result.discrepancy}.`,
        severity: 'critical',
        tenant_id: tenantId,
      })
    }
  }

  if (discrepancies > 0) {
    log.warn({ checked, discrepancies }, 'Credit reconciliation completed with discrepancies')
  } else if (checked > 0) {
    log.info({ checked }, 'Credit reconciliation completed — all balanced')
  }

  return { checked, discrepancies }
}

// ── Combined runner ───────────────────────────────────────────────────────────

export async function runBillingCron(db: Db): Promise<void> {
  // Distributed lock — prevents multiple instances from running simultaneously.
  // Only active when billing v2 is enabled (v1 runs without lock).
  if (isBillingV2Enabled()) {
    const acquired = await acquireCronLock(db)
    if (!acquired) {
      log.info({ reason: 'lock_held' }, 'Billing cron skipped — lock held by another instance')
      return
    }

    try {
      const jobs: Array<{ name: string; fn: () => Promise<unknown> }> = [
        { name: 'settleOutcomeCharges', fn: () => settleOutcomeCharges(db) },
        { name: 'expireTrials', fn: () => expireTrials(db) },
        { name: 'recoverPastDueTenants', fn: () => recoverPastDueTenants(db) },
        { name: 'resetBillingCycles', fn: () => resetBillingCycles(db) },
        { name: 'refillFreeTierCredits', fn: () => refillFreeTierCredits(db) },
        { name: 'cleanupOrphanedEvents', fn: () => cleanupOrphanedEvents(db) },
      ]
      const results = await Promise.allSettled(jobs.map(j => j.fn()))
      for (let i = 0; i < results.length; i++) {
        const result = results[i]!
        if (result.status === 'rejected') {
          const jobName = jobs[i]!.name
          const err = String(result.reason)
          log.error({ job: jobName, err }, 'Billing cron job failed')
          await sendBillingAlert({
            title: `Billing cron job failed: ${jobName}`,
            message: `The billing cron job "${jobName}" threw an error. Error: ${err}`,
            severity: 'critical',
          })
        }
      }
      // Reconciliation runs after all other jobs complete
      await runReconciliation(db).catch(async err => {
        log.error({ err: String(err) }, 'Credit reconciliation failed')
        await sendBillingAlert({
          title: 'Billing cron job failed: runReconciliation',
          message: `Credit reconciliation threw an error. Error: ${String(err)}`,
          severity: 'critical',
        })
      })
    } finally {
      await releaseCronLock(db)
    }
  } else {
    // v1 mode: no lock, no reconciliation, no orphaned event cleanup
    const jobs: Array<{ name: string; fn: () => Promise<unknown> }> = [
      { name: 'settleOutcomeCharges', fn: () => settleOutcomeCharges(db) },
      { name: 'expireTrials', fn: () => expireTrials(db) },
      { name: 'recoverPastDueTenants', fn: () => recoverPastDueTenants(db) },
      { name: 'resetBillingCycles', fn: () => resetBillingCycles(db) },
      { name: 'refillFreeTierCredits', fn: () => refillFreeTierCredits(db) },
    ]
    const results = await Promise.allSettled(jobs.map(j => j.fn()))
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!
      if (result.status === 'rejected') {
        const jobName = jobs[i]!.name
        const err = String(result.reason)
        log.error({ job: jobName, err }, 'Billing cron job failed')
        await sendBillingAlert({
          title: `Billing cron job failed: ${jobName}`,
          message: `The billing cron job "${jobName}" threw an error. Error: ${err}`,
          severity: 'critical',
        })
      }
    }
  }
}
