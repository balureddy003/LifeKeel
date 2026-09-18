import { describe, expect, it } from 'vitest'
import { splitInsightsByResolution } from '../HealthDomainClient'
import type { FamilyInsight } from '@/lib/api'

function makeInsight(overrides: Partial<FamilyInsight> & { id: string }): FamilyInsight {
  return {
    detector_id: 'family_protection_gap',
    rule_id: 'no_income_protection',
    hypothesis: 'no_income_protection',
    reasoning: 'test',
    actions: [],
    confidence: 0.8,
    urgency: 'medium',
    category: 'risk',
    state: 'identified',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('PRD-107: splitInsightsByResolution', () => {
  it('puts resolved insights in the resolved bucket and everything else in open', () => {
    const insights = [
      makeInsight({ id: 'a', state: 'identified' }),
      makeInsight({ id: 'b', state: 'resolved' }),
      makeInsight({ id: 'c', state: 'sent' }),
    ]

    const { open, resolved } = splitInsightsByResolution(insights)

    expect(open.map((i) => i.id)).toEqual(['a', 'c'])
    expect(resolved.map((i) => i.id)).toEqual(['b'])
  })

  it('drops dismissed/completed/archived insights from both buckets — actioned is not "open" and not "now covered"', () => {
    // Once the approval gate exists, an already-approved insight still
    // rendering as "open" would offer a Review & approve link into a
    // decision that's already been made. RESOLVED_INSIGHT_STATES is the
    // same boundary the readiness score uses.
    const insights = [
      makeInsight({ id: 'a', state: 'dismissed' }),
      makeInsight({ id: 'b', state: 'completed' }),
      makeInsight({ id: 'c', state: 'archived' }),
      makeInsight({ id: 'd', state: 'approved' }),
    ]

    const { open, resolved } = splitInsightsByResolution(insights)

    expect(open).toEqual([])
    expect(resolved).toEqual([])
  })

  it('returns empty buckets for an empty insight list', () => {
    expect(splitInsightsByResolution([])).toEqual({ open: [], resolved: [] })
  })
})
