/**
 * ConnectorSyncEngine tests
 *
 * Covers the two real Trading 212 bugs:
 *   1. live_base_url is used when credential extra.live_mode is true
 *   2. single-object responses (Account / Cash) are wrapped into a record array,
 *      preventing total_value from silently defaulting to 1 and breaking
 *      concentration-risk math.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ConnectorSyncEngine,
  transformAlphaVantageOverview,
  transformFinnhubNewsSentiment,
  transformFinnhubFinancialMetrics,
  transformCboeVixDaily,
  transformFredYieldCurve,
  transformFredCreditSpread,
  transformFredTreasury10Y,
  transformGoogleTrendsSearchVolume,
  type SyncCredentials,
} from '../connector-sync-engine.js'
import { safeFetch } from '../safe-fetch.js'
import type { ConnectorConfig } from '../schemas.js'

vi.mock('../safe-fetch.js', () => ({
  safeFetch: vi.fn(),
}))

function mockResponse(body: unknown, status = 200, statusText = 'OK', headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => body,
  } as Response
}

function makeConnector(partial: Omit<Partial<ConnectorConfig>, 'resources'> & { resources: ConnectorConfig['resources'] }): ConnectorConfig {
  return {
    id: 'trading-212',
    name: 'Trading 212',
    provider: 'trading-212',
    category: 'investment',
    status: 'planned',
    version: '1.0.0',
    base_url: 'https://demo.trading212.com/api/v0',
    auth: { type: 'basic' },
    signal_types: [],
    signal_type_map: {},
    field_mappings: [],
    ...partial,
  } as ConnectorConfig
}

function makeEngine() {
  const db = {
    collection: () => ({
      findOne: vi.fn(async () => null),
      updateOne: vi.fn(async () => ({})),
      find: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
    }),
  }
  const eventGenerator = {
    generateFromWebhook: vi.fn(() => null),
  }
  const engine = {
    evaluate: vi.fn(async () => ({ insights: [] })),
    inventory: vi.fn(() => []),
    registeredSignalTypes: [],
  }
  return { db, eventGenerator, engine, sync: new ConnectorSyncEngine(db as any, eventGenerator as any, engine as any) }
}

describe('ConnectorSyncEngine.fetchAllPages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses live_base_url when live_mode is enabled in credentials', async () => {
    const { sync } = makeEngine()
    vi.mocked(safeFetch).mockResolvedValueOnce(mockResponse([{ ticker: 'AAPL', quantity: 10 }]))

    const connector = makeConnector({
      live_base_url: 'https://trading212.com/api/v0',
      signal_types: ['portfolio_position'],
      resources: [{
        name: 'Portfolio',
        path: '/equity/portfolio',
        method: 'GET',
        response_shape: 'list',
      }],
    })

    const creds: SyncCredentials = {
      tenant_id: 'tenant-1',
      connector_id: 'trading-212',
      auth_type: 'basic',
      username: 'API_KEY',
      password: 'API_SECRET',
      extra: { live_mode: 'true' },
    }

    const records = await (sync as any).fetchAllPages(connector, connector.resources![0]!, creds, 'tenant-1', {})

    expect(records).toHaveLength(1)
    expect(safeFetch).toHaveBeenCalledTimes(1)
    const calledUrl = vi.mocked(safeFetch).mock.calls[0]![0] as string
    expect(calledUrl).toContain('https://trading212.com/api/v0/equity/portfolio')
    expect(calledUrl).not.toContain('demo.trading212.com')
    const calledHeaders = vi.mocked(safeFetch).mock.calls[0]![1]?.headers as Record<string, string> | undefined
    expect(calledHeaders?.Authorization).toBe('Basic ' + Buffer.from('API_KEY:API_SECRET').toString('base64'))
  })

  it('falls back to demo base_url when live_mode is not enabled', async () => {
    const { sync } = makeEngine()
    vi.mocked(safeFetch).mockResolvedValueOnce(mockResponse([{ ticker: 'AAPL', quantity: 10 }]))

    const connector = makeConnector({
      live_base_url: 'https://trading212.com/api/v0',
      signal_types: ['portfolio_position'],
      resources: [{
        name: 'Portfolio',
        path: '/equity/portfolio',
        method: 'GET',
        response_shape: 'list',
      }],
    })

    const creds: SyncCredentials = {
      tenant_id: 'tenant-1',
      connector_id: 'trading-212',
      auth_type: 'basic',
      username: 'API_KEY',
      password: 'API_SECRET',
    }

    await (sync as any).fetchAllPages(connector, connector.resources![0]!, creds, 'tenant-1', {})

    const calledUrl = vi.mocked(safeFetch).mock.calls[0]![0] as string
    expect(calledUrl).toContain('https://demo.trading212.com/api/v0/equity/portfolio')
  })

  it('wraps a single-object /equity/account/summary response into one record', async () => {
    const { sync } = makeEngine()
    const accountBody = {
      total: 100_000,
      invested: 80_000,
      currencyCode: 'GBP',
    }
    vi.mocked(safeFetch).mockResolvedValueOnce(mockResponse(accountBody))

    const connector = makeConnector({
      signal_types: ['portfolio_summary'],
      resources: [{
        name: 'Account',
        path: '/equity/account/summary',
        method: 'GET',
        response_shape: 'object',
      }],
    })

    const creds: SyncCredentials = {
      tenant_id: 'tenant-1',
      connector_id: 'trading-212',
      auth_type: 'basic',
      username: 'API_KEY',
      password: 'API_SECRET',
    }

    const records = await (sync as any).fetchAllPages(connector, connector.resources![0]!, creds, 'tenant-1', {})

    expect(records).toHaveLength(1)
    expect(records[0]).toEqual(accountBody)
  })

  it('leaves list-shaped /equity/portfolio responses unchanged', async () => {
    const { sync } = makeEngine()
    const positions = [
      { ticker: 'AAPL', quantity: 10 },
      { ticker: 'VUAG', quantity: 5 },
    ]
    vi.mocked(safeFetch).mockResolvedValueOnce(mockResponse(positions))

    const connector = makeConnector({
      signal_types: ['portfolio_position'],
      resources: [{
        name: 'Portfolio',
        path: '/equity/portfolio',
        method: 'GET',
        response_shape: 'list',
      }],
    })

    const creds: SyncCredentials = {
      tenant_id: 'tenant-1',
      connector_id: 'trading-212',
      auth_type: 'basic',
      username: 'API_KEY',
      password: 'API_SECRET',
    }

    const records = await (sync as any).fetchAllPages(connector, connector.resources![0]!, creds, 'tenant-1', {})

    expect(records).toHaveLength(2)
  })

  it('injects api_key as a query parameter when auth.param is declared', async () => {
    const { sync } = makeEngine()
    vi.mocked(safeFetch).mockResolvedValueOnce(mockResponse({ 'Time Series (Daily)': { '2024-01-02': { '4. close': '100' } } }))

    const connector = makeConnector({
      base_url: 'https://www.alphavantage.co',
      signal_types: ['market_price'],
      auth: { type: 'api_key', param: 'apikey' },
      resources: [{
        name: 'DailyPrices',
        path: '/query',
        method: 'GET',
        response_shape: 'object',
        record_transform: 'alpha_vantage_time_series_daily',
        symbols_param: 'symbol',
        params: { function: 'TIME_SERIES_DAILY' },
      }],
    })

    const creds: SyncCredentials = {
      tenant_id: 'tenant-1',
      connector_id: 'alpha-vantage',
      auth_type: 'api_key',
      api_key: 'AV_KEY',
      extra: { symbols: 'AAPL' },
    }

    await (sync as any).fetchAllPages(connector, connector.resources![0]!, creds, 'tenant-1', {})

    const calledUrl = vi.mocked(safeFetch).mock.calls[0]![0] as string
    expect(calledUrl).toContain('apikey=AV_KEY')
    expect(calledUrl).toContain('symbol=AAPL')
  })

  it('expands symbols and transforms Alpha Vantage time-series into flat records', async () => {
    const { sync } = makeEngine()
    const makeAvBody = (ticker: string) => ({
      'Time Series (Daily)': {
        '2024-01-03': {
          '1. open': '100', '2. high': '105', '3. low': '99', '4. close': '103', '5. volume': '1000',
        },
        '2024-01-02': {
          '1. open': '98', '2. high': '101', '3. low': '97', '4. close': '100', '5. volume': '2000',
        },
      },
    })

    vi.mocked(safeFetch)
      .mockResolvedValueOnce(mockResponse(makeAvBody('AAPL')))
      .mockResolvedValueOnce(mockResponse(makeAvBody('TSLA')))

    const connector = makeConnector({
      base_url: 'https://www.alphavantage.co',
      signal_types: ['market_price'],
      auth: { type: 'api_key', param: 'apikey' },
      resources: [{
        name: 'DailyPrices',
        path: '/query',
        method: 'GET',
        response_shape: 'object',
        record_transform: 'alpha_vantage_time_series_daily',
        symbols_param: 'symbol',
        params: { function: 'TIME_SERIES_DAILY' },
      }],
    })

    const creds: SyncCredentials = {
      tenant_id: 'tenant-1',
      connector_id: 'alpha-vantage',
      auth_type: 'api_key',
      api_key: 'AV_KEY',
      extra: { symbols: 'AAPL, TSLA' },
    }

    const records = await (sync as any).fetchAllPages(connector, connector.resources![0]!, creds, 'tenant-1', {})

    expect(records).toHaveLength(4)
    const aapl = records.filter((r: any) => r.ticker === 'AAPL')
    const tsla = records.filter((r: any) => r.ticker === 'TSLA')
    expect(aapl).toHaveLength(2)
    expect(tsla).toHaveLength(2)
    expect(aapl[0]).toMatchObject({ date: '2024-01-02', close: 100, volume: 2000 })
    expect(aapl[1]).toMatchObject({ date: '2024-01-03', close: 103, volume: 1000 })
  })

  it('records HTTP 429 rate-limit errors from Alpha Vantage instead of treating it as empty data', async () => {
    const { sync } = makeEngine()
    vi.mocked(safeFetch).mockResolvedValue(mockResponse({ Note: 'API call frequency exceeded' }, 429, 'Too Many Requests', { 'retry-after': '0' }))

    const connector = makeConnector({
      base_url: 'https://www.alphavantage.co',
      signal_types: ['market_price'],
      auth: { type: 'api_key', param: 'apikey' },
      resources: [{
        name: 'DailyPrices',
        path: '/query',
        method: 'GET',
        response_shape: 'object',
        record_transform: 'alpha_vantage_time_series_daily',
        symbols_param: 'symbol',
        params: { function: 'TIME_SERIES_DAILY' },
      }],
    })

    const creds: SyncCredentials = {
      tenant_id: 'tenant-1',
      connector_id: 'alpha-vantage',
      auth_type: 'api_key',
      api_key: 'AV_KEY',
      extra: { symbols: 'AAPL' },
    }

    const records = await (sync as any).fetchAllPages(connector, connector.resources![0]!, creds, 'tenant-1', {})

    expect(records).toHaveLength(0)
    expect((sync as any).lastFetchError).toMatchObject({
      status: 429,
      statusText: expect.any(String),
    })
  })
})

/** Minimal in-memory stand-in for the `signals` collection, enough to
 * support the equality / $exists / $lte filters and sort/limit chain that
 * enrichTradingSignal actually issues. */
