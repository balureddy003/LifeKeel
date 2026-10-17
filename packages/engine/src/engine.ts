/**
 * LifeKeel Engine — The Deterministic Intelligence Layer
 *
 * Five invariants enforced by the type system and runtime:
 *
 *   1. Rules run first — YAML conditions are deterministic; LLMs never decide alone
 *   2. LLM scores second — enriches combined_score but cannot produce an Insight
 *   3. Evidence chain always required — every Insight has or_score ≥ 0.7 + evidence_refs
 *   4. Multi-tenant isolation — tenant_id from JWT context, never from request body
 *   5. Decimal money precision — impact values are integer minor units (pence/cents)
 *
 * World-class features:
 *   • Fail-fast validation — every expression pre-compiled at load time
 *   • Hot-reload — file watcher re-loads changed YAMLs without restarting
 *   • Streaming evaluation — AsyncIterable<Insight> for real-time pipelines
 *   • Metrics — per-detector hit rates, latency histograms, evaluations/sec
 *   • Explain — full rule evaluation trace for every Insight
 *   • Priority filters (CDD) — skip/boost detectors based on business context
 *
 * Usage:
 *   const engine = new Engine({ detectorsDir: './detectors' })
 *   await engine.load()
 *
 *   // Single evaluation
 *   const result = await engine.evaluate({ event_type, tenant_id, event_id, data })
 *
 *   // Streaming (real-time pipelines)
 *   for await (const insight of engine.evaluateStream({ event_type, tenant_id, event_id, data })) {
 *     await persistInsight(insight)
 *   }
 *
 *   // Explain an insight
 *   const trace = engine.explain(insightId)
 *
 *   // Live metrics
 *   const stats = engine.metrics.snapshot()
 */

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import chokidar, { type FSWatcher } from 'chokidar'
import { Detector } from './scoring/detector.js'
import {
  DetectorConfigSchema,
  type EvaluationContext,
  type EvaluationResult,
  type Insight,
} from './schemas.js'
import {
  validateDetector,
  formatValidationErrors,
  type ValidationResult,
} from './scoring/detector-validator.js'
import { MetricsCollector, type EngineMetrics } from './engine-metrics.js'
import type { ScoreCalibrator } from './calibration/calibration.js'
import type { NoveltyTracker } from './scoring/novelty-tracker.js'
import type { ChangePointDetector } from './scoring/change-point.js'
import type { FeatureHashScorer } from './scoring/feature-hash-scorer.js'
import type { TenantLevelScorer, RecentInsight } from './scoring/tenant-level-scorer.js'
import { CorrelationBuffer } from './scoring/correlation-buffer.js'
import { createLogger } from '@lifekeel/platform'
import {
  CascadeScorer,
  type CascadePolicy,
  type ConformalGateProvider,
  type CascadeTelemetry,
} from './scoring/cascade.js'
import { DatabaseIndexManager, createIndexManager } from './scoring/database-indexes.js'

const log = createLogger({ service: 'lifekeel-engine', version: '0.0.0' })

// ─── Public contracts ─────────────────────────────────────────────────────────

export interface EngineOptions {
  /** Path to directory containing detector YAML files */
  detectorsDir: string
  /** Optional LLM scorer — enriches insights after rule evaluation */
  llmScorer?: LlmScorer
  /** MongoDB database instance for index management */
  db?: any
  /**
   * Hot-reload detectors when YAML files change.
   * Default: false (appropriate for serverless).
   * Set to true for long-running servers with live YAML editing.
   */
  hotReload?: boolean
  /**
   * Strict mode: refuse to start if any detector has validation errors.
   * Default: false (invalid detectors are skipped with a warning).
   */
  strictValidation?: boolean
  /**
   * LLM scoring gate — controls which insights are enriched by the LLM scorer.
   * Defaults: maxOrScoreToEnrich=0.90, batchCap=10.
   */
  llmScoringPolicy?: LlmScoringPolicy
  /**
   * Category/urgency decision table — overrides the heuristic string-match
   * fallback in inferCategory/inferUrgency with a deterministic lookup table.
   * Loaded from a YAML file at detectorsDir/../category-table.yaml if not supplied.
   */
  categoryTable?: CategoryDecisionEntry[]
  /**
   * Score calibrator — applies per-detector temperature scaling to LLM-enriched
   * combined_scores after the 70/30 blend.
   * Corrects systematic overconfidence (Guo et al. 2017).
   * If omitted, scores are used as-is.
   */
  calibrator?: ScoreCalibrator

  // ── Lightweight ML layer ──────────────────────────────────────────────────

