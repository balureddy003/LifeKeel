import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { AuthProvider, useAuth } from '../auth-context'

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthProvider.signUp', () => {
  it('sends a unique workspace slug derived from the given name, and persists the token', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      jsonResponse({ token: 'tok_123', user: { id: 'u1', email: 'jane@example.com', name: 'Jane Doe', tenant_id: 't1' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.signUp('Jane Doe', 'jane@example.com', 'password123')
    })

    expect(localStorage.getItem('lifekeel_token')).toBe('tok_123')
    expect(result.current.user?.email).toBe('jane@example.com')

    // The mount-time rehydrate also fetches (/auth/me, cookie-session probe),
    // so locate the signup call by URL rather than assuming calls[0].
    const signupCall = fetchMock.mock.calls.find((call: unknown[]) => (call[0] as string).endsWith('/auth/signup'))!
    const [, requestInit] = signupCall
    const body = JSON.parse(requestInit.body)
    // uniqueWorkspaceSlug() slugifies the name then appends a random suffix —
    // assert the shape rather than a specific value, since the suffix is random.
    expect(body.workspace).toMatch(/^jane-doe-[a-z0-9]{6}$/)
  })
})

describe('AuthProvider.signIn', () => {
  it('restores the real family roster on login instead of only trusting local cache', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/login')) {
        return jsonResponse({ token: 'tok_456', user: { id: 'u2', email: 'a@b.com', name: 'A', tenant_id: 't2' } })
      }
      if (url.endsWith('/family')) {
        return jsonResponse({ family: { id: 'f1', name: 'The Bs', inviteCode: 'ABC123', members: [] } })
      }
      return jsonResponse({}, false)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.signIn('a@b.com', 'password123')
    })

    expect(result.current.family?.name).toBe('The Bs')
    expect(result.current.isAuthenticated).toBe(true)
  })

  it('defers the session until verifyMfaCode when the account has TOTP on', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/login')) {
        return jsonResponse({ mfa_required: true, mfa_token: 'pending_tok' })
      }
      if (url.endsWith('/auth/mfa/verify')) {
        const body = JSON.parse(init?.body as string)
        if (body.mfa_token !== 'pending_tok' || body.code !== '123456') {
          return jsonResponse({ error: 'Incorrect code' }, false)
        }
        return jsonResponse({ token: 'tok_mfa', user: { id: 'u9', email: 'm@b.com', name: 'M', tenant_id: 't9' } })
      }
      if (url.endsWith('/family')) {
        return jsonResponse({ family: null })
      }
      return jsonResponse({}, false)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let signInResult: { mfaRequired?: boolean } = {}
    await act(async () => {
      signInResult = await result.current.signIn('m@b.com', 'password123')
    })
    expect(signInResult.mfaRequired).toBe(true)
    // No session yet — the pending token alone must not sign the user in.
    expect(result.current.isAuthenticated).toBe(false)
    expect(localStorage.getItem('lifekeel_token')).toBeNull()

    await act(async () => {
      await result.current.verifyMfaCode('123456')
    })
    expect(result.current.isAuthenticated).toBe(true)
    expect(result.current.user?.email).toBe('m@b.com')
    expect(localStorage.getItem('lifekeel_token')).toBe('tok_mfa')
  })
})

describe('AuthProvider.updateEmail', () => {
  it('PUTs to /auth/profile with the Authorization header and persists the returned user', async () => {
    localStorage.setItem('lifekeel_token', 'existing-token')
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      // /auth/me must succeed here — the mount-time rehydrate effect wipes
      // the stored token on a failed /auth/me, which would defeat this
      // test's whole point (asserting the Authorization header is sent).
      if (url.endsWith('/auth/me')) return jsonResponse({ user_id: 'u1', email: 'original@example.com', name: 'Jane' })
      if (url.endsWith('/family')) return jsonResponse({}, false)
      if (url.endsWith('/auth/profile')) {
        return jsonResponse({ user: { id: 'u1', email: 'new@example.com', name: 'Jane', tenant_id: 't1' } })
      }
      return jsonResponse({}, false)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.updateEmail('new@example.com')
    })

    expect(result.current.user?.email).toBe('new@example.com')
    const profileCall = fetchMock.mock.calls.find((call: unknown[]) => (call[0] as string).endsWith('/auth/profile'))!
    const [, requestInit] = profileCall
    expect(requestInit.method).toBe('PUT')
    expect(requestInit.headers.Authorization).toBe('Bearer existing-token')
    expect(JSON.parse(requestInit.body)).toEqual({ email: 'new@example.com' })
  })

  it('throws with the server error message on failure (e.g. a collision with another account) without changing local state', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/profile')) return jsonResponse({ error: 'Email already in use' }, false)
      return jsonResponse({}, false)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(result.current.updateEmail('taken@example.com')).rejects.toThrow('Email already in use')
    expect(result.current.user).toBeNull()
  })
})

describe('AuthProvider.signOut', () => {
  it('clears both the token and the persisted auth cache', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/me')) {
        return jsonResponse({ user_id: 'u3', email: 'x@y.com', name: 'X' })
      }
      if (url.endsWith('/family')) {
        return jsonResponse({ family: { id: 'f2', name: 'The Xs', inviteCode: 'ZZZ999', members: [] } })
      }
      return jsonResponse({}, false)
    })
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem('lifekeel_token', 'existing-token')

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isAuthenticated).toBe(true)

    act(() => {
      result.current.signOut()
    })

    expect(localStorage.getItem('lifekeel_token')).toBeNull()
    expect(localStorage.getItem('family-auth')).toBeNull()
    expect(result.current.isAuthenticated).toBe(false)
  })
})
