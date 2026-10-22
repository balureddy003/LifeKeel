import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { LandingHero } from '../LandingHero'
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

describe('LandingHero', () => {
  beforeEach(() => {
    stubMatchMedia(false)
    vi.clearAllMocks()
  })
  afterEach(() => {
    cleanup()
    delete document.documentElement.dataset.motion
  })

  it('leads with family readiness and a direct signup link without asking for credentials', () => {
    const { container } = render(<LandingHero />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Stay one step ready.')
    expect(screen.getByRole('link', { name: /Start your family/ }).getAttribute('href')).toMatch(
      /\/signup$/,
    )
    expect(container.querySelector('input')).toBeNull()
    expect(screen.getByRole('link', { name: 'See how it works' }).getAttribute('href')).toBe(
      '#how-it-works',
    )
  })

  it('labels the dashboard as illustrative and keeps animated figures out of announcements', () => {
    const { container } = render(<LandingHero />)
    expect(screen.getByLabelText('Illustrative family dashboard')).toBeTruthy()
    expect(screen.getByText('The Ellis family · Illustrative example')).toBeTruthy()
    expect(container.querySelector('[aria-live]')).toBeNull()
    expect(container.querySelector('.lk-dash-runway strong[aria-hidden="true"]')).not.toBeNull()
  })

  it('lets people inspect a different scenario with its actual sample assumptions', () => {
    render(<LandingHero />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Choose a sample scenario' }), {
      target: { value: '1' },
    })
    expect(screen.getByText(/No wages, benefits or other income counted/)).toBeTruthy()
    expect(screen.getByText('Savings last about 2.8 months in this sample scenario.')).toBeTruthy()
  })

  it('pauses and resumes automatic examples through the shared motion preference', () => {
    render(<LandingHero />)
    expect(document.documentElement.dataset.motion).toBe('on')
    fireEvent.click(screen.getByRole('button', { name: 'Pause examples' }))
    expect(document.documentElement.dataset.motion).toBe('off')
    expect(screen.getByRole('button', { name: 'Play examples' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Play examples' }))
    expect(document.documentElement.dataset.motion).toBe('on')
  })

  it('starts with motion off when the system asks for reduced motion', () => {
    stubMatchMedia(true)
    render(<LandingHero />)
    expect(document.documentElement.dataset.motion).toBe('off')
  })

  it('reports signup clicks without personal data', () => {
    render(<LandingHero />)
    const stop = (event: Event) => event.preventDefault()
    document.addEventListener('click', stop)
    fireEvent.click(screen.getByRole('link', { name: /Start your family/ }))
    document.removeEventListener('click', stop)
    expect(track).toHaveBeenCalledWith('landing_cta_click', { location: 'hero', method: 'signup' })
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
    const hero = container.querySelector('.lk-modern-hero')!
    expect(hero.getAttribute('data-visible')).toBe('true')
    act(() => callback([{ isIntersecting: false }]))
    expect(hero.getAttribute('data-visible')).toBe('false')
  })
})
