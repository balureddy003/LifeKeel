import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SiteFooter } from '../SiteFooter'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
afterEach(cleanup)

describe('footer voice', () => {
  it('speaks of a list, not a chart, and does not use the old insurance-style tagline', () => {
    const { container } = render(<SiteFooter />)
    const text = container.textContent ?? ''
    expect(text).toContain('Know where to look'.toUpperCase())
    expect(text).not.toMatch(/\bchart\b|Have a plan|next chapter/i)
  })
})

describe('footer sign-up band', () => {
  it('shows on the landing page, and not on public pages unless asked', () => {
    const { container, rerender } = render(<SiteFooter />)
    expect(container.textContent).toContain('Good things, in your inbox.')
    rerender(<SiteFooter home={false} />)
    expect(container.textContent).not.toContain('Good things, in your inbox.')
    rerender(<SiteFooter home={false} newsletter />)
    expect(container.textContent).toContain('Good things, in your inbox.')
  })
})
