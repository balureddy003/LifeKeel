import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const useAuth = vi.fn()
const resendVerificationEmail = vi.fn()
vi.mock('@/lib/auth-context', () => ({ useAuth: () => useAuth() }))
vi.mock('@/lib/api', () => ({
  resendVerificationEmail: () => resendVerificationEmail(),
}))

import { VerifyEmailBanner } from '../VerifyEmailBanner'

const signedIn = (emailVerified: boolean) =>
  useAuth.mockReturnValue({ isAuthenticated: true, user: { emailVerified } })

beforeEach(() => {
  localStorage.clear()
  resendVerificationEmail.mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  useAuth.mockReset()
  resendVerificationEmail.mockReset()
})

describe('VerifyEmailBanner', () => {
  it('is one short line with a resend button, not a block of text', async () => {
    signedIn(false)
    render(<VerifyEmailBanner />)
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    expect(screen.getByRole('status').textContent).toMatch(/Verify your email/)
    expect(screen.getByRole('button', { name: /resend/i })).toBeTruthy()
  })

  it('shows nothing once the email is verified, or when signed out', () => {
    signedIn(true)
    const { container, unmount } = render(<VerifyEmailBanner />)
    expect(container.querySelector('[role="status"]')).toBeNull()
    unmount()
    useAuth.mockReturnValue({ isAuthenticated: false, user: null })
    const again = render(<VerifyEmailBanner />)
    expect(again.container.querySelector('[role="status"]')).toBeNull()
  })

  it('has a dismiss control at least 48 points square', async () => {
    signedIn(false)
    render(<VerifyEmailBanner />)
    const dismiss = await screen.findByRole('button', { name: 'Dismiss' })
    expect(dismiss.className).toMatch(/min-h-\[48px\]/)
    expect(dismiss.className).toMatch(/min-w-\[48px\]/)
  })

  it('dismissing hides it and remembers for next time', async () => {
    signedIn(false)
    const { unmount } = render(<VerifyEmailBanner />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(localStorage.getItem('keel:verify-banner-dismissed')).not.toBeNull()
    unmount()
    render(<VerifyEmailBanner />)
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('confirms when the link is sent', async () => {
    signedIn(false)
    render(<VerifyEmailBanner />)
    fireEvent.click(await screen.findByRole('button', { name: /resend/i }))
    await waitFor(() => expect(screen.getByText(/link sent/i)).toBeTruthy())
    expect(resendVerificationEmail).toHaveBeenCalledTimes(1)
  })
})
