import { randomUUID } from 'node:crypto'
import type { Collection, Db } from 'mongodb'

const DAY_MS = 86_400_000

export interface CausalExperiment {
  experiment_id: string
  tenant_id: string
  goal_id: string
  move_id: string
  approved_at: Date
  kpi_snapshot_at_approval: Record<string, number>
  observation_windows: number[]
  synthetic_control_source: 'within_tenant_pre_action'
  created_at: Date
  /** Control group assignment */
  group: 'treatment' | 'control'
  /** Randomization method used */
  randomization_method: 'random' | 'stratified' | 'propensity' | null
  /** Stratification factors (if used) */
  stratification_factors: string[] | null
}

export interface KpiObservation {
  metric: string
  value: number
  recorded_at: Date
}

export interface OutcomeAttribution {
  tenant_id: string
  experiment_id: string
  goal_id: string
  move_id: string
  metric: string
  window_days: number
  observed_delta: number
  counterfactual_delta: number
  attributed_delta: number
  attribution_confidence: number
  confidence_interval: [number, number]
  external_factor_share: number
  insufficient_history: boolean
  computed_at: Date
  /** Statistical significance test result */
  statistical_significance?: {
    p_value: number
    is_significant: boolean
    test_type: 't_test' | 'chi_square' | 'mann_whitney'
    effect_size?: number
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function estimateWithinTenantAttribution(
  experiment: CausalExperiment,
  metric: string,
  history: KpiObservation[],
  windowDays: number,
  asOf = new Date(),
): OutcomeAttribution {
  const approvedAt = experiment.approved_at.getTime()
  const baseline = experiment.kpi_snapshot_at_approval[metric] ?? 0
  const pre = history
    .filter(point => point.metric === metric && point.recorded_at.getTime() < approvedAt)
    .sort((a, b) => a.recorded_at.getTime() - b.recorded_at.getTime())
  const windowEnd = Math.min(asOf.getTime(), approvedAt + windowDays * DAY_MS)
  const post = history
    .filter(point => point.metric === metric
      && point.recorded_at.getTime() >= approvedAt
      && point.recorded_at.getTime() <= windowEnd)
    .sort((a, b) => a.recorded_at.getTime() - b.recorded_at.getTime())

  const preSpanDays = pre.length > 1
    ? (pre.at(-1)!.recorded_at.getTime() - pre[0]!.recorded_at.getTime()) / DAY_MS
    : 0
  const insufficientHistory = preSpanDays < 14
  const preDelta = pre.length > 1 ? pre.at(-1)!.value - pre[0]!.value : 0
  const preDailyDelta = preSpanDays > 0 ? preDelta / preSpanDays : 0
  const observedDelta = post.length > 0 ? post.at(-1)!.value - baseline : 0
  const counterfactualDelta = preDailyDelta * windowDays
  const attributedDelta = observedDelta - counterfactualDelta
  const confidence = insufficientHistory
    ? 0
    : Math.min(1, (preSpanDays / 30) * Math.min(1, Math.sqrt(pre.length / 14)))
  const uncertainty = Math.abs(attributedDelta) * (1 - confidence)

  return {
    tenant_id: experiment.tenant_id,
    experiment_id: experiment.experiment_id,
    goal_id: experiment.goal_id,
    move_id: experiment.move_id,
    metric,
    window_days: windowDays,
    observed_delta: round(observedDelta),
    counterfactual_delta: round(counterfactualDelta),
    attributed_delta: round(attributedDelta),
    attribution_confidence: round(confidence),
    confidence_interval: [round(attributedDelta - uncertainty), round(attributedDelta + uncertainty)],
    external_factor_share: round(1 - confidence),
    insufficient_history: insufficientHistory,
    computed_at: asOf,
  }
}

export class CausalExperimentTracker {
  private readonly experiments: Collection<CausalExperiment>
  private readonly attributions: Collection<OutcomeAttribution>

  constructor(private readonly db: Db) {
    this.experiments = db.collection<CausalExperiment>('causal_experiments')
    this.attributions = db.collection<OutcomeAttribution>('outcome_attributions')
    void this.experiments.createIndex({ tenant_id: 1, goal_id: 1, approved_at: -1 })
    void this.experiments.createIndex({ tenant_id: 1, move_id: 1 }, { unique: true })
    void this.attributions.createIndex(
      { tenant_id: 1, goal_id: 1, move_id: 1, metric: 1, window_days: 1 },
      { unique: true },
    )
  }

  async createExperiment(
    tenantId: string,
    goalId: string,
    moveId: string,
    kpiSnapshot: Record<string, number>,
    approvedAt = new Date(),
    options?: {
      randomizationMethod?: 'random' | 'stratified' | 'propensity'
      stratificationFactors?: string[]
    },
  ): Promise<CausalExperiment> {
    const group = this.assignToGroup(moveId, options?.randomizationMethod ?? 'random')
    
    const experiment: CausalExperiment = {
      experiment_id: randomUUID(),
      tenant_id: tenantId,
      goal_id: goalId,
      move_id: moveId,
      approved_at: approvedAt,
      kpi_snapshot_at_approval: kpiSnapshot,
      observation_windows: [7, 14, 30],
      synthetic_control_source: 'within_tenant_pre_action',
      created_at: approvedAt,
      group,
      randomization_method: options?.randomizationMethod ?? null,
      stratification_factors: options?.stratificationFactors ?? null,
    }
    const existing = await this.experiments.findOneAndUpdate(
      { tenant_id: tenantId, move_id: moveId },
      { $setOnInsert: experiment },
      { upsert: true, returnDocument: 'after' },
    )
    return existing ?? experiment
  }

  /**
   * Assign experiment to treatment or control group
   */
  private assignToGroup(moveId: string, method: 'random' | 'stratified' | 'propensity'): 'treatment' | 'control' {
    // Hash-based consistent assignment
    const hash = this.hashString(moveId)
    const threshold = 0.5 // 50/50 split
    
    return hash % 100 < threshold * 100 ? 'treatment' : 'control'
  }

  /**
   * Simple hash function for consistent assignment
   */
  private hashString(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash)
  }

  /**
   * Perform statistical significance test
   */
  private performSignificanceTest(
    treatmentValues: number[],
    controlValues: number[],
  ): {
    p_value: number
    is_significant: boolean
    test_type: 't_test' | 'chi_square' | 'mann_whitney'
    effect_size?: number
  } {
    // Use Mann-Whitney U test for non-parametric comparison
    const result = this.mannWhitneyUTest(treatmentValues, controlValues)
    
    return {
      p_value: result.p_value,
      is_significant: result.p_value < 0.05,
      test_type: 'mann_whitney',
      effect_size: result.effect_size,
    }
  }

  /**
   * Mann-Whitney U test for non-parametric comparison
   */
  private mannWhitneyUTest(
    sample1: number[],
    sample2: number[],
  ): { p_value: number; effect_size: number } {
    if (sample1.length === 0 || sample2.length === 0) {
      return { p_value: 1, effect_size: 0 }
    }

    // Combine and rank all values
    const combined = [...sample1, ...sample2]
    const sorted = combined.slice().sort((a, b) => a - b)
    
    // Calculate ranks
    const ranks = new Map<number, number>()
    for (let i = 0; i < sorted.length; i++) {
      const val = sorted[i]!
      ranks.set(val, i + 1)
    }

    // Sum ranks for sample1
    let R1 = 0
    for (const val of sample1) {
      R1 += ranks.get(val) ?? 0
    }

    // Calculate U statistic
    const n1 = sample1.length
    const n2 = sample2.length
    const U1 = R1 - (n1 * (n1 + 1)) / 2
    const U2 = n1 * n2 - U1
    const U = Math.min(U1, U2)

    // Calculate z-score
    const meanU = (n1 * n2) / 2
    const stdU = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12)
    const z = (U - meanU) / stdU

    // Calculate p-value (two-tailed)
    const p_value = 2 * (1 - this.normalCDF(Math.abs(z)))

    // Calculate effect size (r = z / sqrt(N))
    const N = n1 + n2
    const effect_size = Math.abs(z) / Math.sqrt(N)

    return { p_value, effect_size }
  }

