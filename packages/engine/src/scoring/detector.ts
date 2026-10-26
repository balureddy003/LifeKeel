/**
 * YAML Detector
 *
 * Evaluates DetectorConfig rules against an event + business context.
 * Returns structured Insight objects — never raw strings.
 *
 * Key invariants enforced here:
 *   1. or_score MUST be ≥ 0.7 (Principle I)
 *   2. evidence_refs MUST be non-empty
 *   3. LLM may enrich but never create an Insight without a rule match
 *   4. Impact values stored as integer minor units (pence/cents) — never float
 *   5. Every insight has tenant_id from the evaluation context — never from params
 */

import crypto from 'node:crypto'
import { evaluate, evaluateNumeric, interpolate } from '../evaluator.js'
import {
  type DetectorConfig,
  type DetectorRule,
  type EvaluationContext,
  type EvaluationResult,
  type Insight,
  InsightSchema,
} from '../schemas.js'
import type { CategoryDecisionEntry } from '../engine.js'
import type { FeatureHashScorer } from './feature-hash-scorer.js'

// ─── Glob matcher ─────────────────────────────────────────────────────────────
// Minimal glob: '*' matches any sequence, '?' matches any single char.
// Used by the category decision table for O(1) pattern matching per entry.
function globMatch(pattern: string, str: string): boolean {
  if (pattern === '*') return true
  // Convert glob to regex: escape dots, replace * → .*, ? → .
  const regex = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$',
    'i',
  )
  return regex.test(str)
}

// ─── Entity key for dedup ───────────────────────────────────────────────────
// Best-effort "what is this insight about" identifier, checked in priority
// order against the same scalar feature_snapshot every insight already
// carries. Lets the persistence layer distinguish "the same rule fired again
// for the same goal/ticker/customer" (a duplicate) from "the same rule fired
// for a different one" (two legitimately separate insights) without needing
// per-detector-category logic.
// member_id / child_name bind family-domain insights to a real roster
// member or an education fund's named child — without them, two children
// or two earners collapse into one deduped insight and the stale-insight
// resolver can't tell them apart.
const ENTITY_KEY_FIELDS = [
  'goal_id',
  'ticker',
  'symbol',
  'customer_id',
  'connector',
  'member_id',
  'child_name',
] as const

function computeEntityKey(featureSnapshot: Record<string, string | number | boolean>): string {
  for (const field of ENTITY_KEY_FIELDS) {
    const value = featureSnapshot[field]
    if (value !== undefined) return String(value)
  }
  return ''
}

export class Detector {
  /** Category decision table injected by Engine at load time. */
  categoryTable?: CategoryDecisionEntry[]
  /** Feature hash scorer injected by Engine — used for score_model rules. */
  featureHashScorer?: FeatureHashScorer
  /**
   * SHA-256 of this detector's config, computed once by Engine at load/
   * hot-reload time and attached here — not recomputed per evaluate() call.
   * Benchmarked at ~0.011ms/call when it was recomputed on every evaluate(),
   * ~29% of the p50 latency of the whole call for a single matching
   * detector, for a value that's identical until the YAML actually changes.
   */
  configHash?: string

  constructor(readonly config: DetectorConfig) {}

  get id(): string {
    return this.config.id
  }

  get signalTypes(): string[] {
    return this.config.evidence_types ?? this.config.signal_types
  }

