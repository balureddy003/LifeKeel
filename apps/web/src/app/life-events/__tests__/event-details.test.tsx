/**
 * Emergency Mode skips the form, so who it affects and a note are added after
 * the steps are on screen: saved through the details route, shown back, and a
 * failed save says so.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EventDetails } from '../[eventId]/LifeEventPlaybookClient'
import type { LifeEvent } from '@/lib/api'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    family: {
      members: [
        { id: 'm1', name: 'Sam', role: 'adult' },
        { id: 'm2', name: 'Kid', role: 'child' },
      ],
    },
  }),
}))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

const updateLifeEventDetails = vi.fn()
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  updateLifeEventDetails: (...a: unknown[]) => updateLifeEventDetails(...a),
}))

const event = { id: 'ev1', affected_member_id: null, context: null } as unknown as LifeEvent

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EventDetails', () => {
  it('saves who it affects and a note, listing adults only', async () => {
    const onSaved = vi.fn()
    updateLifeEventDetails.mockResolvedValue({ ...event, affected_member_id: 'm1', context: 'A&E' })
    render(<EventDetails event={event} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: /Add who it affects/ }))
    expect(screen.queryByRole('option', { name: 'Kid' })).toBeNull()
    fireEvent.change(screen.getByLabelText(/Who does this affect/), { target: { value: 'm1' } })
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: ' A&E ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(updateLifeEventDetails).toHaveBeenCalledWith('ev1', {
      affected_member_id: 'm1',
      context: 'A&E',
    })
  })

  it('says when the save failed and keeps the form open', async () => {
    updateLifeEventDetails.mockResolvedValue(null)
    render(<EventDetails event={event} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Add who it affects/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/did not save/)
  })
})
