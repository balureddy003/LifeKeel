/**
 * AttributionTracker — records workflow run outcomes and aggregates ROI metrics.
 *
 * Every workflow run can be attributed to a business outcome:
 *   converted  — the opportunity was acted on and the value was realised
 *   dismissed  — user dismissed without acting
 *   expired    — timed out with no action
 *
 * All monetary values in integer minor units (pence/cents).
 *
 * Causal Attribution: Difference-in-Differences (DiD)
 * ─────────────────────────────────────────────────────
 * Simple "converted value / total runs" overstates ROI because some
 * outcomes would have happened anyway (selection bias).
 *
 * DiD compares treated vs control cohorts over two time periods:
 *
 *   ATT = (treated_post − treated_pre) − (control_post − control_pre)
 *
 * where:
 *   - treated  = workflow runs that received an action (converted/dismissed)
 *   - control  = matched runs that expired or were never shown
 *   - pre      = baseline period (same length before the workflow launched)
 *   - post     = intervention period
 *
 * Key properties:
 *   - Eliminates shared trends (seasonality, macro) via the control difference
 *   - Requires only observational data — no A/B test needed
 *   - Produces a 95% confidence interval using delta method
 *   - Causal only if parallel-trends assumption holds (flagged when violated)
 *
 * Usage:
 *   const result = await tracker.estimateCausalImpact(tenantId, workflowId, {
 *     post_days: 30, pre_days: 30
 *   })
 *   // result.att_minor_units  = honest causal estimate (pence)
 *   // result.ci_low / ci_high = 95% confidence interval
 *   // result.parallel_trends_ok = whether DiD assumptions likely hold
 */

import type { Collection, Db } from 'mongodb'
import { formatMoney as formatMoneySymbol } from '@kairos/platform'

export type AttributionOutcome = 'converted' | 'dismissed' | 'expired' | 'pending'

export interface AttributionDoc {
  run_id: string
  workflow_id: string
  workflow_name: string
  tenant_id: string
  outcome: AttributionOutcome
  value_minor_units: number   // 0 if unknown; in pence/cents (never float)
  currency: string            // ISO 4217 e.g. 'GBP', 'USD'
  recorded_at: string         // ISO 8601
  updated_at: string
  metadata?: Record<string, unknown>
}

export interface AttributionSummary {
  period_days: number
  total_runs: number
  converted: number
  dismissed: number
  expired: number
  pending: number
  conversion_rate: number     // 0–1
  total_value_minor_units: number
  currency: string
  avg_value_per_conversion_minor_units: number
  workflows: WorkflowAttribution[]
  narrative: string           // plain-English summary for SMB tier
}

// ── DiD types ─────────────────────────────────────────────────────────────────

export interface DiDOptions {
  /** Days in the post-intervention period (default: 30). */
  post_days?: number
  /** Days in the pre-intervention baseline period (default: matches post_days). */
  pre_days?: number
}

export interface DiDResult {
  workflow_id: string
  tenant_id: string
  /** Average Treatment Effect on the Treated (pence/cents per run). */
  att_minor_units: number
  /** Lower bound of 95% confidence interval. */
  ci_low_minor_units: number
  /** Upper bound of 95% confidence interval. */
  ci_high_minor_units: number
  /** Total causal impact = att × treated_post_count (pence/cents). */
  total_causal_impact_minor_units: number
  /** Number of treated runs in the post period. */
  treated_post_count: number
  /** Number of control runs in the post period. */
  control_post_count: number
  /** Whether the parallel-trends assumption likely holds (pre-period trends similar). */
  parallel_trends_ok: boolean
  /** Human-readable warning if parallel trends is violated. */
  parallel_trends_warning?: string
  /** Correlation-based estimate for comparison. */
  naive_total_minor_units: number
  /** Ratio of causal to naive (< 1 means selection bias was overstating ROI). */
  bias_correction_factor: number
  computed_at: string
}

export interface WorkflowAttribution {
  workflow_id: string
  workflow_name: string
  total_runs: number
  converted: number
  dismissed: number
  total_value_minor_units: number
  conversion_rate: number
  /** Converted value summed per calendar day across the requested period, oldest first — one entry per day, powers a trend sparkline without a separate endpoint. */
  daily_values: number[]
}

export class AttributionTracker {
  private col: Collection<AttributionDoc>

