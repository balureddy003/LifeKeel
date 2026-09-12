/**
 * Detector Eval Runner — precision/recall evaluation for detector YAML configs.
 *
 * Without this, tuning detectors is pure guesswork. This module provides:
 *
 *   1. Run a detector against a labelled golden dataset
 *   2. Compute precision, recall, F1 per detector
 *   3. Compare against a stored baseline to detect regression ("detector drift")
 *   4. Surface false positives and false negatives for debugging
 *
 * Golden datasets are YAML/JSON files in a configurable directory:
 *   eval-cases/
 *     late-payment-risk.yaml   — cases for the "late-payment-risk" detector
 *     churn-risk.yaml
 *     ...
 *
 * Format:
 *   cases:
 *     - id: case-001
 *       event_type: invoice.created
 *       data:
 *         days_overdue: 45
 *         amount_minor: 250000
 *       expected_insights:
 *         - rule_id: overdue_45_days
 *           min_or_score: 0.7
 *       expected_silent: false
 *
 * Usage:
 *   const runner = new DetectorEvalRunner(engine, './eval-cases')
 *   const report = await runner.run('late-payment-risk')
 *   console.log(report.f1)  // 0.94
 *
 *   // Detect regression vs. last baseline
 *   const drift = await runner.compareToBaseline(db, 'late-payment-risk', 'baseline-2025-01')
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { DEFAULT_GOAL_KPI_TARGETS } from '@agentoak/platform'
import type { Engine } from './engine.js'
import type { Insight } from './schemas.js'
// MongoDB Db is injected at runtime (engine package does not depend on mongodb directly)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { collection: (name: string) => any }

// ── Eval case types ────────────────────────────────────────────────────────────

export interface EvalExpectedInsight {
  /** rule_id that must appear in at least one triggered insight. */
  rule_id: string
  /** Minimum or_score the triggered insight must have. Default: 0.7. */
  min_or_score?: number
}

export interface EvalCase {
  id: string
  event_type: string
  data: Record<string, unknown>
  /** Optional goal KPI targets used by goal-conditioned detector rules. */
  goal_kpi_targets?: Record<string, number>
  /** Optional business context passed through to the engine. */
  business_context?: Record<string, unknown>
  /** If non-empty, at least these insights must be produced. */
  expected_insights?: EvalExpectedInsight[]
  /** If true, the detector must produce zero insights for this case. */
  expected_silent?: boolean
  /** Human-readable description of what this case tests. */
  description?: string
}

// ── Report types ───────────────────────────────────────────────────────────────

export interface EvalCaseResult {
  case_id: string
  passed: boolean
  actual_insights: Pick<Insight, 'id' | 'detector_id' | 'rule_id' | 'confidence_breakdown'>[]
  missing_rules: string[]    // expected rule_ids that were not triggered
  unexpected_insights: string[] // triggered rule_ids not in expected set (when expected_silent)
  failure_reason?: string
}

export interface EvalReport {
  detector_id: string
  run_at: Date
  total_cases: number
  passed: number
  failed: number
  /** TP / (TP + FP) — of all triggered, how many should have triggered? */
  precision: number
  /** TP / (TP + FN) — of all expected, how many were actually triggered? */
  recall: number
  /** Harmonic mean of precision and recall. */
  f1: number
  false_positives: EvalCaseResult[]   // detector fired but shouldn't have
  false_negatives: EvalCaseResult[]   // detector should have fired but didn't
  case_results: EvalCaseResult[]
}

export interface EvalBaseline {
  detector_id: string
  baseline_id: string
  precision: number
  recall: number
  f1: number
  saved_at: Date
}

export interface DriftReport {
  detector_id: string
  baseline_id: string
  current: Pick<EvalReport, 'precision' | 'recall' | 'f1'>
  baseline: Pick<EvalBaseline, 'precision' | 'recall' | 'f1'>
  precision_delta: number
  recall_delta: number
  f1_delta: number
  has_regression: boolean  // true if f1_delta < -0.05 (5% drop)
}

// ── DetectorEvalRunner ─────────────────────────────────────────────────────────

