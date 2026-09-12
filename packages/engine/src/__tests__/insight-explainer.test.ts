/**
 * Tests for InsightExplainer
 */

import { describe, it, expect } from 'vitest'
import { InsightExplainer, insightExplainer } from '../insight-explainer.js'
import type { Insight, ConfidenceBreakdown, EvidenceTrail } from '../schemas.js'

describe('InsightExplainer', () => {
  const explainer = new InsightExplainer()

  const mockInsight: Insight = {
    id: 'test-insight-1',
    tenant_id: 'tenant-123',
    detector_id: 'invoice-overdue',
    rule_id: 'high-value-overdue',
    hypothesis: 'High value invoice overdue',
    category: 'risk',
    urgency: 'high',
    reasoning: 'Invoice overdue for 7 days with amount £50000 (above 2σ threshold)',
    confidence_breakdown: {
      or_score: 0.85,
      llm_score: 0.75,
      combined_score: 0.82,
      model_version: 'gpt-4',
      evidence_refs: ['event-456']
    },
    estimated_impact_low: 50000,
    estimated_impact_high: 75000,
    actions: ['Send payment reminder', 'Escalate to collections'],
    state: 'identified',
    derived_from_signals: ['event-456'],
    created_at: new Date('2024-01-15T10:00:00Z'),
    evidence_trail: {
      trigger_id: 'trigger-123',
      detector_id: 'invoice-overdue',
      detector_version: '1.0.0',
      fired_at: new Date('2024-01-15T10:00:00Z'),
      rule_evidence: {
        rule_id: 'high-value-overdue',
        condition_expression: 'data.days_overdue >= 7 and data.amount_minor > 50000',
        matched_variables: { days_overdue: 7, amount_minor: 50000 },
        or_score: 0.85,
        threshold_used: 50000,
        threshold_basis: 'adaptive'
      },
      source_events: [
        {
          event_id: 'event-456',
          event_type: 'invoice.overdue',
          connector: 'quickbooks',
          occurred_at: new Date('2024-01-15T09:00:00Z'),
          excerpt: 'Invoice #12345 overdue'
        }
      ],
      plain_english: 'Invoice overdue for 7 days with high value'
    }
  }

  it('should generate user-friendly explanation', () => {
    const explanation = explainer.explain(mockInsight)

    expect(explanation).toHaveProperty('headline')
    expect(explanation).toHaveProperty('what_happened')
    expect(explanation).toHaveProperty('why_important')
    expect(explanation).toHaveProperty('confidence')
    expect(explanation).toHaveProperty('confidence_level')
    expect(explanation).toHaveProperty('what_to_do')
    expect(explanation).toHaveProperty('evidence')
    expect(explanation).toHaveProperty('technical_details')
  })

  it('should generate appropriate headline based on confidence', () => {
    const highConfidence = { ...mockInsight, confidence_breakdown: { ...mockInsight.confidence_breakdown, or_score: 0.95, llm_score: 0.9, combined_score: 0.93 } }
    const mediumConfidence = { ...mockInsight, confidence_breakdown: { ...mockInsight.confidence_breakdown, or_score: 0.85, llm_score: 0.75, combined_score: 0.82 } }
    const lowConfidence = { ...mockInsight, confidence_breakdown: { ...mockInsight.confidence_breakdown, or_score: 0.75, llm_score: 0.7, combined_score: 0.73 } }

    const highExpl = explainer.explain(highConfidence)
    const mediumExpl = explainer.explain(mediumConfidence)
    const lowExpl = explainer.explain(lowConfidence)

    expect(highExpl.headline).toContain('Highly likely')
    expect(mediumExpl.headline).toContain('Likely')
    expect(lowExpl.headline).toContain('Possible')
  })

  it('should simplify technical jargon in reasoning', () => {
    const technicalInsight = {
      ...mockInsight,
      reasoning: 'CUSUM detected trend change above 2σ adaptive threshold'
    }

    const explanation = explainer.explain(technicalInsight)

    expect(explanation.what_happened).not.toContain('CUSUM')
    expect(explanation.what_happened).toContain('trend analysis')
    expect(explanation.what_happened).not.toContain('2σ')
    expect(explanation.what_happened).toContain('standard deviations')
  })

  it('should explain impact in business terms', () => {
    const explanation = explainer.explain(mockInsight)

    expect(explanation.why_important).toContain('£')
    expect(explanation.why_important).toContain('50.0K')
    expect(explanation.why_important).toContain('75.0K')
  })

  it('should simplify action items', () => {
    const explanation = explainer.explain(mockInsight)

    expect(explanation.what_to_do).toContain('Request payment')
    expect(explanation.what_to_do).toContain('Send to collections')
  })

  it('should summarize evidence trail', () => {
    const explanation = explainer.explain(mockInsight)

    expect(explanation.evidence).toContain('1 event')
    expect(explanation.evidence).toContain('invoice.overdue')
  })

  it('should generate summary for dashboard cards', () => {
    const summary = explainer.generateSummary(mockInsight)

    expect(summary).toContain('Likely')
    expect(summary).toContain('High value invoice overdue')
  })

  it('should generate tooltip text', () => {
    const tooltip = explainer.generateTooltip(mockInsight)

    expect(tooltip).toContain('Overall confidence')
    expect(tooltip).toContain('estimated impact')
  })

  it('should handle insights without evidence trail', () => {
    const noEvidenceInsight = { ...mockInsight, evidence_trail: undefined }
    const explanation = explainer.explain(noEvidenceInsight)

    expect(explanation.evidence).toContain('rule analysis')
  })

  it('should handle zero impact', () => {
    const zeroImpactInsight = { ...mockInsight, estimated_impact_low: 0, estimated_impact_high: 0 }
    const explanation = explainer.explain(zeroImpactInsight)

    expect(explanation.why_important).toContain('no estimated financial impact')
  })

  it('should provide technical details', () => {
    const explanation = explainer.explain(mockInsight)

    expect(explanation.technical_details).toHaveProperty('or_score')
    expect(explanation.technical_details).toHaveProperty('llm_score')
    expect(explanation.technical_details).toHaveProperty('combined_score')
    expect(explanation.technical_details).toHaveProperty('rule_id')
    expect(explanation.technical_details).toHaveProperty('detector_id')
  })

  it('should use singleton instance', () => {
    const singletonExplanation = insightExplainer.explain(mockInsight)
    const instanceExplanation = explainer.explain(mockInsight)

    expect(singletonExplanation.headline).toBe(instanceExplanation.headline)
  })
})