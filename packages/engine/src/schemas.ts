import { z } from 'zod'

// ─── Evidence Chain (Principle I) ─────────────────────────────────────────────
// Every insight MUST have or_score ≥ 0.7 and non-empty evidence_refs.
// LLMs may never produce an Insight without these two fields populated.

export const ConfidenceBreakdownSchema = z.object({
  or_score: z.number().min(0.7).max(1.0),         // rule-based — deterministic floor
  llm_score: z.number().min(0).max(1).optional(), // LLM scoring — additive only
  combined_score: z.number().min(0).max(1),
  model_version: z.string(),
  evidence_refs: z.array(z.string()).min(1),       // MUST be non-empty
  grounded_in_history: z.boolean().optional(),
  rag_context_tokens: z.number().int().nonnegative().optional(),
})
export type ConfidenceBreakdown = z.infer<typeof ConfidenceBreakdownSchema>

export const EvidenceTrailSchema = z.object({
  trigger_id: z.string(),
  detector_id: z.string(),
  detector_version: z.string(),
  fired_at: z.date(),
  rule_evidence: z.object({
    rule_id: z.string(),
    condition_expression: z.string(),
    matched_variables: z.record(z.union([z.string(), z.number(), z.boolean()])),
    or_score: z.number(),
    threshold_used: z.number(),
    threshold_basis: z.string(),
  }),
  llm_evidence: z.object({
    model: z.string(),
    prompt_summary: z.string(),
    llm_score: z.number(),
    combined_score: z.number(),
    blend_weights: z.object({ rule: z.number(), llm: z.number() }),
  }).optional(),
  source_events: z.array(z.object({
    event_id: z.string(),
    event_type: z.string(),
    connector: z.string(),
    occurred_at: z.date(),
    excerpt: z.string(),
  })),
  plain_english: z.string(),
})
export type EvidenceTrail = z.infer<typeof EvidenceTrailSchema>

// ─── Blend Policy ───────────────────────────────────────────────────────────────

export const BlendPolicySchema = z.object({
  rule_weight: z.number().min(0.5).max(1.0).default(0.7),
  llm_weight: z.number().min(0).max(0.5).default(0.3),
  llm_weight_ceiling: z.number().min(0).max(0.9).default(0.9),
  rationale: z.string().max(500).optional(),
}).refine(p => Math.abs(p.rule_weight + p.llm_weight - 1.0) < 0.01, {
  message: 'rule_weight + llm_weight must sum to 1.0',
})
export type BlendPolicy = z.infer<typeof BlendPolicySchema>

// ─── Insight (the output of every detector run) ───────────────────────────────

/**
 * One considered alternative path and why it was rejected or is less preferred.
 * Populated from the detector rule's alternatives_template at trigger time.
 */
export const AlternativeSchema = z.object({
  label: z.string(),
  why_not: z.string().optional(),
  forecast_low: z.number().optional(),
  forecast_high: z.number().optional(),
})
export type Alternative = z.infer<typeof AlternativeSchema>

