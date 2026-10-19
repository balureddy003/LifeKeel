import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import SignUpPage from '../signup/page'
import LoginPage from '../login/page'
import WelcomePage from '../welcome/page'

const signUp = vi.fn(async () => {})
const signIn = vi.fn(async () => ({ mfaRequired: false }))
const push = vi.fn()
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    signUp,
    signIn,
    verifyMfaCode: vi.fn(),
    signInWithProvider: vi.fn(),
    isAuthenticated: false,
  }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/' }))
vi.mock('@/lib/api', () => ({ fetchPublicStatus: async () => ({ signups_enabled: true }), captureLead: vi.fn() }))
vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/lib/ad-track', () => ({ trackConversion: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
vi.mock('@/components/RegionSwitch', () => ({ RegionSwitch: () => null }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('signup form', () => {
  it('is a real form: Enter submits, errors are announced, fields are marked invalid and focus moves', async () => {
    const { container } = render(<SignUpPage />)
    expect(container.querySelector('form')).not.toBeNull()
    // the submit button is enabled and validates on submit instead of staying silently disabled
    const submit = screen.getByRole('button', { name: 'Create your free account' })
    expect((submit as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(submit)
    expect(signUp).not.toHaveBeenCalled()
    const name = screen.getByLabelText('Your name')
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(name)
    expect(screen.getByText('Enter your name.')).toBeTruthy()
    expect(container.querySelector('[role="alert"]')).not.toBeNull() // permanent region, mounted from the start
  })

  it('submits through the form when the fields are valid', async () => {
    const { container } = render(<SignUpPage />)
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Alex' } })
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'alex@example.com' } })
    fireEvent.change(container.querySelector('#signup-password')!, { target: { value: 'longenough1' } })
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(signUp).toHaveBeenCalled())
    expect(push).toHaveBeenCalledWith('/family-setup')
  })

  it('tells the visitor what happens next and says the data is not sold', () => {
    render(<SignUpPage />)
    expect(screen.getByText(/Next you add the people in your household/)).toBeTruthy()
    expect(screen.getByText(/financial data isn.t sold/i)).toBeTruthy()
  })
})

describe('login form', () => {
  it('is a real form with a permanent alert region, and reports empty fields', () => {
    const { container } = render(<LoginPage />)
    expect(container.querySelector('form')).not.toBeNull()
    fireEvent.submit(container.querySelector('form')!)
    expect(signIn).not.toHaveBeenCalled()
    expect(container.querySelector('#login-error')!.textContent).toBe('Enter your email address and password.')
    expect(screen.getByLabelText('Email address').getAttribute('aria-invalid')).toBe('true')
  })
})

describe('welcome carousel', () => {
  it('keeps one primary button across slides so focus is never lost, and ends on signup', () => {
    render(<WelcomePage />)
    const primary = screen.getByRole('button', { name: 'Continue' })
    primary.focus()
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: /Continue|Create your free account/ }))
    const last = screen.getByRole('button', { name: 'Create your free account' })
    expect(last).toBe(primary) // the same element, only its label changed
    expect(document.activeElement).toBe(primary)
    fireEvent.click(last)
    expect(push).toHaveBeenCalledWith('/signup')
  })

  it('uses the chart story, with one h1, and no retired wording', () => {
    const { container } = render(<WelcomePage />)
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'welcome', 'page.tsx'), 'utf8')
    for (const bad of ['Life Map', 'instant answer', 'adapts to each person', 'Just Ask']) expect(src).not.toContain(bad)
  })
})

describe('signed-out fallback', () => {
  it('is the landing-look sign-in prompt and says nothing about always-on monitoring', () => {
    const shell = fs.readFileSync(path.resolve(__dirname, '..', '..', 'components', 'AppShell.tsx'), 'utf8')
    expect(shell).toContain('title="Sign in to continue"')
    expect(shell.toLowerCase()).not.toContain('always-on')
    // and it is framed by AuthShell, not squeezed into the phone-width wrapper
    expect(shell).toContain('const signedOutFallback = !isAuthenticated && !isAuthRoute')
    expect(shell).toMatch(/signedOutFallback \? '' : 'pt-2'/)
  })
})

describe('exits and titles', () => {
  const app = path.resolve(__dirname, '..')
  it('every account and legal page has its own title, and the site title no longer overpromises', () => {
    for (const d of ['welcome', 'login', 'signup', 'reset-password', 'verify-email', 'terms', 'privacy', 'support']) {
      expect(fs.readFileSync(path.join(app, d, 'layout.tsx'), 'utf8'), d).toMatch(/title: '[^']+ — LifeKeel'/)
    }
    const root = fs.readFileSync(path.join(app, 'layout.tsx'), 'utf8')
    expect(root).not.toContain('knows what to do next')
    expect(root).not.toContain('guided response plan')
  })

  it('terms, privacy and support no longer send signed-out readers to /settings', () => {
    for (const d of ['terms', 'privacy', 'support']) {
      expect(fs.readFileSync(path.join(app, d, 'page.tsx'), 'utf8'), d).not.toContain('backHref="/settings"')
    }
  })
})
