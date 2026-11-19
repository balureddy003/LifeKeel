/**
 * Delivery-retry worker — the second half of persist-then-deliver.
 *
 * persistAndDeliverInsights upserts an insight (state:'identified') and then
 * calls DeliveryRouter.deliver() inline. A crash between the two — or a
 * transient provider failure that exhausted every channel — leaves the row
 * durable but never delivered, and nothing retried it: the escalation worker
 * only looks at state:'sent', and drainDeliveryQueue only serves rows the
 * escalation worker writes. This worker resumes the *normal* deliver() path
 * (prefs → urgency floor → quiet hours → judge → budget → per-channel dedup),
 * so a retry can never bypass a gate the first attempt would have hit.
 *
 * Claiming mirrors EscalationWorker (KEEL-003), with one extra twist: the
 * retry count alone cannot exclude concurrent claimants (count 1 < cap is
 * true for two racing workers at once). So the claim is a lease — the atomic
 * findOneAndUpdate only matches when delivery_retry_at is absent or older
 * than one cron cycle — which both single-claims each insight and throttles
 * successive runs. The count cap bounds retries of genuinely undeliverable
 * alerts (no reachable channel at all) so they stop after MAX_RETRIES
 * instead of being re-claimed every cycle forever.
 */

import type { Db } from 'mongodb'
import type { DeliveryRouter } from '../delivery/delivery-router.js'

/** Older than one 15-minute cron cycle — the first attempt had time to run. */
const RETRY_DELAY_MS = 15 * 60_000
/** Older than this the alert is stale; delivering it now is worse than not. */
const MAX_AGE_MS = 48 * 3_600_000
const MAX_RETRIES = 3
const BATCH_LIMIT = 50

export class DeliveryRetryWorker {
  constructor(
    private readonly db: Db,
    private readonly router: Pick<DeliveryRouter, 'deliver'>,
  ) {}

  /** Claimable right now: unclaimed, or the last claim expired a cycle ago. */
  private claimableFilter(now: Date) {
    return {
      $and: [
        {
          $or: [
            { delivery_retry_at: { $exists: false } },
            { delivery_retry_at: { $lte: new Date(now.getTime() - RETRY_DELAY_MS) } },
          ],
        },
        {
          $or: [
            { delivery_retry_count: { $exists: false } },
            { delivery_retry_count: { $lt: MAX_RETRIES } },
          ],
        },
      ],
    }
  }

  async run(now = new Date()): Promise<{
    claimed: number
    delivered: number
    failed: number
    gated: number
  }> {
    const insights = this.db.collection('insights')
    const claimable = this.claimableFilter(now)
    const candidates = await insights
      .find({
        state: 'identified',
        created_at: {
          $lte: new Date(now.getTime() - RETRY_DELAY_MS),
          $gte: new Date(now.getTime() - MAX_AGE_MS),
        },
        ...claimable,
      })
      .sort({ created_at: 1 })
      .limit(BATCH_LIMIT)
      .toArray()

    let claimed = 0
    let delivered = 0
    let failed = 0
    let gated = 0
    for (const insight of candidates) {
      const claim = await insights.findOneAndUpdate(
        { _id: insight['_id'], state: 'identified', ...claimable },
        { $set: { delivery_retry_at: now }, $inc: { delivery_retry_count: 1 } },
      )
      if (!claim) continue
      claimed++
      try {
        const result = await this.router.deliver(
          insight as Record<string, unknown>,
          insight['tenant_id'] as string,
        )
        // deliver() returns null for every correctly-gated path (quiet
        // hours → digest, urgency floor, budget deny) — not a failure.
        // A DeliveryResult with success:false is every channel tried and
        // failed: the case this worker exists for, so count it honestly.
        if (result === null) gated++
        else if (result.success) delivered++
        else failed++
      } catch {
        // deliver() throwing leaves the retry count already incremented —
        // bounded retries, never a stuck row hammering a broken provider.
        failed++
      }
    }
    return { claimed, delivered, failed, gated }
  }
}