function makeSignalsStore(initialDocs: Record<string, unknown>[] = []) {
  const docs = [...initialDocs]

  function getPath(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>(
      (acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined),
      obj,
    )
  }

  const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>): boolean => {
    return Object.entries(filter).every(([key, cond]) => {
      const value = getPath(doc, key)
      if (cond && typeof cond === 'object' && '$exists' in (cond as Record<string, unknown>)) {
        const wantsExists = (cond as { $exists: boolean }).$exists
        return wantsExists ? value !== undefined : value === undefined
      }
      if (cond && typeof cond === 'object' && '$lte' in (cond as Record<string, unknown>)) {
        const bound = (cond as { $lte: Date }).$lte
        return value !== undefined && (value as Date) <= bound
      }
      return value === cond
    })
  }

  const collection = {
    find: (filter: Record<string, unknown>) => {
      const filtered = docs.filter((d) => matches(d, filter))
      return {
        sort: (sortSpec: Record<string, number>) => {
          const entry = Object.entries(sortSpec)[0]
          const key = entry?.[0] ?? 'created_at'
          const dir = entry?.[1] ?? -1
          const results = [...filtered].sort((a, b) => {
            const av = getPath(a, key)
            const bv = getPath(b, key)
            if (av === bv) return 0
            const cmp = (av as number | Date) > (bv as number | Date) ? 1 : -1
            return dir === -1 ? -cmp : cmp
          })
          return {
            limit: (n: number) => ({ toArray: async () => results.slice(0, n) }),
            toArray: async () => results,
          }
        },
        toArray: async () => filtered,
      }
    },
    insertOne: async (doc: Record<string, unknown>) => { docs.push(doc) },
  }
  return { docs, collection }
}

