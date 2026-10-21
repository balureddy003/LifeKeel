import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { AuthProvider } from '../auth-context'
import { useFamilyTimeline, useEventReadiness } from '../useFamilyData'
import { calculateAge } from '../age'

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) })
}

// A fixed month/day (not fixed year, to avoid needing fake timers — which
// waitFor's internal polling doesn't play well with) so the "10 years old,
// 8 years until 18" arithmetic below stays true regardless of which year
// the suite runs in.
const CHILD_DOB = `${new Date().getFullYear() - 10}-03-01`

const FAMILY_WITH_DOB = {
  id: 'f1',
  name: 'The Riveras',
  inviteCode: 'ABC123',
  members: [
    {
      id: 'u1',
      name: 'Alex',
      email: 'a@b.com',
      role: 'organizer',
      status: 'active',
      joinedAt: '2026-01-01',
    },
    {
      id: 'c1',
      name: 'Sam',
      email: '',
      role: 'child',
      status: 'active',
      joinedAt: '2026-01-01',
      dateOfBirth: CHILD_DOB,
    },
    { id: 'c2', name: 'Robin', email: '', role: 'child', status: 'active', joinedAt: '2026-01-01' },
  ],
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useFamilyTimeline — derives milestones from a roster child's dateOfBirth", () => {
  it('produces a "starts university" event only for the child with a birthdate on file', async () => {
    localStorage.setItem('lifekeel_token', 'tok_1')
    localStorage.setItem(
      'family-auth',
      JSON.stringify({
        user: { id: 'u1', name: 'Alex', email: 'a@b.com', avatar: '' },
        family: FAMILY_WITH_DOB,
      }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/auth/me'))
          return jsonResponse({ user_id: 'u1', name: 'Alex', email: 'a@b.com' })
        if (url.endsWith('/family')) return jsonResponse({ family: FAMILY_WITH_DOB })
        return jsonResponse({}, false)
      }),
    )

    const { result } = renderHook(() => useFamilyTimeline(), { wrapper: AuthProvider })

    await waitFor(() => expect(result.current.hasData).toBe(true))
    expect(result.current.events).toHaveLength(1)
    const expectedYear = new Date().getFullYear() + (18 - calculateAge(CHILD_DOB))
    expect(result.current.events[0]).toMatchObject({
      label: 'Sam starts university',
      year: expectedYear,
      status: 'future',
    })
    expect(result.current.hasChildren).toBe(true)
  })

  it('has no timeline data when no roster child has a birthdate', async () => {
    const familyNoDobs = {
      ...FAMILY_WITH_DOB,
      members: FAMILY_WITH_DOB.members.map((m) => ({ ...m, dateOfBirth: undefined })),
    }
    localStorage.setItem('lifekeel_token', 'tok_1')
    localStorage.setItem(
      'family-auth',
      JSON.stringify({
        user: { id: 'u1', name: 'Alex', email: 'a@b.com', avatar: '' },
        family: familyNoDobs,
      }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/auth/me'))
          return jsonResponse({ user_id: 'u1', name: 'Alex', email: 'a@b.com' })
        if (url.endsWith('/family')) return jsonResponse({ family: familyNoDobs })
        return jsonResponse({}, false)
      }),
    )

    const { result } = renderHook(() => useFamilyTimeline(), { wrapper: AuthProvider })

    await waitFor(() => expect(result.current.hasChildren).toBe(true))
    expect(result.current.hasData).toBe(false)
    expect(result.current.events).toEqual([])
  })
})

// UAT D5/D6: an insight's `confidence` is how sure the detector is the gap
// exists — NOT a readiness score. A 0.85-confidence "education fund not
// started" gap used to render as "Family Readiness 85%". The number must
// always come from /family/events/:id/readiness; the insight is text only.
describe('useEventReadiness — never renders insight confidence as a readiness score', () => {
  const GAP_INSIGHT = {
    id: 'i1',
    detector_id: 'family_education_shortfall',
    rule_id: 'education_fund_not_started',
    hypothesis: '',
    reasoning: "Maya's education fund has no savings on file against its target.",
    actions: [],
    confidence: 0.85,
    urgency: 'soon',
    category: 'education',
    state: 'open',
    created_at: '2026-01-01T00:00:00Z',
  }

  function seed() {
    localStorage.setItem('lifekeel_token', 'tok_1')
    localStorage.setItem(
      'family-auth',
      JSON.stringify({
        user: { id: 'u1', name: 'Alex', email: 'a@b.com', avatar: '' },
        family: FAMILY_WITH_DOB,
      }),
    )
  }

  it('shows the real readiness number, not the 0.85 gap-confidence', async () => {
    seed()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/auth/me'))
          return jsonResponse({ user_id: 'u1', name: 'Alex', email: 'a@b.com' })
        if (url.includes('/insights?')) return jsonResponse({ insights: [GAP_INSIGHT] })
        if (url.includes('/family/events/university/readiness'))
          return jsonResponse({
            stability: 12,
            explanation: 'funds hold £0 against a £80,000 target',
            hasLiveData: true,
          })
        return jsonResponse({}, false)
      }),
    )

    const { result } = renderHook(() => useEventReadiness('university', 50, 'sample'), {
      wrapper: AuthProvider,
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.stability).toBe(12)
    expect(result.current.stability).not.toBe(85)
    // The real gap insight still narrates — the score is just never its confidence.
    expect(result.current.explanation).toContain('no savings on file')
    expect(result.current.live).toBe(true)
    expect(result.current.insightId).toBe('i1')
  })

  it('returns a null score when no formula exists — never the fallback or confidence', async () => {
    seed()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/auth/me'))
          return jsonResponse({ user_id: 'u1', name: 'Alex', email: 'a@b.com' })
        if (url.includes('/insights?')) return jsonResponse({ insights: [GAP_INSIGHT] })
        if (url.includes('/family/events/university/readiness'))
          return jsonResponse({ hasLiveData: false })
        return jsonResponse({}, false)
      }),
    )

    const { result } = renderHook(() => useEventReadiness('university', 50, 'sample'), {
      wrapper: AuthProvider,
    })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.stability).toBeNull()
    // The card is still "live" — real insight text exists even without a number.
    expect(result.current.live).toBe(true)
    expect(result.current.explanation).toContain('no savings on file')
  })
})
