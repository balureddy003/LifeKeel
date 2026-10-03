/**
 * ReadinessFeed — the home page's "What changed" surface (PRD-136 §6).
 * The api module is mocked; GlassCard/Link render through jsdom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const fetchFeed = vi.fn()
const fetchFeedSummary = vi.fn()
const submitFeedback = vi.fn()
const push = vi.fn()

vi.mock('@/lib/api', () => ({
  fetchFeed: (...a: unknown[]) => fetchFeed(...a),
  fetchFeedSummary: (...a: unknown[]) => fetchFeedSummary(...a),
  submitFeedback: (...a: unknown[]) => submitFeedback(...a),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

// next/link renders fine in jsdom but pulls in app-router internals in
// some setups — a plain anchor keeps the component testable.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

import { ReadinessFeed } from '../ReadinessFeed'

const evt = (over: Record<string, unknown> = {}) => ({
  id: over['id'] ?? Math.random().toString(36).slice(2),
  type: 'insight_opened',
  severity: 'notice',
  direction: null,
  member_id: null,
  domain: 'protection',
  title: 'Something happened',
  summary: 'details',
  evidence: [],
  links: [],
  next_check_at: null,
  dedupe_key: 'k',
  created_at: new Date().toISOString(),
  ...over,
})

const emptySummary = { window: '7d', total: 0, by_type: {}, up: 0, down: 0, composite_delta: null }

beforeEach(() => {
  fetchFeed.mockReset()
  fetchFeedSummary.mockReset()
  submitFeedback.mockReset()
  push.mockReset()
  submitFeedback.mockResolvedValue({ ok: true })
  fetchFeedSummary.mockResolvedValue(emptySummary)
})

describe('ReadinessFeed', () => {
  it('renders one card per event with the summary line', async () => {
    fetchFeed.mockResolvedValue([
      evt({ title: 'Score moved', type: 'score_moved', direction: 'up' }),
      evt({ title: 'Doc processed', type: 'document_processed' }),
    ])
    fetchFeedSummary.mockResolvedValue({ ...emptySummary, total: 2, composite_delta: 4 })

    render(<ReadinessFeed />)

    expect(await screen.findByText('Score moved')).toBeTruthy()
    expect(screen.getByText('Doc processed')).toBeTruthy()
    expect(screen.getByText('2 things moved this week · score +4')).toBeTruthy()
  })

  it('shows the empty state when nothing has moved', async () => {
    fetchFeed.mockResolvedValue([])
    render(<ReadinessFeed />)
    expect(await screen.findByText('Nothing has moved yet — Oak checks daily')).toBeTruthy()
  })

  it('renders a member chip resolved from the roster', async () => {
    fetchFeed.mockResolvedValue([evt({ member_id: 'm1' })])
    render(<ReadinessFeed members={[{ id: 'm1', name: 'Nihaan Kumar' }]} />)
    expect(await screen.findByText('Nihaan')).toBeTruthy()
  })

  it('exposes evidence behind a details disclosure', async () => {
    fetchFeed.mockResolvedValue([
      evt({ evidence: [{ label: 'Score', value: '74 → 82' }] }),
    ])
    render(<ReadinessFeed />)
    const details = await screen.findByText('Details')
    expect(details.closest('details')).toBeTruthy()
    expect(screen.getByText(/74 → 82/)).toBeTruthy()
  })

  it('asks for the youth slice when mode=youth', async () => {
    fetchFeed.mockResolvedValue([])
    render(<ReadinessFeed mode="youth" />)
    await waitFor(() => expect(fetchFeed).toHaveBeenCalledWith(expect.objectContaining({ mode: 'youth' })))
  })

  // PRD-136 §3 — the feedback row collapses to a one-line ack after a
  // response, and 'not relevant' keeps an undo affordance.
  it('renders the feedback row and collapses it after a response', async () => {
    fetchFeed.mockResolvedValue([evt({ id: 'e1' })])
    render(<ReadinessFeed />)
    const btn = await screen.findByText('Handled')
    btn.click()
    await waitFor(() => expect(submitFeedback).toHaveBeenCalledWith('e1', 'handled'))
    expect(await screen.findByText('Thanks — noted')).toBeTruthy()
    expect(screen.queryByText('Not relevant')).toBeNull()
  })

  it('shows "Muted for 90 days" with undo after not_relevant', async () => {
    fetchFeed.mockResolvedValue([evt({ id: 'e1' })])
    render(<ReadinessFeed />)
    const btn = await screen.findByText('Not relevant')
    btn.click()
    await waitFor(() => expect(submitFeedback).toHaveBeenCalledWith('e1', 'not_relevant'))
    expect(await screen.findByText(/Muted for 90 days/)).toBeTruthy()
    const undo = screen.getByText('undo?')
    submitFeedback.mockResolvedValue({ ok: true })
    undo.click()
    await waitFor(() => expect(submitFeedback).toHaveBeenCalledWith('e1', 'useful'))
  })

  it('hides the feedback row in youth mode', async () => {
    fetchFeed.mockResolvedValue([evt({ type: 'milestone', member_id: 'kid1' })])
    render(<ReadinessFeed mode="youth" members={[{ id: 'kid1', name: 'Kid' }]} />)
    await screen.findByText('Something happened')
    expect(screen.queryByText('Not relevant')).toBeNull()
  })
})