  /**
   * Novelty tracker — Count-Min Sketch per tenant/field.
   * When provided, novelty_scores are injected into EvaluationContext before
   * rule evaluation, enabling YAML conditions like:
   *   condition: "context.novelty_scores['data.amount_minor'] > 0.8"
   * Also powers `novelty:` rule guards.
   */
  noveltyTracker?: NoveltyTracker

  /**
   * Change-point detector — CUSUM per tenant/field.
   * When provided, cusum context is injected (cusum_up, cusum_down, alarm, z_score).
   * Powers `cusum:` rule guards and filtrex expressions like:
   *   condition: "context.change_point['data.revenue_minor.alarm'] == 1"
   */
  changePointDetector?: ChangePointDetector

  /**
   * Feature hash scorer — online logistic regression per detector.
   * Powers `score_model:` rule type — rules that learn from approvals without
   * any schema definition or retraining.
   */
  featureHashScorer?: FeatureHashScorer

  /**
   * Tenant-level scorer — cross-signal online logistic regression.
   * Learns patterns across ALL detectors and signal types for the same
   * entity (e.g. "customer with overdue invoice + cart abandonment =
   * high approval likelihood"). Injects `context.tenant_level_score`.
   */
  tenantLevelScorer?: TenantLevelScorer

  /**
   * Fetches recent insights for an entity (last 7 days) — used by the
   * tenant-level scorer to build cross-signal features. Returns an array
   * of { detector_id, signal_type, state, created_at }.
   */
  recentInsightsProvider?: (tenantId: string, entityKey: string) => Promise<RecentInsight[]>

  /**
   * Fields to track for novelty scoring, keyed by signal_type.
   * Example: { 'invoice.overdue': ['data.amount_minor', 'data.customer_id'] }
   * If omitted, novelty tracking is skipped even when noveltyTracker is set.
   */
  noveltyFields?: Record<string, string[]>

  /**
   * Fields to track for CUSUM change-point detection, keyed by signal_type.
   * Example: { 'revenue.daily': ['data.revenue_minor', 'data.order_count'] }
   */
  changePointFields?: Record<string, string[]>
  correlationBuffer?: CorrelationBuffer
  reasoningContextBuilder?: ReasoningContextBuilder

  /**
   * Tiered cascade + conformal escalation gate (ADR-0068). When
   * `cascadePolicy.enabled` and a `conformalGate` are both provided, LLM
   * escalation is governed by a per-tenant conformal threshold `tau` (bounding
   * the wrong-skip rate) instead of the static `maxOrScoreToEnrich` constant.
   * Default off — the legacy gate is used and behaviour is unchanged.
   */
  cascadePolicy?: CascadePolicy
  /** Per-tenant conformal escalation threshold provider (ADR-0068). */
  conformalGate?: ConformalGateProvider
}

function detectorSupportsSchema(detector: Detector, eventType: string, version: string): boolean {
  const compatibility = detector.config.event_types?.find((entry) => entry.name === eventType)
  if (!compatibility || version === '0.0.0') return true
  const asNumber = (value: string): number | null => {
    const parts = value.split('.').map(Number)
    return parts.length === 3 && parts.every(Number.isFinite)
      ? parts[0]! * 1_000_000 + parts[1]! * 1_000 + parts[2]!
      : null
  }
  const current = asNumber(version)
  const minimum = asNumber(compatibility.min_schema_version)
  if (current === null || minimum === null || current < minimum) return false
  if (compatibility.max_schema_version === '*') return true
  if (compatibility.max_schema_version.endsWith('.x')) {
    return version.split('.')[0] === compatibility.max_schema_version.split('.')[0]
  }
  const maximum = asNumber(compatibility.max_schema_version)
  return maximum !== null && current <= maximum
}

export interface ReasoningContext {
  episodic_snippets: string[]
  semantic_snippets: string[]
  goal_snippets?: string[]
  tokens_used: number
}

export interface ReasoningContextBuilder {
  assemble(input: {
    tenant_id: string
    detector_id: string
    query_text: string
    token_budget: number
  }): Promise<ReasoningContext>
}

export interface LlmScorer {
  /** Score a batch of insights; returns updated llm_score per insight id */
  score(
    insights: Insight[],
    context: EvaluationContext,
    reasoningContexts?: ReadonlyMap<string, ReasoningContext>,
  ): Promise<Map<string, number>>
}

/**
 * LLM Scoring Gate — controls which insights are sent to the LLM scorer.
 *
 * When a rule fires with or_score ≥ max_or_score_to_score, the LLM can
 * move the combined_score by at most (1 - 0.70) × 0.30 = 9 points.
 * That marginal change does not justify the API cost.
 * Gate it out and save 30–50% of LLM scorer spend with zero accuracy loss.
 */
