/**
 * Shared domain types — canonical definitions used by both apps/api and apps/studio.
 *
 * These types represent the API response shapes that both the API server
 * and the Studio frontend need. Previously, each app defined its own copy
 * with subtle field drift. This file is the single source of truth.
 *
 * Note: API-side types use `Date` for timestamps; Studio-side types use `string`.
 * The API serializes dates to ISO strings via JSON, so Studio always receives
 * strings. We use `string | Date` here to accommodate both contexts.
 */

// ─── KPI ──────────────────────────────────────────────────────────────────────

export interface Kpi {
  metric: string
  label: string
  unit: string
  target: number
  current: number
  start_value: number
  direction: 'increase' | 'decrease'
  kpi_status?: 'live' | 'pending_connector' | 'manual_only'
  source?: 'signals' | 'external_api' | 'manual'
  signal_types?: string[]
  aggregation?: 'count' | 'sum' | 'avg' | 'last' | 'min' | 'max' | 'rate'
  field?: string
  filter?: string
  window_days?: number
  denominator_signal_types?: string[]
  denominator_filter?: string
  reconciliation?: KpiReconciliation
}

// ─── Goal ─────────────────────────────────────────────────────────────────────

export type GoalStatus = 'active' | 'at_risk' | 'achieved' | 'failed' | 'stalled' | 'archived'

export interface GoalExecutionPlan {
  enabled: boolean
  cadence: 'daily' | 'weekly'
  skills: string[]
  stop_condition: string
  status: 'active' | 'paused' | 'blocked' | 'completed'
  cycle_count: number
  last_step_id?: string
  last_run_at?: string
  next_run_at?: string
}

export interface GoalProjection {
  projected_end_date?: string
  projected_value?: number
  pct_complete?: number
  trend?: 'up' | 'down' | 'flat'
}

export interface GoalDoc {
  id: string
  tenant_id: string
  name: string
  description?: string
  timeline_days: number
  start_date: string | Date
  target_date: string | Date
  kpis: Kpi[]
  tags: string[]
  detector_ids: string[]
  status: GoalStatus
  at_risk_threshold: number
  trajectory?: GoalProjection
  domain?: string
  vertical?: string
  template_id?: string
  parent_goal_id?: string
  execution_plan?: GoalExecutionPlan
  created_at: string | Date
  updated_at: string | Date
}

export type KpiSourceType = 'connector' | 'computed' | 'manual'

export interface KpiSourceContribution {
  id?: string
  tenant_id: string
  goal_id: string
  metric: string
  source_id: string
  source_type: KpiSourceType
  value: number
  /** Unit the value is reported in (e.g. 'GBP', 'pct', 'count'). When present,
   * the reconciliation engine normalizes contributions to the KPI's canonical
   * unit before comparing — preventing a silent unit mismatch from looking
   * like (or masking) a real discrepancy. */
  unit?: string
  period_start: string | Date
  period_end: string | Date
  observed_at: string | Date
  metadata?: Record<string, unknown>
}

export interface KpiSourceDiscrepancy {
  detected: boolean
  threshold_pct: number
  max_delta_pct: number
  conflicting_source_ids: string[]
}

export interface KpiReconciliation {
  metric: string
  value: number
  selected_source_id: string
  selected_source_type: KpiSourceType
  contributions: KpiSourceContribution[]
  discrepancy: KpiSourceDiscrepancy
  reconciled_at: string | Date
}

export interface KpiProgress {
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
  reconciliation?: KpiReconciliation
}

export type GoalOverallStatus = 'achieved' | 'on_track' | 'behind' | 'ahead' | 'stalled'

export interface GoalProgress {
  goal: GoalDoc
  kpis: KpiProgress[]
  overall_status: GoalOverallStatus
  pct_time_elapsed: number
  summary: string
}

// ─── EPIC-001: Alert consolidation ───────────────────────────────────────────

export type DetectorTier = 'regulatory' | 'deterministic' | 'llm_scored'

export interface DetectorPrioritySettings {
  detector_priorities: Record<string, number>
  tier_priorities: Record<DetectorTier, number>
}

export interface ConsolidatedInsightGroup {
  entity_key: string
  primary: Record<string, unknown>
  secondary: Array<Record<string, unknown>>
  count: number
  max_urgency: 'low' | 'medium' | 'high' | 'critical'
  has_conflict: boolean
  conflicting_detector_ids: string[]
}

// ─── Detector ─────────────────────────────────────────────────────────────────

export interface NoveltyConfig {
  fields: string[]
  min_novelty?: number
  field?: string
}

export interface CUSUMConfig {
  field: string
  slack?: number
  threshold?: number
  direction?: 'up' | 'down' | 'both'
  min_observations?: number
}

