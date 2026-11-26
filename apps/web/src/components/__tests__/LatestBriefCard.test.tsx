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

  it('shows the one-line answer, not the fine print, and who has seen it', async () => {
    api.listBriefs.mockResolvedValue([
      brief({
        template_sentence:
          'On these figures savings would run out around June 2027 (about month 6.3). Figures are the household’s own entries — tax is not covered.',
        share: { for_member_id: 'm2', for_member_name: 'Tom', expires_at: 'x', revoked: false },
        confirmation: { creator_at: '2026-11-21', recipient_at: null, both_confirmed: false },
      }),
    ])
    render(<LatestBriefCard />)
    expect(await screen.findByText('Your savings would last until about June 2027.')).toBeTruthy()
    expect(screen.queryByText(/Figures are the household/)).toBeNull()
    expect(screen.getByText('Waiting for Tom to read and confirm.')).toBeTruthy()
  })
})

describe('Home order', () => {
  it('puts the latest brief first, straight under the emergency row (hands-on review G4)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, '../../app/page.tsx'), 'utf8')
    const at = (tag: string) => src.indexOf(tag)
    expect(at('<LatestBriefCard />')).toBeGreaterThan(at('<EmergencyRow />'))
    expect(at('<LatestBriefCard />')).toBeLessThan(at('<TodayCard'))
    expect(src.split('<LatestBriefCard />').length).toBe(2)
  })
})
