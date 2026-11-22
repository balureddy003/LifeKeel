/** One door for "what if income stops" (hands-on review G3): the saved income brief, or a way to make one. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const api = vi.hoisted(() => ({ listBriefs: vi.fn() }))
vi.mock('@/lib/api', () => api)

import { IncomeStopBrief } from '../IncomeStopBrief'

const brief = (over: object = {}) => ({
  id: 'b1',
  problem_type: 'income_stops',
  title: 'One of us might stop earning',
  template_sentence: 'Your savings would last until about June 2027.',
  created_at: '2026-11-21T10:00:00Z',
  stale: false,
  ...over,
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('IncomeStopBrief', () => {
  it('shows the saved income brief and its answer, linking to the briefs page', async () => {
    api.listBriefs.mockResolvedValue([
      brief({ id: 'old', template_sentence: 'Older answer.', created_at: '2026-10-01T10:00:00Z' }),
      brief(),
    ])
    render(<IncomeStopBrief />)
    expect(await screen.findByText('Your savings would last until about June 2027.')).toBeTruthy()
    expect(screen.queryByText('Older answer.')).toBeNull()
    expect(screen.getByRole('link').getAttribute('href')).toBe('/briefs')
  })

  it('ignores briefs about other situations and offers to make the income one', async () => {
    api.listBriefs.mockResolvedValue([
      brief({ problem_type: 'new_baby', template_sentence: 'Baby answer.' }),
    ])
    render(<IncomeStopBrief />)
    expect(await screen.findByText(/Work it out with your own dates/)).toBeTruthy()
    expect(screen.queryByText('Baby answer.')).toBeNull()
    expect(screen.getByRole('link').getAttribute('href')).toBe('/briefs?start=income_stops')
  })

  it('still offers the brief when the list cannot be read', async () => {
    api.listBriefs.mockRejectedValue(new Error('offline'))
    render(<IncomeStopBrief />)
    expect((await screen.findByRole('link')).getAttribute('href')).toBe(
      '/briefs?start=income_stops',
    )
  })
})
