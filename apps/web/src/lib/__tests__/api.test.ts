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
  uploadDocument,
  fetchFinancialProfileWithVersion,
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
    expect(result).toEqual({ score: 72, hasLiveData: true, computedAt: '2026-09-20T00:00:00Z' })
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
    expect(result).toEqual({ score: 0, hasLiveData: false, computedAt: '2026-09-20T00:00:00Z' })
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
    expect(result).toEqual({ score: 0, hasLiveData: true, computedAt: '2026-09-20T00:00:00Z' })
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
    // insights_evaluated_at stands in as the honest "when was this data
    // checked" timestamp when /family/readiness is unreachable.
    expect(result).toEqual({ score: 100, hasLiveData: true, computedAt: '2026-09-20T00:00:00Z' })
  })

  it('does not score a saved-but-never-evaluated profile as 100 in the fallback — zero insights there means unknown, not on track', async () => {
    mockFetchSequence(
      { body: {}, ok: false },
      { body: { insights: [] } },
      { body: { profile: { household: {} } } },
    )
    const result = await fetchFamilyReadinessScore()
    expect(result).toEqual({ score: 0, hasLiveData: false, computedAt: null })
  })

  it('scores 0 without live data when the fallback finds no insights and no profile', async () => {
    mockFetchSequence(
      { body: {}, ok: false },
      { body: { insights: [] } },
      { body: { profile: null } },
    )
    const result = await fetchFamilyReadinessScore()
    expect(result).toEqual({ score: 0, hasLiveData: false, computedAt: null })
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
    expect(result).toEqual({ score: 95, hasLiveData: true, computedAt: expect.any(String) })
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
    expect(result).toEqual({ score: 100, hasLiveData: true, computedAt: expect.any(String) })
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
    mockFetchOnce({
      connectors: [
        { id: 'email', name: 'Email', category: 'email', connected: true, needsReauth: true },
      ],
    })
    expect(await fetchEmailConnectorStatus()).toEqual({
      connected: true,
      needsReauth: true,
      failed: false,
    })
  })

  it('flags failed rather than reporting "not connected" on a server error', async () => {
    mockFetchOnce({}, false)
    expect(await fetchEmailConnectorStatus()).toEqual({
      connected: false,
      needsReauth: false,
      failed: true,
    })
  })
})

