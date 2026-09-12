/**
 * Regression test for the repo-root category-table.yaml and the loader that
 * reads it (Engine.loadCategoryTableFromDisk). Before this file existed,
 * every trading insight silently fell through to category: 'experience'
 * (the heuristic fallback's default), which entity-model's riskTierFor()
 * maps to riskTier: 'low' — so a severe price drop rendered with the same
 * "Low risk" badge as a routine dividend opportunity. This loads the real
 * detectors dir and the real category-table.yaml at the repo root, exactly
 * as apps/api/src/server.ts does, so a regression here means a real insight
 * is misclassified, not just a fixture.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { Engine } from '../engine.js'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')

describe('category-table.yaml', () => {
  it('classifies a concentration-risk insight as risk, not the experience fallback', async () => {
    const engine = new Engine({
      detectorsDir: path.join(ROOT, 'detectors'),
      strictValidation: false,
    })
    await engine.load()

    const result = await engine.evaluate({
      tenant_id: 'test-tenant-category-table',
      event_type: 'portfolio_position',
      event_id: 'test-event-category-table-001',
      data: {
        ticker: 'AAPL',
        portfolio_weight_pct: 15.2,
        position_value_minor: 5_000_000,
        excess_shares: 25,
        current_price: 150.0,
        avg_price: 170.0, // below avg -> position_over_threshold_with_loss
        quantity: 270,
        current_price_gbp: '150.00',
        avg_price_gbp: '170.00',
      },
      goal_kpi_targets: {
        portfolio_concentration_max_pct: 10,
      },
    })

    const insight = result.insights.find((i) => i.detector_id === 'trading_concentration_risk')
    expect(insight, 'concentration-risk detector should have fired').toBeDefined()
    expect(insight!.category).toBe('risk')
  })
})
