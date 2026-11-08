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
