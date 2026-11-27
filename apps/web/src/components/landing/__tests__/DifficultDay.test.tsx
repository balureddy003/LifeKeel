/**
 * Scroll 3 — a difficult ordinary day, told as a list rather than a drama. The family's plan always; a
 * small business plan only once the business door is open (verticals.ts), and its link goes to the
 * separate business vertical. The test guards the shape and the restraint (no alarm, no advice).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  BUSINESS_PLAN,
  DAY_CAPTION,
  DAY_CAPTION_TWO,
  DAY_CLOSING,
  DAY_INTRO,
  DifficultDay,
  FAMILY_PLAN,
} from '../DifficultDay'
import { CLAIMS } from '../claims'
import { BUSINESS_SITE_URL } from '../verticals'
import { track } from '@/lib/growth-track'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))

const tracked = vi.mocked(track)

afterEach(() => {
  cleanup()
  tracked.mockClear()
  vi.unstubAllEnvs()
})

describe('DifficultDay (Scroll 3)', () => {
  it('names the day plainly and says the list holds three things', () => {
    render(<DifficultDay />)
    expect(
      screen.getByRole('heading', { level: 2, name: 'A difficult ordinary day.' }),
    ).toBeTruthy()
    for (const line of DAY_INTRO) expect(screen.getByText(line)).toBeTruthy()
  })

  it('today shows the family plan alone: three rows and one link to sign up', () => {
    const { container } = render(<DifficultDay />)
    const panels = [...container.querySelectorAll('article.lk-day-panel')]
    expect(panels).toHaveLength(1)
    expect(panels[0]!.querySelectorAll('li')).toHaveLength(3)
    expect(panels[0]!.querySelector('a')!.getAttribute('href')).toContain('/signup')
    const rows = [...container.querySelectorAll('.lk-day-panel li > span:last-child')].map(
      (s) => s.textContent,
    )
    expect(rows).toEqual([...FAMILY_PLAN.rows])
    expect(screen.getByText(DAY_CAPTION)).toBeTruthy()
  })

  it('lands the calm closing line after the panels', () => {
    const { container } = render(<DifficultDay />)
    const panels = container.querySelector('.lk-day-panels')!
    const closing = container.querySelector('.lk-day-closing')!
    expect(closing.textContent).toBe(DAY_CLOSING)
    expect(panels.compareDocumentPosition(closing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('records which plan was opened', () => {
    render(<DifficultDay />)
    const family = screen.getByRole('link', { name: FAMILY_PLAN.cta })
    family.addEventListener('click', (e) => e.preventDefault())
    fireEvent.click(family)
    expect(tracked).toHaveBeenCalledWith('landing_cta_click', {
      location: 'difficult_day_family',
      method: 'signup',
    })
  })

  it('once the business door is open, adds a same-shaped business plan that links to its own vertical', () => {
    vi.stubEnv('NEXT_PUBLIC_BUSINESS_DOOR', 'on')
    const { container } = render(<DifficultDay />)
    const panels = [...container.querySelectorAll('article.lk-day-panel')]
    expect(panels).toHaveLength(2)
    for (const p of panels) {
      expect(p.querySelectorAll('li')).toHaveLength(3)
      expect(p.querySelector('h3')!.textContent).toBe('A difficult morning')
    }
    expect(screen.getByRole('link', { name: BUSINESS_PLAN.cta }).getAttribute('href')).toBe(
      BUSINESS_SITE_URL,
    )
    expect(screen.getByText(DAY_CAPTION_TWO)).toBeTruthy()
  })

  it('stays ordinary: no crisis, no alarm, no red-button verb, and no team', () => {
    const text = [
      DAY_INTRO.join(' '),
      DAY_CLOSING,
      DAY_CAPTION,
      DAY_CAPTION_TWO,
      ...FAMILY_PLAN.rows,
      ...BUSINESS_PLAN.rows,
    ].join(' ')
    expect(text).not.toMatch(/crisis|emergency|urgent|panic|hospital|A&E|siren|meltdown/i)
    expect(text).not.toMatch(/\bactivate\b|\btrigger\b|\bswitch to\b/i)
    expect(text).not.toMatch(/\byou should\b|\bbuy\b|\bswitch\b|\bnot covered\b/i)
    expect(text).not.toMatch(/we will call|we call |24\/7|around the clock/i)
    expect(text).not.toMatch(/\b(team|co-?founder|founder|payroll|court)\b/i)
  })

  it('every claim the family plan relies on is live in the registry', () => {
    for (const id of [
      'bad-day-steps',
      'first-steps-from-list',
      'who-to-call',
      'no-money-moved',
      'no-policy-picks',
    ]) {
      const claim = CLAIMS.find((x) => x.id === id)
      expect(claim, id).toBeTruthy()
      expect(claim!.status, id).toBe('live')
    }
  })
})
