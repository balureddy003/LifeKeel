import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { EconomicsRow, EconomicsView, SpendEntry } from '@/lib/api'

const fetchEconomics = vi.fn()
const fetchSpend = vi.fn()
const addSpendEntry = vi.fn()
const deleteSpendEntry = vi.fn()
const syncRevenueNow = vi.fn()
vi.mock('@/lib/api', () => ({
  fetchEconomics: (d: number, m: string) => fetchEconomics(d, m),
  fetchSpend: () => fetchSpend(),
  addSpendEntry: (e: unknown, r: string) => addSpendEntry(e, r),
  deleteSpendEntry: (id: string, r: string) => deleteSpendEntry(id, r),
  syncRevenueNow: (r: string) => syncRevenueNow(r),
}))
vi.mock('@/components/Toast', () => ({ useToast: () => vi.fn() }))

import { EconomicsPanel } from '../_components/EconomicsPanel'

const rate = (n: number, d: number) => ({
  numerator: n,
  denominator: d,
  rate: d ? n / d : null,
  low: d ? 0.02 : null,
  high: d ? 0.2 : null,
})

const row = (over: Partial<EconomicsRow> & { key: string }): EconomicsRow => ({
  visits: 400,
  cta_clicks: 60,
  signups: 40,
  profiles: 30,
  activated: 20,
  paid: 4,
  revenue_pence: 3196,
  spend_pence: 10000,
  cost_per_signup_pence: 250,
  cac_pence: 2500,
  payback_months: 3.1,
  visit_to_signup: rate(40, 400),
  signup_to_activated: rate(20, 40),
  signup_to_paid: rate(4, 40),
  confidence: 'directional',
  finding: `${over.key}: finding sentence`,
  ...over,
})

const view = (over: Partial<EconomicsView> = {}): EconomicsView => ({
  window_days: 90,
  model: 'first',
  totals: row({ key: 'All sources' }),
  by_source: [
    row({ key: 'bluesky' }),
    row({
      key: 'x',
      visits: 20,
      signups: 2,
      paid: 0,
      revenue_pence: 0,
      spend_pence: null,
      cac_pence: null,
      confidence: 'insufficient',
    }),
  ],
  by_campaign: [row({ key: 'pillar_chart', spend_pence: null })],
  by_content: [row({ key: 'post_1', visits: null, visit_to_signup: null })],
  last_touch_coverage: null,
  arpu_pence: 799,
  notes: [
    'Rates are shown with a 95% plausible range; rows marked insufficient are too thin to compare.',
  ],
  revenue: { synced: true, last_sync_at: '2026-10-23T04:15:00Z', mrr_pence: 799, livemode: false },
  rollup_ready: true,
  ...over,
})

const spendEntry: SpendEntry = {
  id: 's1',
  month: '2026-10',
  channel: 'bluesky',
  amount_pence: 5000,
  note: 'Boost',
  created_by: 'op',
  created_at: '2026-10-01T00:00:00Z',
}

