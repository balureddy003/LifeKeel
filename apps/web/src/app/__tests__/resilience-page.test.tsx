import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fetchFamilyResilience = vi.fn()
const confirmResilienceFigures = vi.fn()
const fetchFamilyLearning = vi.fn()
const fetchConfirmationHistory = vi.fn()
vi.mock('@/lib/api', () => ({
  listBriefs: () => Promise.resolve([]),
  fetchFamilyLearning: () => fetchFamilyLearning() ?? Promise.resolve(null),
  fetchConfirmationHistory: () => fetchConfirmationHistory() ?? Promise.resolve(null),
  fetchFamilyResilience: () => fetchFamilyResilience(),
  confirmResilienceFigures: () => confirmResilienceFigures(),
  fetchFinancialProfileWithVersion: () =>
    Promise.resolve({
      profile: {
        household: { monthly_salary_minor: 300000 },
        emergency_fund: { emergency_savings_minor: 800000, monthly_expenses_minor: 200000 },
      },
      version: 3,
    }),
  submitFinancialProfile: () => Promise.resolve({ insightsGenerated: 0, version: 4 }),
}))

import ResiliencePage from '../resilience/page'

afterEach(() => {
  cleanup()
  fetchFamilyResilience.mockReset()
  confirmResilienceFigures.mockReset()
  fetchFamilyLearning.mockReset()
  fetchConfirmationHistory.mockReset()
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
    // One door (G3): the brief is offered first, and this estimate names its own assumption.
    expect(screen.getByRole('heading', { name: 'If all income stopped today' })).toBeTruthy()
    expect((await screen.findByTestId('income-stop-brief')).getAttribute('href')).toBe(
      '/briefs?start=income_stops',
    )
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

  it('shows the earner scenario with its assumptions only when the server sends it', async () => {
    const base = {
      status: 'ready',
      scenario: 'income_stops',
      range: { lowMonths: 3, highMonths: 3 },
      text: 'Savings would cover about 3 months. This is an estimate.',
      left_out: [],
      next_checks: [],
    }
    fetchFamilyResilience.mockResolvedValueOnce(base)
    const { unmount } = render(<ResiliencePage />)
    await waitFor(() => expect(screen.getByText(/about 3 months/)).toBeTruthy())
    expect(screen.queryByText(/If the main earner dies/)).toBeNull()
    unmount()
    fetchFamilyResilience.mockResolvedValueOnce({
      ...base,
      earner_dies: {
        range: { lowMonths: 1, highMonths: 5 },
        text: 'Savings and the cover payout would cover 1 to 5 months. This is an estimate.',
        assumptions: ['Assumes the cover pays out 1 to 2 months after a claim.'],
      },
    })
    render(<ResiliencePage />)
    await waitFor(() => expect(screen.getByText(/1 to 5 months/)).toBeTruthy())
    expect(screen.getByText(/If the main earner dies/)).toBeTruthy()
    expect(screen.getByText(/1 to 2 months after a claim/)).toBeTruthy()
  })

  it('shows each estimate with its own confirmation status', async () => {
    const c = (all: boolean) => ({
      confirmedBy: all ? ['Alex', 'Sam'] : [],
      youConfirmed: all,
      adultsTotal: 2,
      allAdultsConfirmed: all,
    })
    fetchFamilyResilience.mockResolvedValue({
      status: 'ready',
      scenario: 'income_stops',
      range: { lowMonths: 3, highMonths: 3 },
      text: 'Savings would cover about 3 months. This is an estimate.',
      left_out: [],
      next_checks: [],
      earner_dies: {
        range: { lowMonths: 1, highMonths: 5 },
        text: 'Savings and the cover payout would cover 1 to 5 months. This is an estimate.',
        assumptions: [],
      },
      scenarios: { income_stops: c(true), earner_dies: c(false) },
    })
    render(<ResiliencePage />)
    await waitFor(() => expect(screen.getAllByTestId('estimate-status')).toHaveLength(2))
    const [first, second] = screen.getAllByTestId('estimate-status')
    expect(first?.textContent).toMatch(/confirmed by both adults/)
    expect(second?.textContent).toMatch(/need confirming/)
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
      fetchFamilyResilience.mockResolvedValueOnce(ready()).mockResolvedValueOnce(
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

  it('offers the sharing link only when the server says sharing exists', async () => {
    const ready = {
      status: 'ready',
      scenario: 'income_stops',
      range: { lowMonths: 3, highMonths: 3 },
      text: 'Savings would cover about 3 months. This is an estimate.',
      left_out: [],
      next_checks: [],
    }
    fetchFamilyResilience.mockResolvedValue(ready)
    fetchFamilyLearning.mockResolvedValue(null)
    const { unmount } = render(<ResiliencePage />)
    await waitFor(() => expect(screen.getByText(/about 3 months/)).toBeTruthy())
    expect(screen.queryByText(/Share your range anonymously/)).toBeNull()
    unmount()
    fetchFamilyLearning.mockResolvedValue({
      optedIn: false,
      adultsOptedIn: 0,
      adultsTotal: 2,
      contributing: false,
    })
    render(<ResiliencePage />)
    await waitFor(() => expect(screen.getByText(/Share your range anonymously/)).toBeTruthy())
  })

  it('lists what is not on file only when the server sends it', async () => {
    const ready = {
      status: 'ready',
      scenario: 'income_stops',
      range: { lowMonths: 3, highMonths: 3 },
      text: 'Savings would cover about 3 months. This is an estimate.',
      left_out: [],
      next_checks: [],
    }
    fetchFamilyResilience.mockResolvedValueOnce(ready)
    const { unmount } = render(<ResiliencePage />)
    await waitFor(() => expect(screen.getByText(/about 3 months/)).toBeTruthy())
    expect(screen.queryByText(/Not on your list yet/)).toBeNull()
    unmount()
    fetchFamilyResilience.mockResolvedValueOnce({
      ...ready,
      not_on_file: ['No income protection payout is recorded in your profile.'],
    })
    render(<ResiliencePage />)
    await waitFor(() => expect(screen.getByText(/Not on your list yet/)).toBeTruthy())
    expect(screen.getByText(/No income protection payout is recorded/)).toBeTruthy()
  })

  it('shows who confirmed what and when, keeping earlier figures after a change', async () => {
    fetchFamilyResilience.mockResolvedValue({
      status: 'ready',
      scenario: 'income_stops',
      range: { lowMonths: 3, highMonths: 3 },
      text: 'Savings would cover about 3 months. This is an estimate.',
      left_out: [],
      next_checks: [],
    })
    fetchConfirmationHistory.mockResolvedValue([
      {
        scenario: 'income_stops',
        current: true,
        confirmedBy: [{ name: 'Alex', at: '2026-11-19T10:00:00.000Z' }],
        figures: [{ label: 'Savings', valueMinor: 950000 }],
      },
      {
        scenario: 'income_stops',
        current: false,
        confirmedBy: [
          { name: 'Alex', at: '2026-11-10T10:00:00.000Z' },
          { name: 'Sam', at: '2026-11-11T09:00:00.000Z' },
        ],
        figures: [{ label: 'Savings', valueMinor: 900000 }],
      },
    ])
    render(<ResiliencePage />)
    await waitFor(() => expect(screen.getByTestId('confirmation-history')).toBeTruthy())
    const box = screen.getByTestId('confirmation-history').textContent ?? ''
    expect(box).toMatch(/Sam confirmed on 11 November 2026/)
    expect(box).toMatch(/earlier figures, since changed/)
    expect(box).toMatch(/Savings £9,000/)
    expect(box).toMatch(/Savings £9,500/)
  })

  it('shows no history section when nobody has confirmed', async () => {
    fetchFamilyResilience.mockResolvedValue({
      status: 'ready',
      scenario: 'income_stops',
      range: { lowMonths: 3, highMonths: 3 },
      text: 'Savings would cover about 3 months. This is an estimate.',
      left_out: [],
      next_checks: [],
    })
    fetchConfirmationHistory.mockResolvedValue([])
    render(<ResiliencePage />)
    await waitFor(() => expect(screen.getByText(/about 3 months/)).toBeTruthy())
    expect(screen.queryByTestId('confirmation-history')).toBeNull()
  })

  it('changing a figure says what changed and re-reads the estimate', async () => {
    fetchFamilyResilience.mockResolvedValue({
      status: 'ready',
      scenario: 'income_stops',
      range: { lowMonths: 3, highMonths: 6 },
      text: 'Savings would cover 3 to 6 months. This is an estimate.',
      left_out: [],
      next_checks: [],
      figures: [{ label: 'Savings', valueMinor: 800000, key: 'savings_minor' }],
      confirmation: { confirmedBy: [], allAdultsConfirmed: false, youConfirmed: false },
    })
    render(<ResiliencePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Change Savings/ }))
    fireEvent.change(screen.getByLabelText('Savings in £'), { target: { value: '6000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByTestId('figure-changed')).textContent).toContain(
      'Savings changed from £8,000 to £6,000.',
    )
    expect(fetchFamilyResilience).toHaveBeenCalledTimes(2)
  })
})