  /**
   * Evaluate all rules against the provided context.
   * Returns every matching rule as an Insight — dedup happens upstream.
   */
  async detectAll(context: EvaluationContext, eventId: string): Promise<EvaluationResult> {
    const {
      tenant_id,
      data,
      business_context = {},
      adaptive_thresholds,
      goal_kpi_targets,
      goal_id_by_metric,
    } = context

    // Flatten context for filtrex evaluation. adaptive_thresholds and
    // goal_kpi_targets are top-level EvaluationContext fields (siblings of
    // business_context, not nested inside it) — merge them into the same
    // `context` namespace filtrex conditions read from, so
    // "context.goal_kpi_targets['metric']" and
    // "context.adaptive_thresholds['metric.2sigma']" actually resolve instead
    // of silently evaluating to undefined.
    const evalCtx = {
      data,
      context: {
        ...business_context,
        ...(adaptive_thresholds !== undefined && { adaptive_thresholds }),
        ...(goal_kpi_targets !== undefined && { goal_kpi_targets }),
      },
    }

    const insights: Insight[] = []
    const triggeredRules: string[] = []

    for (const rule of this.config.rules) {
      // Suppression check — skip before full evaluation
      if (rule.suppress_if) {
        try {
          if (evaluate(rule.suppress_if, evalCtx)) continue
        } catch {
          // suppress_if evaluation failure = don't suppress
        }
      }

      // Stateful sliding window check
      if (rule.state_enabled && context.history) {
        const windowedHistory = this.getWindowedHistory(rule, context.history)
        if (!this.meetsWindowThreshold(rule, windowedHistory)) continue
      }

      // ── Lightweight ML guards ─────────────────────────────────────────────

      // Novelty guard: skip rule unless a tracked field is rare enough
      if (rule.novelty && context.novelty_scores) {
        const cfg = rule.novelty
        const scores = context.novelty_scores
        const minNovelty = cfg.min_novelty ?? 0.8
        let noveltyPassed = false

        if (cfg.field) {
          noveltyPassed = (scores[cfg.field] ?? 0) >= minNovelty
        } else {
          // Check max novelty across all tracked fields
          noveltyPassed = cfg.fields.some((f) => (scores[f] ?? 0) >= minNovelty)
        }
        if (!noveltyPassed) continue
      }

      // CUSUM guard: skip rule unless a trend shift alarm has fired
      if (rule.cusum && context.change_point) {
        const alarmKey = `${rule.cusum.field}.alarm`
        const alarm = context.change_point[alarmKey]
        if (!alarm || alarm === 0) continue

        // Optionally restrict to a specific direction
        if (rule.cusum.direction !== 'both') {
          const dirKey = `${rule.cusum.field}.direction`
          const dir = context.change_point[dirKey]
          if (dir !== rule.cusum.direction) continue
        }
      }

      // Score model: learned feature-hash model replaces or augments condition
      let modelScore: number | undefined
      if (rule.score_model && this.featureHashScorer) {
        const result = await this.featureHashScorer.score(
          tenant_id,
          this.config.id,
          data,
          rule.score_model,
        )
        modelScore = result.score
        if (!result.matched) continue // model gate
      }

      // Main condition evaluation — evaluateCondition returns true when condition is absent
      if (!rule.condition && !rule.score_model) continue // misconfigured rule
      if (!this.evaluateCondition(rule, evalCtx)) continue

      triggeredRules.push(rule.id)

      // Compute impact — always integer minor units
      const impactLow = this.computeImpact(rule.impact_low, evalCtx)
      const impactHigh = this.computeImpact(rule.impact_high, evalCtx)

      // Build reasoning from template — expose model_score for {{model_score}} interpolation
      const reasoningCtx =
        modelScore !== undefined ? { ...evalCtx, model_score: modelScore } : evalCtx
      const reasoning = interpolate(rule.reasoning_template, reasoningCtx)

      // Decision Support Quality (items 02/03): build alternatives, risk, and
      // exit_criteria from templates if the rule defines them.
      const alternatives = rule.alternatives_template?.map((alt) => ({
        label: interpolate(alt.label, reasoningCtx),
        ...(alt.why_not ? { why_not: interpolate(alt.why_not, reasoningCtx) } : {}),
        ...(alt.forecast_low !== undefined
          ? {
              forecast_low:
                typeof alt.forecast_low === 'string'
                  ? Number(this.computeImpact(alt.forecast_low, evalCtx))
                  : alt.forecast_low,
            }
          : {}),
        ...(alt.forecast_high !== undefined
          ? {
              forecast_high:
                typeof alt.forecast_high === 'string'
                  ? Number(this.computeImpact(alt.forecast_high, evalCtx))
                  : alt.forecast_high,
            }
          : {}),
      }))
      const riskAssessment = rule.risk_template
        ? interpolate(rule.risk_template, reasoningCtx)
        : undefined
      const exitCriteria = rule.exit_criteria_template
        ? interpolate(rule.exit_criteria_template, reasoningCtx)
        : undefined

      // Capture scalar fields from event data for the feature-hash learning loop.
      // Only primitives — no nested objects — to keep the document lean.
      const featureSnapshot: Record<string, string | number | boolean> = {}
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          featureSnapshot[k] = v
        }
      }
      // Gap #32: Thread goal_id into feature_snapshot so insights carry a
      // durable link back to the goal that motivated them. The goal_id is
      // determined by extracting metric names referenced in the rule's
      // condition (e.g. "context.goal_kpi_targets.portfolio_concentration_max_pct")
      // and matching them against goal_id_by_metric. This is best-effort:
      // if no match is found, goal_id is simply absent.
      if (goal_id_by_metric) {
        const conditionStr =
          typeof rule.condition === 'string'
            ? rule.condition
            : rule.score_model
              ? JSON.stringify(rule.score_model)
              : ''
        // Extract metric names from "context.goal_kpi_targets.METRIC" or
        // "context.goal_kpi_targets['METRIC']" patterns in the condition.
        const metricMatches = conditionStr.matchAll(
          /goal_kpi_targets(?:\.(\w+)|\[['"](\w+)['"]\])/g,
        )
        for (const match of metricMatches) {
          const metric = match[1] ?? match[2]
          if (metric && goal_id_by_metric[metric]) {
            featureSnapshot['goal_id'] = goal_id_by_metric[metric]
            break
          }
        }
      }
      const adaptiveThreshold = Object.entries(context.adaptive_thresholds ?? {})[0]
      const conditionExpression =
        typeof rule.condition === 'string'
          ? rule.condition
          : JSON.stringify(rule.condition ?? { score_model: rule.score_model })
      const firedAt = new Date()
      const connector =
        typeof data['connector'] === 'string'
          ? data['connector']
          : (context.signal_type?.split('.')[0] ?? 'unknown')

      const insight = InsightSchema.parse({
        id: crypto.randomUUID(),
        tenant_id, // ← from JWT context, never from request params
        hypothesis: rule.id,
        category: this.inferCategory(rule.id, context.signal_type),
        urgency: this.inferUrgency(
          rule.confidence,
          this.lookupUrgency(rule.id, context.signal_type),
        ),
        estimated_impact_low: impactLow,
        estimated_impact_high: impactHigh,
        reasoning,
        actions: rule.actions,
        ...(rule.action_intents && rule.action_intents.length > 0
          ? { action_intents: rule.action_intents }
          : {}),
        ...(alternatives && alternatives.length > 0 ? { alternatives } : {}),
        ...(riskAssessment ? { risk_assessment: riskAssessment } : {}),
        ...(exitCriteria ? { exit_criteria: exitCriteria } : {}),
        confidence_breakdown: {
          or_score: rule.confidence, // deterministic floor — rule decides
          combined_score: rule.confidence, // LLM may update this downstream
          model_version: `${this.config.id}@${this.config.version}`,
          evidence_refs: [eventId], // non-empty: the triggering event
        },
        detector_id: this.config.id,
        rule_id: rule.id,
        ...(rule.disclosure ? { disclosure: rule.disclosure } : {}),
        derived_from_signals: context.derived_from_signals ?? [],
        state: 'identified' as const,
        created_at: firedAt,
        dedup_window_ms: rule.dedup_window_ms,
        entity_key: computeEntityKey(featureSnapshot),
        ...(Object.keys(featureSnapshot).length > 0 && { feature_snapshot: featureSnapshot }),
        evidence_trail: {
          trigger_id: eventId,
          detector_id: this.config.id,
          detector_version: this.config.version,
          fired_at: firedAt,
          rule_evidence: {
            rule_id: rule.id,
            condition_expression: conditionExpression,
            matched_variables: featureSnapshot,
            or_score: rule.confidence,
            threshold_used: adaptiveThreshold?.[1] ?? rule.confidence,
            threshold_basis: adaptiveThreshold
              ? `Adaptive threshold ${adaptiveThreshold[0]}`
              : 'Static detector rule confidence threshold',
          },
          source_events: [
            {
              event_id: eventId,
              event_type: context.signal_type ?? 'unknown',
              connector,
              occurred_at: firedAt,
              excerpt: reasoning,
            },
          ],
          plain_english: reasoning,
        },
      } satisfies Insight)

      insights.push(insight)
    }

    return {
      tenant_id,
      detector_id: this.config.id,
      triggered_rules: triggeredRules,
      insights,
      skipped: false,
      priority_weight: 1.0,
      evaluated_at: new Date(),
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private evaluateCondition(rule: DetectorRule, evalCtx: Record<string, unknown>): boolean {
    if (rule.condition === undefined) return true // no condition = score_model only
    if (typeof rule.condition === 'string') {
      try {
        return evaluate(rule.condition, evalCtx)
      } catch {
        return false
      }
    }
    // Nested logic gate
    return this.evaluateLogicGate(rule.condition, evalCtx)
  }

  private evaluateLogicGate(condition: unknown, evalCtx: Record<string, unknown>): boolean {
    // Type narrowing for nested conditions
    const cond = condition as { expression?: string; logic_gate?: string; children?: unknown[] }

    if (cond.expression) {
      try {
        return evaluate(cond.expression, evalCtx)
      } catch {
        return false
      }
    }

    const children = (cond.children ?? []) as (typeof cond)[]

    switch (cond.logic_gate) {
      case 'AND':
        return children.every((c) => this.evaluateLogicGate(c, evalCtx))
      case 'OR':
        return children.some((c) => this.evaluateLogicGate(c, evalCtx))
      case 'NOT':
        return !this.evaluateLogicGate(children[0] ?? {}, evalCtx)
      default:
        return false
    }
  }

  private computeImpact(expr: string | number, evalCtx: Record<string, unknown>): number {
    const result = evaluateNumeric(expr, evalCtx)
    if (result === null) return 0
    // Always store as integer minor units (pence/cents)
    return Math.round(result)
  }

  private inferCategory(ruleId: string, signalType?: string): Insight['category'] {
    // ── Decision table lookup (O(k), first-match wins) ─────────────────────────
    // Replaces brittle string.includes() heuristics that misclassify rules like
    // "upsell_cost_recovery" (matches both 'upsell'→revenue and 'cost'→cost-savings).
    // The table is loaded from category-table.yaml at engine startup.
    if (this.categoryTable) {
      for (const entry of this.categoryTable) {
        if (
          globMatch(entry.signal_type_pattern, signalType ?? '*') &&
          globMatch(entry.rule_id_pattern, ruleId)
        ) {
          return entry.category
        }
      }
    }
    // ── Fallback: prefix/suffix heuristics (non-overlapping, intentionally explicit) ──
    const id = ruleId.toLowerCase()
    if (
      id.startsWith('rev_') ||
      id.endsWith('_revenue') ||
      id.includes('_upsell') ||
      id.includes('_recovery')
    )
      return 'revenue'
    if (
      id.startsWith('cost_') ||
      id.endsWith('_cost') ||
      id.includes('_duplicate') ||
      id.includes('_saving')
    )
      return 'cost-savings'
    if (
      id.startsWith('risk_') ||
      id.endsWith('_risk') ||
      id.includes('_churn') ||
      id.includes('_cashflow')
    )
      return 'risk'
    if (
      id.startsWith('comp_') ||
      id.endsWith('_compliance') ||
      id.includes('_gdpr') ||
      id.includes('_legal')
    )
      return 'compliance'
    if (id.startsWith('goal_')) return 'goal_progress'
    return 'experience'
  }

  private lookupUrgency(ruleId: string, signalType?: string): Insight['urgency'] | undefined {
    if (!this.categoryTable) return undefined
    for (const entry of this.categoryTable) {
      if (
        entry.urgency &&
        globMatch(entry.signal_type_pattern, signalType ?? '*') &&
        globMatch(entry.rule_id_pattern, ruleId)
      ) {
        return entry.urgency
      }
    }
    return undefined
  }

  private inferUrgency(confidence: number, tableUrgency?: Insight['urgency']): Insight['urgency'] {
    // Table-supplied urgency takes precedence (explicit beats heuristic)
    if (tableUrgency) return tableUrgency
    // Confidence-derived urgency: the correct semantic — reflects certainty, not just rule type
    if (confidence >= 0.95) return 'critical'
    if (confidence >= 0.85) return 'high'
    if (confidence >= 0.75) return 'medium'
    return 'low'
  }

  private getWindowedHistory(rule: DetectorRule, history: EvaluationContext['history']) {
    if (!history) return []
    const now = Date.now()
    return history.filter((h) => {
      if (h.rule_id !== rule.id) return false
      if (rule.window_duration_ms) {
        return now - h.evaluated_at.getTime() <= rule.window_duration_ms
      }
      return true
    })
  }

  private meetsWindowThreshold(
    rule: DetectorRule,
    windowedHistory: NonNullable<EvaluationContext['history']>,
  ): boolean {
    if (rule.window_size && windowedHistory.length < rule.window_size) {
      return false
    }
    return true
  }
}
