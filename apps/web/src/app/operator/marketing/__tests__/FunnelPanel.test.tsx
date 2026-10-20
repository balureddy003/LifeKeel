import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import { FunnelPanel } from '../_components/FunnelPanel'
import type { FunnelView } from '@/lib/api'

afterEach(cleanup)

const funnel: FunnelView = {
  window_days: 28,
  steps: [
    { step: 'visit', count: 200 },
    { step: 'cta_click', count: 40 },
    { step: 'signup', count: 20 },
    { step: 'profile', count: 10 },
    { step: 'first_insight', count: 5 },
  ],
  by_source: [
    { key: 'bluesky', visit: 120, cta_click: 30, signup: 12, profile: 6, first_insight: 3 },
  ],
  by_campaign: [
    { key: 'pillar_hard_day', visit: 80, cta_click: 20, signup: 8, profile: 4, first_insight: 2 },
  ],
}

describe('FunnelPanel', () => {
  it('shows each step with the share of visits that became accounts and the share of accounts that went on', () => {
    render(<FunnelPanel funnel={funnel} />)
    expect(screen.getByText('Funnel, last 28 days')).toBeTruthy()
    const accounts = screen.getByText('Accounts created').closest('li')!
    expect(accounts.textContent).toContain('20')
    expect(accounts.textContent).toContain('(10%)') // 20 of 200 visits
    const profile = screen.getByText('Profile filled in').closest('li')!
    expect(profile.textContent).toContain('(50%)') // 10 of 20 accounts
  })

  it('names networks as they are and pillars in plain words', () => {
    render(<FunnelPanel funnel={funnel} />)
    const bySource = screen.getByRole('table', { name: 'By source' })
    expect(within(bySource).getByText('bluesky')).toBeTruthy()
    const byPillar = screen.getByRole('table', { name: 'By pillar' })
    expect(within(byPillar).getByText('hard day')).toBeTruthy()
  })
})
