/**
 * Unit tests for portfolio-data loaders.
 *
 * Coverage for the gap #1 fix (TRADING_ENGINE_GAPS.md): `loadLatestPrices`
 * must fall back to `portfolio_position.current_price` when no `market_price`
 * signal exists for a ticker, mirroring the dual-source pattern already used
 * by `buildMarketDataFromSignals`. Without this fallback, every Trading-212-
 * only tenant (whose broker-internal tickers never match Alpha Vantage's
 * exchange tickers — see gap #2) sees £0 / 0% on the Strategy ROI panel and
 * Calibration dashboard.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { loadLatestPrices } from '../portfolio-data.js'

const TEST_TENANT = 'tenant-portfolio-data-test'

// Each entry is a single signal doc. The mock `signals` collection's `find`
// returns a chain whose `toArray` resolves to the docs matching the query's
// `signal_type` and `data.ticker` filters, sorted by `created_at` desc to
// mirror the real query's `.sort({ created_at: -1 })`.
let mockSignals: Record<string, unknown>[] = []

vi.mock('../../db.js', () => ({
  getDb: vi.fn(async () => ({
    collection: vi.fn(() => ({
      find: vi.fn((query: Record<string, unknown>) => {
        const signalTypeFilter = query.signal_type as { $in?: string[] } | string | undefined
        const allowedTypes = signalTypeFilter && typeof signalTypeFilter === 'object' && signalTypeFilter.$in
          ? new Set(signalTypeFilter.$in)
          : signalTypeFilter
            ? new Set([signalTypeFilter as string])
            : null
        const ticker = (query['data.ticker'] as string | undefined) ?? undefined
        const filtered = mockSignals.filter((s) => {
          if (allowedTypes && !allowedTypes.has(String(s.signal_type))) return false
          if (ticker && (s.data as { ticker?: string } | undefined)?.ticker !== ticker) return false
          return true
        })
        // Sort by created_at desc, mirroring the real query.
        filtered.sort((a, b) => {
          const aTime = (a.created_at instanceof Date ? a.created_at : new Date(a.created_at as string)).getTime()
          const bTime = (b.created_at instanceof Date ? b.created_at : new Date(b.created_at as string)).getTime()
          return bTime - aTime
        })
        const chain = {
          sort: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          toArray: vi.fn(async () => filtered),
        }
        return chain
      }),
    })),
  })),
  getSignalsCollection: vi.fn(async () => ({
    find: vi.fn(() => ({ sort: vi.fn(() => ({ limit: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })) })),
  })),
}))

describe('loadLatestPrices — gap #1 fallback (TRADING_ENGINE_GAPS.md)', () => {
  beforeEach(() => {
    mockSignals = []
  })

  it('uses market_price.data.price when a market_price signal exists', async () => {
    mockSignals = [
      {
        signal_type: 'market_price',
        data: { ticker: 'AAPL', price: 22_500 },
        created_at: new Date('2026-07-17T10:00:00Z'),
      },
    ]

    const prices = await loadLatestPrices(TEST_TENANT, ['AAPL'])
    expect(prices.get('AAPL')).toBe(22_500)
  })

  it('falls back to portfolio_position.current_price when no market_price signal exists', async () => {
    // The live failure mode: a Trading-212-only tenant whose tickers never
    // match Alpha Vantage, so no market_price doc ever lands. Before the fix
    // this returned an empty map and ROI was stuck at £0.
    mockSignals = [
      {
        signal_type: 'portfolio_position',
        data: { ticker: 'LIME_US_EQ', quantity: 100, avg_price: 4_000, current_price: 4_250 },
        created_at: new Date('2026-07-17T10:00:00Z'),
      },
    ]

    const prices = await loadLatestPrices(TEST_TENANT, ['LIME_US_EQ'])
    expect(prices.get('LIME_US_EQ')).toBe(4_250)
  })

  it('prefers the most recent doc across both signal types', async () => {
    // A stale market_price from 2 days ago vs. a fresh portfolio_position
    // from 1 minute ago — the freshest price estimate should win for a
    // "latest price" lookup, regardless of signal type.
    mockSignals = [
      {
        signal_type: 'market_price',
        data: { ticker: 'DPW_US_EQ', price: 1_900 },
        created_at: new Date('2026-07-15T16:00:00Z'),
      },
      {
        signal_type: 'portfolio_position',
        data: { ticker: 'DPW_US_EQ', quantity: 3978, avg_price: 1_850, current_price: 1_950 },
        created_at: new Date('2026-07-17T09:59:00Z'),
      },
    ]

    const prices = await loadLatestPrices(TEST_TENANT, ['DPW_US_EQ'])
    expect(prices.get('DPW_US_EQ')).toBe(1_950)
  })

  it('returns no entry for a ticker with no signals of either type', async () => {
    mockSignals = [
      {
        signal_type: 'portfolio_position',
        data: { ticker: 'AAPL', quantity: 10, avg_price: 22_000, current_price: 22_500 },
        created_at: new Date('2026-07-17T10:00:00Z'),
      },
    ]

    const prices = await loadLatestPrices(TEST_TENANT, ['NOPE_US_EQ'])
    expect(prices.has('NOPE_US_EQ')).toBe(false)
  })

  it('skips a portfolio_position doc whose current_price is missing or non-finite', async () => {
    // Defensive: a malformed sync doc (zero/missing current_price) must not
    // poison the price map with a NaN/0 that would silently make ROI look
    // like a 100% loss. Better to report "no price" than a wrong price.
    mockSignals = [
      {
        signal_type: 'portfolio_position',
        data: { ticker: 'BAD_US_EQ', quantity: 10, avg_price: 1_000 }, // no current_price
        created_at: new Date('2026-07-17T10:00:00Z'),
      },
      {
        signal_type: 'portfolio_position',
        data: { ticker: 'NAN_US_EQ', quantity: 10, avg_price: 1_000, current_price: Number.NaN },
        created_at: new Date('2026-07-17T10:00:00Z'),
      },
    ]

    const prices = await loadLatestPrices(TEST_TENANT, ['BAD_US_EQ', 'NAN_US_EQ'])
    expect(prices.has('BAD_US_EQ')).toBe(false)
    expect(prices.has('NAN_US_EQ')).toBe(false)
  })

  it('handles multiple tickers in one call, mixing market_price and portfolio_position sources', async () => {
    mockSignals = [
      {
        signal_type: 'market_price',
        data: { ticker: 'AAPL', price: 22_500 },
        created_at: new Date('2026-07-17T10:00:00Z'),
      },
      {
        signal_type: 'portfolio_position',
        data: { ticker: 'LIME_US_EQ', quantity: 100, avg_price: 4_000, current_price: 4_250 },
        created_at: new Date('2026-07-17T09:45:00Z'),
      },
    ]

    const prices = await loadLatestPrices(TEST_TENANT, ['AAPL', 'LIME_US_EQ', 'MISSING_US_EQ'])
    expect(prices.get('AAPL')).toBe(22_500)
    expect(prices.get('LIME_US_EQ')).toBe(4_250)
    expect(prices.has('MISSING_US_EQ')).toBe(false)
  })
})
