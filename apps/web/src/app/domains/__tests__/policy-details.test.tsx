/**
 * After a policy is saved the family list must show it: provider, cover, premiums, the check on
 * the two premiums, and who to call. The coverage table alone showed only a name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const fetchFinancialProfile = vi.fn()
const checkPolicyPremium = vi.fn()
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  fetchFinancialProfile: () => fetchFinancialProfile(),
  checkPolicyPremium: (m?: number, a?: number) => checkPolicyPremium(m, a),
}))

import { PolicyDetails } from '../PolicyDetails'

const TYPES = ['life', 'income_protection', 'critical_illness']
const policy = (over: object = {}) => ({
  id: 'pol_1',
  type: 'life',
  provider: 'Test Insurer',
  coverage_amount_minor: 25_000_000,
  monthly_premium_minor: 4200,
  annual_premium_minor: 50_000,
  contact_phone: '0800 000 0000',
  ...over,
})

beforeEach(() => {
  checkPolicyPremium.mockResolvedValue(null)
})
afterEach(() => {
  cleanup()
  fetchFinancialProfile.mockReset()
  checkPolicyPremium.mockReset()
})

describe('PolicyDetails', () => {
  it('shows provider, cover, both premiums and a tappable claims number', async () => {
    fetchFinancialProfile.mockResolvedValue({ policies: [policy()] })
    render(<PolicyDetails types={TYPES} />)
    await waitFor(() => expect(screen.getByText(/Test Insurer/)).toBeTruthy())
    const card = screen.getByTestId('policy-details').textContent ?? ''
    expect(card).toMatch(/£250,000/)
    expect(card).toMatch(/£42 a month/)
    expect(card).toMatch(/£500 a year/)
    const link = screen.getByRole('link', { name: /0800 000 0000/ })
    expect(link.getAttribute('href')).toBe('tel:08000000000')
  })

  it('shows the premium check line when the two premiums do not match', async () => {
    fetchFinancialProfile.mockResolvedValue({ policies: [policy()] })
    checkPolicyPremium.mockResolvedValue({
      status: 'mismatch',
      text: '£42 a month adds up to £504 a year. You entered £500 a year, £4 less.',
    })
    render(<PolicyDetails types={TYPES} />)
    await waitFor(() => expect(screen.getByText(/adds up to £504 a year/)).toBeTruthy())
    expect(checkPolicyPremium).toHaveBeenCalledWith(4200, 50_000)
  })

  it('does not run the check or invent a number when a premium is missing', async () => {
    fetchFinancialProfile.mockResolvedValue({
      policies: [policy({ annual_premium_minor: undefined, coverage_amount_minor: 0 })],
    })
    render(<PolicyDetails types={TYPES} />)
    await waitFor(() => expect(screen.getByText(/Test Insurer/)).toBeTruthy())
    expect(checkPolicyPremium).not.toHaveBeenCalled()
    const card = screen.getByTestId('policy-details').textContent ?? ''
    expect(card).not.toMatch(/a year/)
    expect(card).not.toMatch(/Cover £/)
  })

  it('only lists policy types this page is about', async () => {
    fetchFinancialProfile.mockResolvedValue({
      policies: [policy(), policy({ id: 'pol_2', type: 'car', provider: 'Motor Co' })],
    })
    render(<PolicyDetails types={TYPES} />)
    await waitFor(() => expect(screen.getByText(/Test Insurer/)).toBeTruthy())
    expect(screen.queryByText(/Motor Co/)).toBeNull()
  })

  it('renders nothing when no policy is on file', async () => {
    fetchFinancialProfile.mockResolvedValue({ policies: [] })
    const { container } = render(<PolicyDetails types={TYPES} />)
    await waitFor(() => expect(fetchFinancialProfile).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="policy-details"]')).toBeNull()
  })
})
