/**
 * The cinematic hero reads three calm beats around the locked platform
 * line "Know where to look." It is a quiet opening shot, not a SaaS pitch.
 *
 * Brand discipline referenced:
 *   - docs/research/brand-and-story-guide-2026-11-08.md §4 (story rules)
 *   - docs/marketing/cinematic-site-redesign-2026-11-26.md §4 (Scroll 0)
 *   - apps/web/src/components/landing/claims.ts (live registry)
 *   - packages/engine/src/__tests__/copy-readability.test.ts (advice rule)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { LandingHero } from '../LandingHero'
import { CLAIMS } from '../claims'
import { track } from '@/lib/growth-track'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

describe('LandingHero (paper-mode)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(cleanup)

  it('renders three calm beats: opening, the "Know where to look." h1, and the resolution', () => {
    render(<LandingHero />)
    expect(screen.getByRole('heading', { level: 1, name: 'Know where to look.' })).toBeTruthy()
    // Body beats around the h1 — order matters: problem above, resolution below.
    expect(screen.getByText('The important things usually live in one head.')).toBeTruthy()
    expect(screen.getByText('One list. The people who need to know can see it.')).toBeTruthy()
  })

  it('never claims "every adult has seen it" and never says "always watching"', () => {
    render(<LandingHero />)
    expect(document.body.textContent).not.toMatch(/every adult has seen it/i)
    expect(document.body.textContent).not.toMatch(/always watching|24\/7|around the clock/i)
    expect(document.body.textContent).not.toMatch(/already there|The day someone needs it/i)
  })

  it('carries one primary CTA and one quiet secondary, never two parallel buttons', () => {
    render(<LandingHero />)
    const start = screen.getByRole('link', { name: /Start a free list/ })
    expect(start.getAttribute('href')).toMatch(/\/signup$/)
    const team = screen.getByRole('link', { name: /For a small team/ })
    expect(team.textContent).toMatch(/see plans/)
  })

  it('uses the Rivera family cast (Dev / Marcia / Asha) — one cast for the home page', () => {
    render(<LandingHero />)
    expect(document.body.textContent).toContain('The Rivera family')
    expect(document.body.textContent).toContain('Dev')
    expect(document.body.textContent).toContain('Marcia')
    // Asha is referenced in the row label "School fees start 1 September — Asha"
    expect(document.body.textContent).toContain('Asha')
  })

  it('shows the sample-list prop with real names, real ticks, and the illustrative caption', () => {
    render(<LandingHero />)
    const prop = screen.getByTestId('marketing-seen-by-list')
    expect(prop.getAttribute('aria-label')).toMatch(/Sample family list/)
    expect(prop.textContent).toContain('Car insurance — renewal 14 March')
    expect(prop.textContent).toContain('Yours begins empty and stays yours.')
    expect(prop.textContent).toMatch(/Dev last looked 9 days ago/)
  })

  it('states the no-money, no-advice, free-to-start microcopy beneath the CTA', () => {
    render(<LandingHero />)
    expect(document.body.textContent).toMatch(/Free for a household/)
    expect(document.body.textContent).toMatch(/Honest plans for a team/)
    expect(document.body.textContent).toMatch(/never moves money/)
    expect(document.body.textContent).toMatch(/never gives advice/)
  })

  it('reports signup clicks without personal data', () => {
    render(<LandingHero />)
    const stop = (event: Event) => event.preventDefault()
    document.addEventListener('click', stop)
    fireEvent.click(screen.getByRole('link', { name: /Start a free list/ }))
    document.removeEventListener('click', stop)
    expect(track).toHaveBeenCalledWith('landing_cta_click', {
      location: 'paper_hero',
      method: 'signup',
    })
  })

  it('marks the hero hidden when it scrolls out of view', () => {
    let callback: (entries: { isIntersecting: boolean }[]) => void = () => {}
    window.IntersectionObserver = class {
      constructor(value: typeof callback) {
        callback = value
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver
    const { container } = render(<LandingHero />)
    const hero = container.querySelector('.lk-paper-hero')!
    expect(hero.getAttribute('data-visible')).toBe('true')
    act(() => {
      callback([{ isIntersecting: false }])
    })
    expect(hero.getAttribute('data-visible')).toBe('false')
  })

  it('every claim the hero relies on is live in the registry', () => {
    const ids = [
      'family-list',
      'every-adult-confirms',
      'no-commissions',
      'no-money-moved',
      'no-policy-picks',
      'no-selling',
      'free-plan',
    ]
    for (const id of ids) {
      const c = CLAIMS.find((x) => x.id === id)
      expect(c, id).toBeTruthy()
      expect(c!.status, id).toBe('live')
    }
  })

  it('uses the family-list vocabulary, not "brief", "runway" or "roster"', () => {
    const { container } = render(<LandingHero />)
    expect(container.textContent).not.toMatch(/\b(brief|runway|roster)\b/i)
    expect(container.textContent).not.toMatch(/£/)
    expect(container.textContent).not.toMatch(/months of savings/)
  })
})