export const TriggerSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  hypothesis: z.string(),
  category: z.enum(['revenue', 'cost-savings', 'risk', 'compliance', 'experience', 'goal_progress']),
  urgency: z.enum(['low', 'medium', 'high', 'critical']),
  estimated_impact_low: z.number().int(),  // minor units (pence/cents) — never float
  estimated_impact_high: z.number().int(),
  reasoning: z.string(),
  actions: z.array(z.string()),
  /**
   * Decision Support Quality (items 02/03):
   * Structured alternatives for A/B/C comparison, risk assessment, and
   * exit criteria. All optional — detectors that don't define them produce
   * insights without these fields, preserving backward compatibility.
   */
  alternatives: z.array(AlternativeSchema).optional(),
  risk_assessment: z.string().optional(),
  exit_criteria: z.string().optional(),
  confidence_breakdown: ConfidenceBreakdownSchema,
  detector_id: z.string(),
  rule_id: z.string(),
  state: z.enum(['identified', 'sent', 'completed', 'dismissed', 'archived', 'snoozed']).default('identified'),
  created_at: z.date().default(() => new Date()),
  /**
   * Signal IDs / event IDs this insight was derived from.
   * Used by lightweight truth maintenance: when a signal in this set arrives,
   * the engine evaluates expires_if to check if this insight should be archived.
   */
  derived_from_signals: z.array(z.string()).default([]),
  /**
   * Filtrex expression evaluated against new signals to auto-expire this insight.
   * Example: "data.outstanding_amount == 0"  (auto-archive when invoice is paid)
   * Example: "data.review_rating >= 4"       (auto-archive when rating improves)
   */
  expires_if: z.string().optional(),
  /**
   * LLM cost attributed to generating this insight (micro-dollars, integer).
   * Populated by the cost ledger when the insight is persisted.
   */
  llm_cost_microdollars: z.number().int().optional(),
  /**
   * Snapshot of the event data fields used by the detector rule.
   * Stored at insight creation so the feature-hash scorer can learn from
   * approve/dismiss outcomes against the actual triggering data — not just
   * the insight's metadata (hypothesis/urgency/category).
   * Capped at scalar fields only (no nested objects) to keep the document lean.
   */
  feature_snapshot: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  /**
   * Carries DetectorRule.dedup_window_ms onto the insight itself so the
   * persistence layer (which has no direct access to the rule config) can
   * enforce it. Without this, dedup_window_ms is declared in every detector
   * YAML but never actually read anywhere — see entity_key below.
   */
  dedup_window_ms: z.number().int().optional(),
  /**
   * Best-effort identifier for "what this insight is about" (a goal id, a
   * ticker, a customer id — whichever scalar field in feature_snapshot looks
   * most like an entity reference), so the same rule firing repeatedly for
   * the *same* entity can be recognized as a duplicate, while two different
   * entities under the same rule (e.g. a price-drop alert for two different
   * tickers) are correctly kept as separate insights. Empty string when no
   * such field is present.
   */
  entity_key: z.string().optional(),
  evidence_trail: EvidenceTrailSchema.optional(),
  judge_verdict: z.object({
    decision: z.enum(['pass', 'rewrite', 'block', 'skipped']),
    scores: z.object({
      coherence: z.number().int().min(1).max(5),
      groundedness: z.number().int().min(1).max(5),
      actionability: z.number().int().min(1).max(5),
      proportionality: z.number().int().min(1).max(5),
      safety: z.number().int().min(1).max(5),
      feedback: z.string(),
    }).optional(),
    judge_skipped: z.boolean(),
    skip_reason: z.string().optional(),
    evaluated_at: z.date(),
  }).optional(),
})
export type Trigger = z.infer<typeof TriggerSchema>

/** @deprecated Use Trigger. Kept for API and Studio compatibility. */
export const InsightSchema = TriggerSchema
/** @deprecated Use Trigger. Kept for API and Studio compatibility. */
export type Insight = Trigger

export interface Move {
  id: string
  tenant_id: string
  trigger_id: string
  description: string
  requires_approval: boolean
}

// ─── Detector Rule ─────────────────────────────────────────────────────────────

export const RuleConditionSchema = z.object({
  expression: z.string(), // e.g. "data.days_overdue >= 7 and data.amount_minor >= 10000"
  logic_gate: z.enum(['AND', 'OR', 'NOT']).optional(),
  children: z.array(z.lazy((): z.ZodTypeAny => RuleConditionSchema)).optional(),
})
export type RuleCondition = z.infer<typeof RuleConditionSchema>

// ── Lightweight ML extensions for DetectorRule ────────────────────────────────

/** Novelty guard — fires only when a field value is rare (novelty ≥ threshold). */
export const NoveltyConfigSchema = z.object({
  /** Dot-path fields to track, e.g. ["data.amount_minor", "data.customer_id"] */
  fields: z.array(z.string()),
  /** Minimum novelty score (0–1) to pass this guard. Default 0.8. */
  min_novelty: z.number().min(0).max(1).default(0.8),
  /** Which field's novelty to check (defaults to max across all fields). */
  field: z.string().optional(),
})
export type NoveltyConfig = z.infer<typeof NoveltyConfigSchema>

/** CUSUM change-point guard — fires only when a trend shift is detected. */
export const CUSUMConfigSchema = z.object({
  /** Dot-path to the numeric field to monitor, e.g. "data.revenue_minor" */
  field: z.string(),
  /** Slack k — half the minimum shift worth detecting. Default 0.5. */
  slack: z.number().default(0.5),
  /** Alarm threshold h. Default 4.0 (≈ ARL₀ = 500). */
  threshold: z.number().default(4.0),
  /** Direction to monitor. Default 'both'. */
  direction: z.enum(['up', 'down', 'both']).default('both'),
  /** Minimum observations before alarming. Default 10. */
  min_observations: z.number().int().default(10),
})
export type CUSUMConfig = z.infer<typeof CUSUMConfigSchema>

