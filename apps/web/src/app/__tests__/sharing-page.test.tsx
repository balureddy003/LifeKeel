import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const fetchFamilyLearning = vi.fn()
const setFamilyLearning = vi.fn()
const fetchLearningBenchmark = vi.fn()
vi.mock('@/lib/api', () => ({
  fetchFamilyLearning: () => fetchFamilyLearning(),
  setFamilyLearning: (v: boolean) => setFamilyLearning(v),
  fetchLearningBenchmark: () => fetchLearningBenchmark(),
}))

import SharingPage from '../resilience/sharing/page'

const state = (over: object = {}) => ({
  optedIn: false,
  adultsOptedIn: 0,
  adultsTotal: 2,
  contributing: false,
  ...over,
})

afterEach(() => {
  cleanup()
  fetchFamilyLearning.mockReset()
  setFamilyLearning.mockReset()
  fetchLearningBenchmark.mockReset()
})

describe('/resilience/sharing', () => {
  it('says it is not available when the server has it switched off or refuses', async () => {
    fetchFamilyLearning.mockResolvedValue(null)
    render(<SharingPage />)
    await waitFor(() => expect(screen.getByText(/not available/i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /share/i })).toBeNull()
  })

  it('explains what is and is not shared before asking', async () => {
    fetchFamilyLearning.mockResolvedValue(state())
    render(<SharingPage />)
    await waitFor(() => screen.getByRole('button', { name: /share my household/i }))
    expect(screen.getByText(/one range of months/i)).toBeTruthy()
    expect(screen.getByText(/never your figures, names or documents/i)).toBeTruthy()
    expect(screen.getByText(/every adult in your family/i)).toBeTruthy()
    expect(screen.getByText(/stop at any time/i)).toBeTruthy()
    expect(screen.getByText(/not used to train/i)).toBeTruthy()
  })

  it('opts in, then reloads and shows who has agreed so far', async () => {
    fetchFamilyLearning
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(state({ optedIn: true, adultsOptedIn: 1 }))
    setFamilyLearning.mockResolvedValue(true)
    render(<SharingPage />)
    await waitFor(() => screen.getByRole('button', { name: /share my household/i }))
    fireEvent.click(screen.getByRole('button', { name: /share my household/i }))
    await waitFor(() => expect(setFamilyLearning).toHaveBeenCalledWith(true))
    await waitFor(() => expect(screen.getByText(/1 of 2 adults/)).toBeTruthy())
    expect(screen.getByText(/waiting for the other adult/i)).toBeTruthy()
  })

  it('lets an adult stop sharing, which says it removes the household contribution', async () => {
    fetchFamilyLearning
      .mockResolvedValueOnce(state({ optedIn: true, adultsOptedIn: 2, contributing: true }))
      .mockResolvedValueOnce(state())
    fetchLearningBenchmark.mockResolvedValue({ available: false })
    setFamilyLearning.mockResolvedValue(true)
    render(<SharingPage />)
    await waitFor(() => screen.getByRole('button', { name: /stop sharing/i }))
    fireEvent.click(screen.getByRole('button', { name: /stop sharing/i }))
    await waitFor(() => expect(setFamilyLearning).toHaveBeenCalledWith(false))
    await waitFor(() => screen.getByRole('button', { name: /share my household/i }))
  })

  it('shows the counts only when the cohort is big enough, and says so when it is not', async () => {
    fetchFamilyLearning.mockResolvedValue(
      state({ optedIn: true, adultsOptedIn: 2, contributing: true }),
    )
    fetchLearningBenchmark.mockResolvedValueOnce({ available: false })
    const { unmount } = render(<SharingPage />)
    await waitFor(() => expect(screen.getByText(/not enough households yet/i)).toBeTruthy())
    unmount()
    fetchFamilyLearning.mockResolvedValue(
      state({ optedIn: true, adultsOptedIn: 2, contributing: true }),
    )
    fetchLearningBenchmark.mockResolvedValueOnce({
      available: true,
      total: 40,
      bands: { '0-3': 6, '3-6': 20, '6-12': 14, '12+': null },
    })
    render(<SharingPage />)
    await waitFor(() => expect(screen.getByText(/40 households/)).toBeTruthy())
    expect(screen.getByText('3 to 6 months')).toBeTruthy()
    expect(screen.getByText('20')).toBeTruthy()
    expect(screen.getByText(/fewer than 5/i)).toBeTruthy()
  })

  it('says so when the change fails', async () => {
    fetchFamilyLearning.mockResolvedValue(state())
    setFamilyLearning.mockResolvedValue(false)
    render(<SharingPage />)
    await waitFor(() => screen.getByRole('button', { name: /share my household/i }))
    fireEvent.click(screen.getByRole('button', { name: /share my household/i }))
    await waitFor(() => expect(screen.getByText(/could not save/i)).toBeTruthy())
  })
})
