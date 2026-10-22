/**
 * Account deletion ends billing (R09).
 *
 * Deletion marks the tenant 'deleting' and sets `billing.cancellation_pending`
 * before anything else, so a failed Stripe call is never forgotten: the
 * nightly erasure replay calls this again until it succeeds. Cancelling an
 * already-cancelled subscription is treated as success, so retries are safe.
 */
import type { Db } from 'mongodb'
import Stripe from 'stripe'
import { createLogger } from '@lifekeel/platform'

const log = createLogger({ service: 'billing-cancel-on-delete', version: '0.0.0' })

/** Tenant states a payment webhook must never move a tenant out of. */
export const TERMINAL_TENANT_STATUSES = ['deleting', 'deleted'] as const

let client: Stripe | null | undefined
function stripeClient(): Stripe | null {
  if (client === undefined) {
    client = process.env['STRIPE_SECRET_KEY'] ? new Stripe(process.env['STRIPE_SECRET_KEY']) : null
  }
  return client
}

export async function markCancellationPending(db: Db, tenantId: string): Promise<void> {
  await db
    .collection('tenants')
    .updateOne(
      { tenant_id: tenantId, stripe_subscription_id: { $exists: true, $ne: null } },
      { $set: { 'billing.cancellation_pending': true } },
    )
}

/** Returns true once nothing is left to cancel for this tenant. */
export async function cancelSubscriptionForDeletedTenant(
  db: Db,
  tenantId: string,
  stripe: Stripe | null = stripeClient(),
): Promise<boolean> {
  const tenant = await db.collection('tenants').findOne({ tenant_id: tenantId })
  const subscriptionId = tenant?.['stripe_subscription_id'] as string | undefined
  if (!subscriptionId) {
    if (tenant?.['billing']?.['cancellation_pending']) {
      await db
        .collection('tenants')
        .updateOne({ tenant_id: tenantId }, { $unset: { 'billing.cancellation_pending': '' } })
    }
    return true
  }
  if (!stripe) {
    log.error({ tenant_id: tenantId }, 'Deleted tenant still has a subscription but Stripe is not configured')
    return false
  }
  try {
    await stripe.subscriptions.cancel(subscriptionId, undefined, {
      idempotencyKey: `delete-${tenantId}-${subscriptionId}`,
    })
  } catch (err) {
    const code = (err as { code?: string }).code
    const alreadyGone = code === 'resource_missing' || /canceled/i.test(String((err as Error).message))
    if (!alreadyGone) {
      log.error({ err, tenant_id: tenantId }, 'Subscription cancellation failed; will retry')
      return false
    }
  }
  await db.collection('tenants').updateOne(
    { tenant_id: tenantId },
    {
      $set: { 'billing.cancelled_for_deletion_at': new Date(), plan: 'free' },
      $unset: { stripe_subscription_id: '', 'billing.cancellation_pending': '' },
    },
  )
  return true
}
