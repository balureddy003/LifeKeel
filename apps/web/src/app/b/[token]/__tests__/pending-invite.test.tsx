/**
 * A brief shared with a partner who has not joined yet: the signed-out page
 * names them and the sender and points at their invite, never the figures.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { recipientLabel } from '@/lib/brief-recipient'

const TOKEN = 'ab'.repeat(24)
vi.mock('next/navigation', () => ({ usePathname: () => `/b/${TOKEN}` }))

import BriefShareClient from '../BriefShareClient'

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('shared brief, partner not joined yet', () => {
  it('names them and the sender and sends them to their invite', async () => {
    respond(401, {
      error: 'Join the household from your invite to see this brief',
      pending_invite: true,
      for_member_name: 'Tom Tester',
      from_name: 'Pass',
    })
    render(<BriefShareClient />)
    expect(await screen.findByText('Tom, Pass shared a brief with you')).toBeTruthy()
    expect(screen.getByText(/Open the invite link/)).toBeTruthy()
    const signIn = screen.getByRole('link', { name: 'I already have a sign-in' })
    expect(signIn.getAttribute('href')).toBe(`/login?next=${encodeURIComponent(`/b/${TOKEN}`)}`)
  })

  it('keeps the plain sign-in notice for any other signed-out open', async () => {
    respond(401, { error: 'Sign in as the adult this brief was shared with' })
    render(<BriefShareClient />)
    expect(await screen.findByText('Sign in to see this brief')).toBeTruthy()
  })
})

describe('recipientLabel', () => {
  it('marks an invited partner, leaves a joined adult as their name', () => {
    expect(recipientLabel({ id: 'm1', name: 'Tom', status: 'pending' })).toBe('Tom (invited)')
    expect(recipientLabel({ id: 'm2', name: 'Alex', status: 'active' })).toBe('Alex')
    expect(recipientLabel({ id: 'm3', name: 'Sam' })).toBe('Sam')
  })
})
