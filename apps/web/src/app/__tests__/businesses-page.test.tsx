import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fetchFamilyBusinesses = vi.fn()
const saveFamilyBusinesses = vi.fn()
vi.mock('@/lib/api', () => ({
  fetchFamilyBusinesses: () => fetchFamilyBusinesses(),
  saveFamilyBusinesses: (g: unknown) => saveFamilyBusinesses(g),
}))

import BusinessesPage from '../resilience/businesses/page'

const empty = {
  businesses: [],
  incomeEdges: [],
  adults: [{ id: 'u1', name: 'Alex' }],
  shocks: [],
}

afterEach(() => {
  cleanup()
  fetchFamilyBusinesses.mockReset()
  saveFamilyBusinesses.mockReset()
})

describe('/resilience/businesses', () => {
  it('says it is for adults when the server refuses', async () => {
    fetchFamilyBusinesses.mockResolvedValue(null)
    render(<BusinessesPage />)
    await waitFor(() => expect(screen.getByText(/adults in your family/i)).toBeTruthy())
  })

  it('sends the typed pounds as whole minor units for the named business', async () => {
    fetchFamilyBusinesses.mockResolvedValue(empty)
    saveFamilyBusinesses.mockResolvedValue(true)
    render(<BusinessesPage />)
    await waitFor(() => screen.getByRole('button', { name: /add a business/i }))
    fireEvent.click(screen.getByRole('button', { name: /add a business/i }))
    fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: 'Plumbing Ltd' } })
    fireEvent.change(screen.getByLabelText(/Alex receives/i), { target: { value: '1000.50' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(saveFamilyBusinesses).toHaveBeenCalledTimes(1))
    const g = saveFamilyBusinesses.mock.calls[0]![0]
    expect(g.businesses).toHaveLength(1)
    expect(g.businesses[0].name).toBe('Plumbing Ltd')
    expect(g.incomeEdges).toEqual([
      { businessId: g.businesses[0].id, memberId: 'u1', monthlyMinor: 100050 },
    ])
  })

  it('shows what happens if a business stops, from the server text', async () => {
    fetchFamilyBusinesses.mockResolvedValue({
      businesses: [{ id: 'b1', name: 'Plumbing Ltd' }],
      incomeEdges: [{ businessId: 'b1', memberId: 'u1', monthlyMinor: 100000 }],
      adults: [{ id: 'u1', name: 'Alex' }],
      shocks: [
        {
          businessId: 'b1',
          name: 'Plumbing Ltd',
          range: { lowMonths: 9, highMonths: 9 },
          text: 'Savings would cover about 9 months. This is an estimate.',
        },
      ],
    })
    render(<BusinessesPage />)
    await waitFor(() => expect(screen.getByText(/about 9 months/)).toBeTruthy())
    expect(screen.getByText(/If a business stops/)).toBeTruthy()
  })

  it('says so when saving fails', async () => {
    fetchFamilyBusinesses.mockResolvedValue(empty)
    saveFamilyBusinesses.mockResolvedValue(false)
    render(<BusinessesPage />)
    await waitFor(() => screen.getByRole('button', { name: /^save$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(screen.getByText(/Could not save/)).toBeTruthy())
  })
})
