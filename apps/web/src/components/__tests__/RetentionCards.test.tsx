/**
 * PRD-141 web pieces: the digest click tag is recorded once and stripped, the
 * quarterly question shows only when due and never twice, and the operator
 * card shows hidden cohorts as "not enough" rather than zero.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const track = vi.fn()
const fetchDue = vi.fn()
const answer = vi.fn(async (_score: number | null) => true)
vi.mock('@/lib/growth-track', () => ({ track: (...a: unknown[]) => track(...a) }))
vi.mock('@/lib/api', () => ({
  fetchPerceivedProtectionDue: () => fetchDue(),
  answerPerceivedProtection: (s: number | null) => answer(s),
}))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

import { DigestClickTracker } from '../AppShell'
import { PERCEIVED_PROTECTION_QUESTION, PerceivedProtectionCard } from '../PerceivedProtectionCard'
import { RetentionMetricsCard } from '../RetentionMetricsCard'
import type { RetentionMetrics } from '@/lib/api'

beforeEach(() => window.history.replaceState(null, '', '/'))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DigestClickTracker', () => {
  it('records one digest_click with the variant only and strips the tag', () => {
    window.history.replaceState(null, '', '/settings?src=digest&v=note&x=1#notifications')
    render(<DigestClickTracker />)
    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('digest_click', { v: 'note' })
    expect(window.location.search).toBe('?x=1')
    expect(window.location.hash).toBe('#notifications')
  })

  it('records an alert click with the insight id and strips the tag (PRD-139)', () => {
    window.history.replaceState(null, '', '/insights/abc?src=alert&i=abc')
    render(<DigestClickTracker />)
    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('alert_click', { i: 'abc' })
    expect(window.location.search).toBe('')
    expect(window.location.pathname).toBe('/insights/abc')
  })

  it('ignores an alert tag with no insight id', () => {
    window.history.replaceState(null, '', '/?src=alert')
    render(<DigestClickTracker />)
    expect(track).not.toHaveBeenCalled()
  })

  it('ignores other traffic', () => {
    window.history.replaceState(null, '', '/?src=newsletter&v=a')
    render(<DigestClickTracker />)
    expect(track).not.toHaveBeenCalled()
  })
})

describe('PerceivedProtectionCard', () => {
  it('renders nothing when not due', async () => {
    fetchDue.mockResolvedValue({ quarter: '2026-Q4', due: false })
    const { container } = render(<PerceivedProtectionCard />)
    await waitFor(() => expect(fetchDue).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('asks the question, posts the score and goes away', async () => {
    fetchDue.mockResolvedValue({ quarter: '2026-Q4', due: true })
    const { container } = render(<PerceivedProtectionCard />)
    expect(await screen.findByText(PERCEIVED_PROTECTION_QUESTION)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /4\s*Fairly/ }))
    await waitFor(() => expect(answer).toHaveBeenCalledWith(4))
    expect(screen.queryByText(PERCEIVED_PROTECTION_QUESTION)).toBeNull()
    expect(container.textContent).toContain('Thanks')
  })

  it('"Not now" skips without a score', async () => {
    fetchDue.mockResolvedValue({ quarter: '2026-Q4', due: true })
    render(<PerceivedProtectionCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(answer).toHaveBeenCalledWith(null))
  })

  it('names no product', () => {
    expect(PERCEIVED_PROTECTION_QUESTION).not.toMatch(/\b(policy|insurer|provider|buy|switch)\b/i)
  })
})

const hidden: RetentionMetrics = {
  generated_at: '2026-10-20T00:00:00Z',
  min_cohort: 10,
  definitions: { digest_delivery: 'Scheduled versus delivered definition text.' },
  digest_delivery: { scheduled: 20, delivered: 18, rate: 0.9 },
  data_freshness: { mean_share_running: null, families: null },
  digest_engagement: {
    all_clear: { clicks_per_100: 40 },
    note: { clicks_per_100: null },
    missed: { clicks_per_100: null },
  },
  notification_budget: { dropped_by_reason: { tier_a_cap: 12, monthly_budget: 3 } },
  notification_health: {
    unsubscribes_per_100_digests: null,
    digest_only_share: null,
    heartbeat_off_share: null,
  },
  received_value_retention: {
    month_3: { retained_share: null },
    month_6: { retained_share: null },
  },
  perceived_protection: { quarter: '2026-Q4', mean: null, responses: null },
}

describe('RetentionMetricsCard', () => {
  it('shows values where the cohort is big enough and "not enough" where it is hidden', () => {
    render(<RetentionMetricsCard metrics={hidden} />)
    expect(screen.getByText('18 of 20 (90%)')).toBeTruthy()
    expect(screen.getByText('40 per 100 / — / —')).toBeTruthy()
    expect(screen.getAllByText('Not enough families yet').length).toBeGreaterThanOrEqual(4)
    expect(screen.getByText('Scheduled versus delivered definition text.')).toBeTruthy()
    expect(screen.getByText(/Anything under 10 families is hidden/)).toBeTruthy()
    expect(screen.getByText('tier a cap: 12, monthly budget: 3')).toBeTruthy()
  })
})