export interface LlmScoringPolicy {
  /**
   * Only score insights where or_score is below this ceiling.
   * Default: 0.90 — insights at or above 0.90 pass through unchanged.
   * Set to 1.0 to score everything (original behaviour).
   */
  maxOrScoreToEnrich?: number
  /**
   * Cap the number of insights sent per evaluation batch.
   * Prevents runaway cost on events that trigger many rules.
   * Default: 10.
   */
  batchCap?: number
}

export interface EvaluateInput {
  event_type: string
  tenant_id: string // ← always from auth context, never from request body
  event_id: string
  data: Record<string, unknown>
  business_context?: Record<string, unknown>
  adaptive_thresholds?: EvaluationContext['adaptive_thresholds']
  goal_kpi_targets?: EvaluationContext['goal_kpi_targets']
  derived_from_signals?: EvaluationContext['derived_from_signals']
  history?: EvaluationContext['history']
  /** Restrict evaluation to detectors activated for the tenant's active goals. */
  active_detector_ids?: string[]
  schema_version?: string
  source?: string
}

export interface EngineResult {
  insights: Insight[]
  detectors_run: number
  rules_triggered: number
  evaluated_at: Date
  /** Wall-clock duration for the full evaluation, in milliseconds */
  latency_ms: number
}

/** Full rule-evaluation trace for a single Insight (returned by explain()) */
export interface InsightTrace {
  insight_id: string
  evaluation_id: string
  detector_config_hash: string
  detector_id: string
  rule_id: string
  matched_condition: string
  evaluated_at: Date
  latency_ms: number
  input_data: Record<string, unknown>
  business_context: Record<string, unknown>
}

/**
 * One row in the category/urgency decision table.
 * Both pattern fields are glob-style: '*' = wildcard, '?' = any one char.
 * First matching row wins (ordered lookup, O(k) where k = table rows).
 *
 * Example YAML (category-table.yaml):
 *   - signal_type_pattern: "invoice_*"
 *     rule_id_pattern: "*_overdue"
 *     category: risk
 *     urgency: high
 *     confidence_urgency_override: false
 */
export interface CategoryDecisionEntry {
  /** Glob pattern for the signal type (e.g. "invoice_*", "payment_failed"). */
  signal_type_pattern: string
  /** Glob pattern for the rule ID (e.g. "*_overdue", "duplicate_*"). */
  rule_id_pattern: string
  category: Insight['category']
  /**
   * Urgency override. If omitted, urgency is still derived from confidence score
   * (which is the correct default — urgency should reflect confidence, not just type).
   */
  urgency?: Insight['urgency']
}

