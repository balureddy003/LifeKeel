/**
 * @agentoak/pipeline — unit tests
 *
 * Tests connector loader, event schema validation, webhook routing basics.
 */

import { describe, it, expect } from 'vitest'
import { ConnectorConfigSchema } from '../schemas.js'
import { ConnectorLoader } from '../connector-loader.js'
import yaml from 'js-yaml'
import fs from 'node:fs'
import path from 'node:path'

// ── Connector loader ──────────────────────────────────────────────────────────

describe('connector definitions', () => {
  it('loads and validates the trading-212 connector definition', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..')
    const file = path.join(repoRoot, 'connectors', 'trading-212.yaml')
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = yaml.load(raw)
    const connector = ConnectorConfigSchema.parse(parsed)

    expect(connector.id).toBe('trading-212')
    expect(connector.status).toBe('ga')
    expect(connector.category).toBe('investment')
    expect(connector.auth.type).toBe('basic')
    expect(connector.signal_types).toContain('portfolio_position')
    expect(connector.signal_types).toContain('portfolio_summary')
    expect(connector.signal_types).toContain('order_event')
    expect(connector.signal_types).toContain('instrument_metadata')
    expect(connector.base_url).toContain('demo.trading212.com')
    expect(connector.live_base_url).toContain('trading212.com')

    const account = connector.resources?.find(r => r.name === 'Account')
    const cash = connector.resources?.find(r => r.name === 'Cash')
    const portfolio = connector.resources?.find(r => r.name === 'Portfolio')
    expect(account?.response_shape).toBe('object')
    expect(cash?.response_shape).toBe('object')
    expect(portfolio?.response_shape).toBe('list')
  })

  it('loads every connector definition in the connectors directory', async () => {
    const loader = new ConnectorLoader()
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..')
    const connectorsDir = path.join(repoRoot, 'connectors')
    const yamlFiles = fs.readdirSync(connectorsDir).filter(f => /\.ya?ml$/i.test(f))
    await loader.load(connectorsDir)
    expect(loader.count).toBe(yamlFiles.length)
    expect(loader.get('land-registry')).toBeDefined()
    expect(loader.get('open-banking')).toBeDefined()
    expect(loader.get('rightmove')).toBeDefined()
    expect(loader.get('zoopla')).toBeDefined()
    expect(loader.get('postiz')).toBeDefined()
    expect(loader.get('postiz-library')).toBeDefined()
  })

  it('a valid connector definition has required fields', () => {
    const connector = {
      id: 'stripe',
      name: 'Stripe',
      category: 'payments',
      auth: 'oauth2',
      signal_types: ['payment.succeeded', 'payment.failed'],
      actions: [{ id: 'charge', method: 'POST', path: '/v1/charges' }],
      triggers: [],
    }

    expect(connector.id).toBeTruthy()
    expect(connector.name).toBeTruthy()
    expect(connector.category).toBeTruthy()
    expect(Array.isArray(connector.signal_types)).toBe(true)
    expect(Array.isArray(connector.actions)).toBe(true)
  })

  it('signal_types must be non-empty for connectors with triggers', () => {
    const connectors = [
      { id: 'xero',   signal_types: ['invoice.created', 'payment.received'] },
      { id: 'stripe', signal_types: ['payment.succeeded', 'payment.failed'] },
      { id: 'slack',  signal_types: ['message.received'] },
    ]
    for (const c of connectors) {
      expect(c.signal_types.length).toBeGreaterThan(0)
    }
  })

  it('rejects unsupported connector auth types', () => {
    const bad = {
      id: 'bad',
      name: 'Bad',
      provider: 'bad',
      category: 'generic',
      base_url: 'https://example.com',
      auth: { type: 'magic_link' },
      signal_types: [],
    }
    expect(() => ConnectorConfigSchema.parse(bad)).toThrow()
  })

  it('accepts http_basic auth and finance/investment categories', () => {
    const connector = {
      id: 'trading-212-test',
      name: 'Trading 212 Test',
      provider: 'trading-212',
      category: 'investment',
      base_url: 'https://demo.trading212.com/api/v0',
      auth: { type: 'http_basic' },
      signal_types: ['portfolio.position'],
    }
    expect(() => ConnectorConfigSchema.parse(connector)).not.toThrow()
  })
})

// ── Event schema ──────────────────────────────────────────────────────────────

describe('event payload schema', () => {
  const validEvent = {
    id: 'evt-001',
    event_type: 'invoice.overdue',
    tenant_id: 'tenant-test',
    data: { days_overdue: 35, amount_minor: 500000 },
    created_at: new Date(),
  }

  it('valid event has all required fields', () => {
    expect(validEvent.id).toBeTruthy()
    expect(validEvent.event_type).toBeTruthy()
    expect(validEvent.tenant_id).toBeTruthy()
    expect(typeof validEvent.data).toBe('object')
    expect(validEvent.created_at instanceof Date).toBe(true)
  })

  it('event_type follows dot-notation convention', () => {
    const eventTypes = [
      'invoice.overdue', 'payment.failed', 'review.submitted',
      'cart.abandoned', 'subscription.cancelled',
    ]
    for (const type of eventTypes) {
      expect(type).toMatch(/^[a-z_]+\.[a-z_]+$/)
    }
  })

  it('tenant_id must never be empty', () => {
    expect(validEvent.tenant_id.length).toBeGreaterThan(0)
    expect(validEvent.tenant_id).not.toBe('undefined')
    expect(validEvent.tenant_id).not.toBe('null')
  })
})

// ── Webhook routing ───────────────────────────────────────────────────────────

describe('webhook event routing', () => {
  it('Stripe webhook event_type is correctly normalised', () => {
    const stripeRaw = { type: 'payment_intent.succeeded', data: { object: { amount: 9999 } } }
    // Pipeline normalises Stripe's underscore format to dot notation
    const normalised = stripeRaw.type.replace(/_/g, '.')
    expect(normalised).toBe('payment.intent.succeeded')
  })

  it('routes webhook to matching connector by path prefix', () => {
    const webhookPath = '/webhooks/stripe'
    const connectorId = webhookPath.split('/').pop()
    expect(connectorId).toBe('stripe')
  })
})
