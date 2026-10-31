/**
 * /auth/callback after Google: a person who started from a brief link goes back
 * to that brief, not the home page. Unsafe or missing paths fall back to home.
 */
import { StrictMode } from 'react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import AuthCallbackPage from '../auth/callback/page'
import { stashReturnTo } from '@/lib/return-to'

const push = vi.fn()
const replace = vi.fn()
const refresh = vi.fn(() => Promise.resolve())
vi.mock('@/lib/auth-context', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth-context')>()),
  useAuth: () => ({ refresh }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }))
vi.mock('@/lib/observability', () => ({ reportError: vi.fn() }))
vi.mock('@/lib/session-token', () => ({ storeSessionToken: vi.fn() }))

beforeEach(() => {
  sessionStorage.clear()
  window.location.hash = ''
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('auth callback return path', () => {
  it('signs in and returns to the brief the person came from', async () => {
    stashReturnTo('/b/abc123')
    window.location.hash = '#token=t&tenant=tn'
    render(<AuthCallbackPage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/b/abc123'))
  })

  it('still returns to the brief when the effect runs twice (strict mode)', async () => {
    stashReturnTo('/b/abc123')
    window.location.hash = '#token=t&tenant=tn'
    render(
      <StrictMode>
        <AuthCallbackPage />
      </StrictMode>,
    )
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/b/abc123'))
    expect(replace).not.toHaveBeenCalledWith('/')
  })

  it('goes home when nothing was parked', async () => {
    window.location.hash = '#token=t&tenant=tn'
    render(<AuthCallbackPage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  })

  it('never follows a tampered path off the site', async () => {
    sessionStorage.setItem('lifekeel_return_to', 'https://evil.example')
    window.location.hash = '#token=t&tenant=tn'
    render(<AuthCallbackPage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'))
  })

  it('keeps the return path through the authenticator-code step', async () => {
    stashReturnTo('/b/abc123')
    window.location.hash = '#mfa_token=m'
    render(<AuthCallbackPage />)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login?mfa=1&next=%2Fb%2Fabc123'))
  })

  it('drops the parked path when sign-in fails', async () => {
    stashReturnTo('/b/abc123')
    window.location.hash = '#error=access_denied'
    render(<AuthCallbackPage />)
    await waitFor(() => expect(sessionStorage.getItem('lifekeel_return_to')).toBeNull())
  })
})
