import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchAIResponse,
  fetchFamilyInsights,
  fetchFamilyReadinessScore,
  fetchInboxItems,
  fetchEmailConnectorStatus,
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
  // PRD-114: the server is authoritative when it answers — the local
  // penalty math only runs when /family/readiness is unreachable.
  it('prefers the server composite score when /family/readiness reports live data', async () => {
    mockFetchOnce({
      score: 72,
      has_live_data: true,
      computed_at: '2026-09-20T00:00:00Z',
      components: [],
      insights: [],
    })
    const result = await fetchFamilyReadinessScore()
    expect(result).toEqual({ score: 72, hasLiveData: true })
  })

  it('treats server has_live_data=false as unknown — never a flattering 100', async () => {
    mockFetchOnce({
      score: null,
      has_live_data: false,
      computed_at: '2026-09-20T00:00:00Z',
      components: [],
      insights: [],
    })
    const result = await fetchFamilyReadinessScore()
    expect(result).toEqual({ score: 0, hasLiveData: false })
  })

  it('scores 0 with hasLiveData when the server ran but could not compute', async () => {
    mockFetchOnce({
      score: null,
      has_live_data: true,
      computed_at: '2026-09-20T00:00:00Z',
      components: [],
      insights: [],
    })
    const result = await fetchFamilyReadinessScore()
    expect(result).toEqual({ score: 0, hasLiveData: true })
  })

  // Fallback path: /family/readiness unreachable → legacy insight-penalty
  // math, still gated on insights_evaluated_at.
  it('falls back to 100 with hasLiveData when readiness is unreachable, detectors ran, and no insights are open', async () => {
    mockFetchSequence(
      { body: {}, ok: false },
      { body: { insights: [] } },
      { body: { profile: { household: {}, insights_evaluated_at: '2026-09-20T00:00:00Z' } } },
    )
    const result = await fetchFamilyReadinessScore()
    expect(result).toEqual({ score: 100, hasLiveData: true })
  })

  it('does not score a saved-but-never-evaluated profile as 100 in the fallback — zero insights there means unknown, not on track', async () => {
    mockFetchSequence(
      { body: {}, ok: false },
      { body: { insights: [] } },
      { body: { profile: { household: {} } } },
    )
    const result = await fetchFamilyReadinessScore()
    expect(result).toEqual({ score: 0, hasLiveData: false })
  })

  it('scores 0 without live data when the fallback finds no insights and no profile', async () => {
    mockFetchSequence(
      { body: {}, ok: false },
      { body: { insights: [] } },
      { body: { profile: null } },
    )
    const result = await fetchFamilyReadinessScore()
    expect(result).toEqual({ score: 0, hasLiveData: false })
  })

  it('subtracts a confidence-weighted penalty per open (unresolved) insight in the fallback', async () => {
    mockFetchSequence(
      { body: {}, ok: false },
      {
        body: {
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
        },
      },
    )
    const result = await fetchFamilyReadinessScore()
    // 100 - (0.5 * 10) = 95
    expect(result).toEqual({ score: 95, hasLiveData: true })
  })

  it('does not penalize resolved insights in the fallback', async () => {
    mockFetchSequence(
      { body: {}, ok: false },
      {
        body: {
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
        },
      },
    )
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

describe('fetchEmailConnectorStatus', () => {
  it('reads the email connector out of the connectors list', async () => {
    mockFetchOnce({ connectors: [{ id: 'email', name: 'Email', category: 'email', connected: true, needsReauth: true }] })
    expect(await fetchEmailConnectorStatus()).toEqual({ connected: true, needsReauth: true, failed: false })
  })

  it('flags failed rather than reporting "not connected" on a server error', async () => {
    mockFetchOnce({}, false)
    expect(await fetchEmailConnectorStatus()).toEqual({ connected: false, needsReauth: false, failed: true })
  })
})

describe('fetchAIResponse', () => {
  it('returns a live status when the backend answers with live data', async () => {
    mockFetchOnce({ content: 'Your emergency fund covers 0.33 months.', isLive: true })
    const result = await fetchAIResponse('How is my emergency fund?')
    expect(result).toEqual({ content: 'Your emergency fund covers 0.33 months.', status: 'live' })
  })

  it('returns canned when the backend deliberately answers non-live', async () => {
    mockFetchOnce({ content: 'Generic answer.', isLive: false })
    const result = await fetchAIResponse('How is my emergency fund?')
    expect(result).toEqual({ content: 'Generic answer.', status: 'canned' })
  })

  it('reports unavailable when the network request itself throws while online', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const result = await fetchAIResponse('Where is my travel insurance?')
    // The distinguishing fix: an online failure must not degrade into a
    // canned/sample answer — it surfaces as unavailable so the UI can say so.
    expect(result.status).toBe('unavailable')
  })

  it('reports unavailable on a non-2xx response while online', async () => {
    mockFetchOnce({ error: 'unauthorized' }, false)
    const result = await fetchAIResponse('Where is my travel insurance?')
    expect(result.status).toBe('unavailable')
  })

  it('still serves the canned map when the device is genuinely offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const result = await fetchAIResponse('Where is my travel insurance?')
    onLine.mockRestore()
    expect(result.status).toBe('canned')
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
