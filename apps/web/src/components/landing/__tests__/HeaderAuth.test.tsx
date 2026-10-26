import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SiteHeader } from '../SiteHeader'
import { SiteFooter } from '../SiteFooter'
import { AuthShell } from '../AuthShell'
import { Brand } from '../Brand'
import { track } from '@/lib/growth-track'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
vi.mock('@/lib/api', () => ({ captureLead: vi.fn(async () => true) }))

afterEach(cleanup)

describe('Brand', () => {
  it('is the app icon plus the wordmark, as one home link', () => {
    const { container } = render(<Brand />)
    expect(screen.getByRole('link', { name: 'LifeKeel home' }).getAttribute('href')).toBe('/')
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/icon.svg')
    expect(container.textContent).toBe('LifeKeel')
  })
})

describe('SiteHeader', () => {
  it('switches and persists the public theme preference', () => {
    localStorage.clear()
    document.documentElement.dataset.theme = 'light'
    render(<SiteHeader />)
    const toggle = screen.getByRole('button', { name: 'Toggle light and dark theme' })
    fireEvent.click(toggle)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('lifekeel-theme')).toBe('dark')
    fireEvent.click(toggle)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('lifekeel-theme')).toBe('light')
    localStorage.clear()
  })

  it('links the sections, signs in and starts on the app host, and reports the clicks', () => {
    render(<SiteHeader />)
    expect(screen.getByRole('link', { name: 'Pricing' }).getAttribute('href')).toBe('#pricing')
    expect(
      within(screen.getByRole('navigation', { name: 'Main' }))
        .getByRole('link', { name: 'Guides' })
        .getAttribute('href'),
    ).toBe('/guides')
    const start = screen.getByRole('link', { name: 'Get started' })
    expect(start.getAttribute('href')).toMatch(/\/signup$/)
    const stop = (e: Event) => e.preventDefault() // jsdom cannot navigate
    document.addEventListener('click', stop)
    fireEvent.click(start)
    expect(track).toHaveBeenCalledWith('landing_cta_click', { location: 'nav', method: 'signup' })
    fireEvent.click(screen.getAllByRole('link', { name: 'Sign in' })[0]!)
    expect(track).toHaveBeenCalledWith('landing_signin_click', { location: 'nav' })
    document.removeEventListener('click', stop)
  })

  it('opens and closes the phone menu with the right aria state', () => {
    render(<SiteHeader />)
    const btn = screen.getByRole('button', { name: 'Open menu' })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(btn)
    expect(screen.getByRole('button', { name: 'Close menu' }).getAttribute('aria-expanded')).toBe(
      'true',
    )
    expect(screen.getByRole('navigation', { name: 'Menu' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull()
  })

  it('closes the phone menu on Escape', () => {
    render(<SiteHeader />)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull()
  })
})

describe('header and footer share one lockup', () => {
  it('both render the same Brand, so they cannot drift apart', () => {
    const header = render(<SiteHeader />)
    const a = header.container.querySelector('.lk-brand')!.outerHTML
    cleanup()
    const footer = render(<SiteFooter />)
    expect(footer.container.querySelector('.lk-brand')!.outerHTML).toBe(a)
  })

  it('header and footer use the same container width as the bands', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '..', 'bands.css'), 'utf8')
    const widths = [
      ...css.matchAll(/(\.lk-band|\.lk-header-in|\.lk-menu)\s*\{[^}]*max-width:\s*(\d+)px/g),
    ].map((m) => m[2])
    expect(new Set(widths)).toEqual(new Set(['1180']))
  })
})

describe('hero shell', () => {
  it('uses the same 1148px content width as the header and bands, so the corners line up', () => {
    const hero = fs.readFileSync(path.resolve(__dirname, '..', 'hero.css'), 'utf8')
    expect(hero).toMatch(/\.lk-scene\s*\{[^}]*width:\s*min\(1148px,\s*calc\(100% - 32px\)\)/)
    const bands = fs.readFileSync(path.resolve(__dirname, '..', 'bands.css'), 'utf8')
    // 1180px band minus 16px padding on each side = 1148px of content
    expect(bands).toMatch(/\.landing \.lk-band\s*\{[^}]*max-width:\s*1180px[^}]*padding:[^}]*16px/)
  })
})

describe('AuthShell', () => {
  it('frames a screen with the brand, one h1, the sub line and legal links', () => {
    render(
      <AuthShell title="Welcome back" sub="Sign in to your family">
        <button>Sign In</button>
      </AuthShell>,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome back')
    expect(screen.getByText('Sign in to your family')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'LifeKeel home' })).toBeTruthy()
    expect(
      ['Terms', 'Privacy', 'Support'].every((n) => screen.getByRole('link', { name: n })),
    ).toBe(true)
  })

  it('makes the heading focusable only when a ref is passed (step changes)', () => {
    const { rerender } = render(<AuthShell title="A" />)
    expect(screen.getByRole('heading', { level: 1 }).getAttribute('tabindex')).toBeNull()
    rerender(<AuthShell title="A" headingRef={{ current: null }} />)
    expect(screen.getByRole('heading', { level: 1 }).getAttribute('tabindex')).toBe('-1')
  })
})
