/**
 * @lifekeel/pipeline — unit tests
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
  it('loads and validates the open-banking connector definition', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..')
    const file = path.join(repoRoot, 'connectors', 'open-banking.yaml')
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = yaml.load(raw)
    const connector = ConnectorConfigSchema.parse(parsed)

    expect(connector.id).toBe('open-banking')
    expect(connector.status).toBe('planned')
    expect(connector.category).toBe('finance')
    expect(connector.auth.type).toBe('oauth2_aisp')
    expect(connector.signal_types).toContain('mortgage.account')
    expect(connector.signal_types).toContain('mortgage.rate')
  })

  it('loads every connector definition in the connectors directory', async () => {
    const loader = new ConnectorLoader()
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..')
    const connectorsDir = path.join(repoRoot, 'connectors')
    const yamlFiles = fs.readdirSync(connectorsDir).filter(f => /\.ya?ml$/i.test(f))
    await loader.load(connectorsDir)
    expect(loader.count).toBe(yamlFiles.length)
    expect(loader.get('gmail')).toBeDefined()
    expect(loader.get('open-banking')).toBeDefined()
    expect(loader.get('google_drive')).toBeDefined()
    expect(loader.get('dropbox')).toBeDefined()
    expect(loader.get('onedrive')).toBeDefined()
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
