/**
 * The obligations map: Confirm is offered only to the named adult and says why
 * when it fails, read-only adults get no write buttons, and the summary names
 * the person the rows lean on.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react'
import ObligationsMapPage from '../page'
import type { ObligationsMap } from '@/lib/api'

const getObligationsMap = vi.fn()
const confirmObligation = vi.fn()
const toast = vi.fn()
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  getObligationsMap: () => getObligationsMap(),
  confirmObligation: (id: string) => confirmObligation(id),
}))
vi.mock('@/components/Toast', () => ({ useToast: () => toast }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

const row = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  label: 'Mortgage payment',
  category: null,
  named_person: 'Alex',
  pays_from: null,
  notices_to: null,
  next_due_date: '2026-12-14',
  recurrence: 'monthly',
  if_unavailable: null,
  pending_confirmation: true,
  can_confirm: false,
  confirmed_by: null,
  created_by: 'u1',
  ...over,
})

const map = (over: Partial<ObligationsMap> = {}): ObligationsMap => ({
  obligations: [row()],
  can_edit: true,
  summary: {
    dependent_count: 2,
    top_person: 'Alex',
    top_person_count: 2,
    earliest_due_date: '2026-12-14',
    earliest_due_label: 'Mortgage payment',
  },
  ...over,
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('obligations map page', () => {
  it('names the person the rows lean on', async () => {
    getObligationsMap.mockResolvedValue(map())
    render(<ObligationsMapPage />)
    await waitFor(() => expect(screen.getByText(/2 things depend on Alex/)).toBeTruthy())
    expect(screen.queryByText(/one named person/)).toBeNull()
  })

  it('offers Confirm only to the adult the row names', async () => {
    getObligationsMap.mockResolvedValue(map())
    render(<ObligationsMapPage />)
    await screen.findByText('Mortgage payment')
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    cleanup()
    getObligationsMap.mockResolvedValue(map({ obligations: [row({ can_confirm: true })] }))
    render(<ObligationsMapPage />)
    expect(await screen.findByRole('button', { name: 'Confirm' })).toBeTruthy()
  })

  it('says why when a confirm is refused', async () => {
    getObligationsMap.mockResolvedValue(map({ obligations: [row({ can_confirm: true })] }))
    confirmObligation.mockResolvedValue({
      ok: false,
      data: { error: 'Only the named adult confirms this' },
    })
    render(<ObligationsMapPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        message: 'Only the named adult confirms this',
        variant: 'error',
      }),
    )
  })

  it('hides every write control from a read-only adult', async () => {
    getObligationsMap.mockResolvedValue(map({ can_edit: false }))
    render(<ObligationsMapPage />)
    await screen.findByText('Mortgage payment')
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Add an obligation/ })).toBeNull()
  })

  it('shows write controls to an editor', async () => {
    getObligationsMap.mockResolvedValue(map())
    render(<ObligationsMapPage />)
    await screen.findByText('Mortgage payment')
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Add an obligation/ })).toBeTruthy()
  })
})