  /**
   * Standard normal CDF approximation
   */
  private normalCDF(x: number): number {
    const a1 = 0.254829592
    const a2 = -0.284496736
    const a3 = 1.421413741
    const a4 = -1.453152027
    const a5 = 1.061405429
    const p = 0.3275911

    const sign = x < 0 ? -1 : 1
    x = Math.abs(x) / Math.sqrt(2)

    const t = 1.0 / (1.0 + p * x)
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)

    return 0.5 * (1.0 + sign * y)
  }

  async computeDueAttributions(tenantId: string, experimentId: string, asOf = new Date()): Promise<OutcomeAttribution[]> {
    const experiment = await this.experiments.findOne({ tenant_id: tenantId, experiment_id: experimentId })
    if (!experiment) return []

    const dueWindows = experiment.observation_windows.filter(days =>
      asOf.getTime() >= experiment.approved_at.getTime() + days * DAY_MS,
    )
    const history = await this.db.collection<KpiObservation & { tenant_id: string; goal_id: string }>('goal_kpi_snapshots')
      .find({ tenant_id: tenantId, goal_id: experiment.goal_id, recorded_at: { $lte: asOf } })
      .sort({ recorded_at: 1 })
      .toArray()

    const results = Object.keys(experiment.kpi_snapshot_at_approval).flatMap(metric =>
      dueWindows.map(days => estimateWithinTenantAttribution(experiment, metric, history, days, asOf)),
    )
    for (const result of results) {
      await this.attributions.updateOne(
        {
          tenant_id: tenantId,
          goal_id: result.goal_id,
          move_id: result.move_id,
          metric: result.metric,
          window_days: result.window_days,
        },
        { $set: result },
        { upsert: true },
      )
    }
    return results
  }
}
