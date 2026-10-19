import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { LandingHero } from '../LandingHero'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

function stubMatchMedia(reduced: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: reduced && q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

describe('LandingHero', () => {
  beforeEach(() => stubMatchMedia(false))
  afterEach(() => {
    cleanup()
    delete document.documentElement.dataset.motion
  })

  it('leads with the chart headline and a direct signup link, with no email or password field', () => {
    const { container } = render(<LandingHero />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('chart')
    const signup = screen.getByRole('link', { name: 'Create your free account' })
    expect(signup.getAttribute('href')).toMatch(/\/signup$/)
    expect(container.querySelector('input')).toBeNull()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toMatch(/\/login$/)
  })

  it('labels the figures as a sample and puts no aria-live on the animated number', () => {
    const { container } = render(<LandingHero />)
    expect(screen.getAllByText(/sample/i).length).toBeGreaterThan(0)
    expect(container.querySelector('[aria-live]')).toBeNull()
    expect(container.querySelector('.lk-read span[aria-hidden="true"]')).not.toBeNull()
  })

  it('the Pause control turns every ambient loop off through data-motion', () => {
    render(<LandingHero />)
    expect(document.documentElement.dataset.motion).toBe('on')
    const pause = screen.getByRole('button', { name: 'Pause animation' })
    fireEvent.click(pause)
    expect(document.documentElement.dataset.motion).toBe('off')
    expect(
      screen.getByRole('button', { name: 'Play animation' }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('starts with motion off when the system asks for reduced motion', () => {
    stubMatchMedia(true)
    render(<LandingHero />)
    expect(document.documentElement.dataset.motion).toBe('off')
  })
})
