/**
 * Verticals API tests
 *
 * Tests GET /verticals/active, including gap #31's inference fallback:
 * when no explicit active_vertical is set in tenant_settings, the endpoint
 * infers the vertical from the tenant's active detectors (via insights).
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import { registerVerticalRoutes } from '../routes/verticals.js'

const TEST_TENANT = 'tenant-verticals-test'

let mockTenantSettings: Map<string, Record<string, unknown>> = new Map()
let mockInsights: Record<string, unknown>[] = []
let mockConnectorCredentials: Record<string, unknown>[] = []

vi.mock('../db.js', () => ({
  getDb: vi.fn(async () => ({
    collection: vi.fn((name: string) => {
      if (name === 'tenant_settings') {
        return {
          findOne: vi.fn(async (query: { tenant_id?: string }) => {
            if (query?.tenant_id !== TEST_TENANT) return null
            return mockTenantSettings.get('settings') ?? null
          }),
          updateOne: vi.fn(async (query: { tenant_id?: string }, update: { $set: Record<string, unknown> }) => {
            if (query?.tenant_id === TEST_TENANT) {
              mockTenantSettings.set('settings', { ...mockTenantSettings.get('settings'), ...update.$set })
            }
            return { acknowledged: true }
          }),
        }
      }
      if (name === 'insights') {
        return {
          distinct: vi.fn(async (_key: string, query: { tenant_id?: string }) => {
            if (query?.tenant_id !== TEST_TENANT) return []
            return [...new Set(mockInsights.map((i) => i.detector_id))]
          }),
        }
      }
      if (name === 'connector_credentials') {
        return {
          find: vi.fn(() => ({ toArray: vi.fn(async () => mockConnectorCredentials) })),
        }
      }
      return { findOne: vi.fn(async () => null) }
    }),
  })),
}))

async function buildApp() {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TEST_TENANT, user_id: 'user-1' }
  })
  const { getDb } = await import('../db.js')
  const db = await getDb()
  await registerVerticalRoutes(app, db)
  await app.ready()
  return app
}

beforeEach(() => {
  mockTenantSettings = new Map()
  mockInsights = []
  mockConnectorCredentials = []
})

describe('GET /verticals/active', () => {
  it('returns null when no explicit vertical is set and no insights exist', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/verticals/active' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.vertical).toBeNull()
  })

  it('returns the explicit vertical when set in tenant_settings', async () => {
    mockTenantSettings.set('settings', { active_vertical: 'trading-investment' })
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/verticals/active' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.vertical).not.toBeNull()
    expect(body.vertical.id).toBe('trading-investment')
    expect(body.inferred).toBe(false)
  })

  it('gap #31: infers trading-investment from trading detector insights when no explicit vertical is set', async () => {
    mockInsights = [
      { detector_id: 'trading_concentration_risk', tenant_id: TEST_TENANT },
      { detector_id: 'trading_price_drop_alert', tenant_id: TEST_TENANT },
      { detector_id: 'trading_dividend_opportunity', tenant_id: TEST_TENANT },
    ]
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/verticals/active' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.vertical).not.toBeNull()
    expect(body.vertical.id).toBe('trading-investment')
    expect(body.inferred).toBe(true)
  })

  it('gap #31: explicit vertical takes precedence over inferred', async () => {
    mockTenantSettings.set('settings', { active_vertical: 'smb-operations' })
    mockInsights = [
      { detector_id: 'trading_concentration_risk', tenant_id: TEST_TENANT },
    ]
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/verticals/active' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.vertical).not.toBeNull()
    expect(body.vertical.id).toBe('smb-operations')
    expect(body.inferred).toBe(false)
  })

  it('gap #31: returns null when insights exist but no detector matches any vertical', async () => {
    mockInsights = [
      { detector_id: 'unknown_custom_detector', tenant_id: TEST_TENANT },
    ]
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/verticals/active' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.vertical).toBeNull()
  })

  it('kpi vocabulary: shows only universal terms when the tenant has no connector connected', async () => {
    mockTenantSettings.set('settings', { active_vertical: 'trading-investment' })
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/verticals/active' })
    const body = JSON.parse(res.body)
    expect(body.vertical.kpi_vocabulary).not.toContain('ISA allowance used')
    expect(body.vertical.kpi_vocabulary).not.toContain('ELSS invested (§80C)')
    expect(body.vertical.kpi_vocabulary).toContain('Dividend yield')
  })

  it('kpi vocabulary: appends GB terms when the tenant has connected trading-212', async () => {
    mockTenantSettings.set('settings', { active_vertical: 'trading-investment' })
    mockConnectorCredentials = [{ tenant_id: TEST_TENANT, connector_id: 'trading-212' }]
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/verticals/active' })
    const body = JSON.parse(res.body)
    expect(body.vertical.kpi_vocabulary).toContain('ISA allowance used')
    expect(body.vertical.kpi_vocabulary).not.toContain('ELSS invested (§80C)')
  })

  it('kpi vocabulary: appends IN terms when the tenant has connected zerodha', async () => {
    mockTenantSettings.set('settings', { active_vertical: 'trading-investment' })
    mockConnectorCredentials = [{ tenant_id: TEST_TENANT, connector_id: 'zerodha' }]
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/verticals/active' })
    const body = JSON.parse(res.body)
    expect(body.vertical.kpi_vocabulary).toContain('ELSS invested (§80C)')
    expect(body.vertical.kpi_vocabulary).toContain('SIP completion')
    expect(body.vertical.kpi_vocabulary).not.toContain('ISA allowance used')
  })
})
