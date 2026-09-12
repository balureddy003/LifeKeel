/**
 * Shared goal-progress computation — the single source of truth for KPI
 * progress, status, and overall goal status.
 *
 * Gap A4 (GOAL_PROGRESS_AND_UX_GAPS.md): three independent computations of
 * "goal progress" existed — one in routes/goals.ts (the API every UI calls),
 * one in jobs/kpi-compute-engine.ts (used only for insight text), and one
 * implicit in the frontend (home/page.tsx reading kpis[0] instead of an
 * aggregate). They disagreed. This module is the consolidation: both
 * backend paths now call these functions instead of re-implementing the
 * same math, and the frontend reads the API's aggregate directly.
 *
 * Gap A2: the `totalNeeded <= 0 ? 1` shortcut was wrong for decrease-direction
 * KPIs that start *better than* their target (the normal, healthy starting
 * state for a risk-limit KPI like drawdown: start_value=0, target=20).
 * For those, totalNeeded = 0 - 20 = -20 <= 0, so pctComplete was force-set
 * to 1 (100%) from day one. The fix: only force 100% when the KPI has
 * actually crossed past its target in the good direction, not whenever
 * totalNeeded is non-positive by construction.
 *
 * Gap A5: STATUS (not pct_complete — Gap A2 already covers that) was still
 * computed by projecting pace_per_day across the goal's full timeline for
 * every KPI alike, which only makes sense for a KPI that genuinely
 * accumulates toward a target over the goal's life (e.g. portfolio value).
 * Percent-unit KPIs in this system are current-state gauges, not
 * accumulators, and that assumption broke two ways on a real account's real
 * goal: a monthly_return_pct of 2.96% against a 20% target was scored
 * 'ahead' — pace-projecting one low reading (2.96 "points" in 32 days) over
 * a 365-day timeline happened to land inside the "ahead" window, even
 * though the return rate itself sits at 15% of target *right now* and a
 * monthly rate doesn't accumulate additively toward next month's number.
 * And a decrease-direction risk ceiling sitting safely under its limit
 * (drawdown 1.25% vs a 20% cap) was scored 'stalled' purely because
 * pace_per_day <= 0 — but "not moving" is exactly what a healthy, unbreached
 * ceiling should do; it isn't a problem to fix. Percent-unit KPIs now get
 * their status from comparing current directly against target instead of
 * from a pace/time projection.
 */

export interface KpiForProgress {
  metric: string
  label: string
  unit: string
  target: number
  current: number
  start_value: number
  direction: 'increase' | 'decrease'
}

export interface KpiProgressResult {
  metric: string
  label: string
  unit: string
  target: number
  current: number
  start_value: number
  direction: 'increase' | 'decrease'
  delta: number
  pct_complete: number
  days_elapsed: number
  days_remaining: number
  pace_per_day: number
  projected_days: number | null
  on_track: boolean
  status: 'achieved' | 'on_track' | 'behind' | 'ahead' | 'stalled' | 'not_started'
}

export type OverallStatus = 'achieved' | 'on_track' | 'behind' | 'ahead' | 'stalled'

/**
 * Computes progress for a single KPI.
 *
 * The pctComplete formula:
 * - For `increase` direction: how far current has moved from start_value
 *   toward target. delta = current - start_value, totalNeeded = target - start_value.
 * - For `decrease` direction: how far current has moved from start_value
 *   toward target. delta = start_value - current, totalNeeded = start_value - target.
 *
 * Gap A2 fix: the old `totalNeeded <= 0 ? 1` shortcut is wrong for decrease-
 * direction KPIs that start below target (e.g. max_drawdown_pct: start=0,
 * target=20). For those, totalNeeded = 0 - 20 = -20, and the shortcut would
 * force pctComplete = 1 from day one. The correct behavior:
 * - If totalNeeded <= 0 AND the current value has already crossed past the
 *   target in the good direction, pctComplete = 1 (genuinely achieved).
 * - If totalNeeded <= 0 but the current value has NOT crossed the target,
 *   pctComplete = 0 (the KPI hasn't needed any progress yet, but isn't
 *   "achieved" — it's in a healthy starting state).
 * - If totalNeeded > 0, pctComplete = clamp(delta / totalNeeded, 0, 1).
 */
