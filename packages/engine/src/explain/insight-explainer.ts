/**
 * Plain Language Insight Explainer
 *
 * Converts technical insight objects into user-friendly explanations
 * that non-technical users can understand and act upon.
 *
 * Features:
 *   - Simplifies technical jargon (CUSUM, Bollinger Bands, adaptive thresholds)
 *   - Generates confidence explanations (highly likely, likely, possible)
 *   - Explains impact in business terms (revenue, cost, risk)
 *   - Summarizes evidence trails
 *   - Provides actionable next steps
 */

import type { Insight, ConfidenceBreakdown, EvidenceTrail } from '../schemas.js'

export interface UserFriendlyExplanation {
  headline: string
  what_happened: string
  why_important: string
  confidence: string
  confidence_level: 'high' | 'medium' | 'low'
  what_to_do: string[]
  evidence: string
  technical_details?: {
    or_score: number
    llm_score: number | undefined
    combined_score: number
    rule_id: string
    detector_id: string
  }
}

export class InsightExplainer {
  /**
   * Convert a technical insight into a user-friendly explanation
   */
  explain(insight: Insight): UserFriendlyExplanation {
    const {
      hypothesis,
      reasoning,
      confidence_breakdown,
      estimated_impact_low,
      estimated_impact_high,
      actions,
      evidence_trail,
    } = insight

    const headline = this.generateHeadline(hypothesis, confidence_breakdown.or_score)
    const what_happened = this.simplifyReasoning(reasoning)
    const why_important = this.explainImpact(estimated_impact_low, estimated_impact_high)
    const confidence = this.explainConfidence(confidence_breakdown)
    const confidence_level = this.getConfidenceLevel(confidence_breakdown.or_score)
    const what_to_do = this.simplifyActions(actions)
    const evidence = this.summarizeEvidence(evidence_trail)

    return {
      headline,
      what_happened,
      why_important,
      confidence,
      confidence_level,
      what_to_do,
      evidence,
      technical_details: {
        or_score: confidence_breakdown.or_score,
        llm_score: confidence_breakdown.llm_score,
        combined_score: confidence_breakdown.combined_score,
        rule_id: insight.rule_id,
        detector_id: insight.detector_id,
      },
    }
  }

  /**
   * Generate a user-friendly headline based on hypothesis and confidence
   */
  private generateHeadline(hypothesis: string, orScore: number): string {
    const confidence = orScore >= 0.9 ? 'Highly likely' : orScore >= 0.8 ? 'Likely' : 'Possible'
    const hypothesisLower = hypothesis.toLowerCase()

    // Remove technical terms from headline
    const simplified = hypothesisLower
      .replace(/(\d+)σ/g, 'standard deviations')
      .replace(/cusum/g, 'trend analysis')
      .replace(/bollinger bands/g, 'statistical range')
      .replace(/adaptive threshold/g, 'personalized limit')
      .replace(/novelty score/g, 'rarity score')

    return `${confidence}: ${simplified.charAt(0).toUpperCase() + simplified.slice(1)}`
  }

  /**
   * Simplify technical reasoning into plain language
   */
  private simplifyReasoning(reasoning: string): string {
    return reasoning
      .replace(/(\d+)σ/g, 'standard deviations')
      .replace(/CUSUM/g, 'trend analysis')
      .replace(/Bollinger Bands/g, 'statistical range')
      .replace(/adaptive threshold/g, 'personalized limit')
      .replace(/novelty score/g, 'rarity score')
      .replace(/change-point detection/g, 'trend change detection')
      .replace(/Count-Min Sketch/g, 'frequency analysis')
      .replace(/feature hash/g, 'pattern recognition')
      .replace(/temporal pattern/g, 'time-based pattern')
      .replace(/correlation buffer/g, 'related events')
      .replace(/evidence_refs/g, 'supporting data')
      .replace(/or_score/g, 'rule confidence')
      .replace(/llm_score/g, 'AI confidence')
      .replace(/combined_score/g, 'overall confidence')
  }

