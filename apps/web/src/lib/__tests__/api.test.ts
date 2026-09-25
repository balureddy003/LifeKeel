import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchAIResponse,
  fetchFamilyInsights,
  fetchFamilyReadinessScore,
  fetchInboxItems,
  fetchLifeEvents,
  reportLifeEvent,
  prepareLifeEventStepDraft,
  fetchLifeChangeNudge,
  dismissLifeChangeNudge,
  fetchMyReferralCode,
  fetchReferralSummary,
  RESOLVED_INSIGHT_STATES,
} from '../api'
import { clearAllCaches } from '../fetch-cache'

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
  // fetchFamilyInsights (and anything else wrapped in cachedFetch) keeps
  // its result in a module-level cache for 30s in real usage — without
  // clearing it here, one test's mocked response silently answers every
  // later test that also calls it, regardless of what they each mock.
  clearAllCaches()
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
  it('scores 100 with hasLiveData when detectors ran and found no open insights', async () => {
    mockFetchSequence(
      { body: { insights: [] } },
      { body: { profile: { household: {}, insights_evaluated_at: '2026-09-20T00:00:00Z' } } },
    )
    const result = await fetchFamilyReadinessScore()
    expect(result).toEqual({ score: 100, hasLiveData: true })
  })

  it('does not score a saved-but-never-evaluated profile as 100 — zero insights there means unknown, not on track', async () => {
    mockFetchSequence(
      { body: { insights: [] } },
      { body: { profile: { household: {} } } },
    )
    const result = await fetchFamilyReadinessScore()
    expect(result).toEqual({ score: 0, hasLiveData: false })
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

describe('fetchInboxItems', () => {
  it('is not "failed" for a genuine empty inbox (a normal 200 with no items)', async () => {
    mockFetchOnce({ items: [] })
    const result = await fetchInboxItems()
    expect(result).toEqual({ items: [], isLive: false, failed: false })
  })

  it('flags failed when the server errors, so the page can tell that apart from a real empty inbox', async () => {
    mockFetchOnce({}, false)
    const result = await fetchInboxItems()
    expect(result).toEqual({ items: [], isLive: false, failed: true })
  })

  it('flags failed when the network request itself throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const result = await fetchInboxItems()
    expect(result).toEqual({ items: [], isLive: false, failed: true })
  })
})

describe('fetchAIResponse', () => {
  it('returns the backend response as-is when the call succeeds', async () => {
    mockFetchOnce({ content: 'Your emergency fund covers 0.33 months.', isLive: true })
    const result = await fetchAIResponse('How is my emergency fund?')
    expect(result).toEqual({ content: 'Your emergency fund covers 0.33 months.', isLive: true })
  })

  it('falls back to the local AI_RESPONSES map when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const result = await fetchAIResponse('Where is my travel insurance?')
    expect(result.isLive).toBe(false)
    expect(result.content.length).toBeGreaterThan(0)
  })

  it('falls back to the local map when the backend returns a non-2xx status', async () => {
    mockFetchOnce({ error: 'unauthorized' }, false)
    const result = await fetchAIResponse('Where is my travel insurance?')
    expect(result.isLive).toBe(false)
    expect(result.content.length).toBeGreaterThan(0)
  })
})

describe('PRD-108: life events', () => {
  it('fetchLifeEvents returns the reported events list', async () => {
    mockFetchOnce({
      events: [
        { id: '1', event_type: 'job_loss', affected_member_id: null, reported_at: '2026-01-01', playbook: { event_type: 'job_loss', title: 't', intro: 'i', steps: [] } },
      ],
    })
    const events = await fetchLifeEvents()
    expect(events).toHaveLength(1)
    expect(events[0]?.event_type).toBe('job_loss')
  })

  it('fetchLifeEvents falls back to an empty list when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const events = await fetchLifeEvents()
    expect(events).toEqual([])
  })

  it('reportLifeEvent returns the created event with its rendered playbook', async () => {
    mockFetchOnce({
      id: 'evt-1',
      event_type: 'bereavement',
      affected_member_id: null,
      reported_at: '2026-01-01',
      playbook: { event_type: 'bereavement', title: 't', intro: 'i', steps: [{ id: 'notify_insurers', title: 'Notify', body: 'Aviva', contact: true }] },
    })
    const event = await reportLifeEvent('bereavement')
    expect(event?.id).toBe('evt-1')
    expect(event?.playbook?.steps[0]?.body).toBe('Aviva')
  })

  it('reportLifeEvent returns null when the request fails', async () => {
    mockFetchOnce({ error: 'Submit a financial profile before reporting a life event' }, false)
    const event = await reportLifeEvent('job_loss')
    expect(event).toBeNull()
  })

  it('prepareLifeEventStepDraft returns the generated draft', async () => {
    mockFetchOnce({ draft: { content: 'Dear Aviva,', generated_at: '2026-01-01' } })
    const draft = await prepareLifeEventStepDraft('evt-1', 'notify_insurers')
    expect(draft?.content).toBe('Dear Aviva,')
  })

  it('prepareLifeEventStepDraft returns null on a non-2xx response', async () => {
    mockFetchOnce({ error: 'not found' }, false)
    const draft = await prepareLifeEventStepDraft('evt-1', 'notify_insurers')
    expect(draft).toBeNull()
  })
})

describe('PRD-111: fetchLifeChangeNudge / dismissLifeChangeNudge', () => {
  it('fetchLifeChangeNudge returns the active flag', async () => {
    mockFetchOnce({ active: true })
    expect(await fetchLifeChangeNudge()).toEqual({ active: true })
  })

  it('fetchLifeChangeNudge falls back to inactive on failure, never throws', async () => {
    mockFetchOnce({ error: 'unauthorized' }, false)
    expect(await fetchLifeChangeNudge()).toEqual({ active: false })
  })

  it('dismissLifeChangeNudge posts to the dismiss endpoint', async () => {
    const fetchMock = mockFetchSequence({ body: { ok: true } })
    await dismissLifeChangeNudge()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/family/life-events/nudge/dismiss'),
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('PRD-112: fetchMyReferralCode / fetchReferralSummary', () => {
  it('fetchMyReferralCode returns the code', async () => {
    mockFetchOnce({ code: 'ABC123' })
    expect(await fetchMyReferralCode()).toBe('ABC123')
  })

  it('fetchMyReferralCode falls back to null on failure', async () => {
    mockFetchOnce({ error: 'unauthorized' }, false)
    expect(await fetchMyReferralCode()).toBeNull()
  })

  it('fetchReferralSummary returns pending/rewarded counts', async () => {
    mockFetchOnce({ pending: 2, rewarded: 3 })
    expect(await fetchReferralSummary()).toEqual({ pending: 2, rewarded: 3 })
  })
})