export interface DetectorInventoryEntry {
  id: string
  name: string
  description?: string
  version: string
  signal_types: string[]
  industries: string[]
  blend_policy?: {
    rule_weight: number
    llm_weight: number
    llm_weight_ceiling: number
    rationale?: string | undefined
  }
  rules: Array<{
    id: string
    name: string
    confidence: number
    condition: string
  }>
  validation: ValidationResult
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class Engine {
  private detectors: Map<string, Detector[]> = new Map() // signal_type → detectors
  private detectorById: Map<string, Detector> = new Map() // for inventory
  private validationResults: Map<string, ValidationResult> = new Map()
  private loaded = false
  private watcher: FSWatcher | null = null

  /** Insight traces keyed by insight_id — last 1000 evaluations ring buffer */
  private readonly traceBuffer = new Map<string, InsightTrace>()
  private readonly traceOrder: string[] = []
  private readonly TRACE_BUFFER_SIZE = 1000

  readonly metrics = new MetricsCollector()
  private readonly correlationBuffer: CorrelationBuffer
  private indexManager: DatabaseIndexManager | undefined

  /** Last cascade telemetry (DRR etc.) per tenant — ADR-0068 north-star metric. */
  private readonly cascadeTelemetry = new Map<string, CascadeTelemetry>()

  constructor(readonly options: EngineOptions) {
    this.correlationBuffer = options.correlationBuffer ?? new CorrelationBuffer()
    this.indexManager = options.db ? createIndexManager(options.db) : undefined
  }

  /**
   * Most recent cascade telemetry for a tenant (ADR-0068), or undefined if the
   * cascade gate has not run for that tenant. `drr` is the Deterministic
   * Resolution Rate — the fraction of insights resolved with zero LLM cost.
   */
  getCascadeTelemetry(tenant_id: string): CascadeTelemetry | undefined {
    return this.cascadeTelemetry.get(tenant_id)
  }

  // ─── Load ──────────────────────────────────────────────────────────────────

  /**
   * Load all YAML detector configs from detectorsDir.
   * Supports nested subdirectories (e.g. detectors/ecommerce/cart.yaml).
   *
   * With strictValidation: true, throws if any detector has expression errors.
   * With hotReload: true, starts a file watcher to auto-reload on changes.
   */
  async load(): Promise<void> {
    const files = await this.findYamlFiles(this.options.detectorsDir)

    // Create database indexes if db is provided
    if (this.indexManager) {
      try {
        await this.indexManager.createAllIndexes()
        log.info({}, 'Database indexes created successfully')
      } catch (err) {
        log.warn({ err }, 'Failed to create database indexes (continuing anyway)')
      }
    }

    // Reset before reload
    this.detectors.clear()
    this.detectorById.clear()
    this.validationResults.clear()

    const failedValidations: ValidationResult[] = []

    for (const file of files) {
      const loaded = await this.loadFile(file)
      if (loaded && !loaded.valid) {
        failedValidations.push(loaded)
      }
    }

    if (this.options.strictValidation && failedValidations.length > 0) {
      throw new Error(formatValidationErrors(failedValidations))
    }

    this.loaded = true

    // Inject ML scorers into every loaded detector
    if (this.options.featureHashScorer) {
      for (const detectorList of this.detectors.values()) {
        for (const detector of detectorList) {
          detector.featureHashScorer = this.options.featureHashScorer
        }
      }
    }

    // Inject category decision table into every loaded detector
    // so inferCategory() uses table lookup instead of string heuristics.
    if (this.options.categoryTable) {
      for (const detectorList of this.detectors.values()) {
        for (const detector of detectorList) {
          detector.categoryTable = this.options.categoryTable
        }
      }
    } else {
      // Auto-load from <detectorsDir>/../category-table.yaml if it exists.
      // Awaited (not fire-and-forget): callers doing `await engine.load()`
      // then evaluating immediately must see the table already attached —
      // otherwise the very first evaluations after startup could silently
      // fall through to the heuristic fallback depending on disk I/O timing.
      await this.loadCategoryTableFromDisk().catch(() => {})
    }

    if (this.options.hotReload) {
      this.startWatcher()
    }
  }

  private async loadCategoryTableFromDisk(): Promise<void> {
    const tablePath = path.join(this.options.detectorsDir, '..', 'category-table.yaml')
    try {
      const raw = await fs.readFile(tablePath, 'utf8')
      const parsed = yaml.load(raw) as
        CategoryDecisionEntry[] | { entries?: CategoryDecisionEntry[] }
      // The documented shape (see CategoryDecisionEntry's own doc comment) is
      // a bare top-level list — accept that as primary, and an {entries:[]}
      // wrapper too in case a file is ever written that way.
      const table = Array.isArray(parsed) ? parsed : (parsed.entries ?? [])
      for (const detectorList of this.detectors.values()) {
        for (const detector of detectorList) {
          detector.categoryTable = table
        }
      }
      log.info({ count: table.length, path: tablePath }, 'Loaded category decision entries')
    } catch {
      // File doesn't exist — fall back to heuristics silently
    }
  }

  /**
   * Load a single YAML file and register its detector.
   * Returns the validation result (or null if the file couldn't be parsed).
   */
  private async loadFile(file: string): Promise<ValidationResult | null> {
    try {
      const raw = await fs.readFile(file, 'utf-8')
      const parsed = yaml.load(raw)
      const config = DetectorConfigSchema.parse(parsed)

      // Fail-fast expression validation
      const validation = validateDetector(config)
      this.validationResults.set(config.id, validation)

      if (!validation.valid) {
        log.warn(
          { detector_id: config.id, errors: validation.errors },
          'Detector has validation errors — skipping',
        )
        return validation
      }

      for (const warning of validation.warnings) {
        log.warn({ detector_id: config.id, warning }, 'Detector validation warning')
      }

      const detector = new Detector(config)
      if (this.options.featureHashScorer) {
        detector.featureHashScorer = this.options.featureHashScorer
      }
      // Computed once here (initial load and hot-reload both go through
      // loadFile), not on every evaluate() call — see Detector.configHash.
      detector.configHash = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex')
      this.detectorById.set(config.id, detector)

      for (const signalType of detector.signalTypes) {
        const existing = this.detectors.get(signalType) ?? []
        // Remove old version of this detector if re-loading
        const filtered = existing.filter((d) => d.id !== config.id)
        filtered.push(detector)
        this.detectors.set(signalType, filtered)
      }

      return validation
    } catch (err) {
      log.warn({ file, err }, 'Failed to load detector')
      return null
    }
  }

  // ─── Evaluate ─────────────────────────────────────────────────────────────

  /**
   * Evaluate all matching detectors for an incoming event.
   *
   * Algorithm (Deterministic Floor Pattern):
   *   1. Match detectors by event_type (+ wildcard '*' detectors)
   *   2. Apply CDD priority filters — skip or re-weight detectors
   *   3. Run each detector's rules deterministically (YAML conditions)
   *   4. Collect all triggered Insights with evidence chains
   *   5. Optionally enrich with LLM scoring (70/30 blend — rules always dominate)
   *   6. Sort by combined_score DESC
   *   7. Return deduplicated Insights
   */
  async evaluate(input: EvaluateInput): Promise<EngineResult> {
    if (!this.loaded) await this.load()

    const startMs = Date.now()
    const evaluationId = crypto.randomUUID()
    const { event_type, tenant_id, event_id, data, business_context, history } = input

    const context: EvaluationContext = {
      tenant_id,
      signal_type: event_type,
      data,
      ...(business_context !== undefined && { business_context }),
      ...(input.adaptive_thresholds !== undefined && {
        adaptive_thresholds: input.adaptive_thresholds,
      }),
      ...(input.goal_kpi_targets !== undefined && { goal_kpi_targets: input.goal_kpi_targets }),
      ...(input.derived_from_signals !== undefined && {
        derived_from_signals: input.derived_from_signals,
      }),
      ...(history !== undefined && { history }),
    }

    // ── Inject lightweight ML context ──────────────────────────────────────
    await this.injectMLContext(context, event_type)

    const activeDetectorIds = input.active_detector_ids ? new Set(input.active_detector_ids) : null
    const matchingDetectors = this.getMatchingDetectors(event_type)
      .filter((detector) => !activeDetectorIds || activeDetectorIds.has(detector.id))
      .filter((detector) =>
        detectorSupportsSchema(detector, event_type, input.schema_version ?? '0.0.0'),
      )
    this.correlationBuffer.add({
      tenant_id,
      evidence_type: event_type,
      evidence_id: event_id,
      data,
      observed_at: new Date(),
    })

    const allResults: EvaluationResult[] = []
    let detectors_run = 0
    let rules_triggered = 0

    for (const detector of matchingDetectors) {
      let detectorContext = context
      if (detector.config.correlation) {
        const evidenceTypes = detector.config.evidence_types ?? detector.config.signal_types
        const window = this.correlationBuffer.aggregate(
          tenant_id,
          evidenceTypes,
          detector.config.correlation.window_hours,
          detector.config.correlation.min_evidence_count,
          detector.config.correlation.require_all,
        )
        if (!window.complete) continue
        detectorContext = {
          ...context,
          data: { ...window.data, ...data },
          derived_from_signals: window.evidence_ids,
        }
      }
      const detStart = Date.now()
      const result = await detector.detectAll(detectorContext, event_id)
      const detLatency = Date.now() - detStart

      allResults.push(result)
      detectors_run++
      rules_triggered += result.triggered_rules.length

      // Record per-detector metrics
      this.metrics.record({
        detector_id: detector.id,
        latency_ms: detLatency,
        rules_triggered: result.triggered_rules.length,
        insights_produced: result.insights.length,
      })

      // Buffer traces for explain()
      for (const insight of result.insights) {
        this.bufferTrace({
          insight_id: insight.id,
          evaluation_id: evaluationId,
          detector_config_hash: detector.configHash!,
          detector_id: detector.id,
          rule_id: insight.rule_id,
          matched_condition: `rule:${insight.rule_id}`,
          evaluated_at: insight.created_at,
          latency_ms: detLatency,
          input_data: data,
          business_context: business_context ?? {},
        })
      }
    }

    let insights = allResults.flatMap((r) => r.insights)

    // LLM enrichment — 70% rule + 30% LLM, graceful degradation
    if (this.options.llmScorer && insights.length > 0) {
      const blendPolicies = new Map(
        matchingDetectors.map((detector) => [detector.id, detector.config.blend_policy]),
      )
      const reasoning = await this.applyReasoningContext(insights, context)
      insights = await this.applyLlmScoring(
        reasoning.insights,
        context,
        blendPolicies,
        reasoning.contexts,
      )
    }

    // Sort by combined_score DESC
    insights.sort(
      (a, b) => b.confidence_breakdown.combined_score - a.confidence_breakdown.combined_score,
    )

    const latency_ms = Date.now() - startMs

    return {
      insights,
      detectors_run,
      rules_triggered,
      evaluated_at: new Date(),
      latency_ms,
    }
  }

  private async applyReasoningContext(
    insights: Insight[],
    context: EvaluationContext,
  ): Promise<{ insights: Insight[]; contexts: Map<string, ReasoningContext> }> {
    const contexts = new Map<string, ReasoningContext>()
    if (!this.options.reasoningContextBuilder) return { insights, contexts }
    const enriched: Insight[] = []
    for (const insight of insights) {
      try {
        const retrieved = await this.options.reasoningContextBuilder.assemble({
          tenant_id: context.tenant_id,
          detector_id: insight.detector_id,
          query_text: `${insight.hypothesis} ${insight.reasoning}`,
          token_budget: 1_500,
        })
        contexts.set(insight.id, retrieved)
        enriched.push({
          ...insight,
          confidence_breakdown: {
            ...insight.confidence_breakdown,
            grounded_in_history:
              retrieved.episodic_snippets.length + retrieved.semantic_snippets.length > 0,
            rag_context_tokens: retrieved.tokens_used,
          },
        })
      } catch {
        enriched.push({
          ...insight,
          confidence_breakdown: {
            ...insight.confidence_breakdown,
            grounded_in_history: false,
            rag_context_tokens: 0,
          },
        })
      }
    }
    return { insights: enriched, contexts }
  }

  /**
   * Streaming evaluation — yields Insights one-by-one as each detector fires.
   * Ideal for real-time pipelines where you want to persist/send insights
   * without waiting for all detectors to complete.
   *
   * LLM scoring is applied per-detector rather than in batch.
   */
  async *evaluateStream(input: EvaluateInput): AsyncIterable<Insight> {
    const result = await this.evaluate(input)
    for (const insight of result.insights) yield insight
  }

  // ─── Explain ──────────────────────────────────────────────────────────────

  /**
   * Return the full evaluation trace for a given Insight ID.
   * Traces are kept for the last 1000 evaluations (ring buffer).
   */
  explain(insightId: string): InsightTrace | null {
    return this.traceBuffer.get(insightId) ?? null
  }

  /**
   * Get database index statistics for monitoring
   */
  async getIndexStats(): Promise<Record<string, any> | null> {
    if (!this.indexManager) return null
    return this.indexManager.getIndexStats()
  }

  // ─── Inventory ────────────────────────────────────────────────────────────

  /**
   * Return the full detector inventory with validation status.
   * Used by GET /engine/detectors.
   */
  inventory(): DetectorInventoryEntry[] {
    const entries: DetectorInventoryEntry[] = []

    for (const [id, detector] of this.detectorById) {
      const config = detector.config
      entries.push({
        id,
        name: config.name,
        ...(config.description !== undefined && { description: config.description }),
        version: config.version,
        signal_types: config.signal_types,
        industries: config.industries,
        ...(config.blend_policy && { blend_policy: config.blend_policy }),
        rules: config.rules.map((r) => ({
          id: r.id,
          name: r.name,
          confidence: r.confidence,
          condition: typeof r.condition === 'string' ? r.condition : JSON.stringify(r.condition),
        })),
        validation: this.validationResults.get(id) ?? { valid: true, errors: [], warnings: [] },
      })
    }

    return entries.sort((a, b) => a.id.localeCompare(b.id))
  }

  // ─── Accessors ────────────────────────────────────────────────────────────

  get detectorCount(): number {
    return this.detectorById.size
  }

  get registeredSignalTypes(): string[] {
    return [...this.detectors.keys()]
  }

  get isLoaded(): boolean {
    return this.loaded
  }

  // ─── Hot-reload ───────────────────────────────────────────────────────────

  private startWatcher(): void {
    const dir = this.options.detectorsDir
    try {
      this.watcher = chokidar.watch(dir, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      })

      this.watcher.on('change', async (filePath: string) => {
        if (/\.ya?ml$/i.test(filePath)) {
          const filename = path.basename(filePath)
          log.info({ filename }, 'Hot-reloading detector')
          await this.loadFile(filePath).catch((err) =>
            log.warn({ filename, err }, 'Hot-reload failed'),
          )
        }
      })

      this.watcher.on('add', async (filePath: string) => {
        if (/\.ya?ml$/i.test(filePath)) {
          const filename = path.basename(filePath)
          log.info({ filename }, 'Loading new detector')
          await this.loadFile(filePath).catch((err) => log.warn({ filename, err }, 'Load failed'))
        }
      })

      this.watcher.on('unlink', async (filePath: string) => {
        if (/\.ya?ml$/i.test(filePath)) {
          const filename = path.basename(filePath)
          log.info({ filename }, 'Unloading detector')
          // Remove detector from memory
          const detectorId = path.basename(filePath, path.extname(filePath))
          this.detectorById.delete(detectorId)
          // Remove from signal type mappings
          for (const [signalType, detectors] of this.detectors.entries()) {
            this.detectors.set(
              signalType,
              detectors.filter((d) => d.id !== detectorId),
            )
          }
        }
      })

      // Register cleanup on process exit
      process.on('SIGTERM', () => this.shutdown().catch(() => {}))
      process.on('SIGINT', () => this.shutdown().catch(() => {}))
    } catch (err) {
      log.warn({ err }, 'Hot-reload: chokidar failed to start')
    }
  }

