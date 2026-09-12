import { describe, it, expect } from 'vitest'
import {
  consolidateInsights,
  classifyDetectorTier,
  isContradictory,
  DEFAULT_TIER_PRIORITIES,
  type DetectorPrioritySettings,
} from '../insights/consolidation.js'
import type { Insight } from '@kairos/engine'

function makeInsight(overrides: Partial<Insight> & { id: string }): Insight {
  return {
    id: overrides.id,
    tenant_id: 't1',
    hypothesis: overrides.hypothesis ?? 'Test hypothesis',
    category: overrides.category ?? 'revenue',
    urgency: overrides.urgency ?? 'medium',
    estimated_impact_low: 0,
    estimated_impact_high: 1000,
    reasoning: 'test',
    actions: overrides.actions ?? [],
    confidence_breakdown: overrides.confidence_breakdown ?? {
      combined_score: 80,
      rule_score: 80,
      llm_score: undefined,
    } as unknown as Insight['confidence_breakdown'],
    detector_id: overrides.detector_id ?? 'det-1',
    rule_id: 'rule-1',
    state: overrides.state ?? 'identified',
    created_at: overrides.created_at ?? new Date('2025-01-01'),
    derived_from_signals: [],
    entity_key: overrides.entity_key,
    ...overrides,
  } as unknown as Insight
}

const defaultSettings: DetectorPrioritySettings = {
  detector_priorities: {},
  tier_priorities: { ...DEFAULT_TIER_PRIORITIES },
}

describe('classifyDetectorTier', () => {
  it('classifies compliance as regulatory', () => {
    const insight = makeInsight({ id: '1', category: 'compliance' })
    expect(classifyDetectorTier(insight)).toBe('regulatory')
  })

  it('classifies critical risk as regulatory', () => {
    const insight = makeInsight({ id: '2', category: 'risk', urgency: 'critical' })
    expect(classifyDetectorTier(insight)).toBe('regulatory')
  })

  it('classifies insights with llm_score as llm_scored', () => {
    const insight = makeInsight({
      id: '3',
      confidence_breakdown: { combined_score: 80, rule_score: 60, llm_score: 90 } as unknown as Insight['confidence_breakdown'],
    })
    expect(classifyDetectorTier(insight)).toBe('llm_scored')
  })

  it('classifies plain rule insights as deterministic', () => {
    const insight = makeInsight({ id: '4', category: 'revenue' })
    expect(classifyDetectorTier(insight)).toBe('deterministic')
  })
})

describe('isContradictory', () => {
  it('detects sell vs buy contradiction', () => {
    const left = makeInsight({ id: '1', actions: ['sell'] })
    const right = makeInsight({ id: '2', actions: ['buy'] })
    expect(isContradictory(left, right)).toBe(true)
  })

  it('detects trim vs add contradiction', () => {
    const left = makeInsight({ id: '1', actions: ['trim'] })
    const right = makeInsight({ id: '2', actions: ['add'] })
    expect(isContradictory(left, right)).toBe(true)
  })

  it('does not flag same-direction insights', () => {
    const left = makeInsight({ id: '1', actions: ['buy'] })
    const right = makeInsight({ id: '2', actions: ['add'] })
    expect(isContradictory(left, right)).toBe(false)
  })

  it('does not flag unrelated actions', () => {
    const left = makeInsight({ id: '1', actions: ['notify'] })
    const right = makeInsight({ id: '2', actions: ['schedule_review'] })
    expect(isContradictory(left, right)).toBe(false)
  })
})

