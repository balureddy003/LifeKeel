import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const api = vi.hoisted(() => ({ listBriefs: vi.fn() }))
vi.mock('@/lib/api', () => api)

import { LatestBriefCard } from '../LatestBriefCard'

const brief = (over: object = {}) => ({
  id: 'b1',
  title: 'One of us might stop earning',
  template_sentence: 'Your savings would last until about May 2027.',
  created_at: '2026-11-21T10:00:00Z',
  stale: false,
  ...over,
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('LatestBriefCard', () => {
  it('shows the newest brief with its one-line answer and links to the briefs page', async () => {
    api.listBriefs.mockResolvedValue([
      brief({ id: 'old', title: 'Older', created_at: '2026-10-01T10:00:00Z' }),
      brief(),
    ])
    render(<LatestBriefCard />)
    expect(await screen.findByText('Your savings would last until about May 2027.')).toBeTruthy()
    expect(screen.getByText('One of us might stop earning')).toBeTruthy()
    expect(screen.queryByText('Older')).toBeNull()
    expect(screen.getByRole('link').getAttribute('href')).toBe('/briefs')
  })

  it('says the figures have changed when the brief is stale', async () => {
    api.listBriefs.mockResolvedValue([brief({ stale: true })])
    render(<LatestBriefCard />)
    expect(await screen.findByText(/figures have changed since/i)).toBeTruthy()
  })

  it('renders nothing when there is no brief, or the list cannot be read', async () => {
    api.listBriefs.mockResolvedValue([])
    const { container, rerender } = render(<LatestBriefCard />)
    await Promise.resolve()
    expect(container.textContent).toBe('')
    api.listBriefs.mockRejectedValue(new Error('offline'))
    rerender(<LatestBriefCard key="again" />)
    await Promise.resolve()
    expect(container.textContent).toBe('')
  })

  it('renders nothing for a brief with no sentence, never an empty card', async () => {
    api.listBriefs.mockResolvedValue([brief({ template_sentence: '' })])
    const { container } = render(<LatestBriefCard />)
    await Promise.resolve()
    expect(container.textContent).toBe('')
  })
})
