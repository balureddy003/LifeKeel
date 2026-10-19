import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { LandingHero } from '../LandingHero'
import { track } from '@/lib/growth-track'

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
    const signup = container.querySelector('.lk-card a.lk-btn') as HTMLElement
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
    expect(screen.getByRole('button', { name: 'Play animation' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Play animation' }).getAttribute('aria-pressed')).toBeNull()
  })

  it('starts with motion off when the system asks for reduced motion', () => {
    stubMatchMedia(true)
    render(<LandingHero />)
    expect(document.documentElement.dataset.motion).toBe('off')
  })

  it('reports signup and sign-in clicks with a location and no personal data', () => {
    render(<LandingHero />)
    fireEvent.click(screen.getAllByRole('link', { name: 'Create your free account' })[0]!)
    expect(track).toHaveBeenCalledWith('landing_cta_click', { location: 'hero_top', method: 'signup' })
    const stop = (e: Event) => e.preventDefault() // jsdom cannot navigate
    document.addEventListener('click', stop)
    fireEvent.click(document.querySelector('.lk-card a.lk-btn')!)
    expect(track).toHaveBeenCalledWith('landing_cta_click', { location: 'hero', method: 'signup' })
    fireEvent.click(screen.getByRole('link', { name: 'Sign in' }))
    expect(track).toHaveBeenCalledWith('landing_signin_click', { location: 'hero' })
    document.removeEventListener('click', stop)
  })

  it('marks the scene hidden to the stylesheet when it scrolls out of view', () => {
    let cb: (es: { isIntersecting: boolean }[]) => void = () => {}
    window.IntersectionObserver = class {
      constructor(c: typeof cb) {
        cb = c
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver
    const { container } = render(<LandingHero />)
    const scene = container.querySelector('.lk-scene')!
    expect(scene.getAttribute('data-visible')).toBe('true')
    act(() => cb([{ isIntersecting: false }]))
    expect(scene.getAttribute('data-visible')).toBe('false')
  })
})
