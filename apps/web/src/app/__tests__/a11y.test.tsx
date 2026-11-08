/**
 * Automated accessibility checks (axe-core, WCAG 2 A and AA) on the pages a new
 * person meets first. jsdom has no layout, so colour contrast is not checked
 * here (landing-contrast.test.ts covers the landing tokens); this catches
 * missing names, labels, roles, landmarks and duplicate ids. It does not
 * replace a real screen-reader pass.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor, screen, fireEvent } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import axe from 'axe-core'
import SignUpPage from '../signup/page'
import LoginPage from '../login/page'
import WelcomePage from '../welcome/page'
import ObligationsMapPage from '../map/page'
import DomainsPage from '../domains/page'
import { ThreeDoors } from '@/components/ThreeDoors'
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
  getDomains: async () => ({
    domains: [
      {
        id: 'life_protection',
        title: 'Life and income protection',
        summary: 'Which policies are on file.',
        confirm: 'both_adults',
      },
    ],
  }),
  getDomainView: async (id: string) => (id === 'car' ? carView : lifeView),
  getDomainPlaybook: async () => null,
  confirmDomain: vi.fn(),
  addDomainRecord: vi.fn(),
  deleteDomainRecord: vi.fn(),
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
const lifeView = {
  domain_id: 'life_protection',
  can_edit: true,
  roster: [
    { id: 'sam', name: 'Sam' },
    { id: 'alex', name: 'Alex' },
  ],
  pack: {
    id: 'life_protection',
    title: 'Life and income protection',
    summary: 'Which policies are on file.',
    records: [
      {
        key: 'policy',
        label: 'Policy',
        person_attribution: 'holder',
        source: { kind: 'adapter', adapter: 'financial_profile_policies' },
        fields: [{ key: 'provider', label: 'Provider', kind: 'text' }],
      },
    ],
    playbook: { playbook: 'bereavement', label: 'If someone dies: what is on file' },
  },
  rows: [
    {
      id: 'p1',
      record: 'policy',
      holder_member_id: 'sam',
      covers_member_id: 'alex',
      values: { provider: 'Provider A' },
    },
  ],
  matrix: {
    label: 'Who is covered by what',
    columns: [
      { id: 'sam', name: 'Sam' },
      { id: 'alex', name: 'Alex' },
    ],
    rows: [{ id: 'p1', label: 'Policy · Provider A', cells: { sam: 'holds', alex: 'covers' } }],
  },
  gaps: [{ row_id: 'p1', note: 'Not yet matched to a family member' }],
  upcoming: [
    {
      trigger: 'renewal',
      label: 'A policy renewal date is coming up',
      row_id: 'p1',
      row_label: 'Policy · Provider A',
      date: '2026-12-01',
      days: 12,
    },
  ],
  result_version: 'a'.repeat(64),
  confirmation: {
    required: [
      { id: 'sam', name: 'Sam' },
      { id: 'alex', name: 'Alex' },
    ],
    confirmed: [],
    both_confirmed: false,
    viewer_confirmed: false,
  },
}
const carView = {
  ...lifeView,
  domain_id: 'car',
  matrix: null,
  gaps: [],
  upcoming: [],
  rows: [
    {
      id: 'v1',
      record: 'vehicle',
      holder_member_id: 'sam',
      covers_member_id: null,
      values: { reg: 'AB12 CDE', mot_due: '2027-02-01' },
    },
  ],
  pack: {
    id: 'car',
    title: 'Car and transport',
    summary: 'Which vehicles are on file.',
    records: [
      {
        key: 'vehicle',
        label: 'Vehicle',
        person_attribution: 'holder',
        source: { kind: 'store' },
        fields: [
          { key: 'reg', label: 'Registration', kind: 'text' },
          { key: 'mot_due', label: 'MOT due', kind: 'date' },
        ],
      },
    ],
    playbook: { playbook: 'car', label: 'If there is an accident or breakdown: what is on file' },
  },
}

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

  it('home doors', async () => {
    const { container } = render(<ThreeDoors />)
    expect(await violations(container)).toEqual([])
  })
  it('domains hub', async () => {
    window.history.pushState({}, '', '/domains')
    const { container } = render(<DomainsPage />)
    await waitFor(() => expect(screen.getByText('Life and income protection')).toBeTruthy())
    expect(await violations(container)).toEqual([])
  })
  it('domain with a matrix, reminders and a first-steps picker', async () => {
    window.history.pushState({}, '', '/domains?d=life_protection')
    const { container } = render(<DomainsPage />)
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Who is covered by what' })).toBeTruthy(),
    )
    expect(await violations(container)).toEqual([])
  })
  it('domain with records and the add form open', async () => {
    window.history.pushState({}, '', '/domains?d=car')
    const { container } = render(<DomainsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Add a vehicle/ }))
    expect(await violations(container)).toEqual([])
  })
})

describe('touch targets and motion (what jsdom can check)', () => {
  // jsdom has no layout, so this checks the 48px class contract on buttons; the
  // measured 375px pass (axe + bounding boxes) is done in a browser, see
  // docs/reviews/ship-loop-ledger.md.
  // Tailwind: h-10 is 40px, h-11 is 44px, h-12 is 48px. Only 48px and up counts.
  const TAP_SIZED =
    /min-h-\[(4[89]|[5-9]\d|\d{3,})px\]|\bmin-h-(1[2-9]|[2-9]\d)\b|\bh-(1[2-9]|[2-9]\d)\b/
  const isTapSized = (className: string) => TAP_SIZED.test(className)
  // Buttons, and links that are styled as buttons (inline text links are exempt).
  const small = (c: HTMLElement) =>
    [...c.querySelectorAll('button, a.inline-flex')]
      .filter((b) => !isTapSized(b.className))
      .map((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim().slice(0, 30))

  it('treats 40px and 44px as too small, and 48px and up as fine', () => {
    for (const c of ['h-10', 'h-11', 'min-h-[40px]', 'min-h-[44px]', 'min-h-11', 'p-3'])
      expect(isTapSized(c), c).toBe(false)
    for (const c of ['h-12', 'h-14', 'min-h-12', 'min-h-[48px]', 'min-h-[56px]', 'min-h-[64px]'])
      expect(isTapSized(c), c).toBe(true)
  })

  it('flags a button-styled link that is too small', () => {
    const { container } = render(
      <div>
        <a href="/x" className="inline-flex h-11 items-center">
          small link
        </a>
        <a href="/y" className="inline-flex min-h-[48px] items-center">
          ok link
        </a>
        <button type="button" className="h-10">
          small button
        </button>
      </div>,
    )
    expect(small(container)).toEqual(['small link', 'small button'])
  })

  it('every button on the domains pages is at least 48px tall', async () => {
    for (const d of ['life_protection', 'car']) {
      window.history.pushState({}, '', `/domains?d=${d}`)
      const { container, unmount } = render(<DomainsPage />)
      await waitFor(() => expect(container.querySelector('main button')).toBeTruthy())
      if (d === 'car') fireEvent.click(await screen.findByRole('button', { name: /Add a vehicle/ }))
      expect(small(container), d).toEqual([])
      unmount()
    }
  })

  it('the home door footnote link is at least 48px tall', () => {
    const { container } = render(<ThreeDoors />)
    const link = container.querySelector('a[href^="/domains"]')!
    expect(link.className).toContain('min-h-[48px]')
  })

  it('the stylesheet honours reduced motion', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'globals.css'), 'utf8')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })
})