describe('fetchAIResponse', () => {
  it('returns a live status when the backend answers with live data', async () => {
    mockFetchOnce({ content: 'Your emergency fund covers 0.33 months.', isLive: true })
    const result = await fetchAIResponse('How is my emergency fund?')
    expect(result).toEqual({ content: 'Your emergency fund covers 0.33 months.', status: 'live' })
  })

  it('passes the server data_as_of stamp through so stale answers are dated', async () => {
    mockFetchOnce({
      content: 'Your emergency fund covers 0.33 months.',
      isLive: true,
      data_as_of: '2026-10-24T10:00:00.000Z',
    })
    const result = await fetchAIResponse('How is my emergency fund?')
    expect(result.dataAsOf).toBe('2026-10-24T10:00:00.000Z')
  })

  it('omits dataAsOf when the server sends none', async () => {
    mockFetchOnce({ content: 'Generic answer.', isLive: false })
    const result = await fetchAIResponse('How is my emergency fund?')
    expect(result.dataAsOf).toBeUndefined()
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

  it('short-circuits an acute-emergency query with safety guidance — no network call at all', async () => {
    const fn = vi.fn()
    vi.stubGlobal('fetch', fn)
    const result = await fetchAIResponse('my husband is having chest pain')
    expect(result.status).toBe('emergency')
    expect(result.content).toContain('999')
    expect(fn).not.toHaveBeenCalled()
  })

  it('maps a server-side emergency flag to the emergency status', async () => {
    mockFetchOnce({ content: 'If this is happening right now…', isLive: false, emergency: true })
    // Uses a query the client-side screen doesn't itself flag (the server
    // screen is the backstop — e.g. a phrase a stale client misses).
    const result = await fetchAIResponse('something urgent happened')
    expect(result.status).toBe('emergency')
    expect(result.content).toContain('happening right now')
  })

  it('runs the PII curtain over the query before it leaves the device and restores the response', async () => {
    const fn = mockFetchSequence({
      body: { content: 'Done — we noted the reference you sent.', isLive: true },
    })
    const result = await fetchAIResponse(
      'Please email sarah.jenkins@example.co.uk or call 07700 900123 about this',
    )
    const sentBody = JSON.parse((fn.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(sentBody.query).not.toContain('sarah.jenkins@example.co.uk')
    expect(sentBody.query).not.toContain('07700 900123')
    expect(sentBody.query).toMatch(/\[EMAIL_1_[a-z0-9]+\]/)
    expect(sentBody.query).toMatch(/\[PHONE_1_[a-z0-9]+\]/)
    expect(result.status).toBe('live')
  })

  it('flags medical_hint when the query carries special-category content', async () => {
    const fn = mockFetchSequence({
      body: {
        content: 'This question touches health information…',
        isLive: false,
        quarantined: true,
      },
    })
    const result = await fetchAIResponse("Is mum's hospital appointment covered?")
    const sentBody = JSON.parse((fn.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(sentBody.medical_hint).toBe(true)
    expect(result.status).toBe('canned')
    expect(result.content).toContain('health information')
  })

  it('omits medical_hint for routine financial queries', async () => {
    const fn = mockFetchSequence({ body: { content: 'Live answer.', isLive: true } })
    await fetchAIResponse('What is my salary?')
    const sentBody = JSON.parse((fn.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(sentBody.medical_hint).toBeUndefined()
  })

  it('restores redacted placeholders echoed back in the answer', async () => {
    // The nonce differs per curtain, so the "server" echoes whatever
    // placeholder the client actually sent.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        const sentQuery = JSON.parse((init?.body as string) ?? '{}').query as string
        const token = sentQuery.match(/\[EMAIL_1_[a-z0-9]+\]/)?.[0] ?? '[NONE]'
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ content: `Replying about ${token} now.`, isLive: true }),
        })
      }),
    )
    const result = await fetchAIResponse('Reach me at sarah.jenkins@example.co.uk')
    expect(result.content).toBe('Replying about sarah.jenkins@example.co.uk now.')
  })
})

describe('PRD-108: life events', () => {
  it('fetchLifeEvents returns the reported events list', async () => {
    mockFetchOnce({
      events: [
        {
          id: '1',
          event_type: 'job_loss',
          affected_member_id: null,
          reported_at: '2026-01-01',
          playbook: { event_type: 'job_loss', title: 't', intro: 'i', steps: [] },
        },
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
      playbook: {
        event_type: 'bereavement',
        title: 't',
        intro: 'i',
        steps: [{ id: 'notify_insurers', title: 'Notify', body: 'Aviva', contact: true }],
      },
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

describe('uploadDocument on-device screen', () => {
  // Households not on the direct-to-R2 path get 409 direct_upload_unavailable
  // from POST /documents/uploads and fall back to the multipart route.
  const notDirect = () => ({
    ok: false,
    status: 409,
    json: () => Promise.resolve({ error: 'direct_upload_unavailable' }),
  })
  const ok = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) })

  it('sends the client screen outcome as a form field — and only the outcome', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce(notDirect())
      .mockResolvedValueOnce(ok({ id: 'd1' }))
    vi.stubGlobal('fetch', fn)
    const file = new File([new Uint8Array(8)], 'letter.png', { type: 'image/png' })
    await uploadDocument(file, 'flagged')
    const form = (fn.mock.calls[1]?.[1] as RequestInit).body as FormData
    expect(form.get('clientScreen')).toBe('flagged')
    expect(form.get('file')).toBe(file)
  })

  it('omits the field when no screen ran', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce(notDirect())
      .mockResolvedValueOnce(ok({ id: 'd1' }))
    vi.stubGlobal('fetch', fn)
    await uploadDocument(new File([new Uint8Array(8)], 'doc.pdf', { type: 'application/pdf' }))
    const form = (fn.mock.calls[1]?.[1] as RequestInit).body as FormData
    expect(form.get('clientScreen')).toBeNull()
  })

  it('direct path: init with the screen, PUT to the presigned URL, then complete (§7.4)', async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce(
        ok({
          document_id: 'd9',
          upload: {
            url: 'https://acct.eu.r2.cloudflarestorage.com/q/t/d9?sig',
            headers: { 'Content-Type': 'application/pdf' },
          },
        }),
      )
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce(ok({ status: 'scan_queued' }))
    vi.stubGlobal('fetch', fn)
    const file = new File([new Uint8Array(8)], 'policy.pdf', { type: 'application/pdf' })
    const doc = await uploadDocument(file, 'clear')
    const init = JSON.parse(String((fn.mock.calls[0]?.[1] as RequestInit).body))
    expect(init).toMatchObject({
      filename: 'policy.pdf',
      mime: 'application/pdf',
      size: 8,
      client_screen: 'clear',
    })
    expect(fn.mock.calls[1]?.[0]).toContain('r2.cloudflarestorage.com')
    expect((fn.mock.calls[1]?.[1] as RequestInit).method).toBe('PUT')
    expect(fn.mock.calls[2]?.[0]).toContain('/documents/d9/complete')
    expect(doc).toMatchObject({ id: 'd9', status: 'scan_queued' })
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

describe('fetchFinancialProfileWithVersion', () => {
  it('returns the profile and version on success', async () => {
    mockFetchOnce({ profile: { household: {} }, version: 3 })
    expect(await fetchFinancialProfileWithVersion()).toEqual({
      profile: { household: {} },
      version: 3,
    })
  })

  it('returns null profile when none is on file', async () => {
    mockFetchOnce({ profile: null })
    expect(await fetchFinancialProfileWithVersion()).toEqual({ profile: null, version: 0 })
  })

  it('rejects on a failed response — never silently reports "no profile"', async () => {
    mockFetchOnce({ error: 'server error' }, false)
    await expect(fetchFinancialProfileWithVersion()).rejects.toThrow('500')
  })

  it('rejects on a network failure — the wizard must not render an empty form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(fetchFinancialProfileWithVersion()).rejects.toThrow('network down')
  })
})
