/**
 * After a policy is saved the family list must show it: provider, cover, premiums, the check on
 * the two premiums, and who to call. The coverage table alone showed only a name.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'

const fetchFinancialProfile = vi.fn()
const checkPolicyPremium = vi.fn()
const editFamilyPolicy = vi.fn()
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  fetchFinancialProfile: () => fetchFinancialProfile(),
  checkPolicyPremium: (m?: number, a?: number) => checkPolicyPremium(m, a),
  editFamilyPolicy: (id: string, patch: object) => editFamilyPolicy(id, patch),
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

  it('changing a premium updates the row at once and says what changed and what stayed the same', async () => {
    fetchFinancialProfile.mockResolvedValue({
      policies: [policy({ annual_premium_minor: 50_400 })],
    })
    editFamilyPolicy.mockResolvedValue({
      ok: true,
      result: {
        policy: policy({ annual_premium_minor: 50_400, monthly_premium_minor: 4500 }),
        changes: {
          changed: [
            { field: 'monthly_premium_minor', label: 'Monthly premium', before: 4200, after: 4500 },
          ],
          unchanged: [
            { field: 'coverage_amount_minor', label: 'Cover', value: 25_000_000 },
            { field: 'annual_premium_minor', label: 'Yearly premium', value: 50_400 },
          ],
        },
        check: { status: 'mismatch', text: '£45 a month adds up to £540 a year.' },
      },
    })
    render(<PolicyDetails types={TYPES} />)
    await waitFor(() => expect(screen.getByText(/Test Insurer/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Update figures' }))
    fireEvent.change(screen.getByLabelText('Monthly premium (£)'), { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/Monthly premium was £42, now £45\./),
    )
    expect(screen.getByRole('status').textContent).toMatch(
      /Cover and yearly premium stay the same\./,
    )
    expect(editFamilyPolicy).toHaveBeenCalledWith(
      'pol_1',
      expect.objectContaining({ monthly_premium_minor: 4500 }),
    )
    expect(screen.getByTestId('policy-details').textContent).toMatch(/£45 a month/)
    expect(screen.getByText(/adds up to £540 a year/)).toBeTruthy()
  })

  it('keeps the form and says why when the save fails', async () => {
    fetchFinancialProfile.mockResolvedValue({ policies: [policy()] })
    editFamilyPolicy.mockResolvedValue({
      ok: false,
      error: 'Could not reach the server. Try again in a moment.',
    })
    render(<PolicyDetails types={TYPES} />)
    await waitFor(() => expect(screen.getByText(/Test Insurer/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Update figures' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Could not reach the server/),
    )
    expect(screen.getByTestId('policy-edit')).toBeTruthy()
  })
})
