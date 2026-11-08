/**
 * The home page hero tells the family-list story: Know where to look.
 * It says what LifeKeel keeps, that every adult has seen it, and what it never does. It shows a
 * made-up family list, not a calculation, and every sentence reads at grade 9 or below.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { VividHero } from '../VividHero'
import { CLAIMS } from '../claims'
import { track } from '@/lib/growth-track'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('home hero', () => {
  it('leads with "Know where to look.", not a calculation and not a promise about a bad day', () => {
    render(<VividHero />)
    expect(screen.getByRole('heading', { level: 1, name: 'Know where to look.' })).toBeTruthy()
    // Four of five panel reviewers read the earlier headline as a euphemism for death, and it
    // promised more than the product can: a list is only complete if someone added things.
    expect(document.body.textContent).not.toMatch(/already there|The day someone needs it/)
    expect(screen.getByText('A shared family list')).toBeTruthy()
  })

  it('says what is kept and that every adult is asked to confirm, never that they all have', () => {
    render(<VividHero />)
    expect(
      screen.getByText(
        'One list for what your family would look for. Policies, cars, school dates and who to call. Every adult is asked to confirm they have seen it.',
      ),
    ).toBeTruthy()
  })

  it('has one way in, and a way to read more', () => {
    render(<VividHero />)
    const start = screen.getByRole('link', { name: /Start your family.s list/ })
    expect(start.getAttribute('href')).toMatch(/\/signup$/)
    fireEvent.click(start)
    expect(track).toHaveBeenCalledWith('landing_cta_click', {
      location: 'home_hero',
      method: 'signup',
    })
    expect(screen.getByRole('link', { name: 'See how it works' }).getAttribute('href')).toBe(
      '#how-it-works',
    )
  })

  it('keeps the promises about money and advice, in plain words', () => {
    render(<VividHero />)
    for (const t of ['No commissions', 'Never moves money', 'Your details never sold'])
      expect(screen.getByText(t)).toBeTruthy()
    expect(document.body.textContent).toMatch(/Free to start\. No card needed\./)
    expect(document.body.textContent).toMatch(/Information only, not regulated advice/)
  })

  it('has a sign-in link on its own line at 48px', () => {
    render(<VividHero />)
    const link = screen.getByRole('link', { name: 'Sign in' })
    expect(link.getAttribute('href')).toMatch(/\/login$/)
    expect(link.closest('p')?.className).toBe('vv-signin')
    const css = fs.readFileSync(path.join(__dirname, '..', 'vivid.css'), 'utf8')
    expect(css).toMatch(/\.vv-signin a\s*\{[^}]*min-height:\s*48px/)
  })

  it('shows a made-up family list that every adult has seen, with dates and no figures', () => {
    const { container } = render(<VividHero />)
    expect(
      container.querySelector('[aria-label="Sample family list, as shown in the app"]'),
    ).toBeTruthy()
    expect(screen.getByText('Sample family list')).toBeTruthy()
    expect(screen.getByText('Seen by every adult')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/both adults|Every adult has seen it/)
    expect(screen.getByText(/MOT due 14 March/)).toBeTruthy()
    expect(screen.getByText('Made-up family. Made-up dates.')).toBeTruthy()
    // It is a list, not a calculation: no runway months, no pound amounts.
    expect(container.textContent).not.toMatch(/months|£/)
  })

  it('uses the family-list words, not "brief", "runway" or "roster"', () => {
    const { container } = render(<VividHero />)
    expect(container.textContent).not.toMatch(/\b(brief|runway|roster)\b/i)
  })

  it('every claim it relies on is live in the registry', () => {
    const ids = [
      'family-list',
      'every-adult-confirms',
      'no-commissions',
      'no-money-moved',
      'no-selling',
      'free-plan',
    ]
    for (const id of ids) {
      const c = CLAIMS.find((x) => x.id === id)
      expect(c, id).toBeTruthy()
      expect(c!.status, id).toBe('live')
    }
    const src = fs.readFileSync(path.join(__dirname, '..', 'VividHero.tsx'), 'utf8')
    for (const id of ids) expect(src, id).toContain(id)
  })
})