describe('ConnectorSyncEngine.enrichTradingSignal', () => {
  it('merges cash into a total_value-only summary and computes cash_pct', async () => {
    const { collection } = makeSignalsStore([
      { tenant_id: 't1', connector_id: 'trading-212', signal_type: 'portfolio_summary', created_at: new Date(), data: { cash: 12_000_00 } },
    ])
    const db = { collection: () => collection }
    const sync = new ConnectorSyncEngine(db as any, {} as any, {} as any)

    const event = { event_type: 'portfolio_summary', raw_data: { total_value: 100_000_00 } as Record<string, unknown> }
    await (sync as any).enrichTradingSignal(event, 't1', 'trading-212')

    expect(event.raw_data['cash']).toBe(12_000_00)
    expect(event.raw_data['cash_pct']).toBe(12)
  })

  it('merges total_value into a cash-only summary so rebalance detector conditions can evaluate', async () => {
    const { collection } = makeSignalsStore([
      { tenant_id: 't1', connector_id: 'trading-212', signal_type: 'portfolio_summary', created_at: new Date(), data: { total_value: 100_000_00, invested_value: 88_000_00 } },
    ])
    const db = { collection: () => collection }
    const sync = new ConnectorSyncEngine(db as any, {} as any, {} as any)

    const event = { event_type: 'portfolio_summary', raw_data: { cash: 12_000_00 } as Record<string, unknown> }
    await (sync as any).enrichTradingSignal(event, 't1', 'trading-212')

    expect(event.raw_data['total_value']).toBe(100_000_00)
    expect(event.raw_data['cash_pct']).toBe(12)
  })

  it('computes position_value_minor and portfolio_weight_pct from the latest known total_value', async () => {
    const { collection } = makeSignalsStore([
      { tenant_id: 't1', connector_id: 'trading-212', signal_type: 'portfolio_summary', created_at: new Date(), data: { total_value: 200_000_00 } },
    ])
    const db = { collection: () => collection }
    const sync = new ConnectorSyncEngine(db as any, {} as any, {} as any)

    const event = { event_type: 'portfolio_position', raw_data: { ticker: 'AAPL', quantity: 15, current_price: 18_500 } as Record<string, unknown> }
    await (sync as any).enrichTradingSignal(event, 't1', 'trading-212')

    expect(event.raw_data['position_value_minor']).toBe(277_500)
    expect(event.raw_data['portfolio_weight_pct']).toBe(1.39) // 277500 / 20000000 * 100
  })

  it('computes monthly_return_pct and max_drawdown_pct against historical total_value snapshots', async () => {
    const { collection } = makeSignalsStore([
      {
        tenant_id: 't1', connector_id: 'trading-212', signal_type: 'portfolio_summary',
        created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
        data: { total_value: 50_000_00 },
      },
      {
        tenant_id: 't1', connector_id: 'trading-212', signal_type: 'portfolio_summary',
        created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        data: { total_value: 120_000_00 }, // peak
      },
    ])
    const db = { collection: () => collection }
    const sync = new ConnectorSyncEngine(db as any, {} as any, {} as any)

    const event = { event_type: 'portfolio_summary', raw_data: { total_value: 90_000_00, cash: 0 } as Record<string, unknown> }
    await (sync as any).enrichTradingSignal(event, 't1', 'trading-212')

    // (90000 - 50000) / 50000 * 100 = 80
    expect(event.raw_data['monthly_return_pct']).toBe(80)
    // (120000 - 90000) / 120000 * 100 = 25
    expect(event.raw_data['max_drawdown_pct']).toBe(25)
  })
})

