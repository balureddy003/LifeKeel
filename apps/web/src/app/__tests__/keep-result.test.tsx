import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import KeepResultPage from '../keep-result/page'
import { KeepResult } from '@/components/readiness/KeepResult'
import {
  MARKETING_CONSENT_TEXT,
  SAVE_EXPLAINER,
  TRUST_LINES,
  UNMEASURED_NOTE,
} from '@/lib/result-save-copy'

const signInWithMagicLink = vi.fn()
const requestMagicLink = vi.fn(async () => {})
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ signInWithMagicLink }) }))
vi.mock('@/lib/api', () => ({
  requestMagicLink: (...a: unknown[]) => requestMagicLink(...(a as [])),
}))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
vi.mock('@/lib/region', () => ({ appUrl: (p: string) => p }))

const ANSWERS = {
  monthly_salary_minor: 1,
  emergency_savings_minor: 2,
  monthly_expenses_minor: 3,
  mortgage_outstanding_minor: 4,
  life_cover_minor: 5,
  dependents: 6,
}

beforeEach(() => {
  signInWithMagicLink.mockResolvedValue({
    signed_in: true,
    snapshot: {
      id: 's1',
      score: 62,
      saved_at: '2026-10-20T10:00:00.000Z',
      components: [{ key: 'protection', label: 'Protection', score: 20, weight: 1, detail: '' }],
    },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('/keep-result', () => {
  it('shows Continue and consumes nothing until it is pressed, and clears the token from the URL', async () => {
    window.history.replaceState(null, '', '/keep-result?token=' + 'a'.repeat(64))
    render(<KeepResultPage />)
    const button = await screen.findByRole('button', { name: 'Continue' })
    expect(signInWithMagicLink).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
    fireEvent.click(button)
    await waitFor(() => expect(signInWithMagicLink).toHaveBeenCalledWith({ token: 'a'.repeat(64) }))
    expect(await screen.findByText('62 / 100')).toBeTruthy()
    expect(screen.getByText(/Readiness snapshot, 20 October 2026/)).toBeTruthy()
  })

  it('without a token asks for the emailed code and redeems email + code', async () => {
    render(<KeepResultPage />)
    fireEvent.change(await screen.findByLabelText('Email address'), {
      target: { value: 'a@example.com' },
    })
    const submit = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '12ab34' } })
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } })
    fireEvent.click(submit)
    await waitFor(() =>
      expect(signInWithMagicLink).toHaveBeenCalledWith({ email: 'a@example.com', code: '123456' }),
    )
  })

  it('offers a fresh link after a failed redeem without retaking the quiz', async () => {
    signInWithMagicLink.mockRejectedValueOnce(
      new Error('This link or code is invalid or has expired.'),
    )
    window.history.replaceState(null, '', '/keep-result?token=' + 'b'.repeat(64))
    render(<KeepResultPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('This link or code is invalid or has expired.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send me a new link' }))
    await waitFor(() => expect(requestMagicLink).toHaveBeenCalledWith('a@example.com', null))
  })

  it('says the account was not signed in when it has two-step sign-in', async () => {
    signInWithMagicLink.mockResolvedValueOnce({
      signed_in: false,
      reason: 'mfa_required',
      snapshot: { id: 's', score: 50, saved_at: '2026-10-20T10:00:00.000Z', components: [] },
    })
    window.history.replaceState(null, '', '/keep-result?token=' + 'c'.repeat(64))
    render(<KeepResultPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/did not sign you in/)).toBeTruthy()
  })
})

describe('KeepResult on the reveal', () => {
  it('shows the trust block and an unticked marketing box, and states what happens to the address', () => {
    render(<KeepResult answers={ANSWERS} />)
    for (const line of TRUST_LINES) expect(screen.getByText(`• ${line}`)).toBeTruthy()
    expect((screen.getByLabelText(MARKETING_CONSENT_TEXT) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText(SAVE_EXPLAINER)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: /Email me a link/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('sends the answers with consent false by default and true when ticked', async () => {
    render(<KeepResult answers={ANSWERS} />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Email me a link/ }))
    await waitFor(() =>
      expect(requestMagicLink).toHaveBeenCalledWith('a@example.com', ANSWERS, false),
    )
    expect(await screen.findByText('Check your email')).toBeTruthy()

    cleanup()
    render(<KeepResult answers={ANSWERS} />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'b@example.com' } })
    fireEvent.click(screen.getByLabelText(MARKETING_CONSENT_TEXT))
    fireEvent.click(screen.getByRole('button', { name: /Email me a link/ }))
    await waitFor(() =>
      expect(requestMagicLink).toHaveBeenCalledWith('b@example.com', ANSWERS, true),
    )
  })
})

describe('result-save copy', () => {
  const all = [...TRUST_LINES, SAVE_EXPLAINER, MARKETING_CONSENT_TEXT, UNMEASURED_NOTE].join(' ')

  it('has no urgency or scarcity devices (PRD-204)', () => {
    expect(all).not.toMatch(
      /\b(hurry|countdown|limited time|only \d+ (spots|left)|last chance|act now)\b/i,
    )
  })

  it('makes no recommendation and names no provider (advice rule)', () => {
    expect(all).not.toMatch(
      /\b(you should (buy|switch|cancel)|buy|switch to|best policy|recommend)\b/i,
    )
  })
})
