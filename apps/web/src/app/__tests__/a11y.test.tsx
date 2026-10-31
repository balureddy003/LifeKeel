/**
 * Automated accessibility checks (axe-core, WCAG 2 A and AA) on the pages a new
 * person meets first. jsdom has no layout, so colour contrast is not checked
 * here (landing-contrast.test.ts covers the landing tokens); this catches
 * missing names, labels, roles, landmarks and duplicate ids. It does not
 * replace a real screen-reader pass.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor, screen } from '@testing-library/react'
import axe from 'axe-core'
import SignUpPage from '../signup/page'
import LoginPage from '../login/page'
import WelcomePage from '../welcome/page'
import ObligationsMapPage from '../map/page'
import { HomeExperience } from '@/components/landing/HomeExperience'

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    signUp: vi.fn(),
    signIn: vi.fn(),
    verifyMfaCode: vi.fn(),
    signInWithProvider: vi.fn(),
    isAuthenticated: false,
  }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
}))
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  fetchPublicStatus: async () => ({ signups_enabled: true }),
  captureLead: vi.fn(),
  getObligationsMap: async () => ({
    obligations: [
      {
        id: 'o1',
        label: 'Mortgage payment',
        category: null,
        named_person: 'Alex',
        pays_from: null,
        notices_to: null,
        next_due_date: '2026-12-14',
        recurrence: 'monthly',
        if_unavailable: null,
        pending_confirmation: true,
        can_confirm: true,
        confirmed_by: null,
        created_by: 'u1',
      },
    ],
    can_edit: true,
    summary: {
      dependent_count: 1,
      top_person: 'Alex',
      top_person_count: 1,
      earliest_due_date: '2026-12-14',
      earliest_due_label: 'Mortgage payment',
    },
  }),
}))
vi.mock('@/lib/growth-track', () => ({ track: vi.fn(), currentUtm: () => undefined }))
vi.mock('@/lib/ad-track', () => ({ trackConversion: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
vi.mock('@/components/RegionSwitch', () => ({ RegionSwitch: () => null }))
vi.mock('@/components/Toast', () => ({ useToast: () => vi.fn() }))

afterEach(cleanup)

async function violations(container: HTMLElement) {
  const r = await axe.run(container, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
}

describe('accessibility (axe-core, WCAG 2 A and AA)', () => {
  it('the check itself catches a button with no name (it would fail without axe)', async () => {
    const { container } = render(<button type="button" />)
    expect((await violations(container)).join()).toContain('button-name')
  })
  it('landing page', async () => {
    const { container } = render(<HomeExperience />)
    expect(await violations(container)).toEqual([])
  })
  it('signup', async () => {
    const { container } = render(<SignUpPage />)
    expect(await violations(container)).toEqual([])
  })
  it('sign in', async () => {
    const { container } = render(<LoginPage />)
    expect(await violations(container)).toEqual([])
  })
  it('welcome', async () => {
    const { container } = render(<WelcomePage />)
    expect(await violations(container)).toEqual([])
  })
  it('obligations map', async () => {
    const { container } = render(<ObligationsMapPage />)
    await waitFor(() => expect(screen.getByText('Mortgage payment')).toBeTruthy())
    expect(await violations(container)).toEqual([])
  })
})
