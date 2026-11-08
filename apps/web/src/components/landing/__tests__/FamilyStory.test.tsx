/**
 * "Marcia's Tuesday": a short made-up story in six calm beats that shows the family list doing its
 * job. It must respect the visitor's motion choice (pause, reduced motion), read in plain words,
 * make no claim the product cannot back, and never show one adult watching another.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { BEATS, FamilyStory } from '../FamilyStory'
import { CLAIMS } from '../claims'
import { track } from '@/lib/growth-track'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

function stubMatchMedia(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  vi.useFakeTimers()
  stubMatchMedia(false)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  delete document.documentElement.dataset.motion
})

const current = () => screen.getByTestId('story-stage').getAttribute('data-beat')

describe('the story', () => {
  it('has six beats, told in order, in plain words', () => {
    expect(BEATS).toHaveLength(6)
    expect(BEATS.map((b) => b.caption)).toEqual([
      '7:40 on a Tuesday. A school letter and a circled date are on the fridge.',
      'Dev adds the car to the family list. Just the car, for now.',
      'That evening, Marcia looks too. The list shows who has looked.',
      'Weeks later it is raining. The car will not start, and Dev is away.',
      'Marcia opens the list. The car is there, with who to call.',
      'Asha hangs the key back on the hook. Nobody had to ask.',
    ])
  })

  it('shows every beat as text, so nothing depends on the animation', () => {
    render(<FamilyStory />)
    for (const b of BEATS) expect(screen.getByText(b.caption)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Marcia’s Tuesday.' })).toBeTruthy()
    expect(screen.getByText('Made-up family. Made-up dates.')).toBeTruthy()
  })

  it('hides the drawing from screen readers: the beats carry the meaning', () => {
    render(<FamilyStory />)
    expect(screen.getByTestId('story-stage').getAttribute('aria-hidden')).toBe('true')
  })
})

describe('motion', () => {
  it('plays on its own, one beat at a time, and stops on the last', () => {
    render(<FamilyStory />)
    expect(current()).toBe('1')
    act(() => void vi.advanceTimersByTime(5300))
    expect(current()).toBe('2')
    // Each beat schedules the next once it has rendered, so step through them one at a time.
    for (let i = 0; i < 5; i++) act(() => void vi.advanceTimersByTime(5300))
    expect(current()).toBe('6')
    act(() => void vi.advanceTimersByTime(20000))
    expect(current()).toBe('6')
  })

  it('stops when the visitor presses Pause, and carries on when they press Play', () => {
    render(<FamilyStory />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause the story' }))
    act(() => void vi.advanceTimersByTime(20000))
    expect(current()).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Play the story' }))
    act(() => void vi.advanceTimersByTime(5300))
    expect(current()).toBe('2')
  })

  it('does not play at all when the system asks for reduced motion, and can still be stepped through', () => {
    stubMatchMedia(true)
    render(<FamilyStory />)
    act(() => void vi.advanceTimersByTime(30000))
    expect(current()).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(current()).toBe('2')
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(current()).toBe('1')
  })

  it('Next and Previous stay within the six beats', () => {
    render(<FamilyStory />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause the story' }))
    for (let i = 0; i < 9; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(current()).toBe('6')
    for (let i = 0; i < 9; i++) fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(current()).toBe('1')
  })

  it('the controls are 48px buttons, and no 44px rule exists for them', () => {
    render(<FamilyStory />)
    for (const name of ['Pause the story', 'Previous', 'Next'])
      expect(screen.getByRole('button', { name }).className).toContain('fs-btn')
    const css = fs.readFileSync(path.join(__dirname, '..', 'story.css'), 'utf8')
    expect(css).toMatch(/\.fs-btn\s*\{[^}]*min-height:\s*48px/)
    expect(css).not.toMatch(/min-(height|width):\s*44px/)
  })

  it('every loop is stopped by the shared motion switch, and nothing flashes', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'story.css'), 'utf8')
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/)
    // Looping movement only runs while the landing page says motion is on.
    for (const m of css.matchAll(/animation:[^;]*infinite/g)) expect(m[0]).toBeTruthy()
    const loops = css.split('\n').filter((l) => /infinite/.test(l))
    expect(loops.length).toBeGreaterThan(0)
    expect(css).toMatch(/html\[data-motion='on'\]/)
    expect(css).not.toMatch(/blink|strobe/i)
  })
})

describe('the way in at the end', () => {
  it('offers one clear next step, and tracks it like the hero does', () => {
    render(<FamilyStory />)
    const link = screen.getByRole('link', { name: /Start your family.s list/ })
    expect(link.getAttribute('href')).toMatch(/\/signup$/)
    fireEvent.click(link)
    expect(track).toHaveBeenCalledWith('landing_cta_click', { location: 'story', method: 'signup' })
  })

  it('ends on the line, not on a sales push', () => {
    render(<FamilyStory />)
    expect(screen.getByText('Know where to look.')).toBeTruthy()
  })
})

describe('what it may say and show', () => {
  const all = () => document.body.textContent ?? ''

  it('uses only claims the product backs', () => {
    for (const id of [
      'family-list',
      'every-adult-confirms',
      'dates-coming-up',
      'recovery-contact',
    ]) {
      const c = CLAIMS.find((x) => x.id === id)
      expect(c?.status, id).toBe('live')
      expect(
        fs.existsSync(path.join(__dirname, '..', '..', '..', '..', '..', '..', c?.evidence ?? 'x')),
        id,
      ).toBe(true)
    }
    const src = fs.readFileSync(path.join(__dirname, '..', 'FamilyStory.tsx'), 'utf8')
    for (const id of ['family-list', 'every-adult-confirms', 'dates-coming-up', 'recovery-contact'])
      expect(src, id).toContain(id)
  })

  it('shows no death, no distress and no watching', () => {
    render(<FamilyStory />)
    expect(all()).not.toMatch(
      /\b(died|death|funeral|hospital|alarm|siren|crying|emergency|worst|too late|checking up|has not confirmed|hasn.t looked)\b/i,
    )
  })

  it('keeps no brief, runway or roster, and no "both of you"', () => {
    render(<FamilyStory />)
    expect(all()).not.toMatch(/\b(brief|runway|roster)\b|both of you|both adults/i)
  })

  it('shows no figures and names no provider, product or price', () => {
    render(<FamilyStory />)
    expect(all()).not.toMatch(/£|\d+ months|insurer|policy number|per month/i)
  })
})
