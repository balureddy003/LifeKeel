import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { AuthProvider, useAuth } from '../auth-context'
import * as sessionPurge from '../session-purge'
import * as push from '../push'

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
  it('R21: keeps the bearer fallback when the browser blocks the session cookie', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/me')) {
        const headers = (init?.headers ?? {}) as Record<string, string>
        // Only a request that carries the bearer succeeds: the cookie is blocked.
        return headers['Authorization']
          ? jsonResponse({
              user_id: 'u1',
              tenant_id: 't1',
              email: 'jane@example.com',
              name: 'Jane',
            })
          : Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) })
      }
      return jsonResponse({
        token: 'tok_blocked',
        user: { id: 'u1', email: 'jane@example.com', name: 'Jane Doe', tenant_id: 't1' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.signUp('Jane Doe', 'jane@example.com', 'password123')
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(localStorage.getItem('lifekeel_token')).toBe('tok_blocked')
  })

  it('sends a unique workspace slug derived from the given name, and persists the token', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      jsonResponse({
        token: 'tok_123',
        user: { id: 'u1', email: 'jane@example.com', name: 'Jane Doe', tenant_id: 't1' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.signUp('Jane Doe', 'jane@example.com', 'password123')
    })

    // R21: /auth/me answered with the cookie alone, so no script-readable
    // copy of the token is kept.
    await waitFor(() => expect(localStorage.getItem('lifekeel_token')).toBeNull())
    expect(result.current.user?.email).toBe('jane@example.com')

    // The mount-time rehydrate also fetches (/auth/me, cookie-session probe),
    // so locate the signup call by URL rather than assuming calls[0].
    const signupCall = fetchMock.mock.calls.find((call: unknown[]) =>
      (call[0] as string).endsWith('/auth/signup'),
    )!
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
        return jsonResponse({
          token: 'tok_456',
          user: { id: 'u2', email: 'a@b.com', name: 'A', tenant_id: 't2' },
        })
      }
      if (url.endsWith('/family')) {
        return jsonResponse({
          family: { id: 'f1', name: 'The Bs', inviteCode: 'ABC123', members: [] },
        })
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
        return jsonResponse({
          token: 'tok_mfa',
          user: { id: 'u9', email: 'm@b.com', name: 'M', tenant_id: 't9' },
        })
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
      if (url.endsWith('/auth/me'))
        return jsonResponse({ user_id: 'u1', email: 'original@example.com', name: 'Jane' })
      if (url.endsWith('/family')) return jsonResponse({}, false)
      if (url.endsWith('/auth/profile')) {
        return jsonResponse({
          user: { id: 'u1', email: 'new@example.com', name: 'Jane', tenant_id: 't1' },
        })
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
    const profileCall = fetchMock.mock.calls.find((call: unknown[]) =>
      (call[0] as string).endsWith('/auth/profile'),
    )!
    const [, requestInit] = profileCall
    expect(requestInit.method).toBe('PUT')
    expect(requestInit.headers.Authorization).toBe('Bearer existing-token')
    expect(JSON.parse(requestInit.body)).toEqual({ email: 'new@example.com' })
  })

  it('throws with the server error message on failure (e.g. a collision with another account) without changing local state', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/profile'))
        return jsonResponse({ error: 'Email already in use' }, false)
      return jsonResponse({}, false)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await expect(result.current.updateEmail('taken@example.com')).rejects.toThrow(
      'Email already in use',
    )
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
        return jsonResponse({
          family: { id: 'f2', name: 'The Xs', inviteCode: 'ZZZ999', members: [] },
        })
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

  it('purges device data (caches, offline queue, tenant) so a shared device keeps nothing', async () => {
    const purge = vi.spyOn(sessionPurge, 'purgeClientData').mockResolvedValue()
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/me'))
        return jsonResponse({ user_id: 'u3', email: 'x@y.com', name: 'X' })
      if (url.endsWith('/family')) return jsonResponse({ family: null })
      return jsonResponse({}, false)
    })
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem('lifekeel_token', 'existing-token')

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => {
      result.current.signOut()
    })

    expect(purge).toHaveBeenCalledTimes(1)
  })

  it('unregisters push before the local wipe and before the server logout (PRD-140)', async () => {
    let release!: () => void
    const unregister = vi
      .spyOn(push, 'unregisterAllPush')
      .mockReturnValue(new Promise<void>((r) => (release = r)))
    const purge = vi.spyOn(sessionPurge, 'purgeClientData').mockResolvedValue()
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/auth/me'))
        return jsonResponse({ user_id: 'u3', email: 'x@y.com', name: 'X' })
      if (url.endsWith('/family')) return jsonResponse({ family: null })
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem('lifekeel_token', 'existing-token')

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => {
      result.current.signOut()
    })

    expect(unregister).toHaveBeenCalledTimes(1)
    expect(unregister.mock.invocationCallOrder[0]!).toBeLessThan(purge.mock.invocationCallOrder[0]!)
    const logouts = () =>
      fetchMock.mock.calls.filter((c: unknown[]) => (c[0] as string).endsWith('/auth/logout'))
    expect(logouts()).toHaveLength(0) // the session cookie must outlive the unregister call
    await act(async () => {
      release()
    })
    await waitFor(() => expect(logouts()).toHaveLength(1))
  })

  it('purges device data when the server rejects a previously signed-in session', async () => {
    const purge = vi.spyOn(sessionPurge, 'purgeClientData').mockResolvedValue()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) }),
    )
    localStorage.setItem('lifekeel_token', 'expired-token')

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(purge).toHaveBeenCalledTimes(1)
  })

  it('does not purge for an anonymous visitor with no prior session', async () => {
    const purge = vi.spyOn(sessionPurge, 'purgeClientData').mockResolvedValue()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) }),
    )

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(purge).not.toHaveBeenCalled()
  })

  it('keeps the session on a transient server error — only a real 401/403 signs out (UAT P9)', async () => {
    // A rate-limit 5xx used to fall into the same branch as a rejected
    // session and wipe lifekeel_token — the ChannelsCard loop tripping
    // the 100/min cap signed the user out mid-session.
    const purge = vi.spyOn(sessionPurge, 'purgeClientData').mockResolvedValue()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) }),
    )
    localStorage.setItem('lifekeel_token', 'still-valid-token')
    localStorage.setItem(
      'family-auth',
      JSON.stringify({ user: { id: 'u1', email: 'a@b.com', name: 'A' }, family: null }),
    )

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(purge).not.toHaveBeenCalled()
    expect(localStorage.getItem('lifekeel_token')).toBe('still-valid-token')
    expect(result.current.user?.email).toBe('a@b.com')
    expect(result.current.isAuthenticated).toBe(true)
  })
})

