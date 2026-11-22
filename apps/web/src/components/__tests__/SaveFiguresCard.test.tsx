import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({
  fetchFinancialProfileWithVersion: vi.fn(),
  saveFamilyFigures: vi.fn(),
}))
vi.mock('@/lib/api', () => api)
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

import { SaveFiguresCard } from '../SaveFiguresCard'

const inputs = {
  monthly_income_minor: 420000,
  monthly_essentials_minor: 360000,
  liquid_savings_minor: 900000,
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SaveFiguresCard', () => {
  it('offers the figures when none are on the family list, then saves them in one tap', async () => {
    api.fetchFinancialProfileWithVersion.mockResolvedValue({ profile: null, version: 0 })
    api.saveFamilyFigures.mockResolvedValue({
      ok: true,
      saved: [
        { key: 'savings_minor', label: 'Savings', before: null, after: 900000 },
        { key: 'monthly_spend_minor', label: 'Monthly spending', before: null, after: 360000 },
        { key: 'monthly_inflow_minor', label: 'Monthly income', before: null, after: 420000 },
      ],
      unchanged: [],
    })
    render(<SaveFiguresCard inputs={inputs} />)
    expect(await screen.findByText('Save these figures to your family list?')).toBeTruthy()
    expect(screen.getByText('£9,000')).toBeTruthy()
    expect(screen.getByText('£3,600')).toBeTruthy()
    expect(screen.getByText('£4,200')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save to the family list' }))
    await waitFor(() =>
      expect(api.saveFamilyFigures).toHaveBeenCalledWith({
        savings_minor: 900000,
        monthly_spend_minor: 360000,
        monthly_inflow_minor: 420000,
      }),
    )
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Saved to your family list')
    expect(status.textContent).toContain('Savings')
    expect(screen.queryByRole('button', { name: 'Save to the family list' })).toBeNull()
  })

  it('shows what is on file now for a figure that differs', async () => {
    api.fetchFinancialProfileWithVersion.mockResolvedValue({
      profile: {
        emergency_fund: { emergency_savings_minor: 900000, monthly_expenses_minor: 200000 },
        household: { monthly_salary_minor: 420000 },
      },
      version: 3,
    })
    render(<SaveFiguresCard inputs={inputs} />)
    expect(await screen.findByText(/on file now £2,000/)).toBeTruthy()
    expect(screen.queryByText('Savings')).toBeNull()
  })

  it('renders nothing when the list already holds the same figures, or the brief has none', async () => {
    api.fetchFinancialProfileWithVersion.mockResolvedValue({
      profile: {
        emergency_fund: { emergency_savings_minor: 900000, monthly_expenses_minor: 360000 },
        household: { monthly_salary_minor: 420000 },
      },
      version: 3,
    })
    const a = render(<SaveFiguresCard inputs={inputs} />)
    await waitFor(() => expect(api.fetchFinancialProfileWithVersion).toHaveBeenCalled())
    expect(a.container.textContent).toBe('')
    a.unmount()
    const b = render(<SaveFiguresCard inputs={undefined} />)
    expect(b.container.textContent).toBe('')
  })

  it('renders nothing if the family list cannot be read, rather than guessing', async () => {
    api.fetchFinancialProfileWithVersion.mockRejectedValue(new Error('down'))
    const { container } = render(<SaveFiguresCard inputs={inputs} />)
    await waitFor(() => expect(api.fetchFinancialProfileWithVersion).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('says why it did not save, and keeps the button', async () => {
    api.fetchFinancialProfileWithVersion.mockResolvedValue({ profile: null, version: 0 })
    api.saveFamilyFigures.mockResolvedValue({
      ok: false,
      error: 'Only household editors can save figures',
    })
    render(<SaveFiguresCard inputs={inputs} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save to the family list' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Only household editors')
    expect(screen.getByRole('button', { name: 'Save to the family list' })).toBeTruthy()
  })

  it('goes away on Not now without saving', async () => {
    api.fetchFinancialProfileWithVersion.mockResolvedValue({ profile: null, version: 0 })
    const { container } = render(<SaveFiguresCard inputs={inputs} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(container.textContent).toBe('')
    expect(api.saveFamilyFigures).not.toHaveBeenCalled()
  })
})
