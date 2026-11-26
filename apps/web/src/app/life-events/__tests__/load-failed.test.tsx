/**
 * A failed read is not a missing event. Seen on staging: right after reporting, the list request dropped and
 * the plan said "This life event couldn't be found". Offline during an emergency must say it could not load,
 * with a retry that brings the plan back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/lib/useRouteParam', () => ({ useRouteParam: () => 'ev1' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ family: { members: [] } }) }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
vi.mock('@/components/AtHand', () => ({ AtHand: () => null }))

const fetchLifeEvents = vi.fn()
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  fetchLifeEvents: (onFailure?: () => void) => fetchLifeEvents(onFailure),
}))

import LifeEventPlaybookClient from '../[eventId]/LifeEventPlaybookClient'

const ev = {
  id: 'ev1',
  event_type: 'property',
  reported_at: '2026-11-26T10:00:00Z',
  completed_step_ids: [],
  affected_member_id: null,
  context: null,
  playbook: {
    event_type: 'property',
    title: 'Property Damage Response Plan',
    intro: 'x',
    steps: [],
  },
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('life event plan, when the list cannot be read', () => {
  it('says it could not load, not that the event does not exist, and Try again brings it back', async () => {
    fetchLifeEvents
      .mockImplementationOnce(async (onFailure?: () => void) => {
        onFailure?.()
        return []
      })
      .mockImplementationOnce(async () => [ev])
    render(<LifeEventPlaybookClient />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn.t load just now/)
    expect(screen.queryByText(/couldn't be found/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Property Damage Response Plan')).toBeTruthy()
  })

  it('still says not found when the list was read and the event is not in it', async () => {
    fetchLifeEvents.mockResolvedValue([])
    render(<LifeEventPlaybookClient />)
    expect(await screen.findByText(/couldn't be found/)).toBeTruthy()
  })
})
