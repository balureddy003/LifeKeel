import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, cleanup } from '@testing-library/react'
import { PublicShell } from '../PublicShell'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
const auth = { isAuthenticated: false }
vi.mock('@/lib/auth-context', () => ({ useAuth: () => auth }))
vi.mock('@/lib/api', () => ({ captureLead: vi.fn(async () => true) }))

afterEach(() => {
  cleanup()
  auth.isAuthenticated = false
})

const APP = path.resolve(__dirname, '..', '..', '..', 'app')

describe('PublicShell', () => {
  it('wraps the page in the landing header and footer, and section links go back to /', () => {
    render(
      <PublicShell>
        <h1>Terms of Service</h1>
      </PublicShell>,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Terms of Service')
    const pricing = screen.getAllByRole('link', { name: 'Pricing' })
    expect(pricing.length).toBeGreaterThanOrEqual(2) // header and footer
    expect(pricing.every((a) => a.getAttribute('href') === '/#pricing')).toBe(true)
    expect(screen.getAllByRole('link', { name: 'Guides' })[0]!.getAttribute('href')).toBe('/guides')
    expect(document.querySelector('footer.lk-footer')).not.toBeNull()
  })

  it('offers a signed-in reader "Open LifeKeel" instead of Sign in and Get started', () => {
    auth.isAuthenticated = true
    render(
      <PublicShell>
        <h1>Terms</h1>
      </PublicShell>,
    )
    expect(screen.getByRole('link', { name: 'Open LifeKeel' }).getAttribute('href')).toBe('/')
    expect(screen.queryByRole('link', { name: 'Sign in', hidden: true })).toBeNull() // bar and hidden phone menu
    expect(screen.queryByRole('link', { name: 'Get started' })).toBeNull()
  })

  it('is applied to terms, privacy, support, blog and guides through their layouts', () => {
    for (const route of ['terms', 'privacy', 'support', 'blog', 'guides']) {
      const layout = fs.readFileSync(path.join(APP, route, 'layout.tsx'), 'utf8')
      expect(layout, route).toContain('<PublicShell>')
    }
  })

  it('AppShell lets those routes own their width instead of the phone-width wrapper', () => {
    const shell = fs.readFileSync(path.resolve(APP, '..', 'components', 'AppShell.tsx'), 'utf8')
    for (const route of ['/terms', '/privacy', '/support', '/blog', '/guides']) {
      expect(shell, route).toContain(`'${route}'`)
    }
  })

  it('remaps the app colour tokens only inside the shell, in both themes', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '..', 'public.css'), 'utf8')
    for (const sel of ['.lk-public {', ":root[data-theme='dark'] .lk-public {"]) {
      const block = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)))
      for (const v of ['--tint', '--surface-0', '--ink-1', '--ink-2', '--family-400'])
        expect(block, `${sel} ${v}`).toContain(v)
    }
  })
})
