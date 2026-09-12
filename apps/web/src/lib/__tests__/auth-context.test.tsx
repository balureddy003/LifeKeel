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

    expect(localStorage.getItem('agentoak_token')).toBe('tok_123')
    expect(result.current.user?.email).toBe('jane@example.com')

    const [, requestInit] = fetchMock.mock.calls[0]!
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
    localStorage.setItem('agentoak_token', 'existing-token')

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isAuthenticated).toBe(true)

    act(() => {
      result.current.signOut()
    })

    expect(localStorage.getItem('agentoak_token')).toBeNull()
    expect(localStorage.getItem('family-auth')).toBeNull()
    expect(result.current.isAuthenticated).toBe(false)
  })
})
