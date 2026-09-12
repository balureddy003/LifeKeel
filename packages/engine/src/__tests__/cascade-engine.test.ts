import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Engine, type LlmScorer, type ReasoningContext } from '../engine.js'
import type { ConformalGateProvider } from '../cascade.js'

/**
 * End-to-end wiring test: the ADR-0068 cascade gate replaces the legacy gate in
 * the live evaluate() path, escalates only insights below tau, and records DRR
 * telemetry per tenant.
 */
const DETECTOR_YAML = `id: cascade_test
name: Cascade Test
description: Two rules with different confidences fire on the same event
version: 1.0.0
signal_types:
  - test.event
industries: ["*"]
blend_policy:
  rule_weight: 0.9
  llm_weight: 0.1
  llm_weight_ceiling: 0.1
rules:
  - id: high_conf
    name: High confidence
    condition: "data.x >= 1"
    confidence: 0.95
    impact_low: "0"
    impact_high: "0"
    reasoning_template: "high"
    actions: ["noop"]
  - id: low_conf
    name: Low confidence
    condition: "data.x >= 1"
    confidence: 0.72
    impact_low: "0"
    impact_high: "0"
    reasoning_template: "low"
    actions: ["noop"]
`

// Fixed gate: escalate insights with or_score < 0.85 (the low-confidence rule).
const fixedGate: ConformalGateProvider = {
  getThreshold: () => ({ tau: 0.85, alpha: 0.02, calibration_n: 100, fallback: false, version: 'test-v1' }),
}

// Scorer records which insights it was asked to score, returns a fixed score.
class RecordingScorer implements LlmScorer {
  scoredOrScores: number[] = []
  reasoningContexts = new Map<string, ReasoningContext>()
  async score(
    insights: { id: string; confidence_breakdown: { or_score: number } }[],
    _context: unknown,
    reasoningContexts?: ReadonlyMap<string, ReasoningContext>,
  ) {
    this.scoredOrScores.push(...insights.map(i => i.confidence_breakdown.or_score))
    for (const insight of insights) {
      const reasoningContext = reasoningContexts?.get(insight.id)
      if (reasoningContext) this.reasoningContexts.set(insight.id, reasoningContext)
    }
    return new Map(insights.map(i => [i.id, 0.8]))
  }
}

let dir: string

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kairos-cascade-'))
  await fs.writeFile(path.join(dir, 'cascade.yaml'), DETECTOR_YAML)
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('Engine cascade gate (ADR-0068)', () => {
  it('escalates only sub-tau insights and records DRR telemetry', async () => {
    const scorer = new RecordingScorer()
    const engine = new Engine({
      detectorsDir: dir,
      llmScorer: scorer,
      conformalGate: fixedGate,
      cascadePolicy: { enabled: true, alpha: 0.02 },
    })
    await engine.load()

    const result = await engine.evaluate({
      event_type: 'test.event',
      tenant_id: 'tenant-x',
      event_id: 'evt-1',
      data: { x: 1 },
    })

    // Both rules fire → two insights.
    expect(result.insights).toHaveLength(2)

    // Only the low-confidence insight (or_score 0.72 < tau 0.85) was escalated.
    expect(scorer.scoredOrScores).toEqual([0.72])

    const telemetry = engine.getCascadeTelemetry('tenant-x')
    expect(telemetry).toBeDefined()
    expect(telemetry!.total).toBe(2)
    expect(telemetry!.escalated).toBe(1)
    expect(telemetry!.deterministic).toBe(1)
    expect(telemetry!.drr).toBe(0.5)
    expect(telemetry!.calibration_version).toBe('test-v1')
  })

  it('legacy gate is used when the cascade is disabled (no telemetry)', async () => {
    const scorer = new RecordingScorer()
    const engine = new Engine({
      detectorsDir: dir,
      llmScorer: scorer,
      conformalGate: fixedGate,
      cascadePolicy: { enabled: false },
    })
    await engine.load()

    await engine.evaluate({
      event_type: 'test.event',
      tenant_id: 'tenant-y',
      event_id: 'evt-2',
      data: { x: 1 },
    })

    // Legacy gate (maxOrScoreToEnrich 0.90) escalates the 0.72 insight only.
    expect(scorer.scoredOrScores).toEqual([0.72])
    expect(engine.getCascadeTelemetry('tenant-y')).toBeUndefined()
  })

  it('passes immutable per-insight reasoning context to the LLM scorer', async () => {
    const scorer = new RecordingScorer()
    const engine = new Engine({
      detectorsDir: dir,
      llmScorer: scorer,
      reasoningContextBuilder: {
        async assemble() {
          return {
            episodic_snippets: ['Invoice was previously disputed'],
            semantic_snippets: ['Disputes reduce collection certainty'],
            goal_snippets: ['Reduce overdue invoices'],
            tokens_used: 18,
          }
        },
      },
    })
    await engine.load()

    const result = await engine.evaluate({
      event_type: 'test.event',
      tenant_id: 'tenant-rag',
      event_id: 'evt-rag',
      data: { x: 1 },
    })
    const lowConfidenceInsight = result.insights.find(insight => insight.rule_id === 'low_conf')!

    expect(scorer.reasoningContexts.get(lowConfidenceInsight.id)).toEqual({
      episodic_snippets: ['Invoice was previously disputed'],
      semantic_snippets: ['Disputes reduce collection certainty'],
      goal_snippets: ['Reduce overdue invoices'],
      tokens_used: 18,
    })
    expect(lowConfidenceInsight.confidence_breakdown.grounded_in_history).toBe(true)
    expect(lowConfidenceInsight.confidence_breakdown.rag_context_tokens).toBe(18)
  })

  it('uses the same detector eligibility and score semantics for streamed evaluation', async () => {
    const scorer = new RecordingScorer()
    const engine = new Engine({ detectorsDir: dir, llmScorer: scorer })
    await engine.load()
    const input = {
      event_type: 'test.event',
      tenant_id: 'tenant-z',
      event_id: 'evt-3',
      data: { x: 1 },
      active_detector_ids: ['cascade_test'],
      schema_version: '1.0.0',
    }

    const regular = await engine.evaluate(input)
    const trace = engine.explain(regular.insights[0]!.id)
    expect(trace?.evaluation_id).toBeTruthy()
    expect(trace?.detector_config_hash).toMatch(/^[a-f0-9]{64}$/)
    const streamed: typeof regular.insights = []
    for await (const insight of engine.evaluateStream(input)) streamed.push(insight)

    expect(regular.insights.find(insight => insight.rule_id === 'low_conf')?.confidence_breakdown.combined_score).toBeCloseTo(0.728)
    expect(streamed.map(insight => ({
      detector_id: insight.detector_id,
      rule_id: insight.rule_id,
      or_score: insight.confidence_breakdown.or_score,
      combined_score: insight.confidence_breakdown.combined_score,
    }))).toEqual(regular.insights.map(insight => ({
      detector_id: insight.detector_id,
      rule_id: insight.rule_id,
      or_score: insight.confidence_breakdown.or_score,
      combined_score: insight.confidence_breakdown.combined_score,
    })))
  })
})