export function computeKpiProgress(
  kpi: KpiForProgress,
  startDate: Date,
  timelineDays: number,
): KpiProgressResult {
  const now = new Date()
  const daysElapsed = Math.max(0, (now.getTime() - startDate.getTime()) / 86_400_000)
  const daysRemaining = Math.max(0, timelineDays - daysElapsed)

  const delta = kpi.direction === 'increase'
    ? kpi.current - kpi.start_value
    : kpi.start_value - kpi.current

  const totalNeeded = kpi.direction === 'increase'
    ? kpi.target - kpi.start_value
    : kpi.start_value - kpi.target

  // Gap A2: only force 100% when the KPI has genuinely crossed its target.
  // For decrease-direction KPIs starting below target (totalNeeded < 0),
  // the KPI is in a healthy state but hasn't "achieved" anything — it
  // hasn't had to move at all. Setting pctComplete = 0 in this case means
  // the goal won't falsely fire "goal_achieved" on day one.
  let pctComplete: number
  if (totalNeeded <= 0) {
    // The start/target relationship is inverted (or flat): start_value is
    // already at or past the target. This happens for risk-limit KPIs like
    // max_drawdown_pct (start=0, target=20, direction=decrease) where the
    // healthy starting state is *below* the target.
    //
    // Only count this as "achieved" if the KPI has actually moved in the
    // good direction (delta > 0) — i.e. it started above target and has
    // crossed below it. If delta <= 0, the KPI was already in the healthy
    // zone from the start and hasn't made any progress; pctComplete = 0
    // prevents the false "goal achieved" insight from firing on day one.
    pctComplete = delta > 0 ? 1 : 0
  } else {
    pctComplete = Math.min(1, Math.max(0, delta / totalNeeded))
  }

  const pacePerDay = daysElapsed > 0 ? delta / daysElapsed : 0
  const achieved = pctComplete >= 1
  const projectedDays = pacePerDay > 0 ? totalNeeded / pacePerDay : null

  // See Gap A5 above — percent-unit KPIs are gauges, not accumulators, so
  // their status compares current directly to target rather than
  // pace-projecting across the goal's timeline.
  const isPercentGauge = kpi.unit === 'percent' || kpi.unit === '%'

  let status: KpiProgressResult['status']
  if (achieved) {
    status = 'achieved'
  } else if (daysElapsed < 1) {
    status = 'not_started'
  } else if (isPercentGauge) {
    if (kpi.direction === 'decrease') {
      // Ceiling/limit metric: sitting safely under the limit *is* the
      // healthy state, whether or not it has moved recently.
      status = kpi.current <= kpi.target ? 'on_track' : 'behind'
    } else {
      const ratio = kpi.target > 0 ? kpi.current / kpi.target : 0
      if (ratio >= 0.9) status = 'on_track'
      else if (pacePerDay <= 0) status = 'stalled'
      else status = 'behind'
    }
  } else if (pacePerDay <= 0) {
    status = 'stalled'
  } else if (projectedDays !== null && projectedDays < timelineDays * 0.9) {
    status = 'ahead'
  } else if (projectedDays !== null && projectedDays <= timelineDays * 1.1) {
    status = 'on_track'
  } else {
    status = 'behind'
  }

  return {
    metric: kpi.metric,
    label: kpi.label,
    unit: kpi.unit,
    target: kpi.target,
    current: kpi.current,
    start_value: kpi.start_value,
    direction: kpi.direction,
    delta: Math.round(delta * 100) / 100,
    pct_complete: Math.round(pctComplete * 1000) / 1000,
    days_elapsed: Math.round(daysElapsed),
    days_remaining: Math.round(daysRemaining),
    pace_per_day: Math.round(pacePerDay * 100) / 100,
    projected_days: projectedDays !== null ? Math.round(projectedDays) : null,
    on_track: status === 'on_track' || status === 'ahead' || status === 'achieved',
    status,
  }
}

export function computeOverallStatus(kpiProgresses: KpiProgressResult[]): OverallStatus {
  if (kpiProgresses.every(k => k.status === 'achieved')) return 'achieved'
  if (kpiProgresses.some(k => k.status === 'stalled')) return 'stalled'
  if (kpiProgresses.some(k => k.status === 'behind')) return 'behind'
  if (kpiProgresses.every(k => k.status === 'ahead' || k.status === 'achieved')) return 'ahead'
  return 'on_track'
}

// ── Display formatting helpers (gap A1/A3) ───────────────────────────────────

/**
 * Formats a value for user-facing display based on its unit.
 * Gap A1: 'minor_currency' was being interpolated raw into insight text
 * ("535200 minor_currency"). This formats it as a currency string instead.
 */
export function formatValueForDisplay(value: number, unit: string): string {
  if (unit === 'minor_currency' || unit === 'minor currency units') {
    return `£${(value / 100).toFixed(2)}`
  }
  if (unit === '%' || unit === 'percent' || unit === 'percentage') {
    return `${value}%`
  }
  return String(value)
}

/**
 * Returns a display-safe unit label, or empty string for units that are
 * already formatted into the value (like minor_currency → £, percent → %).
 * Gap A1: 'minor_currency' should not appear in user-facing text at all.
 * Gap A7: 'percentage' (LLM-generated variant of 'percent') also needs
 * suppression — formatValueForDisplay already appends %, so the label
 * must not duplicate it.
 */
export function displayUnitLabel(unit: string): string {
  if (unit === 'minor_currency' || unit === 'minor currency units') {
    return '' // already formatted as £ by formatValueForDisplay
  }
  if (unit === '%' || unit === 'percent' || unit === 'percentage') {
    return '' // already formatted as % by formatValueForDisplay
  }
  return unit
}

/**
 * Computes a suggested new target when a goal is ahead of pace.
 * Gap A3: the old formula applied a flat 1.2× (increase) or 0.8× (decrease)
 * multiplier with no bounds check, producing nonsensical suggestions like
 * "raise your target to 114 percent" for a percent-unit KPI with target 95.
 *
 * Now clamps to a sane upper bound per unit type:
 * - percent: max 100
 * - ratio: max 1
 * - minor_currency: no cap (money is unbounded)
 * - other units: no cap (generic)
 */
export function computeSuggestedNewTarget(
  target: number,
  direction: 'increase' | 'decrease',
  unit: string,
): number {
  const multiplier = direction === 'increase' ? 1.2 : 0.8
  let suggested = Math.round(target * multiplier * 100) / 100

  // Clamp to sane bounds per unit type
  if (unit === 'percent' || unit === 'percentage' || unit === '%') {
    suggested = Math.min(suggested, 100)
  } else if (unit === 'ratio') {
    suggested = Math.min(suggested, 1)
  }

  return suggested
}
