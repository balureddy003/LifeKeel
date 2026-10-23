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
