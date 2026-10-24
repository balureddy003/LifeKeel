import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SearchView, TopicSuggestion } from '@/lib/api'

const fetchSearchView = vi.fn()
const fetchTopicSuggestions = vi.fn()
const setTopicSuggestion = vi.fn()
const runSearchReadbackNow = vi.fn()
vi.mock('@/lib/api', () => ({
  fetchSearchView: () => fetchSearchView(),
  fetchTopicSuggestions: () => fetchTopicSuggestions(),
  setTopicSuggestion: (id: string, a: string) => setTopicSuggestion(id, a),
  runSearchReadbackNow: () => runSearchReadbackNow(),
  generateTopicSuggestions: vi.fn(),
}))
const toast = vi.fn()
vi.mock('@/components/Toast', () => ({ useToast: () => toast }))

import { SearchPanel } from '../_components/SearchPanel'

const base: SearchView = {
  window_days: 28,
  lag_note: 'Search data is final about 3 days back.',
  enough_data: true,
  configured: { credentials: true, search_console: true, ga4: true },
  integrations: {
    search_console: { status: 'connected', last_ok_at: '2026-10-23T06:30:00Z', last_error: null },
    ga4: { status: 'needs_attention', last_ok_at: null, last_error: 'forbidden: HTTP 403' },
  },
  totals: { clicks: 20, impressions: 400 },
  top_queries: [{ query: 'tell us once', clicks: 20, impressions: 400, ctr: 0.05, position: 7 }],
  top_pages: [{ path: '/guides/death', clicks: 20, impressions: 400, ctr: 0.05, position: 7 }],
  near_misses: [
    { query: 'where are the papers', clicks: 0, impressions: 50, ctr: 0, position: 12 },
  ],
  ga4: {
    sessions: 10,
    first_party_visits: 14,
    note: 'GA4 only counts visitors who accepted cookies.',
    by_source: [],
  },
}
const idea: TopicSuggestion = {
  id: 's1',
  query: 'lasting power of attorney checklist',
  impressions: 150,
  clicks: 4,
  position: 9,
  nearest: null,
}

beforeEach(() => {
  fetchSearchView.mockResolvedValue(base)
  fetchTopicSuggestions.mockResolvedValue([idea])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SearchPanel', () => {
  it('shows setup steps and no numbers when nothing is configured', async () => {
    fetchSearchView.mockResolvedValue({
      ...base,
      configured: { credentials: false, search_console: false, ga4: false },
      integrations: {
        search_console: { status: 'not_configured', last_ok_at: null, last_error: null },
        ga4: { status: 'not_configured', last_ok_at: null, last_error: null },
      },
    })
    render(<SearchPanel />)
    expect(await screen.findByText(/Set up read-only access/)).toBeTruthy()
    expect(screen.getByText(/restricted/)).toBeTruthy()
    expect(screen.queryByText('Topic ideas from real searches')).toBeNull()
  })

  it('shows status, the lag note, numbers, near misses and the GA4 undercount note', async () => {
    render(<SearchPanel />)
    expect(await screen.findByText('Google Search Console')).toBeTruthy()
    expect(screen.getByText('needs attention')).toBeTruthy()
    expect(screen.getByText('forbidden: HTTP 403')).toBeTruthy()
    expect(screen.getByText(/final about 3 days back/)).toBeTruthy()
    expect(screen.getByText('Near misses')).toBeTruthy()
    expect(screen.getAllByText('tell us once').length).toBeGreaterThan(0)
    expect(screen.getByText(/only counts visitors who accepted cookies/)).toBeTruthy()
  })

  it('says there is not enough data instead of ranking tiny counts', async () => {
    fetchSearchView.mockResolvedValue({
      ...base,
      enough_data: false,
      totals: { clicks: 1, impressions: 4 },
    })
    render(<SearchPanel />)
    expect(
      await screen.findByText(/Not enough data yet to rank anything \(4 impressions\)/),
    ).toBeTruthy()
  })

  it('dismisses and marks an idea, and states that ideas never create posts', async () => {
    setTopicSuggestion.mockResolvedValue({ ok: true })
    render(<SearchPanel />)
    expect(await screen.findByText(/Nothing here creates a draft or a post/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(setTopicSuggestion).toHaveBeenCalledWith('s1', 'dismiss'))
    fireEvent.click(screen.getByRole('button', { name: 'I wrote it' }))
    await waitFor(() => expect(setTopicSuggestion).toHaveBeenCalledWith('s1', 'used'))
  })
})