export class DetectorEvalRunner {
  constructor(
    private readonly engine: Engine,
    /** Directory containing `<detector_id>.yaml` eval case files. */
    private readonly evalCasesDir: string,
  ) {}

  // ── Run eval for a single detector ────────────────────────────────────────

  async run(detectorId: string): Promise<EvalReport> {
    const cases = await this.loadCases(detectorId)
    if (cases.length === 0) {
      return this.emptyReport(detectorId)
    }

    const caseResults: EvalCaseResult[] = []
    let tp = 0   // true positives: expected insight was triggered
    let fp = 0   // false positives: unexpected insight triggered (silent case)
    let fn = 0   // false negatives: expected insight not triggered

    for (const evalCase of cases) {
      const result = await this.runCase(detectorId, evalCase)
      caseResults.push(result)

      if (evalCase.expected_silent) {
        if (result.unexpected_insights.length > 0) {
          fp += result.unexpected_insights.length
        }
        // Silent case with no insights = TP (correctly suppressed)
        if (result.actual_insights.length === 0) tp++
      } else {
        const expectedCount = evalCase.expected_insights?.length ?? 0
        const triggeredExpected = expectedCount - result.missing_rules.length
        tp += triggeredExpected
        fn += result.missing_rules.length
      }
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 1
    const recall = tp + fn > 0 ? tp / (tp + fn) : 1
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

    return {
      detector_id: detectorId,
      run_at: new Date(),
      total_cases: cases.length,
      passed: caseResults.filter(r => r.passed).length,
      failed: caseResults.filter(r => !r.passed).length,
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
      f1: Math.round(f1 * 1000) / 1000,
      false_positives: caseResults.filter(r => !r.passed && r.unexpected_insights.length > 0),
      false_negatives: caseResults.filter(r => !r.passed && r.missing_rules.length > 0),
      case_results: caseResults,
    }
  }

  // ── Run eval for all detectors that have case files ──────────────────────

  async runAll(): Promise<Map<string, EvalReport>> {
    const files = await fs.readdir(this.evalCasesDir).catch(() => [] as string[])
    const detectorIds = files
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json'))
      .map(f => f.replace(/\.(yaml|yml|json)$/, ''))

    const results = new Map<string, EvalReport>()
    for (const id of detectorIds) {
      results.set(id, await this.run(id))
    }
    return results
  }

  // ── Save current eval result as a named baseline ─────────────────────────

  async saveBaseline(
    db: Db,
    detectorId: string,
    baselineId: string,
    report: EvalReport,
  ): Promise<void> {
    const col = db.collection('detector_eval_baselines')
    await col.replaceOne(
      { detector_id: detectorId, baseline_id: baselineId },
      {
        detector_id: detectorId,
        baseline_id: baselineId,
        precision: report.precision,
        recall: report.recall,
        f1: report.f1,
        saved_at: new Date(),
      } as EvalBaseline,
      { upsert: true },
    )
  }

  // ── Compare current eval to a stored baseline (drift detection) ──────────

  async compareToBaseline(
    db: Db,
    detectorId: string,
    baselineId: string,
  ): Promise<DriftReport> {
    const col = db.collection('detector_eval_baselines')
    const baseline = await col.findOne({ detector_id: detectorId, baseline_id: baselineId })
    const current = await this.run(detectorId)

    if (!baseline) {
      // No baseline yet — auto-save this run as the baseline
      await this.saveBaseline(db, detectorId, baselineId, current)
      return {
        detector_id: detectorId,
        baseline_id: baselineId,
        current: { precision: current.precision, recall: current.recall, f1: current.f1 },
        baseline: { precision: current.precision, recall: current.recall, f1: current.f1 },
        precision_delta: 0,
        recall_delta: 0,
        f1_delta: 0,
        has_regression: false,
      }
    }

    const precDelta = Math.round((current.precision - baseline.precision) * 1000) / 1000
    const recallDelta = Math.round((current.recall - baseline.recall) * 1000) / 1000
    const f1Delta = Math.round((current.f1 - baseline.f1) * 1000) / 1000

    return {
      detector_id: detectorId,
      baseline_id: baselineId,
      current: { precision: current.precision, recall: current.recall, f1: current.f1 },
      baseline: { precision: baseline.precision, recall: baseline.recall, f1: baseline.f1 },
      precision_delta: precDelta,
      recall_delta: recallDelta,
      f1_delta: f1Delta,
      has_regression: f1Delta < -0.05, // >5% F1 drop = regression
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async runCase(detectorId: string, evalCase: EvalCase): Promise<EvalCaseResult> {
    // Run the engine for this case
    let actualInsights: Insight[] = []
    try {
      const result = await this.engine.evaluate({
        event_type: evalCase.event_type,
        tenant_id: `eval_${detectorId}`,   // synthetic tenant for eval
        event_id: `eval_${evalCase.id}`,
        data: evalCase.data,
        goal_kpi_targets: {
          ...DEFAULT_GOAL_KPI_TARGETS,
          ...evalCase.goal_kpi_targets,
        },
        ...(evalCase.business_context !== undefined && { business_context: evalCase.business_context }),
      })
      // Only keep insights from the target detector
      actualInsights = result.insights.filter(i => i.detector_id === detectorId)
    } catch (err) {
      return {
        case_id: evalCase.id,
        passed: false,
        actual_insights: [],
        missing_rules: evalCase.expected_insights?.map(e => e.rule_id) ?? [],
        unexpected_insights: [],
        failure_reason: `Engine error: ${(err as Error).message}`,
      }
    }

    const actualRuleIds = actualInsights.map(i => i.rule_id)

    // Silent case: expect zero insights
    if (evalCase.expected_silent) {
      return {
        case_id: evalCase.id,
        passed: actualInsights.length === 0,
        actual_insights: actualInsights.map(i => ({
          id: i.id,
          detector_id: i.detector_id,
          rule_id: i.rule_id,
          confidence_breakdown: i.confidence_breakdown,
        })),
        missing_rules: [],
        unexpected_insights: actualRuleIds,
        ...(actualInsights.length > 0
          ? { failure_reason: `Expected silent but got ${actualInsights.length} insight(s): ${actualRuleIds.join(', ')}` }
          : {}),
      }
    }

    // Expected insights: check each one
    const expected = evalCase.expected_insights ?? []
    const missingRules: string[] = []

    for (const exp of expected) {
      const minScore = exp.min_or_score ?? 0.7
      const match = actualInsights.find(i =>
        i.rule_id === exp.rule_id &&
        i.confidence_breakdown.or_score >= minScore,
      )
      if (!match) missingRules.push(exp.rule_id)
    }

    const passed = missingRules.length === 0

    return {
      case_id: evalCase.id,
      passed,
      actual_insights: actualInsights.map(i => ({
        id: i.id,
        detector_id: i.detector_id,
        rule_id: i.rule_id,
        confidence_breakdown: i.confidence_breakdown,
      })),
      missing_rules: missingRules,
      unexpected_insights: [],
      ...(missingRules.length > 0
        ? { failure_reason: `Missing expected rules: ${missingRules.join(', ')}` }
        : {}),
    }
  }

  private async loadCases(detectorId: string): Promise<EvalCase[]> {
    // Try yaml, yml, json
    for (const ext of ['yaml', 'yml', 'json']) {
      const filePath = path.join(this.evalCasesDir, `${detectorId}.${ext}`)
      try {
        const raw = await fs.readFile(filePath, 'utf8')
        const parsed = ext === 'json'
          ? JSON.parse(raw) as { cases: EvalCase[] }
          : yaml.load(raw) as { cases: EvalCase[] }
        return parsed.cases ?? []
      } catch {
        continue
      }
    }
    return []
  }

  private emptyReport(detectorId: string): EvalReport {
    return {
      detector_id: detectorId,
      run_at: new Date(),
      total_cases: 0,
      passed: 0,
      failed: 0,
      precision: 1,
      recall: 1,
      f1: 1,
      false_positives: [],
      false_negatives: [],
      case_results: [],
    }
  }
}
