import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MissionDecision } from '@/lib/api'

const fetchMissionControl = vi.fn()
const batchMissionControl = vi.fn()
vi.mock('@/lib/api', () => ({
  fetchMissionControl: () => fetchMissionControl(),
  batchMissionControl: (items: unknown, reason: string) => batchMissionControl(items, reason),
}))
vi.mock('@/components/Toast', () => ({ useToast: () => vi.fn() }))

import MissionControlPage from '../operator/mission/page'

const base = {
  why: 'because',
  effect: 'does a thing',
  undo: 'undo it',
  required_permission: 'operations.manage',
  created_at: '2026-10-23T10:00:00.000Z',
}

const decisions: MissionDecision[] = [
  {
    ...base,
    id: 'proposal:p1',
    kind: 'proposal',
    severity: 'warning',
    title: 'Draft a post',
    href: '/operator/operations',
    batchable: true,
  },
  {
    ...base,
    id: 'alert:dead',
    kind: 'alert',
    severity: 'danger',
    title: '3 dead jobs',
    href: '/operator/operations',
    batchable: true,
  },
  {
    ...base,
    id: 'post_draft:m1',
    kind: 'post_draft',
    severity: 'info',
    title: 'Bluesky draft',
    href: '/operator/marketing',
    batchable: false,
  },
]

beforeEach(() => {
  fetchMissionControl.mockResolvedValue({ decisions, autopilot_paused: false })
  batchMissionControl.mockResolvedValue({ results: [] })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Mission Control page', () => {
  it('lists decisions and only offers selection on batchable ones', async () => {
    render(<MissionControlPage />)
    await screen.findByText('Draft a post')
    expect(screen.getByLabelText('Select Draft a post')).toBeTruthy()
    expect(screen.getByLabelText('Select 3 dead jobs')).toBeTruthy()
    // Posts are never batched — no checkbox, and the page says why.
    expect(screen.queryByLabelText('Select Bluesky draft')).toBeNull()
    expect(screen.getByText(/never batched/i)).toBeTruthy()
  })

  it('shows the social decisions with their own labels, an Open link, and no batch checkbox', async () => {
    const social: MissionDecision[] = [
      {
        ...base,
        id: 'plan_week:2026-10-26',
        kind: 'plan_week',
        severity: 'warning',
        title: 'Review and approve the week of 2026-10-26: 18 posts across 6 platforms',
        href: '/operator/marketing',
        batchable: false,
        required_permission: 'marketing.manage',
      },
      {
        ...base,
        id: 'channel_attention:t1:linkedin',
        kind: 'channel_attention',
        severity: 'danger',
        title: 'LinkedIn needs reconnecting',
        href: '/operator/marketing',
        batchable: false,
        required_permission: 'marketing.manage',
      },
      {
        ...base,
        id: 'profile_drift:t1:x',
        kind: 'profile_drift',
        severity: 'info',
        title: 'X profile differs from the approved text: bio',
        href: '/operator/marketing',
        batchable: false,
        required_permission: 'marketing.manage',
      },
      {
        ...base,
        id: 'plan_missing:2026-10-26',
        kind: 'plan_missing',
        severity: 'warning',
        title: 'No plan yet for the week of 2026-10-26',
        href: '/operator/marketing',
        batchable: false,
        required_permission: 'marketing.manage',
      },
    ]
    fetchMissionControl.mockResolvedValue({ decisions: social, autopilot_paused: false })
    render(<MissionControlPage />)
    await screen.findByText(/Review and approve the week of 2026-10-26/)
    for (const label of ['Week to approve', 'Connection', 'Profile', 'Plan missing'])
      expect(screen.getByText(label)).toBeTruthy()
    // None of these can be approved in a batch — each opens its own page.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getAllByRole('link', { name: /Open/ })).toHaveLength(4)
  })

  it('shows the kill-switch banner when autopilot is paused', async () => {
    fetchMissionControl.mockResolvedValue({ decisions, autopilot_paused: true })
    render(<MissionControlPage />)
    await screen.findByText(/kill switch is on/i)
  })

  it('shows an all-clear state with no decisions', async () => {
    fetchMissionControl.mockResolvedValue({ decisions: [], autopilot_paused: false })
    render(<MissionControlPage />)
    await screen.findByText(/nothing is waiting on you/i)
  })

  it('batch-acknowledges selected alerts with a reason', async () => {
    render(<MissionControlPage />)
    fireEvent.click(await screen.findByLabelText('Select 3 dead jobs'))

    fireEvent.click(await screen.findByText('Acknowledge 1 alert'))
    fireEvent.change(screen.getByPlaceholderText(/reason/i), {
      target: { value: 'seen and understood' },
    })
    fireEvent.click(screen.getByText(/^Confirm/))

    await waitFor(() =>
      expect(batchMissionControl).toHaveBeenCalledWith(
        [{ id: 'alert:dead', action: 'ack' }],
        'seen and understood',
      ),
    )
  })

  it('offers approve/reject only for selected proposals', async () => {
    render(<MissionControlPage />)
    fireEvent.click(await screen.findByLabelText('Select Draft a post'))
    expect(await screen.findByText('Approve 1 proposal')).toBeTruthy()
    expect(screen.getByText('Reject 1')).toBeTruthy()
    expect(screen.queryByText(/Acknowledge/)).toBeNull()
  })
})
