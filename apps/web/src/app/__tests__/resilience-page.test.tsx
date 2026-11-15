import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fetchFamilyResilience = vi.fn()
const confirmResilienceFigures = vi.fn()
vi.mock('@/lib/api', () => ({
  fetchFamilyResilience: () => fetchFamilyResilience(),
  confirmResilienceFigures: () => confirmResilienceFigures(),
}))

import ResiliencePage from '../resilience/page'

afterEach(() => {
  cleanup()
  fetchFamilyResilience.mockReset()
  confirmResilienceFigures.mockReset()
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

  describe('confirming', () => {
    const ready = (over: object = {}) => ({
      status: 'ready',
      scenario: 'income_stops',
      range: { lowMonths: 3, highMonths: 3 },
      text: 'Savings would cover about 3 months. This is an estimate.',
      left_out: [],
      next_checks: [],
      figures: [{ label: 'Savings', valueMinor: 900000 }],
      confirmation: {
        confirmedBy: [],
        youConfirmed: false,
        adultsTotal: 2,
        allAdultsConfirmed: false,
      },
      ...over,
    })

    it('shows the figures used and confirms them, then reloads', async () => {
      fetchFamilyResilience
        .mockResolvedValueOnce(ready())
        .mockResolvedValueOnce(
          ready({
            confirmation: {
              confirmedBy: ['Alex'],
              youConfirmed: true,
              adultsTotal: 2,
              allAdultsConfirmed: false,
            },
          }),
        )
      confirmResilienceFigures.mockResolvedValue(true)
      render(<ResiliencePage />)
      await waitFor(() => expect(screen.getByText('£9,000')).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: /confirm these figures/i }))
      await waitFor(() => expect(screen.getByText(/You confirmed/)).toBeTruthy())
      expect(confirmResilienceFigures).toHaveBeenCalledTimes(1)
      expect(screen.getByText(/Alex/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: /confirm these figures/i })).toBeNull()
    })

    it('says when both adults have confirmed', async () => {
      fetchFamilyResilience.mockResolvedValue(
        ready({
          confirmation: {
            confirmedBy: ['Alex', 'Sam'],
            youConfirmed: true,
            adultsTotal: 2,
            allAdultsConfirmed: true,
          },
        }),
      )
      render(<ResiliencePage />)
      await waitFor(() => expect(screen.getByText(/Both adults have confirmed/)).toBeTruthy())
    })
  })
})
