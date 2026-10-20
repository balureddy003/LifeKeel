/**
 * ConnectorSyncEngine tests
 *
 * Covers the generic fetch path:
 *   1. live_base_url is used when credential extra.live_mode is true
 *   2. single-object responses (response_shape: 'object') are wrapped into a
 *      record array
 *   3. api_key auth injects the key as a query parameter when auth.param is
 *      declared
 *   4. non-ok responses (e.g. 429) are recorded as lastFetchError instead of
 *      looking like an empty result set
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ConnectorSyncEngine,
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
    id: 'test-connector',
    name: 'Test Connector',
    provider: 'test-connector',
    category: 'generic',
    status: 'planned',
    version: '1.0.0',
    base_url: 'https://demo.example.com/api',
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
    vi.mocked(safeFetch).mockResolvedValueOnce(mockResponse([{ id: 'rec-1' }]))

    const connector = makeConnector({
      live_base_url: 'https://live.example.com/api',
      resources: [{
        name: 'Records',
        path: '/records',
        method: 'GET',
        response_shape: 'list',
      }],
    })

    const creds: SyncCredentials = {
      tenant_id: 'tenant-1',
      connector_id: 'test-connector',
      auth_type: 'basic',
      username: 'API_KEY',
      password: 'API_SECRET',
      extra: { live_mode: 'true' },
    }

    const records = await sync.fetchAllPages(connector, connector.resources![0]!, creds, 'tenant-1', {})

    expect(records).toHaveLength(1)
    expect(safeFetch).toHaveBeenCalledTimes(1)
    const calledUrl = vi.mocked(safeFetch).mock.calls[0]![0] as string
    expect(calledUrl).toContain('https://live.example.com/api/records')
    expect(calledUrl).not.toContain('demo.example.com')
    const calledHeaders = vi.mocked(safeFetch).mock.calls[0]![1]?.headers as Record<string, string> | undefined
    expect(calledHeaders?.Authorization).toBe('Basic ' + Buffer.from('API_KEY:API_SECRET').toString('base64'))
  })

  it('falls back to base_url when live_mode is not enabled', async () => {
    const { sync } = makeEngine()
    vi.mocked(safeFetch).mockResolvedValueOnce(mockResponse([{ id: 'rec-1' }]))

    const connector = makeConnector({
      live_base_url: 'https://live.example.com/api',
      resources: [{
        name: 'Records',
        path: '/records',
        method: 'GET',
        response_shape: 'list',
      }],
    })

    const creds: SyncCredentials = {
      tenant_id: 'tenant-1',
      connector_id: 'test-connector',
      auth_type: 'basic',
      username: 'API_KEY',
      password: 'API_SECRET',
    }

    await sync.fetchAllPages(connector, connector.resources![0]!, creds, 'tenant-1', {})

    const calledUrl = vi.mocked(safeFetch).mock.calls[0]![0] as string
    expect(calledUrl).toContain('https://demo.example.com/api/records')
  })

  it('wraps a single-object response (response_shape: object) into one record', async () => {
    const { sync } = makeEngine()
    const accountBody = {
      total: 100_000,
      invested: 80_000,
      currencyCode: 'GBP',
    }
    vi.mocked(safeFetch).mockResolvedValueOnce(mockResponse(accountBody))

    const connector = makeConnector({
      resources: [{
        name: 'Account',
        path: '/account/summary',
        method: 'GET',
        response_shape: 'object',
      }],
    })

    const creds: SyncCredentials = {
      tenant_id: 'tenant-1',
      connector_id: 'test-connector',
      auth_type: 'basic',
      username: 'API_KEY',
      password: 'API_SECRET',
    }

    const records = await sync.fetchAllPages(connector, connector.resources![0]!, creds, 'tenant-1', {})

    expect(records).toHaveLength(1)
    expect(records[0]).toEqual(accountBody)
  })

  it('leaves list-shaped responses unchanged', async () => {
    const { sync } = makeEngine()
    const rows = [
      { id: 'rec-1' },
      { id: 'rec-2' },
    ]
    vi.mocked(safeFetch).mockResolvedValueOnce(mockResponse(rows))

    const connector = makeConnector({
      resources: [{
        name: 'Records',
        path: '/records',
        method: 'GET',
        response_shape: 'list',
      }],
    })

    const creds: SyncCredentials = {
      tenant_id: 'tenant-1',
      connector_id: 'test-connector',
      auth_type: 'basic',
      username: 'API_KEY',
      password: 'API_SECRET',
    }

    const records = await sync.fetchAllPages(connector, connector.resources![0]!, creds, 'tenant-1', {})

    expect(records).toHaveLength(2)
  })

  it('injects api_key as a query parameter when auth.param is declared', async () => {
    const { sync } = makeEngine()
    vi.mocked(safeFetch).mockResolvedValueOnce(mockResponse({ results: [{ id: 'rec-1' }] }))

    const connector = makeConnector({
      base_url: 'https://api.example.com',
      auth: { type: 'api_key', param: 'apikey' },
      resources: [{
        name: 'DailyRecords',
        path: '/query',
        method: 'GET',
        response_shape: 'object',
        params: { function: 'LIST' },
      }],
    })

    const creds: SyncCredentials = {
      tenant_id: 'tenant-1',
      connector_id: 'test-connector',
      auth_type: 'api_key',
      api_key: 'TEST_KEY',
    }

    await sync.fetchAllPages(connector, connector.resources![0]!, creds, 'tenant-1', {})

    const calledUrl = vi.mocked(safeFetch).mock.calls[0]![0] as string
    expect(calledUrl).toContain('apikey=TEST_KEY')
  })

  it('records HTTP 429 rate-limit errors instead of treating them as empty data', async () => {
    const { sync } = makeEngine()
    vi.mocked(safeFetch).mockResolvedValue(mockResponse({ Note: 'API call frequency exceeded' }, 429, 'Too Many Requests', { 'retry-after': '0' }))

    const connector = makeConnector({
      base_url: 'https://api.example.com',
      auth: { type: 'api_key', param: 'apikey' },
      resources: [{
        name: 'DailyRecords',
        path: '/query',
        method: 'GET',
        response_shape: 'object',
        params: { function: 'LIST' },
      }],
    })

    const creds: SyncCredentials = {
      tenant_id: 'tenant-1',
      connector_id: 'test-connector',
      auth_type: 'api_key',
      api_key: 'TEST_KEY',
    }

    const records = await sync.fetchAllPages(connector, connector.resources![0]!, creds, 'tenant-1', {})

    expect(records).toHaveLength(0)
    expect((sync as any).lastFetchError).toMatchObject({
      status: 429,
      statusText: expect.any(String),
    })
  })
})
