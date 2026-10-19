import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { YearsTimelapse } from '../YearsTimelapse'
import { StickyCta } from '../StickyCta'
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

describe('years data', () => {
  const status = (id: string) => CLAIMS.find((c) => c.id === id)?.status
  it('every year item is backed by a live claim', () => {
    for (const i of YEAR_ITEMS) expect(status(i.claim), i.text).toBe('live')
  })

  it('every stage has something new on the chart', () => {
    for (const stage of [1, 2, 3, 4])
      expect(
        YEAR_ITEMS.some((i) => i.stage === stage),
        `stage ${stage}`,
      ).toBe(true)
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
    expect(container.textContent).not.toMatch(/planned|\blive\b/i)
    const status = screen.getByRole('status').textContent!
    expect(status).toContain('Later years')
    expect(status).toContain('Retirement gap check')
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

describe('StickyCta and the footer', () => {
  it('hides once the footer is on screen, even if the close was never seen', () => {
    stubMatchMedia(false)
    const foot = document.createElement('footer')
    foot.className = 'lk-footer'
    document.body.appendChild(foot)
    const cbs = new Map<Element, (es: { isIntersecting: boolean }[]) => void>()
    window.IntersectionObserver = class {
      private cb: (es: { isIntersecting: boolean }[]) => void
      constructor(c: (es: { isIntersecting: boolean }[]) => void) {
        this.cb = c
      }
      observe(el: Element) {
        cbs.set(el, this.cb)
      }
      disconnect() {}
    } as unknown as typeof IntersectionObserver
    const hero = document.createElement('div')
    hero.id = 'signup'
    document.body.appendChild(hero)
    const { container } = render(<StickyCta />)
    act(() => cbs.get(hero)!([{ isIntersecting: false }]))
    expect(container.firstElementChild!.className).toContain('on')
    act(() => cbs.get(foot)!([{ isIntersecting: true }]))
    expect(container.firstElementChild!.className).not.toContain(' on')
    foot.remove()
    hero.remove()
  })
})

describe('StickyCta and the phone hero button', () => {
  it('stays hidden while the hero signup button in the copy block is on screen', () => {
    stubMatchMedia(false)
    const hero = document.createElement('div')
    hero.id = 'signup'
    const top = document.createElement('a')
    top.className = 'lk-hero-cta'
    document.body.append(hero, top)
    const cbs = new Map<Element, (es: { isIntersecting: boolean }[]) => void>()
    window.IntersectionObserver = class {
      private cb: (es: { isIntersecting: boolean }[]) => void
      constructor(c: (es: { isIntersecting: boolean }[]) => void) {
        this.cb = c
      }
      observe(el: Element) {
        cbs.set(el, this.cb)
      }
      disconnect() {}
    } as unknown as typeof IntersectionObserver
    const { container } = render(<StickyCta />)
    act(() => cbs.get(hero)!([{ isIntersecting: false }]))
    expect(container.firstElementChild!.className).toContain('on')
    act(() => cbs.get(top)!([{ isIntersecting: true }]))
    expect(container.firstElementChild!.className).not.toContain(' on')
    hero.remove()
    top.remove()
  })
})
