import { describe, it, expect } from 'vitest'
import { SETUP_STEPS } from '../setup-steps'

describe('new-household setup steps', () => {
  it('leads with the short policy form', () => {
    expect(SETUP_STEPS[0]).toMatchObject({ id: 'policy', href: '/policies/new' })
  })
  it('asks for no long profile and no connected account before the first result', () => {
    const text = JSON.stringify(SETUP_STEPS).toLowerCase()
    expect(text).not.toMatch(/financial profile|connect|score|bank login/)
    expect(
      SETUP_STEPS.every(
        (s) => !s.href.startsWith('/connect') && !s.href.startsWith('/financial-profile'),
      ),
    ).toBe(true)
  })
  it('stays short: at most three cards so the page has one next move', () => {
    expect(SETUP_STEPS.length).toBeLessThanOrEqual(3)
  })
})
