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
import type { Insight } from '@agentoak/engine'
import { getTenantCollection } from '@agentoak/platform'
import { ensureVerifiedMoments } from './verified-moments.js'
import type { DeliveryRouter } from './delivery/delivery-router.js'

/** Matches DetectorRuleSchema's own default in packages/engine/src/schemas.ts. */
const DEFAULT_DEDUP_WINDOW_MS = 86_400_000

// 'identified'/'sent' = still awaiting a human decision. Everything else
// (approved/dismissed/completed/resolved/archived) is closed.
const OPEN_STATES = ['identified', 'sent'] as const

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
  // detector.ts) and either:
  //  - an earlier one for that (rule, entity) is still open — regardless of
  //    how long ago it opened. An unresolved gap needs the human to act on
  //    the one card that already exists, not a sibling. Confirmed live:
  //    "No income protection" still open from five days earlier got a
  //    second, independent "identified" insight the next time the detector
  //    ran, because the OLD dedup check only looked at opens from the last
  //    24h (dedup_window_ms) — anything older didn't count as a match at
  //    all, so a still-true, never-dismissed gap silently grew a fresh
  //    duplicate every time the window lapsed, forever.
  //  - or one was closed (approved/dismissed/resolved/…) recently, within
  //    its own dedup window — the "give it a beat before re-nagging" case
  //    the window always meant to cover.
  // Sequential, not Promise.all: batches are a handful of insights (one
  // detector's rules), and two insights in the same batch can share a key
  // (e.g. two rules on the same entity) — checking one at a time means a
  // duplicate created earlier in this very loop is already visible via
  // openMatches to the next check, instead of racing on a stale read.
  const newInsights: Insight[] = []
  for (const insight of insights) {
    const key = { detector_id: insight.detector_id, rule_id: insight.rule_id, entity_key: insight.entity_key ?? '' }

    const openMatches = await insightsCol
      .find({ ...key, state: { $in: OPEN_STATES } })
      .sort({ created_at: -1 })
      .toArray()

    if (openMatches.length > 0) {
      // Self-heal pre-existing duplicates (created before this fix
      // shipped, or from a race) down to the single newest one, instead of
      // requiring a one-off migration — collapses on the next evaluation
      // that touches this (rule, entity) pair.
      if (openMatches.length > 1) {
        const staleIds = openMatches.slice(1).map((m: Insight) => m.id)
        await insightsCol.updateMany(
          { id: { $in: staleIds } },
          { $set: { state: 'resolved', resolved_at: new Date(), resolved_reason: 'duplicate' } },
        )
      }
      continue
    }

    const windowMs = insight.dedup_window_ms ?? DEFAULT_DEDUP_WINDOW_MS
    const recentlyClosed = await insightsCol.findOne({
      ...key,
      state: { $nin: OPEN_STATES },
      created_at: { $gte: new Date(Date.now() - windowMs) },
    })
    if (recentlyClosed) continue

    newInsights.push(insight)
  }
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

/**
 * PRD-107: an insight otherwise only closes via explicit approve/dismiss,
 * or the dedup window elapsing (after which a still-true condition just
 * re-fires the same insight, never actually resolving it) — so a family
 * that fixes a real gap and updates their profile keeps seeing the old
 * alert forever. Call once per detector, per evaluation cycle, with the
 * rule ids that detector's full YAML rule set includes (engine.inventory())
 * and the (rule_id, entity_key) pairs that actually fired this cycle
 * across all of that detector's sub-evaluations.
 *
 * Resolution is entity-aware: an open insight is stale only when its own
 * (rule_id, entity_key) pair didn't reproduce. Per-entity events
 * (a roster member's income protection, a child's education fund) carry
 * member_id/child_name keys — so "child A's insight" stays open while
 * "child B's" resolves when only B's fund was fixed. Insights whose
 * entity_key is '' resolve at rule granularity, same as before.
 */
export async function resolveStaleInsights(
  db: Db,
  tenantId: string,
  detectorId: string,
  checkedRuleIds: string[],
  firedEntities: Array<{ rule_id: string; entity_key: string }>,
): Promise<void> {
  const checked = new Set(checkedRuleIds)
  const fired = new Set(firedEntities.map((e) => `${e.rule_id}${e.entity_key}`))
  if (checked.size === 0) return

  const insightsCol = getTenantCollection<Insight>(db, 'insights', tenantId)
  const open: Insight[] = await insightsCol.find({
    detector_id: detectorId,
    rule_id: { $in: checkedRuleIds },
    state: { $in: OPEN_STATES },
  }).toArray()

  const staleIds = open
    .filter((i) => !fired.has(`${i.rule_id}${i.entity_key ?? ''}`))
    .map((i) => i.id)
  if (staleIds.length === 0) return

  await insightsCol.updateMany(
    { id: { $in: staleIds } },
    { $set: { state: 'resolved', resolved_at: new Date() } },
  )
}