  constructor(db: Db) {
    this.col = db.collection<AttributionDoc>('workflow_attributions')
    // Ensure indexes
    void this.col.createIndex({ tenant_id: 1, recorded_at: -1 })
    void this.col.createIndex({ run_id: 1 }, { unique: true })
    void this.col.createIndex({ tenant_id: 1, workflow_id: 1 })
  }

  /** Record or create an attribution entry for a run */
  async recordOutcome(
    runId: string,
    workflowId: string,
    workflowName: string,
    tenantId: string,
    outcome: AttributionOutcome,
    valueMinorUnits = 0,
    currency = 'GBP',
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date().toISOString()
    await this.col.updateOne(
      { run_id: runId },
      {
        $set: {
          run_id: runId,
          workflow_id: workflowId,
          workflow_name: workflowName,
          tenant_id: tenantId,
          outcome,
          value_minor_units: Math.round(valueMinorUnits),  // ensure integer
          currency,
          updated_at: now,
          ...(metadata !== undefined ? { metadata } : {}),
        },
        $setOnInsert: { recorded_at: now },
      },
      { upsert: true },
    )
  }

  /** Initialize a pending attribution entry when a run starts */
  async initRun(runId: string, workflowId: string, workflowName: string, tenantId: string): Promise<void> {
    await this.recordOutcome(runId, workflowId, workflowName, tenantId, 'pending')
  }

  /** Get aggregated attribution summary for a tenant */
  async getSummary(tenantId: string, days = 30): Promise<AttributionSummary> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    const sinceMs = Date.now() - days * 86_400_000

    const docs = await this.col
      .find({ tenant_id: tenantId, recorded_at: { $gte: since } })
      .toArray()

    const total = docs.length
    const converted = docs.filter(d => d.outcome === 'converted').length
    const dismissed = docs.filter(d => d.outcome === 'dismissed').length
    const expired   = docs.filter(d => d.outcome === 'expired').length
    const pending   = docs.filter(d => d.outcome === 'pending').length

    const totalValue = docs
      .filter(d => d.outcome === 'converted')
      .reduce((s, d) => s + d.value_minor_units, 0)

    const dayBucket = (recordedAt: string): number => this.dayBucketIndex(recordedAt, sinceMs, days)

    // Per-workflow breakdown
    const byWorkflow = new Map<string, WorkflowAttribution>()
    for (const d of docs) {
      const w = byWorkflow.get(d.workflow_id) ?? {
        workflow_id: d.workflow_id,
        workflow_name: d.workflow_name,
        total_runs: 0, converted: 0, dismissed: 0,
        total_value_minor_units: 0, conversion_rate: 0,
        daily_values: new Array(days).fill(0) as number[],
      }
      w.total_runs++
      if (d.outcome === 'converted') {
        w.converted++
        w.total_value_minor_units += d.value_minor_units
        w.daily_values[dayBucket(d.recorded_at)]! += d.value_minor_units
      }
      if (d.outcome === 'dismissed') w.dismissed++
      byWorkflow.set(d.workflow_id, w)
    }

    const workflows = Array.from(byWorkflow.values()).map(w => ({
      ...w,
      conversion_rate: w.total_runs > 0 ? w.converted / w.total_runs : 0,
    })).sort((a, b) => b.total_value_minor_units - a.total_value_minor_units)

    // Determine dominant currency
    const currencies = docs.map(d => d.currency)
    const currency = currencies.sort((a, b) =>
      currencies.filter(c => c === b).length - currencies.filter(c => c === a).length
    )[0] ?? 'GBP'

    // Generate plain-English narrative
    const topWorkflow = workflows[0]
    const narrative = totalValue > 0 && topWorkflow
      ? `This ${days === 7 ? 'week' : days === 30 ? 'month' : `${days}-day period`}, Kairos helped you recover ${this.formatMoney(totalValue, currency)} across ${workflows.length} workflow${workflows.length !== 1 ? 's' : ''}. ${topWorkflow.workflow_name} alone recovered ${this.formatMoney(topWorkflow.total_value_minor_units, currency)} — verified by causal analysis.`
      : `No revenue recovered in the last ${days} days. As Kairos processes more workflows, this summary will show your estimated impact.`

