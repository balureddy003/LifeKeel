import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const confirmation = (viewer: boolean) => ({
  required: [
    { id: 'm1', name: 'Priya' },
    { id: 'm2', name: 'Sam' },
  ],
  confirmed: viewer ? [{ id: 'm1', name: 'Priya', confirmed_at: '2026-12-03T10:00:00Z' }] : [],
  both_confirmed: false,
  viewer_confirmed: viewer,
})

const api = vi.hoisted(() => ({
  getDomains: vi.fn(),
  getDomainView: vi.fn(),
  confirmDomain: vi.fn(),
}))
vi.mock('@/lib/api', () => api)
vi.mock('@/lib/haptics', () => ({ haptic: () => {} }))

import { SeenByCard } from '../SeenByCard'
import { SEEN_CONFIRMED_EVENT } from '@/lib/seen-status'

describe('SeenByCard', () => {
  beforeEach(() => {
    api.getDomains.mockResolvedValue({
      domains: [
        { id: 'life_protection', title: 'Life cover', summary: '', confirm: 'both_adults' },
        { id: 'school_fees', title: 'School fees', summary: '', confirm: 'both_adults' },
      ],
    })
    api.getDomainView.mockImplementation(async (id: string) => ({
      rows: id === 'school_fees' ? [] : [{ id: 'r1' }],
      result_version: 'v1',
      confirmation: confirmation(false),
    }))
  })

  it('shows a row per list with something on file, and none for an empty list', async () => {
    render(<SeenByCard />)
    expect(await screen.findByText('Life cover')).toBeTruthy()
    expect(screen.queryByText('School fees')).toBeNull()
  })

  it('confirms in one tap and then shows the date', async () => {
    api.confirmDomain.mockResolvedValue({
      ok: true,
      status: 200,
      data: { result_version: 'v1', confirmation: confirmation(true) },
    })
    render(<SeenByCard />)
    fireEvent.click(await screen.findByRole('button', { name: "I've seen this" }))
    await waitFor(() =>
      expect(screen.getByText('Priya confirmed on 3 Dec. Waiting for Sam.')).toBeTruthy(),
    )
    expect(api.confirmDomain).toHaveBeenCalledWith('life_protection', 'v1')
    expect(screen.queryByRole('button', { name: "I've seen this" })).toBeNull()
  })

  it('gives each row an anchor and tells the rest of Home when a confirm lands', async () => {
    api.confirmDomain.mockResolvedValue({
      ok: true,
      status: 200,
      data: { result_version: 'v1', confirmation: confirmation(true) },
    })
    const heard = vi.fn()
    window.addEventListener(SEEN_CONFIRMED_EVENT, heard)
    const { container } = render(<SeenByCard />)
    expect(container.querySelector('#seen-life_protection')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: "I've seen this" }))
    await waitFor(() => expect(heard).toHaveBeenCalledTimes(1))
    expect(container.querySelector('#seen-life_protection')).not.toBeNull()
    window.removeEventListener(SEEN_CONFIRMED_EVENT, heard)
  })

  it('says so when saving fails, and keeps the button', async () => {
    api.confirmDomain.mockRejectedValue(new Error('x'))
    render(<SeenByCard />)
    fireEvent.click(await screen.findByRole('button', { name: "I've seen this" }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: "I've seen this" })).toBeTruthy()
  })

  it('treats a refused confirm (not ok) as a failure, not a crash', async () => {
    api.confirmDomain.mockResolvedValue({ ok: false, status: 409, data: undefined })
    render(<SeenByCard />)
    fireEvent.click(await screen.findByRole('button', { name: "I've seen this" }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('Life cover')).toBeTruthy()
  })

  it('renders nothing when there are no lists', async () => {
    api.getDomains.mockResolvedValue({ domains: [] })
    const { container } = render(<SeenByCard />)
    await waitFor(() => expect(api.getDomains).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})
