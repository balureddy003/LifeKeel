import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/lib/useRouteParam', () => ({ useRouteParam: () => 'tok123' }))
vi.mock('@/lib/env', () => ({ getApiBase: () => 'https://api.test' }))
vi.mock('@/lib/api', () => ({ getAuthToken: () => null }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

import BriefShareClient from '../BriefShareClient'

const readOnly = {
  read_only: true,
  can_confirm: false,
  problem_type: 'earning_less',
  title: 'One of us might stop earning',
  result_version: 'v1',
  result: { projectedRunwayMonths: 6, savingsAtChangeMinor: 900000 },
  template_sentence: 'Your savings would last until about May 2027.',
  for_member_name: 'Tom',
  from_name: 'Priya',
}

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ status, ok: status < 400, json: async () => body }),
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('shared brief, read without an account', () => {
  it('shows the answer and asks the reader to sign in to confirm, with no confirm button', async () => {
    respond(200, readOnly)
    render(<BriefShareClient />)
    expect(
      (await screen.findAllByText(/Your savings would last until about May 2027/)).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('6')).toBeTruthy()
    expect(screen.getByText(/Priya prepared this for Tom/)).toBeTruthy()
    const signIn = screen.getByRole('link', { name: /sign in to confirm/i })
    expect(signIn.getAttribute('href')).toBe('/login?next=%2Fb%2Ftok123')
    expect(screen.queryByRole('button', { name: /view the numbers/i })).toBeNull()
  })

  it('still asks a signed-out reader of a handover brief to sign in first', async () => {
    respond(401, { error: 'Sign in' })
    render(<BriefShareClient />)
    expect(await screen.findByText('Sign in to see this brief')).toBeTruthy()
  })
})
