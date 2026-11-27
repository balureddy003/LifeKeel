/**
 * Scroll 3 — a difficult ordinary day.
 *
 * The rising action, told as a list rather than a drama: two panels, family
 * and team, shaped identically. The test guards the shape (it is the
 * argument) and the restraint (no alarm, no advice, no button to press).
 *
 * Copy rules referenced:
 *   - docs/marketing/cinematic-site-redesign-2026-11-26.md §4 (Scroll 3)
 *   - apps/web/src/components/landing/claims.ts (live registry)
 *   - CostAndTrust.test.tsx (no disaster / no advice vocabulary)
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  DAY_CAPTION,
  DAY_CLOSING,
  DAY_INTRO,
  DifficultDay,
  FAMILY_PLAN,
  TEAM_PLAN,
} from '../DifficultDay'
import { CLAIMS } from '../claims'
import { track } from '@/lib/growth-track'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))

const tracked = vi.mocked(track)

afterEach(() => {
  cleanup()
  tracked.mockClear()
})

describe('DifficultDay (Scroll 3)', () => {
  it('names the day plainly and says the list holds three things', () => {
    render(<DifficultDay />)
    expect(
      screen.getByRole('heading', { level: 2, name: 'A difficult ordinary day.' }),
    ).toBeTruthy()
    for (const line of DAY_INTRO) expect(screen.getByText(line)).toBeTruthy()
  })

  it('gives the family and the team one identical shape: same heading, three rows, same link', () => {
    const { container } = render(<DifficultDay />)
    const panels = [...container.querySelectorAll('article.lk-day-panel')]
    expect(panels).toHaveLength(2)
    expect(panels.map((p) => p.className)).toEqual(['lk-day-panel', 'lk-day-panel'])
    for (const panel of panels) {
      expect(panel.querySelectorAll('li')).toHaveLength(3)
      expect(panel.querySelector('h3')!.textContent).toBe('A difficult morning')
      expect(panel.querySelector('a')!.getAttribute('href')).toContain('/signup')
    }
    expect(screen.getByText(FAMILY_PLAN.cta)).toBeTruthy()
    expect(screen.getByText(TEAM_PLAN.cta)).toBeTruthy()
  })

  it('shows the three next things on each list, and nothing else', () => {
    const { container } = render(<DifficultDay />)
    const rows = [...container.querySelectorAll('.lk-day-panel li > span:last-child')].map(
      (span) => span.textContent,
    )
    expect(rows).toEqual([...FAMILY_PLAN.rows, ...TEAM_PLAN.rows])
    // No extra rows, no next-steps counter, no progress bar.
    expect(container.querySelectorAll('.lk-day-panel li')).toHaveLength(6)
  })

  it('lands the calm closing line after both panels, and says the panels are made up', () => {
    const { container } = render(<DifficultDay />)
    const panels = container.querySelector('.lk-day-panels')!
    const closing = container.querySelector('.lk-day-closing')!
    expect(closing.textContent).toBe(DAY_CLOSING)
    expect(panels.compareDocumentPosition(closing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText(DAY_CAPTION)).toBeTruthy()
  })

  it('sends both links to signup and records which plan was opened', () => {
    render(<DifficultDay />)
    // jsdom cannot navigate; keep the click local to the assertion.
    const family = screen.getByRole('link', { name: FAMILY_PLAN.cta })
    family.addEventListener('click', (e) => e.preventDefault())
    fireEvent.click(family)
    expect(tracked).toHaveBeenCalledWith('landing_cta_click', {
      location: 'difficult_day_family',
      method: 'signup',
    })
    const team = screen.getByRole('link', { name: TEAM_PLAN.cta })
    team.addEventListener('click', (e) => e.preventDefault())
    fireEvent.click(team)
    expect(tracked).toHaveBeenCalledWith('landing_cta_click', {
      location: 'difficult_day_team',
      method: 'signup',
    })
  })

  it('stays ordinary: no crisis, no alarm, no red-button verb', () => {
    const text = [
      DAY_INTRO.join(' '),
      DAY_CLOSING,
      DAY_CAPTION,
      ...FAMILY_PLAN.rows,
      ...TEAM_PLAN.rows,
    ].join(' ')
    expect(text).not.toMatch(/crisis|emergency|urgent|panic|hospital|A&E|siren|meltdown/i)
    expect(text).not.toMatch(/\bactivate\b|\btrigger\b|\bswitch to\b/i)
    expect(text).not.toMatch(/\byou should\b|\bbuy\b|\bswitch\b|\bnot covered\b/i)
    // It is never a call centre or a professional substitute.
    expect(text).not.toMatch(/we will call|we call |24\/7|around the clock/i)
  })

  it('every claim it relies on is live in the registry', () => {
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
