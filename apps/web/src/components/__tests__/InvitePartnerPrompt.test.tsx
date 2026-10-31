/** PRD-220: invite prompt gating — weekly cap, two-dismissal stop, hidden
 *  once a second member shows as joined. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const trackMock = vi.fn()
vi.mock('@/lib/growth-track', () => ({ track: (...a: unknown[]) => trackMock(...a) }))
let requests: Array<{ id: string; name: string; email: string; requestedAt: string }> = []
vi.mock('@/lib/api', () => ({ fetchAccessRequests: async () => requests }))
let family: { members: Record<string, unknown>[] } | null = null
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ family }) }))

import { InvitePartnerPrompt, PartnerCard } from '../InvitePartnerPrompt'

describe('InvitePartnerPrompt', () => {
  beforeEach(() => {
    localStorage.clear()
    trackMock.mockClear()
    family = { members: [{ joined: true }] }
  })

  it('shows once for a solo family and tracks the impression', () => {
    render(<InvitePartnerPrompt />)
    expect(screen.getByText('Add your partner so they can see this too')).toBeTruthy()
    expect(trackMock).toHaveBeenCalledWith('invite_prompt_shown', { src: 'prompt' })
  })

  it('never shows once a second member has joined', () => {
    family = { members: [{ joined: true }, { joined: true }] }
    render(<InvitePartnerPrompt />)
    expect(screen.queryByText('Add your partner so they can see this too')).toBeNull()
  })

  it('stops after two dismissals', () => {
    localStorage.setItem('lifekeel_invite_prompt_v1', JSON.stringify({ dismissals: 2 }))
    render(<InvitePartnerPrompt />)
    expect(screen.queryByText('Add your partner so they can see this too')).toBeNull()
  })

  it('respects the once-a-week window', () => {
    localStorage.setItem(
      'lifekeel_invite_prompt_v1',
      JSON.stringify({ dismissals: 0, last: Date.now() - 60_000 }),
    )
    render(<InvitePartnerPrompt />)
    expect(screen.queryByText('Add your partner so they can see this too')).toBeNull()
  })
})

describe('PartnerCard', () => {
  beforeEach(() => {
    localStorage.clear()
    family = { members: [{ joined: true }] }
  })

  it('puts a waiting request first, and links to where it is approved', async () => {
    requests = [{ id: 'r1', name: 'Pat Partner', email: 'p@example.com', requestedAt: 'now' }]
    render(<PartnerCard />)
    expect(await screen.findByText('Pat Partner asked to join your family')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Review request' }).getAttribute('href')).toBe(
      '/settings?requests=1',
    )
    expect(screen.queryByText('Add your partner so they can see this too')).toBeNull()
  })

  it('falls back to the weekly invite prompt when nobody is waiting', async () => {
    requests = []
    render(<PartnerCard />)
    await waitFor(() =>
      expect(screen.getByText('Add your partner so they can see this too')).toBeTruthy(),
    )
  })

  it('points the invite at the add-member form, not a dead-end page', async () => {
    requests = []
    render(<PartnerCard />)
    const link = await screen.findByRole('link', { name: 'Invite your partner' })
    expect(link.getAttribute('href')).toBe('/settings?add=1')
  })
})