describe('transformAlphaVantageOverview — gap #6', () => {
  it('extracts gross profitability from GrossProfitTTM and TotalRevenueTTM', () => {
    const records = transformAlphaVantageOverview({
      Symbol: 'AAPL',
      Name: 'Apple Inc',
      GrossProfitTTM: '80000000000',
      TotalRevenueTTM: '400000000000',
      Sector: 'Technology',
      Industry: 'Consumer Electronics',
      AssetType: 'Common Stock',
      MarketCapitalization: '3000000000000',
    }, 'AAPL')

    expect(records).toHaveLength(1)
    const r = records[0]!
    expect(r['ticker']).toBe('AAPL')
    expect(r['gross_profit_ttm']).toBe(80000000000)
    expect(r['total_revenue_ttm']).toBe(400000000000)
    expect(r['gross_profitability']).toBe(0.2) // 80B / 400B
    expect(r['sector']).toBe('Technology')
  })

  it('returns empty array on error response', () => {
    expect(transformAlphaVantageOverview({ Note: 'API call frequency is 25 calls per day' }, 'AAPL')).toEqual([])
    expect(transformAlphaVantageOverview({ 'Error Message': 'Invalid API call' }, 'AAPL')).toEqual([])
  })

  it('leaves gross_profitability undefined when revenue is 0 or missing', () => {
    const records = transformAlphaVantageOverview({
      Symbol: 'PENNYPICK',
      GrossProfitTTM: '0',
      TotalRevenueTTM: '0',
    }, 'PENNYPICK')
    expect(records).toHaveLength(1)
    expect(records[0]!['gross_profitability']).toBeUndefined()
  })

  it('falls back to the requested symbol when Symbol field is missing', () => {
    const records = transformAlphaVantageOverview({
      GrossProfitTTM: '100',
      TotalRevenueTTM: '200',
    }, 'MSFT')
    expect(records[0]!['ticker']).toBe('MSFT')
  })
})

