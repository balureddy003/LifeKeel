/**
 * Reading Stripe's cancellation state correctly.
 *
 * Two things differ from what a naive read of the Subscription gives you:
 *
 * 1. Cancelling in the Customer Portal on current API versions sets `cancel_at`
 *    (a timestamp at the end of the paid period) and leaves
 *    `cancel_at_period_end` as `false`. Older versions set the boolean. Either
 *    means "will not renew", so both must be checked or a customer who has
 *    just cancelled is still shown "Renews on …".
 * 2. `cancellation_details.reason` is only *why Stripe cancelled* —
 *    `cancellation_requested`, `payment_failed` or `payment_disputed`. The
 *    customer's answer to the portal survey is `feedback` (an enum such as
 *    `too_expensive`) and their free text is `comment`. A churn report keyed on
 *    `reason` therefore shows every portal cancellation as "cancellation_requested".
 */

export const CANCELLATION_FEEDBACK = [
  'customer_service',
  'low_quality',
  'missing_features',
  'other',
  'switched_service',
  'too_complex',
  'too_expensive',
  'unused',
] as const

const FEEDBACK_SET: ReadonlySet<string> = new Set(CANCELLATION_FEEDBACK)

export interface CancellationDetailsLike {
  reason?: string | null
  feedback?: string | null
  comment?: string | null
}

/** True when the subscription is set to end rather than renew. */
export function willCancel(sub: {
  cancel_at_period_end?: boolean | null
  cancel_at?: number | null
}): boolean {
  return sub.cancel_at_period_end === true || typeof sub.cancel_at === 'number'
}

/**
 * What to store as the churn reason and free-text feedback.
 *
 * `reason` = the survey answer when there is one, otherwise Stripe's own reason
 * (so `payment_failed` is still recorded). `feedback` = the customer's free text.
 * Fixtures and older events that put a free-text string in `feedback` keep
 * working: anything that is not a known survey value is treated as free text.
 */
export function churnFields(d: CancellationDetailsLike | null | undefined): {
  reason: string | null
  feedback: string | null
} {
  if (!d) return { reason: null, feedback: null }
  const fb = d.feedback ? String(d.feedback) : null
  const fbIsEnum = fb !== null && FEEDBACK_SET.has(fb)
  const reason = (fbIsEnum ? fb : null) ?? d.reason ?? null
  const text = d.comment ? String(d.comment) : fb !== null && !fbIsEnum ? fb : null
  return { reason, feedback: text ? text.slice(0, 500) : null }
}
