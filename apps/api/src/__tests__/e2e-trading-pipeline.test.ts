/**
 * Real end-to-end test: connect → sync → detect → insight → approve.
 *
 * Every other test in this codebase mocks the `signals`/`insights` collections
 * directly. This one runs against a real (in-process) MongoDB via
 * mongodb-memory-server and exercises the actual production code path:
 *   ConnectorSyncEngine.syncConnector() [real trading-212.yaml, real field
 *   mappings, real derived-signal enrichment, real @kairos/engine detectors]
 *   → real `signals`/`insights` collections
 *   → the real GET /insights route
 *   → the real POST /insights/:id/approve route
 *   → the real ActionExecutor, asserting trading actions resolve to
 *     `log_only` (never a real trade) even through this fully-wired path.
 *
 * Outbound HTTP to Trading 212 is mocked at the global fetch + DNS layer
 * (not by mocking ConnectorSyncEngine) so the real sync logic runs unmodified.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, type Db } from 'mongodb'
import Fastify from 'fastify'
import { Engine } from '@kairos/engine'
import { EventGenerator, ConnectorSyncEngine, ConnectorLoader } from '@kairos/pipeline'
import { registerInsightRoutes } from '../routes/insights.js'

// The SSRF guard in packages/pipeline/src/safe-fetch.ts does a real DNS lookup
// before every outbound call — mock it so trading212.com's demo host resolves
// without depending on this environment's network/DNS.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}))

const TENANT_ID = 'e2e-tenant'
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function mockTrading212Fetch(url: string | URL): Promise<Response> {
  const u = String(url)
  if (u.includes('/equity/account/cash')) {
    return Promise.resolve(jsonResponse({ free: 300, currencyCode: 'GBP' }))
  }
  if (u.includes('/equity/account')) {
    return Promise.resolve(jsonResponse({ total: 2000, invested: 1700, currencyCode: 'GBP' }))
  }
  if (u.includes('/equity/portfolio')) {
    return Promise.resolve(jsonResponse([
      { ticker: 'AAPL', quantity: 10, averagePrice: 22, currentPrice: 25, ppl: 30, accountType: 'isa' },
    ]))
  }
  if (u.includes('/equity/metadata/instruments')) {
    return Promise.resolve(jsonResponse([
      { ticker: 'AAPL', name: 'Apple Inc.', type: 'STOCK', currencyCode: 'USD', isin: 'US0378331005' },
    ]))
  }
  if (u.includes('/equity/history/orders')) {
    return Promise.resolve(jsonResponse([]))
  }
  return Promise.resolve(jsonResponse({}))
}

describe('Trading 212 pipeline — real DB, connect through approve', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
    process.env['MONGODB_URL'] = mongod.getUri()
    process.env['MONGODB_DB'] = 'kairos_e2e_test'

    client = new MongoClient(mongod.getUri())
    await client.connect()
    db = client.db('kairos_e2e_test')

    vi.stubGlobal('fetch', vi.fn(mockTrading212Fetch))

    // Seed an active goal that overrides the concentration cap to 12% (default
    // is 10%) — this test's AAPL position sits at 12.5%, deliberately chosen
    // to fire under the goal override too, proving goal_kpi_targets actually
    // reach the detector rather than just checking the default.
    await db.collection('goals').insertOne({
      tenant_id: TENANT_ID,
      status: 'active',
      kpis: [{ metric: 'portfolio_concentration_max_pct', target: 12 }],
    })

    // Seed connector credentials directly (bypassing the HTTP route — that
    // path is covered separately by connector-credentials.test.ts).
    await db.collection('connector_credentials').insertOne({
      tenant_id: TENANT_ID,
      connector_id: 'trading-212',
      auth_type: 'api_key',
      api_key: 'test-key',
      extra: { live_mode: 'false' },
    })
  }, 60_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await client.close()
    await mongod.stop()
  })

  it('syncs real Trading 212 data, fires goal-aware insights, and approving one only ever logs — never trades', async () => {
    const loader = new ConnectorLoader()
    await loader.load(path.join(REPO_ROOT, 'connectors'))
    const connector = loader.get('trading-212')
    expect(connector).toBeDefined()

    const engine = new Engine({ detectorsDir: path.join(REPO_ROOT, 'detectors', 'trading') })
    await engine.load()

    const eventGenerator = new EventGenerator()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const syncEngine = new ConnectorSyncEngine(db as any, eventGenerator, engine)

    const creds = await db.collection('connector_credentials').findOne({ tenant_id: TENANT_ID, connector_id: 'trading-212' })
    expect(creds).not.toBeNull()

    // ── 1. Real sync: HTTP (mocked) → field mappings → derived-signal enrichment ──
    const results = await syncEngine.syncConnector(connector!, TENANT_ID, true)
    expect(results.length).toBeGreaterThan(0)

    const signals = await db.collection('signals').find({ tenant_id: TENANT_ID }).toArray()
    expect(signals.length).toBeGreaterThan(0)

    const summary = signals.find((s) => s.signal_type === 'portfolio_summary' && s.data && (s.data as Record<string, unknown>)['cash'] !== undefined && (s.data as Record<string, unknown>)['total_value'] !== undefined)
    expect(summary, 'a portfolio_summary signal should carry both cash and total_value after enrichment').toBeDefined()
    const summaryData = summary!.data as Record<string, unknown>
    expect(summaryData['total_value']).toBe(200_000) // £2000 in minor units
    expect(summaryData['cash_pct']).toBeCloseTo(15, 1) // 30,000 / 200,000 * 100

    const position = signals.find((s) => s.signal_type === 'portfolio_position')
    expect(position).toBeDefined()
    const positionData = position!.data as Record<string, unknown>
    expect(positionData['position_value_minor']).toBe(25_000) // 10 * 2,500
    expect(positionData['portfolio_weight_pct']).toBeCloseTo(12.5, 1) // 25,000 / 200,000 * 100

    // ── 2. Real insights: detector conditions actually fired, using the goal override ──
    const insights = await db.collection('insights').find({ tenant_id: TENANT_ID }).toArray()
    const detectorIds = insights.map((i) => i.detector_id)
    expect(detectorIds).toContain('trading_concentration_risk') // 12.5% > goal's 12% cap
    expect(detectorIds).toContain('trading_rebalance_suggestion') // 15% cash > default 5% cap
    expect(detectorIds).not.toContain('trading_dividend_opportunity') // no dividend_yield_pct data — correctly silent, not guessed

    const concentrationInsight = insights.find((i) => i.detector_id === 'trading_concentration_risk')!
    expect(String(concentrationInsight['reasoning'])).toContain('12') // reflects the goal's cap, not the hardcoded default of 10

    // ── 3. Real API: the insight is reachable through the actual /insights route ──
    const app = Fastify()
    app.addHook('onRequest', async (request) => {
      ;(request as any).authContext = { tenant_id: TENANT_ID, user_id: 'e2e-user' }
    })
    await registerInsightRoutes(app, engine, undefined, db)

    const listRes = await app.inject({ method: 'GET', url: '/insights?limit=200' })
    expect(listRes.statusCode).toBe(200)
    const listBody = JSON.parse(listRes.body) as { insights: Array<{ id: string; detector_id: string }> }
    const apiConcentration = listBody.insights.find((i) => i.detector_id === 'trading_concentration_risk')
    expect(apiConcentration).toBeDefined()

    // ── 4. Real approve path: must resolve to log_only, never an executed trade ──
    const approveRes = await app.inject({ method: 'POST', url: `/insights/${apiConcentration!.id}/approve`, payload: {} })
    expect(approveRes.statusCode).toBe(200)

    // ActionExecutor.execute() fire-and-forgets its receipt DB inserts
    // (this.col.insertOne(receipt).catch(() => {})) — querying the collection
    // immediately after the HTTP response is a race. The executionSummary
    // returned in the response body is computed synchronously and is the
    // reliable source for this assertion.
    const approveBody = JSON.parse(approveRes.body) as {
      actions?: { receipts: Array<{ action_type: string; status: string }> }
    }
    expect(approveBody.actions?.receipts.length).toBeGreaterThan(0)
    for (const receipt of approveBody.actions!.receipts) {
      expect(receipt.action_type).toBe('log_only')
      expect(receipt.status).toBe('skipped')
    }

    const updatedInsight = await db.collection('insights').findOne({ id: apiConcentration!.id })
    expect(updatedInsight?.['state']).toBe('completed')
  }, 30_000)

  it('records last_error instead of silently reporting "0 records" when the API rejects the credentials', async () => {
    const FAILING_TENANT = 'e2e-tenant-bad-creds'
    await db.collection('connector_credentials').insertOne({
      tenant_id: FAILING_TENANT,
      connector_id: 'trading-212',
      auth_type: 'api_key',
      api_key: 'wrong-key',
      extra: { live_mode: 'false' },
    })

    const originalImpl = mockTrading212Fetch
    vi.mocked(fetch).mockImplementation(async () =>
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
    )

    try {
      const loader = new ConnectorLoader()
      await loader.load(path.join(REPO_ROOT, 'connectors'))
      const connector = loader.get('trading-212')!
      const engine = new Engine({ detectorsDir: path.join(REPO_ROOT, 'detectors', 'trading') })
      await engine.load()
      const eventGenerator = new EventGenerator()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const syncEngine = new ConnectorSyncEngine(db as any, eventGenerator, engine)

      const results = await syncEngine.syncConnector(connector, FAILING_TENANT, true)
      expect(results.length).toBeGreaterThan(0)
      for (const result of results) {
        expect(result.records_fetched).toBe(0)
        expect(result.error).toEqual({ status: 401, status_text: 'Unauthorized' })
      }

      const states = await db.collection('connector_sync_state').find({ tenant_id: FAILING_TENANT }).toArray()
      expect(states.length).toBeGreaterThan(0)
      for (const state of states) {
        expect(state['last_error']).toEqual(expect.objectContaining({ status: 401, status_text: 'Unauthorized' }))
      }
    } finally {
      vi.mocked(fetch).mockImplementation(originalImpl)
    }
  }, 30_000)
})