// ── Phase 2/3 free-data connector transforms (review fix PR #220) ──────────

describe('transformFinnhubNewsSentiment', () => {
  it('extracts bullishPercent as the [0,1] sentiment score', () => {
    const records = transformFinnhubNewsSentiment({
      symbol: 'AAPL',
      buzz: { buzz: 142, articlesInLastWeek: 31, weeklyArticles: 280 },
      companyNewsScore: 0.85,
      sentiment: { bullishPercent: 0.72, bearishPercent: 0.28 },
      sectorAverageBullishPercent: 0.55,
    }, 'AAPL')
    expect(records).toHaveLength(1)
    expect(records[0]!['sentiment']).toBe(0.72)
    expect(records[0]!['ticker']).toBe('AAPL')
    expect(records[0]!['news_score']).toBe(0.85)
  })

  it('returns empty when bullishPercent is missing or non-finite', () => {
    expect(transformFinnhubNewsSentiment({}, 'AAPL')).toEqual([])
    expect(transformFinnhubNewsSentiment({ sentiment: { bullishPercent: 'n/a' } }, 'AAPL')).toEqual([])
  })
})

describe('transformFinnhubFinancialMetrics', () => {
  it('converts ROE and gross margin from percent to fraction', () => {
    const records = transformFinnhubFinancialMetrics({
      metric: {
        roeTTM: 25.3,
        grossMarginTTM: 38.1,
        'totalDebt/totalEquityQuarterly': 1.5,
      },
    }, 'AAPL')
    expect(records).toHaveLength(1)
    expect(records[0]!['roe']).toBeCloseTo(0.253)
    expect(records[0]!['gross_margin']).toBeCloseTo(0.381)
    expect(records[0]!['debt_to_equity']).toBeCloseTo(0.015)
  })

  it('returns empty when metric object is absent', () => {
    expect(transformFinnhubFinancialMetrics({}, 'AAPL')).toEqual([])
    expect(transformFinnhubFinancialMetrics({ metric: {} }, 'AAPL')).toHaveLength(1) // all undefined, but record still emitted
  })
})

