/**
 * Tests for Decision Support Quality fields (item 03):
 * alternatives/risk_assessment/exit_criteria in the Trigger schema.
 *
 * The sibling coverage for alternatives_template/risk_template/
 * exit_criteria_template in the trading detector YAMLs was removed
 * 2026-09-12 along with detectors/trading/ itself — see ARCHITECTURE.md.
 */

import { describe, it, expect } from 'vitest'
import { TriggerSchema } from '../schemas.js'

describe('Decision Support Quality: Trigger schema', () => {
  it('accepts alternatives, risk_assessment, and exit_criteria', () => {
    const insight = TriggerSchema.parse({
      id: 'test-1',
      tenant_id: 'tenant-1',
      hypothesis: 'test_hypothesis',
      category: 'risk',
      urgency: 'high',
      estimated_impact_low: 0,
      estimated_impact_high: 10000,
      reasoning: 'Test reasoning',
      actions: ['Review'],
      alternatives: [
        { label: 'Option A', why_not: 'Too expensive', forecast_low: -1000, forecast_high: 5000 },
        { label: 'Option B', why_not: 'Too slow' },
      ],
      risk_assessment: 'Downside risk is significant.',
      exit_criteria: 'Auto-archive when price recovers.',
      confidence_breakdown: {
        or_score: 0.85,
        combined_score: 0.85,
        model_version: 'test@1.0.0',
        evidence_refs: ['event-1'],
      },
      detector_id: 'test_detector',
      rule_id: 'test_rule',
    })
    expect(insight.alternatives).toHaveLength(2)
    expect(insight.alternatives![0]!.label).toBe('Option A')
    expect(insight.alternatives![0]!.why_not).toBe('Too expensive')
    expect(insight.risk_assessment).toBe('Downside risk is significant.')
    expect(insight.exit_criteria).toBe('Auto-archive when price recovers.')
  })

  it('accepts insights without the new fields (backward compatibility)', () => {
    const insight = TriggerSchema.parse({
      id: 'test-2',
      tenant_id: 'tenant-1',
      hypothesis: 'test_hypothesis',
      category: 'risk',
      urgency: 'low',
      estimated_impact_low: 0,
      estimated_impact_high: 1000,
      reasoning: 'Test',
      actions: [],
      confidence_breakdown: {
        or_score: 0.85,
        combined_score: 0.85,
        model_version: 'test@1.0.0',
        evidence_refs: ['event-1'],
      },
      detector_id: 'test_detector',
      rule_id: 'test_rule',
    })
    expect(insight.alternatives).toBeUndefined()
    expect(insight.risk_assessment).toBeUndefined()
    expect(insight.exit_criteria).toBeUndefined()
  })
})
