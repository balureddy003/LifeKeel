/**
 * Universal KPI Compute Engine
 *
 * Automatically computes goal KPI current values from the signals collection.
 * Runs nightly at 1am (and on-demand via POST /goals/:id/kpis/recompute).
 *
 * How it works:
 *   For each active goal with signal-source KPIs:
 *     1. Run a MongoDB $match + $group aggregation on the signals collection
 *     2. Write the result to goal_kpi_snapshots
 *     3. Update goal.kpis[n].current
 *     4. If the value changed by > 1%, fire a goal.kpi.updated event
 *        so the engine can evaluate goal-progress detectors
 *
 * KPI aggregation types:
 *   count  — COUNT documents matching signal_types + filter
 *   sum    — SUM field across matching documents
 *   avg    — AVG field across matching documents
 *   last   — most recent value of field
 *   min    — MIN field
 *   max    — MAX field
 *   rate   — COUNT(numerator) / COUNT(denominator) — e.g. churn rate
 *
 * Examples:
 *   overdue invoices:  { signal_types: ['invoice.overdue'], aggregation: 'count' }
 *   MRR:               { signal_types: ['payment.received'], aggregation: 'sum', field: 'data.amount_minor', window_days: 30 }
 *   avg close days:    { signal_types: ['invoice.paid'], aggregation: 'avg', field: 'data.days_to_close' }
 *   churn rate:        { signal_types: ['subscription.cancelled'], aggregation: 'rate',
 *                        denominator_signal_types: ['subscription.created'] }
 *   latest NPS:        { signal_types: ['survey.response'], aggregation: 'avg', field: 'data.score', window_days: 90 }
 */

import type { Db } from 'mongodb'
import type { Engine, Insight } from '@kairos/engine'
import { createLogger } from '@kairos/platform'
import { OutcomeCredits, type KpiLike } from '../billing/outcome-credits.js'
import {
  computeKpiProgress as sharedComputeKpiProgress,
  formatValueForDisplay,
  displayUnitLabel,
  computeSuggestedNewTarget,
  type KpiForProgress,
} from '../goals/progress-compute.js'
import { recordKpiContribution } from '../goals/kpi-source-reconciliation.js'

const log = createLogger({ service: 'kpi-compute', version: '0.0.0' })

// ── KPI Definition types ───────────────────────────────────────────────────────

export type KpiSource = 'signals' | 'external_api' | 'manual'
export type KpiAggregation = 'count' | 'sum' | 'avg' | 'last' | 'min' | 'max' | 'rate'

export interface KpiDefinition {
  metric: string
  label: string
  unit: string
  target: number
  start_value: number
  current: number
  direction: 'increase' | 'decrease'
  /** Where the KPI value comes from */
  source: KpiSource
  // ── signal source config (used when source = 'signals') ──────────────────
  /** Signal types that feed this KPI */
  signal_types?: string[]
  /** MongoDB aggregation to apply */
  aggregation?: KpiAggregation
  /** Dot-path into signal data for sum/avg/last/min/max: e.g. 'data.amount_minor' */
  field?: string
  /** Filtrex filter applied before aggregation: e.g. 'data.days_overdue > 0' */
  filter?: string
  /** Rolling window in days (omit for all-time) */
  window_days?: number
  /** For rate aggregation: the denominator signal types */
  denominator_signal_types?: string[]
  /** Optional filter on the denominator */
  denominator_filter?: string
}

// ── Aggregation result ─────────────────────────────────────────────────────────

interface ComputeResult {
  metric: string
  value: number
  computed_at: Date
  document_count: number
}

interface GoalForKpiCompute {
  id: string
  tenant_id: string
  name: string
  timeline_days: number
  start_date: Date
  target_date?: Date
  kpis?: KpiDefinition[]
}

type KpiInsightHandler = (insights: Insight[], tenantId: string) => Promise<void> | void

// ── KpiComputeEngine ───────────────────────────────────────────────────────────

