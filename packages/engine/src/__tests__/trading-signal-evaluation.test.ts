/**
 * Trading signal end-to-end evaluation
 *
 * Loads the real trading detector YAMLs and evaluates them against synthetic
 * Trading 212 signals that carry the derived fields the sync job is expected
 * to produce. This proves the signal → detector → insight pipeline for the
 * compound-growth use case.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'
import { Engine } from '../engine.js'
import { DEFAULT_GOAL_KPI_TARGETS } from '@kairos/platform'

const TRADING_DETECTORS_DIR = path.join(__dirname, '..', '..', '..', '..', 'detectors', 'trading')

describe('Trading signal evaluation end-to-end', () => {
  let engine: Engine

  beforeAll(async () => {
    engine = new Engine({ detectorsDir: TRADING_DETECTORS_DIR })
    await engine.load()
  })

  it('fires concentration risk and price drop when a position is over-weight and down', async () => {
    const result = await engine.evaluate({
      event_type: 'portfolio_position',
      tenant_id: 'tenant-trading-test',
      event_id: 'pos-1',
      data: {
        ticker: 'AAPL',
        quantity: 15,
        avg_price: 20_000,
        current_price: 18_500,
        currency: 'USD',
        account_type: 'isa',
        position_value_minor: 277_500,
        portfolio_weight_pct: 15.5,
        dividend_yield_pct: 0.6,
      },
      goal_kpi_targets: DEFAULT_GOAL_KPI_TARGETS,
    })

    const detectorIds = result.insights.map(i => i.detector_id)
    expect(detectorIds).toContain('trading_concentration_risk')
    expect(detectorIds).toContain('trading_price_drop_alert')

    const concentration = result.insights.find(i => i.detector_id === 'trading_concentration_risk')
    expect(concentration?.rule_id).toBe('position_over_threshold_with_loss')
    expect(concentration?.estimated_impact_high).toBeGreaterThan(0)
  })

  it('fires dividend opportunity when an enriched position has a high yield', async () => {
    const result = await engine.evaluate({
      event_type: 'portfolio_position',
      tenant_id: 'tenant-trading-test',
      event_id: 'pos-2',
      data: {
        ticker: 'VOD',
        quantity: 100,
        avg_price: 1_000,
        current_price: 1_050,
        currency: 'GBP',
        account_type: 'isa',
        position_value_minor: 105_000,
        portfolio_weight_pct: 8.0,
        dividend_yield_pct: 3.5,
        days_to_ex_dividend: 5,
      },
    })

    const dividend = result.insights.find(i => i.detector_id === 'trading_dividend_opportunity')
    expect(dividend).toBeDefined()
    expect(dividend?.rule_id).toBe('attractive_dividend_yield')
    expect(dividend?.estimated_impact_high).toBeGreaterThan(0)
  })

  it('does not fire dividend opportunity when yield is below threshold', async () => {
    const result = await engine.evaluate({
      event_type: 'portfolio_position',
      tenant_id: 'tenant-trading-test',
      event_id: 'pos-3',
      data: {
        ticker: 'TSLA',
        quantity: 10,
        avg_price: 20_000,
        current_price: 19_000,
        currency: 'USD',
        account_type: 'invest',
        position_value_minor: 190_000,
        portfolio_weight_pct: 9.0,
        dividend_yield_pct: 1.0,
      },
    })

    const dividend = result.insights.find(i => i.detector_id === 'trading_dividend_opportunity')
    expect(dividend).toBeUndefined()
  })

  it('fires rebalance suggestion when idle cash exceeds 5% of portfolio', async () => {
    const result = await engine.evaluate({
      event_type: 'portfolio_summary',
      tenant_id: 'tenant-trading-test',
      event_id: 'summary-1',
      data: {
        cash: 12_000_00,
        invested_value: 80_000_00,
        total_value: 100_000_00,
        currency: 'GBP',
        account_type: 'isa',
        cash_pct: 12,
      },
      goal_kpi_targets: DEFAULT_GOAL_KPI_TARGETS,
    })

    const rebalance = result.insights.find(i => i.detector_id === 'trading_rebalance_suggestion')
    expect(rebalance).toBeDefined()
    expect(rebalance?.rule_id).toBe('excess_cash')
  })

  it('does not fire rebalance suggestion when cash is within threshold', async () => {
    const result = await engine.evaluate({
      event_type: 'portfolio_summary',
      tenant_id: 'tenant-trading-test',
      event_id: 'summary-2',
      data: {
        cash: 4_000_00,
        invested_value: 96_000_00,
        total_value: 100_000_00,
        currency: 'GBP',
        account_type: 'isa',
        cash_pct: 4,
      },
      goal_kpi_targets: DEFAULT_GOAL_KPI_TARGETS,
    })

    const rebalance = result.insights.find(i => i.detector_id === 'trading_rebalance_suggestion')
    expect(rebalance).toBeUndefined()
  })
})
