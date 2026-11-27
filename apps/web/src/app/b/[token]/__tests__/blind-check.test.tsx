/** The /b link with a blind check open: the named adult gives figures first; a no-account read gets none. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/lib/useRouteParam', () => ({ useRouteParam: () => 'tok123' }))
vi.mock('@/lib/env', () => ({ getApiBase: () => 'https://api.test' }))
vi.mock('@/lib/api', () => ({ getAuthToken: () => null, answerBlindCheck: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

import BriefShareClient from '../BriefShareClient'

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

describe('shared brief with a blind check', () => {
  it('the named adult gets the form in place of the confirm button', async () => {
    respond(200, {
      id: 'b1',
      problem_type: 'earning_less',
      title: 'One of us might stop earning',
      result: null,
      template_sentence: '',
      for_member_name: 'Tom',
      from_name: 'Priya',
      can_confirm: true,
      confirmed_opened_at: null,
      created_at: '2026-11-26',
      blind_check: { status: 'waiting_for_you', fields: [] },
    })
    render(<BriefShareClient />)
    expect(await screen.findByText(/Before you see Priya's figures/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /view the numbers/i })).toBeNull()
  })

  it('a no-account read is asked to sign in and give figures first', async () => {
    respond(200, {
      read_only: true,
      can_confirm: false,
      problem_type: 'earning_less',
      title: 'One of us might stop earning',
      blind_check: { status: 'sign_in_to_answer' },
      for_member_name: 'Tom',
      from_name: 'Priya',
    })
    render(<BriefShareClient />)
    expect(await screen.findByText('Priya asked for your own figures first')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/login?next=%2Fb%2Ftok123',
    )
  })
})
