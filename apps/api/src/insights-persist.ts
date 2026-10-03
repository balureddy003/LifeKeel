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
import { buildDedupeKey, emitReadinessEvent } from './feed/emit.js'
import { DETECTOR_TO_COMPONENT } from './routes/family-readiness.js'

// Feed domain for an insight: the detector→component map, except debt
// which is its own feed domain rather than folding into emergency_fund.
function insightDomain(detectorId: string): string | null {
  if (detectorId === 'family_debt_health') return 'debt'
  return DETECTOR_TO_COMPONENT[detectorId] ?? null
}

// PRD-136: narrate the insight lifecycle into the readiness feed. Shared
// by insight_opened/insight_repeated/insight_resolved; emitReadinessEvent
// is fire-and-forget so this never affects the persist path.
function emitInsightEvent(
  db: Db,
  tenantId: string,
  insight: Insight,
  type: 'insight_opened' | 'insight_repeated' | 'insight_resolved',
): void {
  try {
    const urgency = insight.urgency
    emitReadinessEvent(db, tenantId, {
      type,
      severity:
        type === 'insight_resolved'
          ? 'info'
          : type === 'insight_repeated' || urgency === 'high' || urgency === 'critical'
            ? 'attention'
            : 'notice',
      direction: type === 'insight_resolved' ? 'up' : null,
      member_id: (insight as { member_id?: string }).member_id ?? null,
      domain: insightDomain(insight.detector_id),
      title: (insight.hypothesis ?? insight.rule_id.replace(/_/g, ' ')).slice(0, 120),
      summary: (insight.reasoning ?? '').slice(0, 280),
      evidence: [],
      links: [{ kind: 'insight', id: insight.id }],
      next_check_at: null,
      dedupe_key: buildDedupeKey(type, insight.id),
    })
  } catch {
    // Bookkeeping, not behavior — same posture as emitReadinessEvent itself.
  }
}

/** Matches DetectorRuleSchema's own default in packages/engine/src/schemas.ts. */
const DEFAULT_DEDUP_WINDOW_MS = 86_400_000

// Human-readable labels for feature_snapshot fields that move between
// firings — keeps the "what changed" list out of raw_field_name territory.
const FEATURE_FIELD_LABELS: Record<string, string> = {
  monthly_salary_minor: 'monthly income',
  income_protection_monthly_minor: 'income protection',
  life_cover_minor: 'life cover',
  mortgage_outstanding_minor: 'outstanding mortgage',
  annual_living_expenses_minor: 'living expenses',
  emergency_savings_minor: 'emergency savings',
  monthly_expenses_minor: 'monthly expenses',
  monthly_debt_payments_minor: 'monthly debt payments',
  pension_balance_minor: 'pension balance',
  monthly_contribution_minor: 'pension contribution',
  current_savings_minor: 'fund balance',
  target_savings_minor: 'fund target',
  years_remaining: 'years remaining',
  monthly_surplus_minor: 'monthly surplus',
  has_high_interest_debt: 'high-interest debt',
  high_interest_debt_balance_minor: 'high-interest debt balance',
  employed: 'employment status',
  overlap_count: 'policy count',
  orphaned_policy_count: 'policy attribution',
}

/**
 * Which profile fields moved between the previous firing's snapshot and
 * this one — the "what changed" an adaptive insight names. Capped at 3 so
 * the suffix stays a sentence, not a diff dump. Unknown keys render as a
 * lightly humanized field name rather than being dropped — a changed
 * field the label table doesn't know is still real information.
 */
function diffFeatureFields(
  prev: Record<string, string | number | boolean> | undefined,
  next: Record<string, string | number | boolean> | undefined,
): string[] {
  if (!prev || !next) return []
  const changed: string[] = []
  for (const key of Object.keys(next)) {
    if (prev[key] === undefined || prev[key] === next[key]) continue
    changed.push(FEATURE_FIELD_LABELS[key] ?? key.replace(/_minor$|_/g, ' ').trim())
    if (changed.length === 3) break
  }
  return changed
}

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

    // Adaptive copy (G10): a rule firing again after its last insight was
    // closed (dismissed/resolved) re-announces the same gap with the same
    // template — the 5th fire reads identical to the 1st, which trains
    // families to ignore it. Count prior fires for this (rule, entity)
    // and annotate: the repeat count itself, plus which profile fields
    // moved since the last firing so "what changed" is visible rather
    // than the insight reading as a carbon copy. Deliberately appended
    // after the detector's own reasoning so the rule's neutral,
    // informational voice is untouched.
    const priors = await insightsCol
      .find(key)
      .sort({ created_at: -1 })
      .toArray()
    if (priors.length > 0) {
      const repeatCount = priors.length + 1
      const changed = diffFeatureFields(
        priors[0]!.feature_snapshot as Record<string, string | number | boolean> | undefined,
        insight.feature_snapshot as Record<string, string | number | boolean> | undefined,
      )
      const ordinal = repeatCount === 2 ? 'second' : repeatCount === 3 ? 'third' : `${repeatCount}th`
      const suffix =
        changed.length > 0
          ? ` Oak has flagged this before — this is the ${ordinal} time. Since then: ${changed.join(', ')} changed.`
          : ` Oak has flagged this before — this is the ${ordinal} time. The figures on file are unchanged since the last flag.`
      insight.reasoning = `${insight.reasoning}${suffix}`
      // Stored on the doc (not in the engine schema — engine output is
      // generated per-fire; the count is a persistence-layer concern the
      // client reads for its "Flagged N times" badge).
      ;(insight as Record<string, unknown>).repeat_count = repeatCount
      emitInsightEvent(db, tenantId, insight, 'insight_repeated')
    }

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
  for (const insight of newInsights) {
    if ((insight as Record<string, unknown>).repeat_count === undefined) {
      emitInsightEvent(db, tenantId, insight, 'insight_opened')
    }
  }

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

  const stale = open.filter((i) => !fired.has(`${i.rule_id}${i.entity_key ?? ''}`))
  if (stale.length === 0) return

  await insightsCol.updateMany(
    { id: { $in: stale.map((i) => i.id) } },
    { $set: { state: 'resolved', resolved_at: new Date() } },
  )
  for (const insight of stale) emitInsightEvent(db, tenantId, insight, 'insight_resolved')
}
