import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchFamilyInsights,
  fetchFamilyReadinessScore,
  RESOLVED_INSIGHT_STATES,
} from '../api'

function mockFetchOnce(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      json: () => Promise.resolve(body),
    }),
  )
}

function mockFetchSequence(...responses: { body: unknown; ok?: boolean }[]) {
  const fn = vi.fn()
  for (const { body, ok = true } of responses) {
    fn.mockResolvedValueOnce({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) })
  }
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchFamilyInsights', () => {
  it('adapts the engine confidence_breakdown shape into a flat confidence field', async () => {
    mockFetchOnce({
      insights: [
        {
          id: '1',
          detector_id: 'family_protection_gap',
          rule_id: 'r1',
          hypothesis: 'h',
          reasoning: 'r',
          actions: [],
          confidence_breakdown: { combined_score: 0.7 },
          urgency: 'high',
          category: 'protection',
          state: 'open',
          created_at: '2026-01-01',
        },
      ],
    })

    const insights = await fetchFamilyInsights()
    expect(insights).toHaveLength(1)
    expect(insights[0]?.confidence).toBe(0.7)
  })

  it('falls back to an empty list when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const insights = await fetchFamilyInsights()
    expect(insights).toEqual([])
  })

  it('filters out any insight whose detector_id is not a family detector', async () => {
    mockFetchOnce({
      insights: [
        {
          id: '1',
          detector_id: 'trading_momentum_signal',
          rule_id: 'r1',
          hypothesis: 'h',
          reasoning: 'r',
          actions: [],
          confidence_breakdown: { combined_score: 0.9 },
          urgency: 'high',
          category: 'trading',
          state: 'open',
          created_at: '2026-01-01',
        },
      ],
    })

    const insights = await fetchFamilyInsights()
    expect(insights).toEqual([])
  })
})

describe('fetchFamilyReadinessScore', () => {
  it('scores 100 with hasLiveData when there are no open insights but a profile exists', async () => {
    mockFetchSequence(
      { body: { insights: [] } },
      { body: { profile: { household: {} } } },
    )
    const result = await fetchFamilyReadinessScore()
    expect(result).toEqual({ score: 100, hasLiveData: true })
  })

  it('scores 0 without live data when there are no insights and no profile', async () => {
    mockFetchSequence({ body: { insights: [] } }, { body: { profile: null } })
    const result = await fetchFamilyReadinessScore()
    expect(result).toEqual({ score: 0, hasLiveData: false })
  })

  it('subtracts a confidence-weighted penalty per open (unresolved) insight', async () => {
    mockFetchOnce({
      insights: [
        {
          id: '1',
          detector_id: 'family_emergency_fund_adequacy',
          rule_id: 'r1',
          hypothesis: 'h',
          reasoning: 'r',
          actions: [],
          confidence_breakdown: { combined_score: 0.5 },
          urgency: 'medium',
          category: 'savings',
          state: 'open',
          created_at: '2026-01-01',
        },
      ],
    })
    const result = await fetchFamilyReadinessScore()
    // 100 - (0.5 * 10) = 95
    expect(result).toEqual({ score: 95, hasLiveData: true })
  })

  it('does not penalize resolved insights', async () => {
    mockFetchOnce({
      insights: [
        {
          id: '1',
          detector_id: 'family_retirement_gap',
          rule_id: 'r1',
          hypothesis: 'h',
          reasoning: 'r',
          actions: [],
          confidence_breakdown: { combined_score: 0.9 },
          urgency: 'low',
          category: 'retirement',
          state: 'dismissed',
          created_at: '2026-01-01',
        },
      ],
    })
    expect(RESOLVED_INSIGHT_STATES).toContain('dismissed')
    const result = await fetchFamilyReadinessScore()
    expect(result).toEqual({ score: 100, hasLiveData: true })
  })
})