beforeEach(() => {
  fetchEconomics.mockResolvedValue(view())
  fetchSpend.mockResolvedValue({ entries: [spendEntry] })
  addSpendEntry.mockResolvedValue({ entry: spendEntry })
  deleteSpendEntry.mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EconomicsPanel', () => {
  it('shows totals, findings and the per-source table with confidence labels', async () => {
    render(<EconomicsPanel />)
    await screen.findByText('bluesky: finding sentence')
    expect(fetchEconomics).toHaveBeenCalledWith(90, 'first')
    const table = screen.getByRole('table', { name: /By source/i })
    // bluesky is directional, x is too thin to compare — both labelled in the source table.
    expect(within(table).getByText('directional')).toBeTruthy()
    expect(within(table).getByText('too early')).toBeTruthy()
    expect(within(table).getByText('bluesky')).toBeTruthy()
    // A plausible range sits next to the rate, not a bare percentage.
    expect(within(table).getAllByText(/2\.0%–20%|2%–20%/).length).toBeGreaterThan(0)
  })

  it('shows a dash, not a number, where the data does not exist', async () => {
    render(<EconomicsPanel />)
    await screen.findByText('bluesky: finding sentence')
    const content = screen.getByRole('table', { name: /By content item/i })
    expect(within(content).getAllByText('—').length).toBeGreaterThan(0)
    // No spend or CAC columns for pillars and content.
    expect(within(screen.getByRole('table', { name: /By pillar/i })).queryByText('CAC')).toBeNull()
  })

  it('switches attribution model and refetches', async () => {
    render(<EconomicsPanel />)
    await screen.findByText('bluesky: finding sentence')
    fireEvent.click(screen.getByRole('button', { name: 'Last touch' }))
    await waitFor(() => expect(fetchEconomics).toHaveBeenLastCalledWith(90, 'last'))
    expect(screen.getByRole('button', { name: 'Last touch' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('changes the window', async () => {
    render(<EconomicsPanel />)
    await screen.findByText('bluesky: finding sentence')
    fireEvent.change(screen.getByLabelText('Window'), { target: { value: '30' } })
    await waitFor(() => expect(fetchEconomics).toHaveBeenLastCalledWith(30, 'first'))
  })

  it('says plainly when revenue is not synced and when it is a test-mode sync', async () => {
    fetchEconomics.mockResolvedValue(
      view({ revenue: { synced: false, last_sync_at: null, mrr_pence: null, livemode: null } }),
    )
    render(<EconomicsPanel />)
    await screen.findByText(/not synced — Stripe read-only key not connected yet/)
    cleanup()
    fetchEconomics.mockResolvedValue(view())
    render(<EconomicsPanel />)
    await screen.findByText(/from Stripe, synced/)
    expect(screen.getByText(/test mode/)).toBeTruthy()
  })

  it('shows the explanatory notes', async () => {
    render(<EconomicsPanel />)
    await screen.findByText(/Read this first/)
    expect(screen.getByText(/95% plausible range/)).toBeTruthy()
  })

  it('shows an empty state instead of empty tables when nothing has happened yet', async () => {
    const empty = row({
      key: 'All sources',
      visits: 0,
      signups: 0,
      paid: 0,
      revenue_pence: 0,
      spend_pence: null,
      cac_pence: null,
      confidence: 'insufficient',
    })
    fetchEconomics.mockResolvedValue(
      view({ totals: empty, by_source: [], by_campaign: [], by_content: [] }),
    )
    render(<EconomicsPanel />)
    await screen.findByText(/No visits or signups in this window yet/)
    expect(screen.queryByRole('table', { name: /By source/i })).toBeNull()
  })

  it('surfaces a load failure', async () => {
    fetchEconomics.mockRejectedValue(new Error('Missing operator permission: marketing.read'))
    render(<EconomicsPanel />)
    await screen.findByText(/Missing operator permission: marketing.read/)
  })

  it('records spend in pence with a reason, and refreshes', async () => {
    render(<EconomicsPanel />)
    await screen.findByText('bluesky: finding sentence')
    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'linkedin' } })
    fireEvent.change(screen.getByLabelText('Amount in pounds'), { target: { value: '12.50' } })
    const add = screen.getByRole('button', { name: 'Add spend' }) as HTMLButtonElement
    expect(add.disabled).toBe(true) // no reason yet
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'October boost' } })
    expect(add.disabled).toBe(false)
    fireEvent.click(add)
    await waitFor(() =>
      expect(addSpendEntry).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'linkedin', amount_pence: 1250 }),
        'October boost',
      ),
    )
    await waitFor(() => expect(fetchEconomics.mock.calls.length).toBeGreaterThan(1))
  })

  it('removes a spend entry only after a reason is given', async () => {
    render(<EconomicsPanel />)
    await screen.findByText('Boost')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const confirm = screen.getByRole('button', { name: /^Confirm/ }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('Reason (required, audited)'), {
      target: { value: 'Entered twice' },
    })
    fireEvent.click(confirm)
    await waitFor(() => expect(deleteSpendEntry).toHaveBeenCalledWith('s1', 'Entered twice'))
  })

  it('syncs revenue with an audited reason', async () => {
    syncRevenueNow.mockResolvedValue({ configured: true, invoices: 3, subscriptions: 2 })
    render(<EconomicsPanel />)
    await screen.findByText('bluesky: finding sentence')
    fireEvent.click(screen.getByRole('button', { name: 'Sync revenue now' }))
    fireEvent.change(screen.getByPlaceholderText('Reason (required, audited)'), {
      target: { value: 'Checking after launch' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Confirm/ }))
    await waitFor(() => expect(syncRevenueNow).toHaveBeenCalledWith('Checking after launch'))
  })
})
