/** Keel Plus sells more briefs first, with one real price per period (hands-on review G6). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('@/lib/api', () => ({
  fetchBillingSubscription: vi.fn().mockResolvedValue({ plan: 'free', status: 'active' }),
  openBillingPortal: vi.fn(),
  redeemPromoCode: vi.fn(),
  startLifeKeelPlusCheckout: vi.fn(),
}))
vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))

import UpgradePage from '../page'

afterEach(cleanup)

describe('Keel Plus page', () => {
  it('leads with briefs and keeps document and inbox reading out of the headline list', async () => {
    render(<UpgradePage />)
    const list = await screen.findByRole('list')
    const items = within(list)
      .getAllByRole('listitem')
      .map((li) => li.textContent ?? '')
    expect(items[0]).toMatch(/brief/i)
    expect(items.join(' ')).not.toMatch(/\bAI\b|inbox|document/i)
    expect(screen.getByText(/^Also included:/)).toBeTruthy()
  })

  it('shows the billed price for each period, not a derived monthly figure', async () => {
    render(<UpgradePage />)
    const radios = await screen.findAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual([
      expect.stringContaining('£59.99'),
      expect.stringContaining('£7.99'),
    ])
    expect(screen.queryByText(/£5\.00|save 37/)).toBeNull()
  })
})
