import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MarketingTags } from '../MarketingTags'
import { writeConsent } from '@/lib/consent'

vi.mock('next/navigation', () => ({ usePathname: () => '/cookies' }))
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ isAuthenticated: false }) }))
vi.mock('@/lib/consent', () => ({
  TRACKERS_CONFIGURED: true,
  isTrackablePath: () => false,
  readConsent: () => null,
  onConsentChange: () => () => {},
  writeConsent: vi.fn(),
}))
vi.mock('@/components/GoogleAnalytics', () => ({ GoogleAnalytics: () => null }))
vi.mock('@/components/AdPixels', () => ({ AdPixels: () => null }))

afterEach(cleanup)

describe('cookie page choices', () => {
  it('offers cookie choices on the cookie page even though the page is not trackable', () => {
    render(<MarketingTags />)
    expect(screen.getByRole('dialog', { name: 'Cookie choices' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Cookies & storage' }).getAttribute('href')).toBe(
      '/cookies',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(writeConsent).toHaveBeenCalledWith('rejected')
  })
})
