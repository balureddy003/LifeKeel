import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { MarkedRoute } from '../MarkedRoute'
import { YearsTimelapse } from '../YearsTimelapse'
import { StickyCta } from '../StickyCta'
import { ROUTE } from '../route'
import { YEAR_ITEMS } from '../years'
import { CLAIMS } from '../claims'
import { track } from '@/lib/growth-track'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

function stubMatchMedia(reduced = false) {
  window.matchMedia = ((q: string) => ({
    matches: reduced && q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('route and years data', () => {
  const status = (id: string) => CLAIMS.find((c) => c.id === id)?.status
  it('each Live or Planned tag matches its claim in the registry', () => {
    for (const c of ROUTE) expect(status(c.claim) === 'live', c.title).toBe(c.live)
    for (const i of YEAR_ITEMS) expect(status(i.claim) === 'live', i.text).toBe(i.live)
  })
})

describe('MarkedRoute', () => {
  it('shows every card with a text tag, and planned cards say "will", not "does"', () => {
    stubMatchMedia(true)
    const { container } = render(<MarkedRoute />)
    const cards = container.querySelectorAll('.lk-rcard')
    expect(cards.length).toBe(ROUTE.length)
    for (const [i, c] of ROUTE.entries()) {
      expect(cards[i]!.querySelector('.lk-st')!.textContent).toBe(c.live ? 'Live' : 'Planned')
      expect(cards[i]!.textContent).toContain(c.live ? 'Keel does' : 'Keel will')
    }
  })

  it('with motion off the course is drawn complete and every lantern is lit', () => {
    stubMatchMedia(true)
    const { container } = render(<MarkedRoute />)
    expect(container.querySelector('clipPath rect')!.getAttribute('width')).toBe('1000')
    expect(container.querySelectorAll('.lk-wl.lit').length).toBe(ROUTE.length)
  })
})

describe('YearsTimelapse', () => {
  it('is four native radios; picking a stage updates the chart and announces it once', () => {
    stubMatchMedia(true)
    const { container } = render(<YearsTimelapse />)
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    fireEvent.click(screen.getByRole('radio', { name: 'Later years' }))
    expect(container.querySelector('figure')!.className).toContain('lk-yr-4')
    expect(container.querySelectorAll('.lk-yl.in').length).toBe(YEAR_ITEMS.length)
    const status = screen.getByRole('status').textContent!
    expect(status).toContain('Later years')
    expect(status).toContain('Access for a named person outside the family (Planned)')
    expect(container.querySelector('[aria-live]')).toBeNull()
  })

  it('steps through the stages by itself once visible, then stops at the last', () => {
    vi.useFakeTimers()
    stubMatchMedia(false)
    let cb: (es: { isIntersecting: boolean }[]) => void = () => {}
    window.IntersectionObserver = class {
      constructor(c: typeof cb) {
        cb = c
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver
    const { container } = render(<YearsTimelapse />)
    const stage = () => container.querySelector('figure')!.className.match(/lk-yr-(\d)/)![1]
    expect(stage()).toBe('1')
    act(() => cb([{ isIntersecting: true }]))
    act(() => void vi.advanceTimersByTime(3300))
    expect(stage()).toBe('2')
    for (let i = 0; i < 4; i++) act(() => void vi.advanceTimersByTime(3300))
    expect(stage()).toBe('4')
  })

  it('does not step by itself when motion is off', () => {
    vi.useFakeTimers()
    stubMatchMedia(true)
    const { container } = render(<YearsTimelapse />)
    act(() => void vi.advanceTimersByTime(20000))
    expect(container.querySelector('figure')!.className).toContain('lk-yr-1')
  })
})

describe('StickyCta', () => {
  it('is one signup link, hidden from assistive tech while off, reporting its location', () => {
    stubMatchMedia(false)
    const { container } = render(<StickyCta />)
    expect(container.querySelector('input')).toBeNull()
    expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true')
    const link = container.querySelector('a')!
    expect(link.getAttribute('href')).toMatch(/\/signup$/)
    document.addEventListener('click', (e) => e.preventDefault(), { once: true })
    fireEvent.click(link)
    expect(track).toHaveBeenCalledWith('landing_cta_click', {
      location: 'sticky',
      method: 'signup',
    })
  })
})
