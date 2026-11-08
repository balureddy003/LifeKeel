/**
 * "Leave this family": for someone who needs to get out without asking the
 * organizer. It says what happens, is a 48px target, and shows the reason when
 * the server will not allow it (for example a sole organizer who has not handed over).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { LeaveFamily } from '../LeaveFamily'

afterEach(cleanup)

describe('LeaveFamily', () => {
  it('is a clearly named 48px button with a plain explanation', () => {
    render(<LeaveFamily onLeave={async () => {}} />)
    const b = screen.getByRole('button', { name: 'Leave this family' })
    expect(b.className).toContain('min-h-[48px]')
    expect(screen.getByText(/lose access to the family list straight away/i)).toBeTruthy()
    expect(screen.getByText(/You do not need the organizer.s help/i)).toBeTruthy()
  })

  it('asks the page to leave when tapped', async () => {
    const onLeave = vi.fn().mockResolvedValue(undefined)
    render(<LeaveFamily onLeave={onLeave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave this family' }))
    await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1))
  })

  it('shows the reason in words when leaving is not allowed, and keeps the button', async () => {
    const onLeave = vi
      .fn()
      .mockRejectedValue(new Error('Hand over to another organizer before you leave.'))
    render(<LeaveFamily onLeave={onLeave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave this family' }))
    const msg = await screen.findByRole('alert')
    expect(msg.textContent).toContain('Hand over to another organizer before you leave.')
    expect(screen.getByRole('button', { name: 'Leave this family' })).toBeTruthy()
  })

  it('does not fire twice while it is working', async () => {
    let release: () => void = () => {}
    const onLeave = vi.fn(() => new Promise<void>((r) => (release = r)))
    render(<LeaveFamily onLeave={onLeave} />)
    const b = screen.getByRole('button', { name: 'Leave this family' })
    fireEvent.click(b)
    fireEvent.click(b)
    expect(onLeave).toHaveBeenCalledTimes(1)
    release()
  })
})
