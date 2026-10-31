/**
 * /verify-otp (CLOUDFLARE_INTEGRATION.md §6.7): six boxes, paste fills all
 * and submits, errors are announced with attempts left, success follows the
 * normal post-sign-in redirect, and no pending challenge sends you to login.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import VerifyOtpPage from '../verify-otp/page'
import { AuthRequestError } from '@/lib/auth-context'
import { savePendingOtp } from '@/lib/otp-pending'

const verifyEmailOtp = vi.fn()
const resendEmailOtp = vi.fn()
const push = vi.fn()
const replace = vi.fn()
vi.mock('@/lib/auth-context', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth-context')>()),
  useAuth: () => ({ verifyEmailOtp, resendEmailOtp }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

const future = (s: number) => new Date(Date.now() + s * 1000).toISOString()
function pending(purpose: 'signup' | 'login' = 'signup') {
  savePendingOtp({
    otp_required: true,
    otp_token: 'pending-token',
    email_hint: 'j***@example.com',
    delivery: 'sent',
    code_expires_at: future(600),
    chain_expires_at: future(1800),
    resend_available_at: future(60),
    purpose,
  })
}

beforeEach(() => sessionStorage.clear())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('verify-otp page', () => {
  it('without a pending challenge, goes back to sign in', async () => {
    render(<VerifyOtpPage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
  })

  it('shows six numeric boxes with one-time-code autofill and the masked address', async () => {
    pending()
    render(<VerifyOtpPage />)
    const boxes = await screen.findAllByLabelText(/Digit \d of 6/)
    expect(boxes).toHaveLength(6)
    expect(boxes[0]!.getAttribute('autocomplete')).toBe('one-time-code')
    expect(boxes[0]!.getAttribute('inputmode')).toBe('numeric')
    expect(screen.getByText(/j\*\*\*@example\.com/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Resend in \d+ s/ })).toBeTruthy()
  })

  it('pasting six digits submits, and success follows the signup redirect', async () => {
    pending('signup')
    verifyEmailOtp.mockResolvedValueOnce({ purpose: 'signup' })
    render(<VerifyOtpPage />)
    const [first] = await screen.findAllByLabelText(/Digit \d of 6/)
    fireEvent.paste(first!, { clipboardData: { getData: () => '482 913' } })
    await waitFor(() => expect(verifyEmailOtp).toHaveBeenCalledWith('482913'))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/briefs'))
  })

  it('announces a wrong code with the tries left and clears the boxes', async () => {
    pending('login')
    verifyEmailOtp.mockRejectedValueOnce(
      new AuthRequestError('otp_invalid', 400, 'otp_invalid', { attempts_left: 3 }),
    )
    render(<VerifyOtpPage />)
    const [first] = await screen.findAllByLabelText(/Digit \d of 6/)
    fireEvent.paste(first!, { clipboardData: { getData: () => '111111' } })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/3 tries left/))
    for (const box of screen.getAllByLabelText(/Digit \d of 6/))
      expect((box as HTMLInputElement).value).toBe('')
  })

  it('a locked chain offers only "Start over"', async () => {
    pending('login')
    verifyEmailOtp.mockRejectedValueOnce(new AuthRequestError('x', 429, 'otp_locked', {}))
    render(<VerifyOtpPage />)
    const [first] = await screen.findAllByLabelText(/Digit \d of 6/)
    fireEvent.paste(first!, { clipboardData: { getData: () => '111111' } })
    const start = await screen.findByRole('button', { name: 'Start over' })
    fireEvent.click(start)
    expect(push).toHaveBeenCalledWith('/login')
    expect(sessionStorage.length).toBe(0)
  })
})
