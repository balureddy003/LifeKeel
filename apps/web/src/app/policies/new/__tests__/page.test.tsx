import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('@/lib/api', () => ({
  addFamilyPolicy: vi.fn(),
  fetchFamilyGroup: vi.fn().mockResolvedValue({ members: [] }),
  checkPolicyPremium: vi.fn().mockResolvedValue({
    status: 'mismatch',
    yearlyFromMonthlyMinor: 50400,
    differenceMinor: 400,
    text: '£42 a month adds up to £504 a year. You entered £500 a year, £4 less.',
  }),
}))
import NewPolicyPage from '../page'

describe('add a policy: the mismatch check as you type', () => {
  it('names both premium fields on one short line each', () => {
    render(<NewPolicyPage />)
    expect(screen.getByLabelText('Monthly premium (£)')).toBeTruthy()
    expect(screen.getByLabelText('Yearly premium (£)')).toBeTruthy()
  })
  it('explains a monthly £42 against a yearly £500 before anything is saved', async () => {
    render(<NewPolicyPage />)
    fireEvent.change(screen.getByLabelText('Monthly premium (£)'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Yearly premium (£)'), { target: { value: '500' } })
    await waitFor(
      () => expect(screen.getByText(/£42 a month adds up to £504 a year/)).toBeTruthy(),
      { timeout: 2000 },
    )
  })
})