describe('consolidateInsights', () => {
  it('groups insights by entity_key', () => {
    const insights = [
      makeInsight({ id: '1', entity_key: 'AAPL', detector_id: 'det-a' }),
      makeInsight({ id: '2', entity_key: 'AAPL', detector_id: 'det-b' }),
      makeInsight({ id: '3', entity_key: 'MSFT', detector_id: 'det-c' }),
    ]
    const groups = consolidateInsights(insights, defaultSettings)
    expect(groups).toHaveLength(2)
    const aaplGroup = groups.find(g => g.entity_key === 'AAPL')
    expect(aaplGroup).toBeDefined()
    expect(aaplGroup!.count).toBe(2)
    expect(aaplGroup!.secondary).toHaveLength(1)
  })

  it('selects regulatory tier over deterministic as primary', () => {
    const insights = [
      makeInsight({ id: '1', entity_key: 'E1', detector_id: 'det-rule', category: 'revenue', urgency: 'high' }),
      makeInsight({ id: '2', entity_key: 'E1', detector_id: 'det-compliance', category: 'compliance', urgency: 'medium' }),
    ]
    const groups = consolidateInsights(insights, defaultSettings)
    const group = groups.find(g => g.entity_key === 'E1')
    expect(group!.primary.detector_id).toBe('det-compliance')
  })

  it('respects tenant detector_priorities override', () => {
    const settings: DetectorPrioritySettings = {
      detector_priorities: { 'det-rule': 500 },
      tier_priorities: { ...DEFAULT_TIER_PRIORITIES },
    }
    const insights = [
      makeInsight({ id: '1', entity_key: 'E1', detector_id: 'det-rule', category: 'revenue' }),
      makeInsight({ id: '2', entity_key: 'E1', detector_id: 'det-compliance', category: 'compliance' }),
    ]
    const groups = consolidateInsights(insights, settings)
    const group = groups.find(g => g.entity_key === 'E1')
    expect(group!.primary.detector_id).toBe('det-rule')
  })

  it('flags contradictions in the group', () => {
    const insights = [
      makeInsight({ id: '1', entity_key: 'E1', detector_id: 'det-buy', actions: ['buy'], category: 'compliance' }),
      makeInsight({ id: '2', entity_key: 'E1', detector_id: 'det-sell', actions: ['sell'], category: 'revenue' }),
    ]
    const groups = consolidateInsights(insights, defaultSettings)
    const group = groups.find(g => g.entity_key === 'E1')
    expect(group!.has_conflict).toBe(true)
    expect(group!.conflicting_detector_ids).toContain('det-sell')
  })

  it('does not flag conflicts for same-direction insights', () => {
    const insights = [
      makeInsight({ id: '1', entity_key: 'E1', detector_id: 'det-a', actions: ['buy'] }),
      makeInsight({ id: '2', entity_key: 'E1', detector_id: 'det-b', actions: ['add'] }),
    ]
    const groups = consolidateInsights(insights, defaultSettings)
    const group = groups.find(g => g.entity_key === 'E1')
    expect(group!.has_conflict).toBe(false)
  })

  it('computes max_urgency across all insights in group', () => {
    const insights = [
      makeInsight({ id: '1', entity_key: 'E1', urgency: 'low', category: 'compliance' }),
      makeInsight({ id: '2', entity_key: 'E1', urgency: 'critical', category: 'revenue' }),
    ]
    const groups = consolidateInsights(insights, defaultSettings)
    const group = groups.find(g => g.entity_key === 'E1')
    expect(group!.max_urgency).toBe('critical')
  })

  it('sorts groups by primary score (highest first)', () => {
    const insights = [
      makeInsight({ id: '1', entity_key: 'E1', detector_id: 'det-a', category: 'revenue', urgency: 'low' }),
      makeInsight({ id: '2', entity_key: 'E2', detector_id: 'det-b', category: 'compliance', urgency: 'critical' }),
    ]
    const groups = consolidateInsights(insights, defaultSettings)
    expect(groups[0]!.entity_key).toBe('E2')
  })

  it('handles insights without entity_key as singletons', () => {
    const insights = [
      makeInsight({ id: '1', entity_key: undefined }),
      makeInsight({ id: '2', entity_key: undefined }),
    ]
    const groups = consolidateInsights(insights, defaultSettings)
    expect(groups).toHaveLength(2)
    expect(groups.every(g => g.count === 1)).toBe(true)
  })

  it('returns empty array for no insights', () => {
    expect(consolidateInsights([], defaultSettings)).toHaveLength(0)
  })
})

describe('configurable contradiction detection', () => {
  it('uses custom action set for SMB vertical', () => {
    const smbActions = {
      reduce: ['pause_campaign', 'reduce_spend'],
      increase: ['launch_campaign', 'increase_spend'],
    }
    const left = makeInsight({ id: '1', actions: ['pause_campaign'] })
    const right = makeInsight({ id: '2', actions: ['launch_campaign'] })
    expect(isContradictory(left, right, smbActions)).toBe(true)
  })

  it('does not flag SMB actions as contradictory using trading verbs', () => {
    const left = makeInsight({ id: '1', actions: ['pause_campaign'] })
    const right = makeInsight({ id: '2', actions: ['launch_campaign'] })
    // Without passing SMB action set, these don't match trading verbs
    expect(isContradictory(left, right)).toBe(false)
  })

  it('uses vertical-appropriate contradiction set in consolidateInsights', () => {
    const smbSettings: DetectorPrioritySettings = {
      detector_priorities: {},
      tier_priorities: { ...DEFAULT_TIER_PRIORITIES },
      contradiction_actions: {
        reduce: ['pause_campaign', 'reduce_spend'],
        increase: ['launch_campaign', 'increase_spend'],
      },
    }
    const insights = [
      makeInsight({ id: '1', entity_key: 'E1', detector_id: 'det-a', actions: ['pause_campaign'], category: 'compliance' }),
      makeInsight({ id: '2', entity_key: 'E1', detector_id: 'det-b', actions: ['launch_campaign'], category: 'revenue' }),
    ]
    const groups = consolidateInsights(insights, smbSettings)
    const group = groups.find(g => g.entity_key === 'E1')
    expect(group!.has_conflict).toBe(true)
    expect(group!.conflicting_detector_ids).toContain('det-b')
  })

  it('falls back to trading verbs when no contradiction_actions configured', () => {
    const insights = [
      makeInsight({ id: '1', entity_key: 'E1', detector_id: 'det-a', actions: ['sell'], category: 'compliance' }),
      makeInsight({ id: '2', entity_key: 'E1', detector_id: 'det-b', actions: ['buy'], category: 'revenue' }),
    ]
    const groups = consolidateInsights(insights, defaultSettings)
    const group = groups.find(g => g.entity_key === 'E1')
    expect(group!.has_conflict).toBe(true)
  })
})
