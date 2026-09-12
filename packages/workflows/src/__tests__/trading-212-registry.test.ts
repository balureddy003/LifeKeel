/**
 * Trading 212 connector registry tests
 *
 * Ensures the Trading 212 entry in ConnectorRegistry stays aligned with the
 * connector YAML definition and the Studio UI category labels.
 */

import { describe, it, expect } from 'vitest'
import { connectorRegistry } from '../connectors/ConnectorRegistry.js'

describe('Trading 212 connector registry', () => {
  it('includes the trading-212 connector', () => {
    const connector = connectorRegistry.get('trading-212')
    expect(connector).toBeDefined()
    expect(connector!.name).toBe('Trading 212')
    expect(connector!.category).toBe('investment')
    expect(connector!.auth).toBe('basic')
  })

  it('uses the demo environment to match the connector YAML', () => {
    const connector = connectorRegistry.get('trading-212')
    expect(connector!.base_url).toBe('https://demo.trading212.com/api/v0')
  })

  it('exposes portfolio and account actions', () => {
    const connector = connectorRegistry.get('trading-212')
    const actions = connector!.actions.map((a) => a.id)
    expect(actions).toContain('get_portfolio')
    expect(actions).toContain('get_account')
  })

  it('appears in the investment category summary', () => {
    const summary = connectorRegistry.summary()
    const trading = summary.find((c) => c.id === 'trading-212')
    expect(trading).toBeDefined()
    expect(trading!.category).toBe('investment')
  })
})

describe('Alpha Vantage connector registry', () => {
  it('includes the alpha-vantage connector', () => {
    const connector = connectorRegistry.get('alpha-vantage')
    expect(connector).toBeDefined()
    expect(connector!.name).toBe('Alpha Vantage')
    expect(connector!.category).toBe('investment')
    expect(connector!.auth).toBe('api_key')
  })

  it('exposes a market_price trigger', () => {
    const connector = connectorRegistry.get('alpha-vantage')
    const trigger = connector!.triggers.find((t) => t.id === 'daily_price')
    expect(trigger).toBeDefined()
    expect(trigger!.event_type).toBe('market_price')
  })

  it('appears in the investment category summary', () => {
    const summary = connectorRegistry.summary()
    const av = summary.find((c) => c.id === 'alpha-vantage')
    expect(av).toBeDefined()
    expect(av!.category).toBe('investment')
  })
})
