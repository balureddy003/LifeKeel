/**
 * D4 integration test: verifies that a trading detector event produces
 * an insight with fully populated Decision Contract fields (alternatives,
 * risk_assessment, exit_criteria) — not just schema validation, but the
 * actual end-to-end path from event → detector → insight.
 */

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { Engine } from '../engine.js'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')

describe('D4: Decision Contract fields in live trading insight', () => {
  it('concentration-risk detector produces insight with alternatives, risk, and exit criteria', async () => {
    const engine = new Engine({
      detectorsDir: path.join(ROOT, 'detectors'),
      strictValidation: false,
    })
    await engine.load()

    const result = await engine.evaluate({
      tenant_id: 'test-tenant-d4',
      event_type: 'portfolio_position',
      event_id: 'test-event-d4-001',
      data: {
        ticker: 'AAPL',
        portfolio_weight_pct: 15.2,   // above the 10% default cap
        position_value_minor: 5000000, // £50,000
        excess_shares: 25,
        current_price: 185.50,
        avg_price: 170.00,
        quantity: 270,
        current_price_gbp: '185.50',
        avg_price_gbp: '170.00',
      },
      goal_kpi_targets: {
        portfolio_concentration_max_pct: 10, // triggers the condition
      },
    })

    // Find the concentration-risk insight
    const insight = result.insights.find(
      i => i.detector_id === 'trading_concentration_risk',
    )

    expect(insight, 'concentration-risk detector should have fired').toBeDefined()
    if (!insight) return

    // ── Decision Contract fields ──────────────────────────────────────────
    // These are the fields D4 is about — they must be present and populated
    // with real interpolated content, not empty templates.

    // 1. Alternatives — at least 2, each with a label and why_not
    expect(insight.alternatives, 'insight must have alternatives').toBeDefined()
    expect(insight.alternatives!.length, 'at least 2 alternatives').toBeGreaterThanOrEqual(2)

    for (const alt of insight.alternatives!) {
      expect(alt.label, 'alternative label must be non-empty').toBeTruthy()
      expect(alt.label!.length, 'label must be interpolated (not a template)').toBeGreaterThan(5)
      // why_not should be present and interpolated
      if (alt.why_not) {
        expect(alt.why_not.length, 'why_not must be non-empty').toBeGreaterThan(10)
        // Should not contain unresolved template vars
        expect(alt.why_not!.includes('{{'), 'why_not should be interpolated').toBe(false)
      }
    }

    // Verify the first alternative mentions the ticker (interpolation worked)
    const firstAlt = insight.alternatives![0]!
    expect(
      firstAlt.label.includes('AAPL') || firstAlt.why_not?.includes('AAPL'),
      'alternatives should reference the ticker (interpolation)',
    ).toBe(true)

    // 2. Risk assessment — present, interpolated, non-empty
    expect(insight.risk_assessment, 'insight must have risk_assessment').toBeDefined()
    expect(insight.risk_assessment!.length, 'risk_assessment must be non-empty').toBeGreaterThan(20)
    expect(insight.risk_assessment!.includes('{{'), 'risk_assessment should be interpolated').toBe(false)
    expect(
      insight.risk_assessment!.includes('AAPL'),
      'risk_assessment should reference the ticker',
    ).toBe(true)

    // 3. Exit criteria — present, interpolated, non-empty
    expect(insight.exit_criteria, 'insight must have exit_criteria').toBeDefined()
    expect(insight.exit_criteria!.length, 'exit_criteria must be non-empty').toBeGreaterThan(20)
    expect(insight.exit_criteria!.includes('{{'), 'exit_criteria should be interpolated').toBe(false)
  })

  it('price-drop-alert detector produces insight with Decision Contract fields', async () => {
    const engine = new Engine({
      detectorsDir: path.join(ROOT, 'detectors'),
      strictValidation: false,
    })
    await engine.load()

    const result = await engine.evaluate({
      tenant_id: 'test-tenant-d4',
      event_type: 'portfolio_position',
      event_id: 'test-event-d4-002',
      data: {
        ticker: 'MSFT',
        current_price: 380.00,
        avg_price: 420.00,       // 9.5% drop — above 5% threshold
        quantity: 50,
        current_price_gbp: '300.00',
        avg_price_gbp: '332.00',
        drop_pct: 9.5,
      },
      goal_kpi_targets: {
        price_drop_alert_threshold_pct: 5,
      },
    })

    const insight = result.insights.find(
      i => i.detector_id === 'trading_price_drop_alert',
    )

    expect(insight, 'price-drop-alert detector should have fired').toBeDefined()
    if (!insight) return

    expect(insight.alternatives, 'must have alternatives').toBeDefined()
    expect(insight.alternatives!.length, 'at least 2 alternatives').toBeGreaterThanOrEqual(2)
    expect(insight.risk_assessment, 'must have risk_assessment').toBeDefined()
    expect(insight.exit_criteria, 'must have exit_criteria').toBeDefined()

    // Verify interpolation
    expect(insight.risk_assessment!.includes('MSFT'), 'risk should mention ticker').toBe(true)
    expect(insight.exit_criteria!.includes('{{'), 'exit should be interpolated').toBe(false)
  })
})
