import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const fetchFamilyResilience = vi.fn()
vi.mock('@/lib/api', () => ({ fetchFamilyResilience: () => fetchFamilyResilience() }))

import ResiliencePage from '../resilience/page'

afterEach(() => {
  cleanup()
  fetchFamilyResilience.mockReset()
})

describe('/resilience', () => {
  it('shows the estimate, what it leaves out, and the next checks', async () => {
    fetchFamilyResilience.mockResolvedValue({
      status: 'ready',
      scenario: 'income_stops',
      range: { lowMonths: 3, highMonths: 6 },
      text: 'Savings would cover 3 to 6 months. This is an estimate.',
      left_out: ['tax and benefits', 'inflation'],
      next_checks: [
        'Check the savings balance entered in your profile',
        'Ask a licensed professional what applies to your household',
      ],
    })
    render(<ResiliencePage />)
    await waitFor(() => expect(screen.getByText(/3 to 6 months/)).toBeTruthy())
    expect(screen.getByText(/tax and benefits/)).toBeTruthy()
    expect(screen.getByText(/Check the savings balance/)).toBeTruthy()
    expect(screen.getAllByText(/estimate/i).length).toBeGreaterThan(0)
  })

  it('asks for the missing figures instead of showing a number', async () => {
    fetchFamilyResilience.mockResolvedValue({
      status: 'needs_figures',
      missing: ['savings', 'monthly income'],
    })
    render(<ResiliencePage />)
    await waitFor(() => expect(screen.getByText(/savings, monthly income/)).toBeTruthy())
    expect(screen.getByRole('link', { name: /financial profile/i })).toBeTruthy()
  })

  it('says it is for adults in the family when the server refuses', async () => {
    fetchFamilyResilience.mockResolvedValue(null)
    render(<ResiliencePage />)
    await waitFor(() => expect(screen.getByText(/adults in your family/i)).toBeTruthy())
  })
})
