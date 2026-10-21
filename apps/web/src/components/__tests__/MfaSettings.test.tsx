/**
 * MfaSettings must send the stored Bearer token — the httpOnly session
 * cookie is blocked on cross-site deployments (Safari ITP, third-party
 * cookie blocking), which made /auth/mfa/* 401 in production for exactly
 * those users (P4: "Settings appears to sign you out").
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/lib/native', () => ({
  isNativeShell: () => false,
  isBiometricAvailable: async () => false,
  biometricLockEnabled: () => false,
  setBiometricLockEnabled: vi.fn(),
}))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

import { MfaSettings } from '../MfaSettings'
import { ToastProvider } from '../Toast'

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MfaSettings', () => {
  it('sends the stored Bearer token with the status probe', async () => {
    localStorage.setItem('lifekeel_token', 'tok_abc')
    const fetchMock = vi
      .fn()
      .mockImplementation(() => jsonResponse({ enabled: false, recovery_codes_remaining: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <ToastProvider>
        <MfaSettings />
      </ToastProvider>,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const call = fetchMock.mock.calls.find((c: unknown[]) =>
      (c[0] as string).endsWith('/auth/mfa/status'),
    )!
    const init = call[1] as RequestInit
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok_abc')
  })

  it('shows Unavailable, not an endless spinner, when the probe fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => jsonResponse({}, false)),
    )

    render(
      <ToastProvider>
        <MfaSettings />
      </ToastProvider>,
    )

    expect(await screen.findByText('Unavailable')).toBeTruthy()
  })
})