export class KpiComputeEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private signals:  any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private goals:    any
  // Metrics tracking
  private metrics = {
    totalComputations: 0,
    totalDuration: 0,
    p50Duration: 0,
    p95Duration: 0,
    p99Duration: 0,
    byAggregation: {} as Record<string, { count: number; totalDuration: number; avgDuration: number }>,
    bySignalType: {} as Record<string, { count: number; totalDocs: number }>,
  }

  private readonly outcomeCredits: OutcomeCredits

  constructor(
    private readonly db: Db,
    private readonly engine?: Engine,
    private readonly onInsights?: KpiInsightHandler,
    outcomeCredits?: OutcomeCredits,
  ) {
    this.signals   = db.collection('signals')
    this.goals     = db.collection('goals')
    this.outcomeCredits = outcomeCredits ?? new OutcomeCredits(db)
    this.ensureIndexes()
  }

  private ensureIndexes(): void {
    this.signals.createIndex({ tenant_id: 1, signal_type: 1, created_at: -1 }).catch(() => {})
  }

  // ── Main: run all goals for all tenants ────────────────────────────────────

  async runAll(): Promise<{ goals_processed: number; kpis_updated: number; errors: number }> {
    const activeGoals = await this.goals.find({ status: 'active' }).toArray() as GoalForKpiCompute[]
    let kpisUpdated = 0, errors = 0

    for (const goal of activeGoals) {
      const kpis: KpiDefinition[] = goal.kpis ?? []
      // HOME-01/02/03 rework: batch all KPI computations for this goal,
      // then fire ONE canonical goal.kpi.updated event with the
      // worst-status KPI's data (instead of one event per KPI, which
      // produced contradictory verdicts when KPIs had different paces).
      const changedPayloads: { payload: Record<string, unknown>; status: string; metric: string }[] = []
      for (let i = 0; i < kpis.length; i++) {
        const kpi = kpis[i]
        if (!kpi || kpi.source !== 'signals' || !kpi.signal_types?.length) continue
        try {
          const result = await this.computeKpi(goal.tenant_id, kpi)
          const changed = await this.persist(goal, kpi, result)
          kpisUpdated++
          if (changed) {
            const payload = this.buildGoalProgressPayload(goal, kpi, result.value, kpi.current ?? kpi.start_value ?? 0)
            const status = this.kpiPaceStatus(payload)
            changedPayloads.push({ payload, status, metric: kpi.metric })
          }
        } catch (err) {
          log.warn({ goal_id: goal.id, metric: kpi?.metric, err }, 'KPI computation failed')
          errors++
        }
      }
      // Fire ONE canonical event per goal with the worst-status KPI's data
      if (changedPayloads.length > 0 && this.engine) {
        const canonical = this.pickCanonicalKpi(changedPayloads)
        const evaluation = await this.engine.evaluate({
          event_type: 'goal.kpi.updated',
          tenant_id:  goal.tenant_id,
          event_id:   `kpi_${goal.id}_${canonical.metric}_${Date.now()}`,
          data: { ...canonical.payload, source_metric: canonical.metric, all_kpi_metrics: changedPayloads.map(p => p.metric) },
        })
        if (evaluation.insights.length > 0) {
          await this.onInsights?.(evaluation.insights, goal.tenant_id)
        }
      }
    }

    return { goals_processed: activeGoals.length, kpis_updated: kpisUpdated, errors }
  }

  // ── Run a single goal (on-demand) ─────────────────────────────────────────

  async runGoal(goalId: string, tenantId: string): Promise<ComputeResult[]> {
    const goal = await this.goals.findOne({ id: goalId, tenant_id: tenantId })
    if (!goal) throw new Error(`Goal not found: ${goalId}`)

    const results: ComputeResult[] = []
    const typedGoal = goal as GoalForKpiCompute
    const kpis: KpiDefinition[] = typedGoal.kpis ?? []
    const changedPayloads: { payload: Record<string, unknown>; status: string; metric: string }[] = []

    for (let i = 0; i < kpis.length; i++) {
      const kpi = kpis[i]
      if (!kpi || kpi.source !== 'signals' || !kpi.signal_types?.length) continue
      const result = await this.computeKpi(tenantId, kpi)
      const changed = await this.persist(typedGoal, kpi, result)
      results.push(result)
      if (changed) {
        const payload = this.buildGoalProgressPayload(typedGoal, kpi, result.value, kpi.current ?? kpi.start_value ?? 0)
        const status = this.kpiPaceStatus(payload)
        changedPayloads.push({ payload, status, metric: kpi.metric })
      }
    }
    // Fire ONE canonical event per goal
    if (changedPayloads.length > 0 && this.engine) {
      const canonical = this.pickCanonicalKpi(changedPayloads)
      const evaluation = await this.engine.evaluate({
        event_type: 'goal.kpi.updated',
        tenant_id:  tenantId,
        event_id:   `kpi_${goalId}_${canonical.metric}_${Date.now()}`,
        data: { ...canonical.payload, source_metric: canonical.metric, all_kpi_metrics: changedPayloads.map(p => p.metric) },
      })
      if (evaluation.insights.length > 0) {
        await this.onInsights?.(evaluation.insights, tenantId)
      }
    }

    return results
  }

  // ── Canonical per-goal pace resolver (HOME-01/02/03) ──────────────────────
  // Picks ONE authoritative KPI signal from all changed KPIs for a goal.
  // The "worst" status wins so the user sees the most actionable verdict,
  // not a cherry-picked "ahead of pace" when another KPI is behind.
  // Status severity: stalled > behind > on_track > ahead > achieved
  private kpiPaceStatus(payload: Record<string, unknown>): string {
    const pctComplete = payload['pct_complete'] as number
    const pctTimeElapsed = payload['pct_time_elapsed'] as number
    const pacePerDay = payload['pace_per_day'] as number
    const daysElapsed = payload['days_elapsed'] as number
    const projectedDays = payload['projected_days'] as number | null
    const timelineDays = payload['timeline_days'] as number

    if (pctComplete >= 1.0) return 'achieved'
    if (daysElapsed >= 1 && pacePerDay <= 0) return 'stalled'
    if (daysElapsed >= 1 && pacePerDay > 0 && pctComplete < pctTimeElapsed * 0.75) return 'behind'
    if (daysElapsed >= 1 && projectedDays !== null && projectedDays < timelineDays * 0.7) return 'ahead'
    return 'on_track'
  }

  private pickCanonicalKpi(payloads: { payload: Record<string, unknown>; status: string; metric: string }[]): { payload: Record<string, unknown>; status: string; metric: string } {
    const severity: Record<string, number> = { stalled: 5, behind: 4, on_track: 3, ahead: 2, achieved: 1 }
    return payloads.reduce((worst, current) =>
      (severity[current.status] ?? 0) > (severity[worst.status] ?? 0) ? current : worst,
    )
  }

  // ── Compute a single KPI from signals ─────────────────────────────────────

  async computeKpi(tenantId: string, kpi: KpiDefinition): Promise<ComputeResult> {
    const startTime = performance.now()
    const since = kpi.window_days
      ? new Date(Date.now() - kpi.window_days * 86_400_000)
      : null

    // Base match
    const baseMatch: Record<string, unknown> = {
      tenant_id: tenantId,
      signal_type: { $in: kpi.signal_types! },
    }
    if (since) baseMatch['created_at'] = { $gte: since }

    let result: ComputeResult
    switch (kpi.aggregation ?? 'count') {
      case 'count':    result = await this.aggregateCount(tenantId, kpi, baseMatch); break
      case 'sum':      result = await this.aggregateField(tenantId, kpi, baseMatch, '$sum'); break
      case 'avg':      result = await this.aggregateField(tenantId, kpi, baseMatch, '$avg'); break
      case 'min':      result = await this.aggregateField(tenantId, kpi, baseMatch, '$min'); break
      case 'max':      result = await this.aggregateField(tenantId, kpi, baseMatch, '$max'); break
      case 'last':     result = await this.aggregateLast(tenantId, kpi, baseMatch); break
      case 'rate':     result = await this.aggregateRate(tenantId, kpi, since); break
      default:         result = await this.aggregateCount(tenantId, kpi, baseMatch); break
    }

    // Track metrics
    const duration = performance.now() - startTime
    this.trackMetrics(kpi, result, duration)

    return result
  }

  // ── Track metrics ─────────────────────────────────────────────────────────

  private trackMetrics(kpi: KpiDefinition, result: ComputeResult, duration: number): void {
    this.metrics.totalComputations++
    this.metrics.totalDuration += duration

    // Update percentiles
    if (duration > this.metrics.p99Duration) this.metrics.p99Duration = duration
    if (duration > this.metrics.p95Duration) this.metrics.p95Duration = duration
    if (duration > this.metrics.p50Duration) this.metrics.p50Duration = duration

    // Track by aggregation type
    const agg = kpi.aggregation ?? 'count'
    if (!this.metrics.byAggregation[agg]) {
      this.metrics.byAggregation[agg] = { count: 0, totalDuration: 0, avgDuration: 0 }
    }
    this.metrics.byAggregation[agg].count++
    this.metrics.byAggregation[agg].totalDuration += duration
    this.metrics.byAggregation[agg].avgDuration = this.metrics.byAggregation[agg].totalDuration / this.metrics.byAggregation[agg].count

    // Track by signal type
    if (kpi.signal_types) {
      for (const signalType of kpi.signal_types) {
        if (!this.metrics.bySignalType[signalType]) {
          this.metrics.bySignalType[signalType] = { count: 0, totalDocs: 0 }
        }
        this.metrics.bySignalType[signalType].count++
        this.metrics.bySignalType[signalType].totalDocs += result.document_count
      }
    }
  }

  // ── Get metrics ───────────────────────────────────────────────────────────────

  getMetrics() {
    return {
      ...this.metrics,
      avgDuration: this.metrics.totalComputations > 0 ? this.metrics.totalDuration / this.metrics.totalComputations : 0,
    }
  }

  // ── Reset metrics ─────────────────────────────────────────────────────────────

  resetMetrics(): void {
    this.metrics = {
      totalComputations: 0,
      totalDuration: 0,
      p50Duration: 0,
      p95Duration: 0,
      p99Duration: 0,
      byAggregation: {},
      bySignalType: {},
    }
  }

  // ── COUNT ──────────────────────────────────────────────────────────────────

  private async aggregateCount(
    _tenantId: string,
    kpi: KpiDefinition,
    baseMatch: Record<string, unknown>,
  ): Promise<ComputeResult> {
    const match = await this.applyFilter(baseMatch, kpi.filter)
    const result = await this.signals.countDocuments(match)
    return { metric: kpi.metric, value: result, computed_at: new Date(), document_count: result }
  }

  // ── SUM / AVG / MIN / MAX ──────────────────────────────────────────────────

  private async aggregateField(
    _tenantId: string,
    kpi: KpiDefinition,
    baseMatch: Record<string, unknown>,
    mongoOp: '$sum' | '$avg' | '$min' | '$max',
  ): Promise<ComputeResult> {
    if (!kpi.field) throw new Error(`KPI ${kpi.metric}: 'field' required for ${kpi.aggregation}`)

    const match = await this.applyFilter(baseMatch, kpi.filter)
    // Convert dot-path 'data.amount_minor' to MongoDB '$data.amount_minor'
    const mongoField = `$${kpi.field}`

    const [agg] = await this.signals.aggregate([
      { $match: match },
      { $group: { _id: null, value: { [mongoOp]: mongoField }, count: { $sum: 1 } } },
    ]).toArray() as Array<{ value: number; count: number }>

    return {
      metric: kpi.metric,
      value: Math.round((agg?.value ?? 0) * 100) / 100,
      computed_at: new Date(),
      document_count: agg?.count ?? 0,
    }
  }

  // ── LAST ───────────────────────────────────────────────────────────────────

  private async aggregateLast(
    _tenantId: string,
    kpi: KpiDefinition,
    baseMatch: Record<string, unknown>,
  ): Promise<ComputeResult> {
    if (!kpi.field) throw new Error(`KPI ${kpi.metric}: 'field' required for last`)
    const match = await this.applyFilter(baseMatch, kpi.filter)

    const [doc] = await this.signals
      .find(match, { projection: { [kpi.field]: 1 } })
      .sort({ created_at: -1 })
      .limit(1)
      .toArray() as Array<Record<string, unknown>>

    const value = doc ? this.extractField(doc, kpi.field) : 0
    return { metric: kpi.metric, value: Number(value ?? 0), computed_at: new Date(), document_count: doc ? 1 : 0 }
  }

  // ── RATE ───────────────────────────────────────────────────────────────────

  private async aggregateRate(
    tenantId: string,
    kpi: KpiDefinition,
    since: Date | null,
  ): Promise<ComputeResult> {
    const baseMatch: Record<string, unknown> = { tenant_id: tenantId }
    if (since) baseMatch['created_at'] = { $gte: since }

    const numeratorMatch = await this.applyFilter(
      { ...baseMatch, signal_type: { $in: kpi.signal_types! } },
      kpi.filter,
    )
    const denominatorMatch = await this.applyFilter(
      { ...baseMatch, signal_type: { $in: kpi.denominator_signal_types ?? kpi.signal_types! } },
      kpi.denominator_filter,
    )

    const [numerator, denominator] = await Promise.all([
      this.signals.countDocuments(numeratorMatch),
      this.signals.countDocuments(denominatorMatch),
    ])

    const rate = denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : 0
    return { metric: kpi.metric, value: rate, computed_at: new Date(), document_count: numerator }
  }

  // ── Persist result ─────────────────────────────────────────────────────────

  private async persist(
    goal: GoalForKpiCompute,
    kpi: KpiDefinition,
    result: ComputeResult,
  ): Promise<boolean> {
    const goalId = goal.id
    const tenantId = goal.tenant_id
    const prev = kpi.current ?? kpi.start_value ?? 0
    const changed = prev === 0
      ? result.value !== 0
      : Math.abs(result.value - prev) / Math.abs(prev) > 0.01  // > 1% change

    const reconciliation = await recordKpiContribution(this.db, tenantId, goalId, kpi.metric, {
      value: result.value,
      sourceId: `signals:${[...(kpi.signal_types ?? [])].sort().join(',')}`,
      sourceType: 'connector',
      observedAt: result.computed_at,
      metadata: {
        prev_value: prev,
        document_count: result.document_count,
        aggregation: kpi.aggregation ?? 'count',
      },
    })
    result.value = reconciliation.value

    // Measure outcome credits if an approved insight moved this KPI
    try {
      await this.outcomeCredits.measureAndCharge({
        tenantId,
        goalId,
        kpi: kpi as unknown as KpiLike,
        currentValue: result.value,
      })
    } catch (err) {
      log.warn({ tenant_id: tenantId, goal_id: goalId, metric: kpi.metric, err }, 'Outcome credit measurement failed')
    }

    // HOME-01/02/03 rework: no longer fire the event here — the caller
    // (runAll/runGoal) batches all changed KPIs for a goal and fires ONE
    // canonical event with the worst-status KPI's data, so the user sees
    // a single authoritative verdict instead of one per KPI.
    return changed
  }

  buildGoalProgressPayload(
    goal: GoalForKpiCompute,
    kpi: KpiDefinition,
    value: number,
    prevValue: number,
  ): Record<string, unknown> {
    const now = new Date()
    const startDate = new Date(goal.start_date)
    const timelineDays = Math.max(1, goal.timeline_days)
    const daysElapsedRaw = Math.max(0, (now.getTime() - startDate.getTime()) / 86_400_000)
    const daysElapsed = Math.round(daysElapsedRaw)
    const daysRemaining = Math.max(0, Math.round(timelineDays - daysElapsedRaw))
    const pctTimeElapsed = Math.min(1, Math.max(0, daysElapsedRaw / timelineDays))

    // Gap A4: use the shared computeKpiProgress instead of re-implementing
    // the same math. This inherits the gap A2 fix for decrease-direction
    // KPIs that start below target (no more false "goal achieved" on day one).
    const progress = sharedComputeKpiProgress(
      {
        metric: kpi.metric,
        label: kpi.label,
        unit: kpi.unit,
        target: kpi.target,
        current: value,
        start_value: kpi.start_value,
        direction: kpi.direction,
      } satisfies KpiForProgress,
      startDate,
      timelineDays,
    )

    const pctComplete = progress.pct_complete
    const delta = progress.delta
    const pacePerDay = progress.pace_per_day
    const projectedDays = progress.projected_days
    const totalNeeded = kpi.direction === 'increase'
      ? kpi.target - kpi.start_value
      : kpi.start_value - kpi.target
    const requiredPace = daysRemaining > 0 ? Math.max(0, totalNeeded - delta) / daysRemaining : null
    const requiredPaceMultiplier = requiredPace !== null && pacePerDay > 0
      ? requiredPace / pacePerDay
      : null

    // Gap A1: format minor_currency values as currency strings (£) instead
    // of leaking the raw internal unit name into user-facing insight text.
    // Also provide a display-safe unit label (empty for minor_currency since
    // the value itself is already formatted as £).
    const unitLabel = displayUnitLabel(kpi.unit)
    const targetDisplay = formatValueForDisplay(kpi.target, kpi.unit)
    const currentDisplay = formatValueForDisplay(value, kpi.unit)

    // Gap A3: clamp suggested_new_target to sane bounds per unit type
    // (percent → max 100, ratio → max 1) to prevent nonsensical suggestions
    // like "raise your target to 114 percent."
    const suggestedNewTarget = computeSuggestedNewTarget(kpi.target, kpi.direction, kpi.unit)
    const suggestedNewTargetDisplay = formatValueForDisplay(suggestedNewTarget, kpi.unit)

    return {
      goal_id: goal.id,
      goal_name: goal.name,
      metric: kpi.metric,
      label: kpi.label,
      unit: unitLabel,
      value,
      current: value,
      current_display: currentDisplay,
      prev_value: prevValue,
      target: kpi.target,
      target_display: targetDisplay,
      start_value: kpi.start_value,
      direction: kpi.direction,
      timeline_days: timelineDays,
      days_elapsed: daysElapsed,
      days_remaining: daysRemaining,
      pct_complete: pctComplete,
      pct_complete_percent: Math.round(pctComplete * 1000) / 10,
      pct_time_elapsed: Math.round(pctTimeElapsed * 1000) / 1000,
      pct_time_elapsed_percent: Math.round(pctTimeElapsed * 1000) / 10,
      pace_per_day: Math.round(pacePerDay * 100) / 100,
      required_pace_per_day: requiredPace !== null ? Math.round(requiredPace * 100) / 100 : null,
      required_pace_multiplier: requiredPaceMultiplier !== null
        ? Math.round(requiredPaceMultiplier * 100) / 100
        : null,
      projected_days: projectedDays !== null ? Math.round(projectedDays) : null,
      days_early: projectedDays !== null ? Math.max(0, Math.round(timelineDays - projectedDays)) : 0,
      suggested_new_target: suggestedNewTarget,
      suggested_new_target_display: suggestedNewTargetDisplay,
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Apply a filtrex filter expression to a MongoDB match.
   * Converts simple filtrex comparisons to MongoDB query operators.
   * Complex expressions are rejected rather than silently ignored; incorrect
   * KPI values are worse than a visible configuration error.
   */
  private async applyFilter(
    baseMatch: Record<string, unknown>,
    filter?: string,
  ): Promise<Record<string, unknown>> {
    if (!filter) return baseMatch
    // Simple single-field comparisons: "data.field > value" → { 'data.field': { $gt: value } }
    const simple = /^([\w.]+)\s*(>|>=|<|<=|==|!=)\s*(.+)$/.exec(filter.trim())
    if (simple) {
      const [, field, op, rawVal] = simple
      const val = isNaN(Number(rawVal))
        ? rawVal!.replace(/['"]/g, '')
        : Number(rawVal)
      const mongoOp: Record<string, string> = { '>': '$gt', '>=': '$gte', '<': '$lt', '<=': '$lte', '==': '$eq', '!=': '$ne' }
      return { ...baseMatch, [field!]: { [mongoOp[op!] ?? '$eq']: val } }
    }
    throw new Error(`Unsupported KPI filter expression: ${filter}`)
  }

  private extractField(doc: Record<string, unknown>, dotPath: string): unknown {
    const parts = dotPath.split('.')
    let cur: unknown = doc
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return null
      cur = (cur as Record<string, unknown>)[p]
    }
    return cur
  }
}
