/**
 * Shared insight persistence — every ingestion path (webhook queue, the
 * cron/poll-driven social & goal-progress detectors, ad-hoc engine.evaluate()
 * calls) should go through this single function so there is exactly one
 * place that decides whether a newly-produced insight is a duplicate of one
 * already open.
 *
 * Every detector rule declares dedup_window_ms (DetectorRuleSchema), but
 * before this it was never actually enforced anywhere: each insight gets a
 * fresh crypto.randomUUID() id at creation (packages/engine/src/detector.ts),
 * and the only "dedup" that existed at any of the three call sites this
 * replaces was a Mongo upsert keyed on that same random id — which can never
 * collide. A recurring condition (e.g. a goal re-evaluated on every KPI cron
 * tick) just piled up a near-duplicate insight every cycle, forever.
 */
import type { Db } from 'mongodb'
import type { Insight } from '@kairos/engine'
import { getTenantCollection } from '@kairos/platform'
import { ensureVerifiedMoments } from './verified-moments.js'
import type { DeliveryRouter } from './delivery/delivery-router.js'

/** Matches DetectorRuleSchema's own default in packages/engine/src/schemas.ts. */
const DEFAULT_DEDUP_WINDOW_MS = 86_400_000

export async function persistAndDeliverInsights(
  db: Db,
  insights: Insight[],
  tenantId: string,
  deliveryRouter?: DeliveryRouter,
): Promise<void> {
  if (insights.length === 0) return

  // Every insight in a batch belongs to the one tenantId passed in (each of
  // the three call sites this replaces processes one tenant at a time), so
  // TenantScopedCollection's automatic tenant_id scoping is a direct fit —
  // no filter here needs (or is allowed) to name a different tenant_id.
  const insightsCol = getTenantCollection<Insight>(db, 'insights', tenantId)

  // An insight is a duplicate when the same rule has already fired for the
  // same entity (a goal, a ticker, a customer — see computeEntityKey in
  // detector.ts) and that earlier insight is still open (state:
  // 'identified') and within its own dedup window. Once a human has acted on
  // it (approved/dismissed) or the window has elapsed, a fresh firing is a
  // genuinely new occurrence and should surface again.
  const dedupMatches = await Promise.all(
    insights.map((insight) => {
      const windowMs = insight.dedup_window_ms ?? DEFAULT_DEDUP_WINDOW_MS
      return insightsCol.findOne({
        detector_id: insight.detector_id,
        rule_id: insight.rule_id,
        entity_key: insight.entity_key ?? '',
        state: 'identified',
        created_at: { $gte: new Date(Date.now() - windowMs) },
      })
    }),
  )
  const newInsights = insights.filter((_, i) => !dedupMatches[i])
  if (newInsights.length === 0) return

  // TenantScopedCollection has no bulkWrite — these upserts are small
  // per-batch (a handful of insights from one detector evaluation, not a
  // high-throughput path), so a scoped updateOne per insight is the direct
  // trade for the isolation guarantee, not a meaningful performance cost.
  await Promise.all(
    newInsights.map((insight) =>
      insightsCol.updateOne({ id: insight.id }, { $setOnInsert: insight }, { upsert: true }),
    ),
  )
  await ensureVerifiedMoments(db, newInsights, tenantId)

  if (deliveryRouter) {
    await Promise.allSettled(
      newInsights.map((insight) =>
        deliveryRouter.deliver(insight as unknown as Record<string, unknown>, tenantId),
      ),
    )
  }
}