/** Feature-hash model rule — replaces a filtrex condition with a learned model. */
export const ScoreModelConfigSchema = z.object({
  /** Dot-path fields to include as model features. */
  features: z.array(z.string()),
  /** Model fires (rule matches) when score ≥ this. Default 0.65. */
  min_score: z.number().min(0).max(1).default(0.65),
  /** Include pairwise feature interactions. Default true. */
  use_bigrams: z.boolean().default(true),
  /** L2 regularisation coefficient. Default 0.0001. */
  l2_reg: z.number().default(0.0001),
})
export type ScoreModelConfig = z.infer<typeof ScoreModelConfigSchema>

export const DetectorRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  /**
   * filtrex condition string — required unless score_model is set.
   * When score_model is present, condition is optional (model replaces it).
   */
  condition: z.union([z.string().trim(), RuleConditionSchema]).optional(),
  confidence: z.number().min(0.7).max(1.0), // must meet the or_score floor
  impact_low: z.union([z.string(), z.number()]),  // expression or literal (minor units)
  impact_high: z.union([z.string(), z.number()]),
  reasoning_template: z.string(),  // supports {{data.field}} interpolation
  actions: z.array(z.string()).default([]),
  /**
   * Decision Support Quality (items 02/03):
   * Templates for alternatives, risk assessment, and exit criteria.
   * All optional — supports {{data.field}} interpolation like reasoning_template.
   * alternatives_template is a list of {label, why_not, forecast_low, forecast_high}
   * where numeric fields can be expressions evaluated against the event data.
   */
  alternatives_template: z.array(z.object({
    label: z.string(),
    why_not: z.string().optional(),
    forecast_low: z.union([z.string(), z.number()]).optional(),
    forecast_high: z.union([z.string(), z.number()]).optional(),
  })).optional(),
  risk_template: z.string().optional(),
  exit_criteria_template: z.string().optional(),
  // Stateful sliding window
  state_enabled: z.boolean().default(false),
  window_size: z.number().int().optional(),      // keep last N evaluations
  window_duration_ms: z.number().int().optional(), // or last N milliseconds
  reset_on_trigger: z.boolean().default(false),
  // Suppression
  suppress_if: z.string().optional(),
  dedup_window_ms: z.number().int().default(86_400_000), // 24h default
  // ── Lightweight ML extensions ─────────────────────────────────────────────
  /** Novelty guard — skip rule unless field values are rare enough. */
  novelty: NoveltyConfigSchema.optional(),
  /** CUSUM guard — skip rule unless a trend shift has been detected. */
  cusum: CUSUMConfigSchema.optional(),
  /** Feature-hash model — replaces or augments the filtrex condition. */
  score_model: ScoreModelConfigSchema.optional(),
})
export type DetectorRule = z.infer<typeof DetectorRuleSchema>

// ─── Detector Config (YAML root) ──────────────────────────────────────────────

export const DetectorConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  version: z.string().default('1.0.0'),
  signal_types: z.array(z.string()),               // which event types trigger this
  event_types: z.array(z.object({
    name: z.string(),
    min_schema_version: z.string().default('0.0.0'),
    max_schema_version: z.string().default('*'),
  })).optional(),
  evidence_types: z.array(z.string()).optional(),
  correlation: z.object({
    window_hours: z.number().positive(),
    require_all: z.boolean().default(true),
    min_evidence_count: z.number().int().min(1).default(2),
  }).optional(),
  industries: z.array(z.string()).default(['*']),  // ['*'] = all industries
  rules: z.array(DetectorRuleSchema),
  blend_policy: BlendPolicySchema.optional(),
})
export type DetectorConfig = z.infer<typeof DetectorConfigSchema>

// ─── CDD Filter (context-aware prioritisation — patent feature) ───────────────

export const CddFilterSchema = z.object({
  name: z.string(),
  condition: z.string(),  // safe expression against context
  action: z.enum(['skip', 'increase_priority', 'decrease_priority']),
  weight: z.number().default(1.0),
})
export type CddFilter = z.infer<typeof CddFilterSchema>

// ─── CDD Action ────────────────────────────────────────────────────────────────