  /**
   * Explain impact in business terms
   */
  private explainImpact(impactLow: number, impactHigh: number): string {
    if (impactLow === 0 && impactHigh === 0) {
      return 'This insight was detected but has no estimated financial impact.'
    }

    const formatCurrency = (value: number) => {
      if (value >= 1000000) {
        return `£${(value / 1000000).toFixed(1)}M`
      } else if (value >= 1000) {
        return `£${(value / 1000).toFixed(1)}K`
      } else {
        return `£${value.toFixed(0)}`
      }
    }

    const lowFormatted = formatCurrency(impactLow)
    const highFormatted = formatCurrency(impactHigh)

    if (impactLow === impactHigh) {
      return `This insight has an estimated impact of ${lowFormatted}.`
    } else {
      return `This insight has an estimated impact between ${lowFormatted} and ${highFormatted}.`
    }
  }

  /**
   * Explain confidence in user-friendly terms
   */
  private explainConfidence(breakdown: ConfidenceBreakdown): string {
    const { or_score, llm_score, combined_score } = breakdown

    let explanation = `Overall confidence: ${(combined_score * 100).toFixed(0)}%. `

    if (or_score >= 0.9) {
      explanation += 'The rule-based analysis is very confident in this insight. '
    } else if (or_score >= 0.8) {
      explanation += 'The rule-based analysis is confident in this insight. '
    } else {
      explanation += 'The rule-based analysis has moderate confidence in this insight. '
    }

    if (llm_score !== undefined) {
      if (llm_score >= 0.8) {
        explanation += 'AI analysis also supports this conclusion. '
      } else if (llm_score >= 0.6) {
        explanation += 'AI analysis provides moderate support. '
      } else {
        explanation += 'AI analysis is less certain. '
      }
    }

    return explanation.trim()
  }

  /**
   * Get confidence level for UI styling
   */
  private getConfidenceLevel(orScore: number): 'high' | 'medium' | 'low' {
    if (orScore >= 0.9) return 'high'
    if (orScore >= 0.8) return 'medium'
    return 'low'
  }

  /**
   * Simplify action items into user-friendly next steps
   */
  private simplifyActions(actions: string[]): string[] {
    return actions.map((action) => {
      return action
        .replace(/Escalate to/g, 'Send to')
        .replace(/Send payment reminder/g, 'Request payment')
        .replace(/Initiate collection/g, 'Start collection process')
        .replace(/Review manually/g, 'Review this case')
        .replace(/Flag for review/g, 'Mark for review')
        .replace(/Create support ticket/g, 'Open support case')
        .replace(/Notify manager/g, 'Alert your manager')
        .replace(/Block transaction/g, 'Prevent this transaction')
        .replace(/Require approval/g, 'Request approval')
    })
  }

  /**
   * Summarize evidence trail into a concise explanation
   */
  private summarizeEvidence(trail?: EvidenceTrail): string {
    if (!trail) {
      return 'This insight is based on rule analysis without specific event evidence.'
    }

    const parts: string[] = []

    if (trail.source_events && trail.source_events.length > 0) {
      const eventCount = trail.source_events.length
      parts.push(`Based on ${eventCount} event${eventCount > 1 ? 's' : ''}`)

      // Add event types if available
      const eventTypes = [...new Set(trail.source_events.map((e) => e.event_type))]
      if (eventTypes.length > 0) {
        parts.push(`(${eventTypes.join(', ')})`)
      }
    }

    if (trail.fired_at) {
      const timeAgo = this.getTimeAgo(trail.fired_at)
      parts.push(`detected ${timeAgo}`)
    }

    if (trail.detector_id) {
      parts.push(`by detector: ${trail.detector_id}`)
    }

    return parts.length > 0 ? parts.join(' ') + '.' : 'No specific evidence available.'
  }

  /**
   * Get human-readable time ago string
   */
  private getTimeAgo(date: Date): string {
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
    return `${date.toLocaleDateString()}`
  }

  /**
   * Generate a summary for dashboard cards
   */
  generateSummary(insight: Insight): string {
    const explanation = this.explain(insight)
    return `${explanation.headline}. ${explanation.what_happened}`
  }

  /**
   * Generate tooltip text for hover states
   */
  generateTooltip(insight: Insight): string {
    const explanation = this.explain(insight)
    return `${explanation.confidence} | ${explanation.why_important}`
  }
}

// Singleton instance
export const insightExplainer = new InsightExplainer()