describe('transformCboeVixDaily', () => {
  it('parses the CBOE CSV header and emits one record per row', () => {
    const csv = 'Date,VIX Open,VIX High,VIX Low,VIX Close\n2024-01-02,13.0,13.5,12.8,13.2\n2024-01-03,13.2,14.0,13.1,13.8\n'
    const records = transformCboeVixDaily({ text: csv }, '')
    expect(records).toHaveLength(2)
    expect(records[0]!['date']).toBe('2024-01-02')
    expect(records[0]!['vix_value']).toBe(13.2)
    expect(records[1]!['vix_value']).toBe(13.8)
  })

  it('returns empty when header columns are missing', () => {
    expect(transformCboeVixDaily({ text: 'foo,bar\n1,2\n' }, '')).toEqual([])
    expect(transformCboeVixDaily({}, '')).toEqual([])
  })
})

describe('FRED transforms', () => {
  it('transformFredYieldCurve extracts the most recent finite observation', () => {
    const records = transformFredYieldCurve({
      observations: [
        { date: '2024-01-01', value: '.' },
        { date: '2024-01-02', value: '-0.18' },
      ],
    }, '')
    expect(records).toHaveLength(1)
    expect(records[0]!['yield_curve_spread']).toBe(-0.18)
    expect(records[0]!['date']).toBe('2024-01-02')
  })

  it('transformFredCreditSpread maps to credit_spread', () => {
    const records = transformFredCreditSpread({
      observations: [{ date: '2024-01-02', value: '5.23' }],
    }, '')
    expect(records[0]!['credit_spread']).toBe(5.23)
  })

  it('transformFredTreasury10Y maps to treasury_yield_10y', () => {
    const records = transformFredTreasury10Y({
      observations: [{ date: '2024-01-02', value: '4.05' }],
    }, '')
    expect(records[0]!['treasury_yield_10y']).toBe(4.05)
  })

  it('returns empty when all observations are missing (".")', () => {
    expect(transformFredYieldCurve({ observations: [{ date: '2024-01-01', value: '.' }] }, '')).toEqual([])
    expect(transformFredYieldCurve({}, '')).toEqual([])
  })
})

describe('transformGoogleTrendsSearchVolume', () => {
  it('extracts the most recent timeline point value', () => {
    const records = transformGoogleTrendsSearchVolume({
      default: {
        timelineData: [
          { time: '1700000000', formattedTime: 'Nov 14 – Nov 20, 2023', value: [42] },
          { time: '1700604800', formattedTime: 'Nov 21 – Nov 27, 2023', value: [67] },
        ],
      },
    }, 'AAPL')
    expect(records).toHaveLength(1)
    expect(records[0]!['search_volume_ratio']).toBe(67)
    expect(records[0]!['ticker']).toBe('AAPL')
  })

  it('handles top-level timelineData envelope', () => {
    const records = transformGoogleTrendsSearchVolume({
      timelineData: [{ time: '1', formattedTime: '2024-01', value: [55] }],
    }, 'MSFT')
    expect(records[0]!['search_volume_ratio']).toBe(55)
  })

  it('returns empty when timeline is absent or empty', () => {
    expect(transformGoogleTrendsSearchVolume({}, 'AAPL')).toEqual([])
    expect(transformGoogleTrendsSearchVolume({ timelineData: [] }, 'AAPL')).toEqual([])
  })
})