export const CddActionSchema = z.object({
  type: z.enum(['notify', 'webhook', 'create_task', 'approve', 'custom']),
  name: z.string(),
  params: z.record(z.unknown()).default({}),
  on_success: z.array(z.lazy((): z.ZodTypeAny => CddActionSchema)).optional(),
  on_failure: z.array(z.lazy((): z.ZodTypeAny => CddActionSchema)).optional(),
  requires_approval: z.boolean().default(false),
  approval_chain: z.array(z.string()).optional(), // e.g. ['manager', 'cfo']
})
export type CddAction = z.infer<typeof CddActionSchema>

// ─── Evaluation Result ────────────────────────────────────────────────────────

export const EvaluationResultSchema = z.object({
  tenant_id: z.string(),
  detector_id: z.string(),
  triggered_rules: z.array(z.string()),
  insights: z.array(InsightSchema),
  skipped: z.boolean().default(false),
  skip_reason: z.string().optional(),
  priority_weight: z.number().default(1.0),
  evaluated_at: z.date().default(() => new Date()),
})
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>

// ─── Evaluation Context ───────────────────────────────────────────────────────

export interface EvaluationContext {
  tenant_id: string
  data: Record<string, unknown>        // raw event/signal data
  /** The signal/event type — used by the category decision table for pattern matching. */
  signal_type?: string
  business_context?: Record<string, unknown> // industry, employees, country, etc.
  /** Pre-computed adaptive thresholds for this tenant+signal_type (from AdaptiveThresholdStore). */
  adaptive_thresholds?: Record<string, number>
  /**
   * KPI targets from the tenant's active goal(s), keyed by metric name (e.g.
   * 'portfolio_concentration_max_pct' → 10). Lets a detector condition read
   * "what did this user actually ask for" instead of a hardcoded default —
   * see buildGoalKpiTargets() in apps/api/src. Always populated with a
   * built-in default per known metric so a condition referencing a key here
   * never has to guard against it being absent.
   */
  goal_kpi_targets?: Record<string, number>
  /**
   * Gap #32: Maps each KPI metric to the goal_id that set it, so the detector
   * can thread `goal_id` into `feature_snapshot` — creating the durable link
   * from insight → goal that was previously missing. Only populated for
   * targets that came from a tenant's active goal (not built-in defaults).
   * See buildGoalContext() in @kairos/platform.
   */
  goal_id_by_metric?: Record<string, string>
  history?: RuleHistoryEntry[]         // sliding window state
  /** Signals that this insight is derived from — used for dependency-based expiry. */
  derived_from_signals?: string[]
  // ── Lightweight ML context (injected by Engine before rule evaluation) ────
  /** Novelty scores per field: field → 0 (common) … 1 (never seen). */
  novelty_scores?: Record<string, number>
  /** CUSUM change-point context: field.cusum_up, field.cusum_down, field.alarm, field.z_score */
  change_point?: Record<string, unknown>
  /** Feature hash model score for this event (if score_model rule present). */
  model_score?: number
  /**
   * Cross-signal tenant-level score (0–1) — probability that the current
   * insight will be approved, based on patterns across ALL detectors and
   * signal types for the same entity. Injected by TenantLevelScorer.
   * Detectors can use: "context.tenant_level_score > 0.7"
   */
  tenant_level_score?: number
}

export interface RuleHistoryEntry {
  rule_id: string
  triggered: boolean
  evaluated_at: Date
  data_snapshot?: Record<string, unknown>
}

// ─── Detector Version Governance ───────────────────────────────────────────────

export interface DetectorVersion {
  id: string                    // randomUUID
  tenant_id: string
  detector_id: string
  version_number: number        // monotonically increasing per detector
  version: string               // semver e.g. "1.0.0"
  previous_version?: string     // semver of previous version
  changed_by: string            // user_id
  change_type: 'manual_edit' | 'skill_optimizer' | 'blend_policy_change' | 'rollback'
  before_yaml: string           // full YAML before change
  after_yaml: string            // full YAML after change
  diff?: {                     // structured before/after diff
    before: Record<string, unknown>
    after: Record<string, unknown>
  }
  change_summary: string        // human-readable: "Changed confidence threshold 0.7→0.8 in rule invoice_alert"
  metrics_at_change?: {         // approval_rate, avg_confidence at time of change
    approval_rate: number
    avg_confidence: number
  }
  approval_rate_at_change?: number
  created_at: Date
  changed_at: Date
}