  /** Clean up watcher and resources */
  async shutdown(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Inject novelty scores, CUSUM change-point context, and model scores into
   * the EvaluationContext before rule evaluation. All operations are O(features)
   * and run from in-memory caches — no DB round-trips on the hot path.
   */
  private async injectMLContext(context: EvaluationContext, eventType: string): Promise<void> {
    const { tenant_id, data } = context

    // ── Novelty scores ──────────────────────────────────────────────────────
    const noveltyFields =
      this.options.noveltyFields?.[eventType] ?? this.options.noveltyFields?.['*']
    if (this.options.noveltyTracker && noveltyFields && noveltyFields.length > 0) {
      try {
        const noveltyCtx = this.options.noveltyTracker.buildContext(tenant_id, data, noveltyFields)
        context.novelty_scores = noveltyCtx.scores
        // Flush asynchronously — don't block the hot path
        this.options.noveltyTracker.flush(tenant_id).catch(() => {})
      } catch {
        // Novelty failure is non-fatal — rules proceed without novelty context
      }
    }

    // ── CUSUM change-point detection ────────────────────────────────────────
    const cpFields =
      this.options.changePointFields?.[eventType] ?? this.options.changePointFields?.['*']
    if (this.options.changePointDetector && cpFields && cpFields.length > 0) {
      try {
        const cpResults = await this.options.changePointDetector.updateMany(
          tenant_id,
          data,
          cpFields,
        )
        context.change_point = this.options.changePointDetector.buildContext(cpResults)
      } catch {
        // Change-point failure is non-fatal
      }
    }

    // ── Cross-signal tenant-level score ────────────────────────────────────
    // Learns patterns across ALL detectors/signal types for the same entity.
    // Requires a recentInsightsProvider to fetch recent insights for the entity.
    if (this.options.tenantLevelScorer && this.options.recentInsightsProvider) {
      try {
        const entityKey = this.extractEntityKey(data)
        if (entityKey) {
          const recentInsights = await this.options.recentInsightsProvider(tenant_id, entityKey)
          const result = await this.options.tenantLevelScorer.score(
            tenant_id,
            entityKey,
            eventType,
            undefined,
            recentInsights,
          )
          context.tenant_level_score = result.score
        }
      } catch {
        // Tenant-level scoring failure is non-fatal
      }
    }
  }

  /** Extract the entity key from event data (same logic as detector.ts). */
  private extractEntityKey(data: Record<string, unknown>): string {
    const fields = ['goal_id', 'ticker', 'symbol', 'customer_id', 'connector']
    for (const field of fields) {
      const value = data[field]
      if (value !== undefined) return String(value)
    }
    return ''
  }

  private getMatchingDetectors(eventType: string): Detector[] {
    return [...(this.detectors.get(eventType) ?? []), ...(this.detectors.get('*') ?? [])]
  }

  private async applyLlmScoring(
    insights: Insight[],
    context: EvaluationContext,
    blendPolicies?: ReadonlyMap<
      string,
      { rule_weight: number; llm_weight: number; llm_weight_ceiling: number } | undefined
    >,
    reasoningContexts?: ReadonlyMap<string, ReasoningContext>,
  ): Promise<Insight[]> {
    const policy = this.options.llmScoringPolicy ?? {}
    const maxOrScore = policy.maxOrScoreToEnrich ?? 0.9
    const batchCap = policy.batchCap ?? 10
    const defaultBlend = { rule_weight: 0.7, llm_weight: 0.3, llm_weight_ceiling: 0.9 }

    // ── Escalation gate ───────────────────────────────────────────────────────
    // Decide which insights are escalated to the LLM scorer. When the ADR-0068
    // cascade is enabled, a per-tenant conformal threshold τ (bounding the
    // wrong-skip rate) governs escalation and DRR telemetry is recorded;
    // otherwise the legacy static `maxOrScoreToEnrich` gate is used. Either way
    // the deterministic floor (rules) always dominates the authoritative blend.
    let toEnrich: Insight[]
    let passThrough: Insight[]
    if (this.options.cascadePolicy?.enabled && this.options.conformalGate) {
      const scorer = new CascadeScorer({ ...this.options.cascadePolicy, batchCap })
      const threshold = this.options.conformalGate.getThreshold(context.tenant_id)
      const result = scorer.decide(insights, threshold)
      this.cascadeTelemetry.set(context.tenant_id, result.telemetry)
      toEnrich = result.escalate
      passThrough = result.deterministic
      log.debug(
        {
          escalated: toEnrich.length,
          total: insights.length,
          tau: threshold.tau,
          alpha: threshold.alpha,
          drr: result.telemetry.drr,
          fallback: threshold.fallback,
        },
        'Cascade escalation gate',
      )
    } else {
      // High-confidence rule matches (or_score ≥ maxOrScore) pass through unchanged.
      // At 70/30 blend, the LLM can shift combined_score by at most 3 points when
      // or_score = 0.90, making the call wasteful. Gate it out for free savings.
      toEnrich = insights
        .filter((i) => i.confidence_breakdown.or_score < maxOrScore)
        .slice(0, batchCap)
      passThrough = insights.filter((i) => i.confidence_breakdown.or_score >= maxOrScore)
      const gatedCount = insights.length - toEnrich.length
      if (gatedCount > 0) {
        log.debug(
          { scoring: toEnrich.length, total: insights.length, passThrough: gatedCount },
          'LLM scoring gate',
        )
      }
    }

    if (toEnrich.length === 0) return insights

    try {
      const scores = await this.options.llmScorer!.score(toEnrich, context, reasoningContexts)
      const enriched = toEnrich.map((insight) => {
        const llm_score = scores.get(insight.id)
        if (llm_score === undefined) return insight

        // Combined = rule_weight * or_score + llm_weight * llm_score (with ceiling)
        const blend = blendPolicies?.get(insight.detector_id) ?? defaultBlend
        const combined_score =
          insight.confidence_breakdown.or_score * blend.rule_weight +
          llm_score * Math.min(blend.llm_weight, blend.llm_weight_ceiling)

        return {
          ...insight,
          confidence_breakdown: {
            ...insight.confidence_breakdown,
            llm_score,
            combined_score,
          },
          ...(insight.evidence_trail && {
            evidence_trail: {
              ...insight.evidence_trail,
              llm_evidence: {
                model: insight.confidence_breakdown.model_version,
                prompt_summary: `Scored detector ${insight.detector_id} reasoning against the triggering evidence`,
                llm_score,
                combined_score,
                blend_weights: { rule: blend.rule_weight, llm: blend.llm_weight },
              },
            },
          }),
        }
      })
      // ── Score calibration ─────────────────────────────────────────────────
      // Apply per-detector temperature scaling to correct overconfidence.
      // Runs synchronously from in-memory cache — zero DB round-trips on hot path.
      const calibrated = this.options.calibrator
        ? enriched.map((insight) => {
            const adjustedScore = this.options.calibrator!.calibrateSync(
              context.tenant_id,
              insight.detector_id ?? '',
              insight.confidence_breakdown.combined_score,
            )
            return {
              ...insight,
              confidence_breakdown: {
                ...insight.confidence_breakdown,
                combined_score: adjustedScore,
              },
            }
          })
        : enriched

      return [...calibrated, ...passThrough]
    } catch (err) {
      // LLM scorer failure = graceful degradation, rule scores stand
      log.warn({ err }, 'LLM scorer failed, using rule scores only')
      return insights
    }
  }

  private bufferTrace(trace: InsightTrace): void {
    // Ring buffer — evict oldest when full
    if (this.traceOrder.length >= this.TRACE_BUFFER_SIZE) {
      const oldest = this.traceOrder.shift()!
      this.traceBuffer.delete(oldest)
    }
    this.traceBuffer.set(trace.insight_id, trace)
    this.traceOrder.push(trace.insight_id)
  }

  private async findYamlFiles(dir: string): Promise<string[]> {
    const results: string[] = []
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          results.push(...(await this.findYamlFiles(fullPath)))
        } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
          results.push(fullPath)
        }
      }
    } catch {
      // Directory doesn't exist or unreadable — return empty
    }
    return results
  }
}
