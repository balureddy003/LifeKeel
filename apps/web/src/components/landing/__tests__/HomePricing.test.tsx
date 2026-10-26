import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { HomePricing } from '../HomePricing'
import { track } from '@/lib/growth-track'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
afterEach(cleanup)

describe('homepage plan comparison', () => {
  it('offers only Free and Keel Plus at the existing monthly price', () => {
    render(<HomePricing />)
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'Free' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Keel Plus' })).toBeTruthy()
    expect(screen.getByText('£7.99')).toBeTruthy()
    expect(screen.queryByText(/annual|enterprise|unlimited|priority support/i)).toBeNull()
  })

  it('distinguishes an optional mailbox connection from paid email summaries', () => {
    render(<HomePricing />)
    const row = screen.getByRole('row', { name: /Summaries of financial email/ })
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Not included', 'Included with a connected mailbox'])
    expect(
      screen.getByText(/a connection on its own does not include AI summaries on Free/),
    ).toBeTruthy()
  })

  it('routes each choice through signup and records the selected plan location', () => {
    render(<HomePricing />)
    const plus = screen.getByRole('link', { name: /Start free, add Plus later/ })
    expect(plus.getAttribute('href')).toMatch(/\/signup$/)
    const stop = (event: Event) => event.preventDefault()
    document.addEventListener('click', stop)
    fireEvent.click(plus)
    document.removeEventListener('click', stop)
    expect(track).toHaveBeenCalledWith('landing_cta_click', {
      location: 'home_pricing_plus',
      method: 'signup',
    })
  })
})
