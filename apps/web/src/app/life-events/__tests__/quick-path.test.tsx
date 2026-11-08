/**
 * Emergency Mode sends ?type=<id>&now=1: one tap reports with no details and
 * opens the steps. A recent same-type report is opened rather than duplicated,
 * and a failure falls back to the normal form with the reason.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import LifeEventsPage from '../page'

const push = vi.fn()
const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }))
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ family: { members: [] } }) }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

const reportLifeEvent = vi.fn()
const fetchLifeEvents = vi.fn()
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  reportLifeEvent: (...a: unknown[]) => reportLifeEvent(...a),
  fetchLifeEvents: () => fetchLifeEvents(),
}))

function at(search: string) {
  window.history.pushState({}, '', `/life-events${search}`)
}

beforeEach(() => {
  fetchLifeEvents.mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Emergency quick path', () => {
  it('reports with no details and opens the steps, without showing the form', async () => {
    at('?type=bereavement&now=1')
    reportLifeEvent.mockResolvedValue({ id: 'ev1' })
    render(<LifeEventsPage />)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/life-events/ev1'))
    expect(reportLifeEvent).toHaveBeenCalledWith('bereavement', undefined, undefined)
    expect(screen.queryByRole('button', { name: 'Get my plan' })).toBeNull()
  })

  it('opens a same-type event reported in the last day instead of making a second', async () => {
    at('?type=medical&now=1')
    fetchLifeEvents.mockResolvedValue([
      { id: 'old1', event_type: 'medical', reported_at: new Date().toISOString() },
    ])
    render(<LifeEventsPage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/life-events/old1'))
    expect(reportLifeEvent).not.toHaveBeenCalled()
  })

  it('makes a new report when the last one of that type is older than a day', async () => {
    at('?type=car&now=1')
    fetchLifeEvents.mockResolvedValue([
      {
        id: 'old2',
        event_type: 'car',
        reported_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      },
    ])
    reportLifeEvent.mockResolvedValue({ id: 'ev2' })
    render(<LifeEventsPage />)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/life-events/ev2'))
  })

  it('falls back to the form with the reason when the report fails', async () => {
    at('?type=property&now=1')
    reportLifeEvent.mockResolvedValue(null)
    render(<LifeEventsPage />)
    expect(await screen.findByRole('button', { name: 'Get my plan' })).toBeTruthy()
    expect(screen.getByText(/nothing was recorded/)).toBeTruthy()
  })

  it('without now=1 the normal form still shows first', async () => {
    at('?type=bereavement')
    render(<LifeEventsPage />)
    expect(await screen.findByRole('button', { name: 'Get my plan' })).toBeTruthy()
    expect(reportLifeEvent).not.toHaveBeenCalled()
  })
})
