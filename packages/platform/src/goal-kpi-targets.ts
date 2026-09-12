/**
 * Goal KPI Targets — makes detector suggestions goal-aware.
 *
 * Detector rules previously hardcoded thresholds (e.g. "flag positions over
 * 10% of portfolio") with no way to reflect what a specific tenant actually
 * asked for in their goal (e.g. a goal that caps concentration at 15%
 * instead). This builds a flat `metric -> target` map from the tenant's
 * active goal(s) and merges it over a set of built-in defaults, so every
 * known metric always resolves to *some* number — a detector condition can
 * safely reference `context.goal_kpi_targets['metric_name']` without an
 * existence check, whether or not the tenant has an active goal.
 *
 * Shared between apps/api (real-time event ingestion) and
 * packages/pipeline's ConnectorSyncEngine (connector-driven sync) so both
 * paths inject the same context the same way — see EvaluationContext.goal_kpi_targets.
 *
 * Gap #32 (TRADING_ENGINE_GAPS.md): buildGoalContext also returns a
 * `goal_id_by_metric` map so the detector can thread `goal_id` into
 * `feature_snapshot`, creating the durable link from insight → goal that
 * was previously missing.
 */

import { getTenantCollection } from './tenant-scoped-collection.js'

// Minimal structural typing — avoids a hard dependency on the mongodb driver,
// matching the existing convention in packages/pipeline/src/connector-sync-engine.ts.
type MinimalDb = { collection: (name: string) => { find: (filter: Record<string, unknown>) => { toArray: () => Promise<unknown[]> } } }

interface GoalKpiLike {
  metric?: unknown
  target?: unknown
}

type GoalDocLike = Record<string, unknown> & {
  status?: unknown
  kpis?: unknown
  id?: unknown
}

/** Built-in fallback targets for the Trading & Investment vertical's detectors. */
export const DEFAULT_GOAL_KPI_TARGETS: Record<string, number> = {
  portfolio_concentration_max_pct: 10,
  portfolio_dividend_yield_pct: 3.5,
  portfolio_net_yield_pct: 6.5,
  // Not yet a KPI any shipped goal template declares — exists so
  // trading_rebalance_suggestion has a stable default until a goal opts in.
  cash_allocation_max_pct: 5,
  // Controlled by the tenant's goal; default 5% matches the previous hardcoded rule.
  price_drop_alert_threshold_pct: 5,
}

/**
 * Flattens metric -> target across every active goal for a tenant, merged
 * over DEFAULT_GOAL_KPI_TARGETS so referenced keys are never missing.
 */
export async function buildGoalKpiTargets(db: MinimalDb, tenantId: string): Promise<Record<string, number>> {
  const { targets } = await buildGoalContext(db, tenantId)
  return targets
}

/**
 * Gap #32: Returns both the KPI targets (metric → target) and the goal_id
 * mapping (metric → goal_id) for a tenant's active goals. The goal_id
 * mapping lets the detector thread `goal_id` into `feature_snapshot`,
 * creating the durable link from insight → goal that was previously missing.
 *
 * Default targets (from DEFAULT_GOAL_KPI_TARGETS) have no associated goal_id
 * — they're built-in fallbacks, not from any tenant goal.
 */
export interface GoalContext {
  targets: Record<string, number>
  /** metric → goal_id for targets that came from a tenant's active goal. */
  goal_id_by_metric: Record<string, string>
}

export async function buildGoalContext(db: MinimalDb, tenantId: string): Promise<GoalContext> {
  const targets: Record<string, number> = { ...DEFAULT_GOAL_KPI_TARGETS }
  const goalIdByMetric: Record<string, string> = {}

  try {
    const goals = await getTenantCollection<GoalDocLike>(db, 'goals', tenantId)
      .find({ status: 'active' })
      .toArray() as GoalDocLike[]

    for (const goal of goals) {
      const goalId = typeof goal.id === 'string' ? goal.id : undefined
      const kpis = Array.isArray(goal.kpis) ? goal.kpis as GoalKpiLike[] : []
      for (const kpi of kpis) {
        if (typeof kpi.metric === 'string' && typeof kpi.target === 'number') {
          targets[kpi.metric] = kpi.target
          if (goalId) goalIdByMetric[kpi.metric] = goalId
        }
      }
    }
  } catch {
    // Lookup failure falls back to defaults — never blocks detector evaluation.
  }

  return { targets, goal_id_by_metric: goalIdByMetric }
}
