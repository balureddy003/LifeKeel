import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FreshnessCard } from '../FreshnessCard'
import type { FreshnessResponse } from '@/lib/api'

const base: FreshnessResponse = {
  checked_at: '2026-10-20T06:45:00Z',
  share_running: 0.5,
  detectors: [],
}

describe('FreshnessCard', () => {
  it('renders nothing when every check is running', () => {
    const { container } = render(
      <FreshnessCard
        freshness={{
          ...base,
          detectors: [
            {
              detector_id: 'a',
              label: 'Protection',
              state: 'running',
              input: [],
              since: '2026-10-01',
            },
          ],
        }}
      />,
    )
    expect(container.textContent).toBe('')
  })

  it('names each paused check and what is missing or old, in plain words', () => {
    render(
      <FreshnessCard
        freshness={{
          ...base,
          detectors: [
            {
              detector_id: 'r',
              label: 'Retirement',
              state: 'paused_missing',
              input: ['retirement.target_retirement_income_minor'],
              since: '2026-10-01',
            },
            {
              detector_id: 'p',
              label: 'Policies',
              state: 'paused_stale',
              input: ['policies.renewal_date'],
              since: '2026-10-01',
            },
            {
              detector_id: 'x',
              label: 'Protection',
              state: 'running',
              input: [],
              since: '2026-10-01',
            },
          ],
        }}
      />,
    )
    expect(screen.getByText('2 checks are paused')).toBeTruthy()
    expect(screen.getByText(/missing: target retirement income/)).toBeTruthy()
    expect(screen.getByText(/out of date: a policy renewal date that has passed/)).toBeTruthy()
    expect(screen.queryByText('Protection')).toBeNull()
  })
})
