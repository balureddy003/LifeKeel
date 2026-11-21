import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('@/lib/api', () => ({ fetchFinancialProfile: vi.fn() }))
import { fetchFinancialProfile } from '@/lib/api'
import { PinnedTiles } from '../PinnedTiles'

describe('PinnedTiles', () => {
  it('shows "No data yet" with what fills it when nothing is on file', async () => {
    vi.mocked(fetchFinancialProfile).mockResolvedValue(null)
    render(<PinnedTiles />)
    await waitFor(() => expect(screen.getAllByText('No data yet')).toHaveLength(3))
    expect(screen.getByText('Add the first policy')).toBeTruthy()
  })
  it('shows the figure when the profile has it', async () => {
    vi.mocked(fetchFinancialProfile).mockResolvedValue({
      emergency_fund: { emergency_savings_minor: 600000, monthly_expenses_minor: 200000 },
      retirement: { pension_balance_minor: 0 },
      policies: [{}],
    } as never)
    render(<PinnedTiles />)
    await waitFor(() => expect(screen.getByText('3 months')).toBeTruthy())
    expect(screen.getByText('1 policy recorded')).toBeTruthy()
  })
})