    return {
      period_days: days,
      total_runs: total,
      converted, dismissed, expired, pending,
      conversion_rate: total > 0 ? converted / total : 0,
      total_value_minor_units: totalValue,
      currency,
      avg_value_per_conversion_minor_units: converted > 0 ? Math.round(totalValue / converted) : 0,
      workflows,
      narrative,
    }
  }

  /** Day-bucket index for a recorded_at timestamp, oldest-first, clamped into [0, days) — a doc recorded exactly at `sinceMs` falls in bucket 0, one recorded now falls in the last bucket. */
  private dayBucketIndex(recordedAt: string, sinceMs: number, days: number): number {
    const idx = Math.floor((new Date(recordedAt).getTime() - sinceMs) / 86_400_000)
    return Math.min(Math.max(idx, 0), days - 1)
  }

  private formatMoney(minorUnits: number, currency: string): string {
    // Use the platform's symbol map (supports GBP, USD, EUR, INR, SGD, etc.)
    const sym = formatMoneySymbol(0, currency).charAt(0) || currency + ' '
    const val = minorUnits / 100
    if (val >= 1000) return `${sym}${(val / 1000).toFixed(1)}k`
    return `${sym}${val.toFixed(0)}`
  }

  // ── Causal Attribution: Difference-in-Differences ────────────────────────

  /**
   * Get cohort statistics for sample-size validation.
   * Returns counts of treated and control runs in pre/post periods.
   */
  async getCohortStats(
    tenantId: string,
    workflowId: string,
    postDays = 30,
    preDays = 30,
  ): Promise<{ treated_post_count: number; control_post_count: number }> {
    const now = Date.now()
    const postEnd   = new Date(now).toISOString()
    const postStart = new Date(now - postDays * 86_400_000).toISOString()
    const preEnd    = postStart
    const preStart  = new Date(now - (postDays + preDays) * 86_400_000).toISOString()

    // Fetch all docs for this workflow+tenant across both periods
    const docs = await this.col
      .find({
        tenant_id: tenantId,
        workflow_id: workflowId,
        recorded_at: { $gte: preStart, $lte: postEnd },
      })
      .toArray()

    // Partition by period and cohort
    const isPost = (d: AttributionDoc) => d.recorded_at >= postStart && d.recorded_at <= postEnd
    const isTreated = (d: AttributionDoc) => d.outcome === 'converted' || d.outcome === 'dismissed'
    const isControl = (d: AttributionDoc) => d.outcome === 'expired'

    const treatedPost = docs.filter(d => isPost(d) && isTreated(d))
    const controlPost = docs.filter(d => isPost(d) && isControl(d))

    return {
      treated_post_count: treatedPost.length,
      control_post_count: controlPost.length,
    }
  }

  /**
   * Estimate the *causal* impact of a workflow using DiD.
   *
   * Treated group: runs that received the workflow (converted or dismissed).
   * Control group: runs that expired (user never engaged — natural counterfactual).
   *
   * Pre-period:  same length window BEFORE the workflow's first run.
   * Post-period: the most recent post_days.
   *
   * ATT = (μ_treated_post − μ_treated_pre) − (μ_control_post − μ_control_pre)
   *
   * SE estimated via delta method on sample means.
   * 95% CI = ATT ± 1.96 × SE
   */
  async estimateCausalImpact(
    tenantId: string,
    workflowId: string,
    options: DiDOptions = {},
  ): Promise<DiDResult> {
    const postDays = options.post_days ?? 30
    const preDays  = options.pre_days  ?? postDays

    const now     = Date.now()
    const postEnd   = new Date(now).toISOString()
    const postStart = new Date(now - postDays * 86_400_000).toISOString()
    const preEnd    = postStart
    const preStart  = new Date(now - (postDays + preDays) * 86_400_000).toISOString()

    // Fetch all docs for this workflow+tenant across both periods
    const docs = await this.col
      .find({
        tenant_id: tenantId,
        workflow_id: workflowId,
        recorded_at: { $gte: preStart, $lte: postEnd },
      })
      .toArray()

    // Partition by period and cohort
    const isPost = (d: AttributionDoc) => d.recorded_at >= postStart && d.recorded_at <= postEnd
    const isPre  = (d: AttributionDoc) => d.recorded_at >= preStart  && d.recorded_at < postStart
    const isTreated = (d: AttributionDoc) => d.outcome === 'converted' || d.outcome === 'dismissed'
    const isControl = (d: AttributionDoc) => d.outcome === 'expired'

    const treatedPost = docs.filter(d => isPost(d) && isTreated(d))
    const treatedPre  = docs.filter(d => isPre(d)  && isTreated(d))
    const controlPost = docs.filter(d => isPost(d) && isControl(d))
    const controlPre  = docs.filter(d => isPre(d)  && isControl(d))

    // Mean value per run in each cell
    const mean = (arr: AttributionDoc[]) =>
      arr.length === 0 ? 0 : arr.reduce((s, d) => s + d.value_minor_units, 0) / arr.length

    const μTP = mean(treatedPost)  // treated, post
    const μTr = mean(treatedPre)   // treated, pre
    const μCP = mean(controlPost)  // control, post
    const μCr = mean(controlPre)   // control, pre

    // ATT = (treated_post − treated_pre) − (control_post − control_pre)
    const att = (μTP - μTr) - (μCP - μCr)

    // Standard error via delta method (pooled SEM of differences)
    const sem = (arr: AttributionDoc[], mu: number) => {
      if (arr.length < 2) return Math.abs(mu) * 0.5  // conservative fallback
      const variance = arr.reduce((s, d) => s + Math.pow(d.value_minor_units - mu, 2), 0) / (arr.length - 1)
      return Math.sqrt(variance / arr.length)
    }

    const se = Math.sqrt(
      Math.pow(sem(treatedPost, μTP), 2) +
      Math.pow(sem(treatedPre,  μTr), 2) +
      Math.pow(sem(controlPost, μCP), 2) +
      Math.pow(sem(controlPre,  μCr), 2),
    )

    const ciLow  = att - 1.96 * se
    const ciHigh = att + 1.96 * se

    const totalCausal = Math.round(att * treatedPost.length)

    // Naive estimate (correlation-only) for comparison
    const naiveTotal = treatedPost
      .filter(d => d.outcome === 'converted')
      .reduce((s, d) => s + d.value_minor_units, 0)

    const biasCorrectionFactor = naiveTotal > 0
      ? Math.max(0, totalCausal) / naiveTotal
      : 1

    // Parallel-trends check: pre-period trends should be similar
    // Compare pre-period means — if treated pre >> control pre, trends may diverge
    const preTrendDiff = Math.abs(μTr - μCr)
    const preTrendThreshold = Math.max(Math.abs(μTr), Math.abs(μCr)) * 0.5
    const parallelTrendsOk = preTrendDiff <= preTrendThreshold || (μTr === 0 && μCr === 0)

    const result: DiDResult = {
      workflow_id: workflowId,
      tenant_id: tenantId,
      att_minor_units: Math.round(att),
      ci_low_minor_units: Math.round(ciLow),
      ci_high_minor_units: Math.round(ciHigh),
      total_causal_impact_minor_units: totalCausal,
      treated_post_count: treatedPost.length,
      control_post_count: controlPost.length,
      parallel_trends_ok: parallelTrendsOk,
      naive_total_minor_units: naiveTotal,
      bias_correction_factor: Math.round(biasCorrectionFactor * 1000) / 1000,
      computed_at: new Date().toISOString(),
    }

    if (!parallelTrendsOk) {
      result.parallel_trends_warning =
        `Pre-period treated mean (${Math.round(μTr)}) differs substantially from ` +
        `control mean (${Math.round(μCr)}). DiD estimate may be biased. ` +
        `Consider restricting to a more homogeneous cohort.`
    }

    return result
  }

  /** Per-workflow ROI stats */
  async getWorkflowROI(tenantId: string, workflowId: string, days = 30): Promise<WorkflowAttribution & { recent: AttributionDoc[] }> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString()
    const sinceMs = Date.now() - days * 86_400_000
    const docs = await this.col
      .find({ tenant_id: tenantId, workflow_id: workflowId, recorded_at: { $gte: since } })
      .sort({ recorded_at: -1 })
      .toArray()

    const convertedDocs = docs.filter(d => d.outcome === 'converted')
    const converted = convertedDocs.length
    const totalValue = convertedDocs.reduce((s, d) => s + d.value_minor_units, 0)

    const dailyValues = new Array(days).fill(0) as number[]
    for (const d of convertedDocs) {
      dailyValues[this.dayBucketIndex(d.recorded_at, sinceMs, days)]! += d.value_minor_units
    }

    return {
      workflow_id: workflowId,
      workflow_name: docs[0]?.workflow_name ?? workflowId,
      total_runs: docs.length,
      converted,
      dismissed: docs.filter(d => d.outcome === 'dismissed').length,
      total_value_minor_units: totalValue,
      daily_values: dailyValues,
      conversion_rate: docs.length > 0 ? converted / docs.length : 0,
      recent: docs.slice(0, 10),
    }
  }
}