describe('AuthProvider email OTP (CLOUDFLARE_INTEGRATION.md §6)', () => {
  const challenge = {
    otp_required: true,
    otp_token: 'pending-1',
    email_hint: 'a***@b.com',
    delivery: 'sent',
    code_expires_at: new Date(Date.now() + 600_000).toISOString(),
    chain_expires_at: new Date(Date.now() + 1_800_000).toISOString(),
    resend_available_at: new Date(Date.now() + 60_000).toISOString(),
  }

  beforeEach(() => sessionStorage.clear())

  it('signIn returns otpRequired, keeps the challenge in sessionStorage and stores no session', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/me'))
        return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) })
      if (url.endsWith('/auth/login')) {
        expect((init?.headers as Record<string, string>)['cf-turnstile-token']).toBe('cf-tok')
        return jsonResponse(challenge)
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    let out: { otpRequired?: boolean } = {}
    await act(async () => {
      out = await result.current.signIn('a@b.com', 'password123', { turnstileToken: 'cf-tok' })
    })
    expect(out.otpRequired).toBe(true)
    expect(JSON.parse(sessionStorage.getItem('lifekeel_otp_pending')!).otp_token).toBe('pending-1')
    expect(localStorage.getItem('lifekeel_token')).toBeNull()
  })

  it('verifyEmailOtp posts the pending token with the code, then signs in and clears the challenge', async () => {
    sessionStorage.setItem(
      'lifekeel_otp_pending',
      JSON.stringify({ ...challenge, purpose: 'login' }),
    )
    const bodies: Record<string, unknown>[] = []
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/me'))
        return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) })
      if (url.endsWith('/auth/otp/verify')) {
        bodies.push(JSON.parse(String(init?.body)))
        return jsonResponse({
          token: 'tok_otp',
          user: { id: 'u1', email: 'a@b.com', name: 'A', tenant_id: 't1' },
        })
      }
      return jsonResponse({ id: 'f1', name: 'Fam', members: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.verifyEmailOtp('123456')
    })
    expect(bodies[0]).toEqual({ otp_token: 'pending-1', code: '123456' })
    expect(sessionStorage.getItem('lifekeel_otp_pending')).toBeNull()
    expect(result.current.isAuthenticated).toBe(true)
  })
})
