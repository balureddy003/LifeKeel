import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fetchWithVersion = vi.fn()
const submit = vi.fn()
vi.mock('@/lib/api', () => ({
  fetchFinancialProfileWithVersion: () => fetchWithVersion(),
  submitFinancialProfile: (...a: unknown[]) => submit(...a),
}))

import { FigureRow } from '../FigureRow'

const profile = {
  household: {
    monthly_salary_minor: 300000,
    income_protection_monthly_minor: 0,
    life_cover_minor: 0,
  },
  emergency_fund: { emergency_savings_minor: 800000, monthly_expenses_minor: 200000 },
}
const figure = { label: 'Savings', valueMinor: 800000, key: 'savings_minor' }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FigureRow', () => {
  it('shows the figure and a Change button at least 48px tall', () => {
    render(<FigureRow figure={figure} onSaved={vi.fn()} />)
    expect(screen.getByText('£8,000')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Change Savings/ }).className).toContain(
      'min-h-[48px]',
    )
  })

  it('saves the new figure on the current version and says what changed', async () => {
    fetchWithVersion.mockResolvedValue({ profile, version: 7 })
    submit.mockResolvedValue({ insightsGenerated: 0, version: 8 })
    const onSaved = vi.fn()
    render(<FigureRow figure={figure} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: /Change Savings/ }))
    fireEvent.change(screen.getByLabelText('Savings in £'), { target: { value: '6,000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith('Savings changed from £8,000 to £6,000.'),
    )
    const [sent, generate, version] = submit.mock.calls[0] ?? []
    expect(sent?.emergency_fund.emergency_savings_minor).toBe(600000)
    expect(generate).toBe(true)
    expect(version).toBe(7)
  })

  it('refuses text and blanks without calling the server', async () => {
    render(<FigureRow figure={figure} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Change Savings/ }))
    fireEvent.change(screen.getByLabelText('Savings in £'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(submit).not.toHaveBeenCalled()
  })

  it('says so when the save fails, and keeps the old figure', async () => {
    fetchWithVersion.mockResolvedValue({ profile, version: 7 })
    submit.mockRejectedValue(
      new Error('This profile was updated elsewhere — reload and try again.'),
    )
    const onSaved = vi.fn()
    render(<FigureRow figure={figure} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: /Change Savings/ }))
    fireEvent.change(screen.getByLabelText('Savings in £'), { target: { value: '6000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/updated elsewhere/)
  })

  it('Cancel closes the editor without saving', () => {
    render(<FigureRow figure={figure} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Change Savings/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Savings in £')).toBeNull()
    expect(submit).not.toHaveBeenCalled()
  })
})