export interface ScoreModelConfig {
  features: string[]
  min_score?: number
  use_bigrams?: boolean
  l2_reg?: number
}

export interface DetectorRule {
  id: string
  name: string
  confidence: number
  condition?: string
  urgency?: string
  category?: string
  impact?: { low: number; high: number }
  reasoning?: string
  actions?: string[]
  suppress_if?: string
  novelty?: NoveltyConfig
  cusum?: CUSUMConfig
  score_model?: ScoreModelConfig
}

export interface BlendPolicy {
  rule_weight: number
  llm_weight: number
  llm_weight_ceiling: number
  rationale?: string
}

export interface DetectorEntry {
  id: string
  name: string
  description?: string
  version: string
  signal_types: string[]
  industries: string[]
  rules: DetectorRule[]
  blend_policy?: BlendPolicy
  validation: { valid: boolean; errors: unknown[]; warnings: string[] }
}

// ─── Connector ────────────────────────────────────────────────────────────────

export interface ConnectorDef {
  id: string
  name: string
  category: string
  signal_types: string[]
  status?: 'connected' | 'disconnected' | 'error' | 'pending'
  last_sync?: string
  events_today?: number
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export interface EngineHealth {
  status: string
  loaded: boolean
  detectors: number
  signal_types: string[]
  uptime_seconds: number
  total_evaluations: number
  evaluations_per_second: number
}

export interface EngineMetrics {
  total_evaluations: number
  total_hits: number
  total_insights_produced: number
  total_rules_triggered: number
  avg_latency_ms: number
  evaluations_per_second: number
  uptime_seconds: number
  detectors: Record<string, {
    detector_id: string
    evaluations: number
    hits: number
    hit_rate: number
    avg_latency_ms: number
    last_evaluated_at: string | null
  }>
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface TrendPoint {
  date: string
  total: number
  approved: number
  dismissed: number
  value_low: number
  value_high: number
}

export interface CategoryBreakdown {
  category: string
  count: number
  value_low: number
  value_high: number
  approved: number
}

export interface DetectorBreakdown {
  detector_id: string
  count: number
  approved: number
  dismissed: number
  avg_confidence: number
  approval_rate: number
}

export interface AnalyticsSummary {
  total: number
  approved: number
  dismissed: number
  pending: number
  total_value_low: number
  total_value_high: number
  total_value_mid: number
  approval_rate: number
}

// ─── Attribution ──────────────────────────────────────────────────────────────

export interface WorkflowAttribution {
  workflow_id: string
  workflow_name: string
  total_runs: number
  converted: number
  dismissed: number
  total_value_minor_units: number
  conversion_rate: number
}

export interface AttributionSummary {
  period_days: number
  total_runs: number
  converted: number
  dismissed: number
  expired: number
  pending: number
  conversion_rate: number
  total_value_minor_units: number
  currency: string
  avg_value_per_conversion_minor_units: number
  workflows: WorkflowAttribution[]
}

// ─── Verified Moment ──────────────────────────────────────────────────────────

export type VerifiedMomentStatus =
  | 'verified'
  | 'approved'
  | 'dismissed'
  | 'actioned'
  | 'outcome_measured'
  | 'archived'

export interface VerifiedMomentOutcome {
  metric: string
  baseline: number
  observed: number
  delta: number
  value_minor_units: number
  currency: string
  measured_at: string
  source: string
}

export interface VerifiedMoment {
  id: string
  tenant_id: string
  insight_id: string
  goal_id?: string
  kpi_metric?: string
  detector_id: string
  rule_id: string
  status: VerifiedMomentStatus
  verification_method: 'deterministic_rule'
  signal_ids: string[]
  evidence_refs: string[]
  confidence: number
  hypothesis: string
  reasoning: string
  actions: string[]
  approved_at?: string
  dismissed_at?: string
  actioned_at?: string
  action_receipt_ids?: string[]
  outcome?: VerifiedMomentOutcome
  created_at: string
  updated_at: string
}

// ─── Cost Summary ─────────────────────────────────────────────────────────────

export interface CostSummary {
  days: number
  total_cost_microdollars: number
  total_cost_display: string
  total_input_tokens: number
  total_output_tokens: number
  total_calls: number
  by_model: Record<string, {
    calls: number
    input_tokens: number
    output_tokens: number
    cost_microdollars: number
  }>
  by_workflow: Record<string, {
    calls: number
    cost_microdollars: number
  }>
  by_day: Array<{ date: string; cost_microdollars: number; calls: number }>
}

// ─── Calibration ──────────────────────────────────────────────────────────────

export interface CalibrationParam {
  detector_id: string
  temperature: number
  ece: number
  mce: number
  brier_score: number
  sample_count: number
  active_calibrator: 'platt' | 'isotonic' | 'none'
  fitted_at: string
}
