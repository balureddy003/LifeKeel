/**
 * A brief shared with a partner who has not joined yet: the page
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
      for_member_name: 'Tom',
      from_name: 'Pass',
    })
    render(<BriefShareClient />)
    expect(await screen.findByText('Tom, Pass shared a brief with you')).toBeTruthy()
    expect(screen.getByText(/Open the invite link/)).toBeTruthy()
    // Signing in does not join the household, so no sign-in link here.
    expect(screen.queryByRole('link', { name: /sign/i })).toBeNull()
  })

  it('points them at the invite even when signed in to another account', async () => {
    respond(403, {
      error: 'Join the household from your invite to see this brief',
      pending_invite: true,
      for_member_name: 'Tom',
      from_name: 'Pass',
    })
    render(<BriefShareClient />)
    expect(await screen.findByText('Tom, Pass shared a brief with you')).toBeTruthy()
    expect(screen.queryByText('This brief was sent to someone else')).toBeNull()
  })

  it('a read-only view for an invited partner points at the invite, not a sign-in', async () => {
    respond(200, {
      read_only: true,
      pending_invite: true,
      can_confirm: false,
      problem_type: 'earning_less',
      title: 'If one of us earns less',
      result_version: 'v1',
      result: { projectedRunwayMonths: 5.3 },
      sentence: 'Savings last about 5.3 months.',
      template_sentence: 'Savings last about 5.3 months.',
      facts: [],
      as_of_date: '2026-11-22',
      created_at: '2026-11-22T00:00:00Z',
      for_member_name: 'Tom',
      from_name: 'Pass',
      expires_at: '2026-12-22T00:00:00Z',
      confirmed_opened_at: null,
    })
    render(<BriefShareClient />)
    expect(await screen.findByText(/open the invite link Pass sent you/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Sign in to confirm' })).toBeNull()
  })

  it('keeps the plain sign-in notice for any other signed-out open', async () => {
    respond(401, { error: 'Sign in as the adult this brief was shared with' })
    render(<BriefShareClient />)
    expect(await screen.findByText('Sign in to see this brief')).toBeTruthy()
  })
})

describe('recipientLabel', () => {
  it('uses the Family list status words for a partner who has not joined', () => {
    expect(recipientLabel({ id: 'm1', name: 'Tom', status: 'pending' })).toBe(
      'Tom (not invited yet)',
    )
    expect(recipientLabel({ id: 'm1', name: 'Tom', status: 'pending' }, 'sent')).toBe(
      'Tom (invite sent)',
    )
    expect(recipientLabel({ id: 'm1', name: 'Tom', status: 'pending' }, 'viewed')).toBe(
      'Tom (invite viewed)',
    )
    expect(recipientLabel({ id: 'm2', name: 'Alex', status: 'active' })).toBe('Alex')
    expect(recipientLabel({ id: 'm3', name: 'Sam' })).toBe('Sam')
  })
})
