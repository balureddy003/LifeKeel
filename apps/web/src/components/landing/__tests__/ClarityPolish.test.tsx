import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Pricing } from '../Pricing'
import { SiteFooter } from '../SiteFooter'
import { track } from '@/lib/growth-track'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
vi.mock('@/lib/api', () => ({ captureLead: vi.fn(async () => true) }))

afterEach(cleanup)

describe('pricing and footer', () => {
  it('the Plus card says how to cancel and that no card is needed, and the button wording is consistent', () => {
    const { container } = render(<Pricing />)
    expect(container.textContent).toContain('Cancel any time. No card needed to start.')
    expect(screen.getByRole('link', { name: 'Start free, add Plus later' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create your free account' })).toBeTruthy()
  })

  it('the newsletter button is not disabled when empty; submitting empty explains why', async () => {
    render(<SiteFooter />)
    const join = screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement
    expect(join.disabled).toBe(false)
    fireEvent.click(join)
    expect((await screen.findByRole('alert')).textContent).toBe('Enter your email address.')
  })
})

describe('phone hero', () => {
  it('shows all four boats on phone and a signup button in the copy block', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '..', 'hero.css'), 'utf8')
    expect(css).toMatch(/\.lk-hero-cta\s*\{\s*display:\s*flex/)
    // the earlier rule hid the two smallest boats on phones
    expect(css).toMatch(/\.lk-f2, \.lk-f3 \{ display: block; \}/)
  })
})
