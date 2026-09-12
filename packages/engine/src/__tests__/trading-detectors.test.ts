/**
 * Trading & Investment detector rule tests
 *
 * Validates the four trading detector YAMLs by evaluating their filtrex rule
 * conditions and numeric impact expressions against representative signals.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { evaluate, evaluateNumeric } from '../evaluator.js'
import { DEFAULT_GOAL_KPI_TARGETS } from '@agentoak/platform'

const DETECTORS_DIR = path.join(__dirname, '..', '..', '..', '..', 'detectors', 'trading')

const FILENAME_MAP: Record<string, string> = {
  trading_concentration_risk: 'concentration-risk.yaml',
  trading_price_drop_alert: 'price-drop-alert.yaml',
  trading_dividend_opportunity: 'dividend-opportunity.yaml',
  trading_rebalance_suggestion: 'rebalance-suggestion.yaml',
}

async function loadDetector(id: string): Promise<{ rules: Array<{ id: string; condition: string; impact_low: string | number; impact_high: string | number; reasoning_template: string }> }> {
  const filename = FILENAME_MAP[id]
  if (!filename) throw new Error(`Unknown trading detector: ${id}`)
  const content = await fs.readFile(path.join(DETECTORS_DIR, filename), 'utf-8')
  return yaml.load(content) as any
}

/**
 * concentration-risk and rebalance-suggestion conditions reference
 * context.goal_kpi_targets (see buildGoalKpiTargets in @agentoak/platform) —
 * defaults to the same DEFAULT_GOAL_KPI_TARGETS production always injects,
 * override per-test to verify goal-specific thresholds actually take effect.
 */
function evaluateRule(
  condition: string,
  data: Record<string, unknown>,
  goalKpiTargets: Record<string, number> = DEFAULT_GOAL_KPI_TARGETS,
): boolean {
  return evaluate(condition, { data, context: { goal_kpi_targets: goalKpiTargets } })
}

describe('Trading & Investment detectors', () => {
  describe('trading_concentration_risk', () => {
    it('flags a position above 10% of portfolio', async () => {
      const detector = await loadDetector('trading_concentration_risk')
      // The detector has two rules: one for losing positions, one for profitable.
      // A position above the cap should fire at least one rule regardless of P&L.
      const data = {
        ticker: 'AAPL',
        portfolio_weight_pct: 15,
        position_value_minor: 150_000_00,
        current_price: 90,
        avg_price: 100,
      }
      const fired = detector.rules.some((r) => evaluateRule(r.condition, data))
      expect(fired).toBe(true)
    })

    it('ignores a position below 10% of portfolio', async () => {
      const detector = await loadDetector('trading_concentration_risk')
      const data = {
        ticker: 'AAPL',
        portfolio_weight_pct: 5,
        position_value_minor: 50_000_00,
        current_price: 90,
        avg_price: 100,
      }
      const fired = detector.rules.some((r) => evaluateRule(r.condition, data))
      expect(fired).toBe(false)
    })

    it('uses the tenant goal\'s concentration cap instead of the 10% default', async () => {
      const detector = await loadDetector('trading_concentration_risk')
      const data = { ticker: 'AAPL', portfolio_weight_pct: 12.4, position_value_minor: 124_000_00, current_price: 90, avg_price: 100 }
      // Default goal (10% cap): a 12.4% position fires at least one rule.
      expect(detector.rules.some((r) => evaluateRule(r.condition, data))).toBe(true)
      // A goal that raises the cap to 15%: the same 12.4% position no longer fires.
      expect(detector.rules.some((r) => evaluateRule(r.condition, data, { portfolio_concentration_max_pct: 15 }))).toBe(false)
    })
  })

  describe('trading_price_drop_alert', () => {
    it('fires when current price drops 5% below average price', async () => {
      const detector = await loadDetector('trading_price_drop_alert')
      // The detector has two rules: severe (15%+) and moderate (threshold to 15%).
      // A 5.5% drop should fire the moderate rule.
      const data = {
        ticker: 'TSLA',
        current_price: 189,
        avg_price: 200,
        quantity: 10,
      }
      const fired = detector.rules.some((r) => evaluateRule(r.condition, data))
      expect(fired).toBe(true)
    })

    it('does not fire when price is within 5% of average', async () => {
      const detector = await loadDetector('trading_price_drop_alert')
      const data = {
        ticker: 'TSLA',
        current_price: 198,
        avg_price: 200,
        quantity: 10,
      }
      const fired = detector.rules.some((r) => evaluateRule(r.condition, data))
      expect(fired).toBe(false)
    })
  })

  describe('trading_dividend_opportunity', () => {
    it('fires when dividend yield exceeds 2% within the actionable window', async () => {
      const detector = await loadDetector('trading_dividend_opportunity')
      const rule = detector.rules[0]!
      const fired = evaluateRule(rule.condition, {
        ticker: 'VOD',
        dividend_yield_pct: 3.5,
        position_value_minor: 100_000_00,
        days_to_ex_dividend: 5,
      })
      expect(fired).toBe(true)
    })

    it('does not fire when dividend yield is below 2%', async () => {
      const detector = await loadDetector('trading_dividend_opportunity')
      const rule = detector.rules[0]!
      const fired = evaluateRule(rule.condition, {
        ticker: 'VOD',
        dividend_yield_pct: 1.0,
        position_value_minor: 100_000_00,
        days_to_ex_dividend: 5,
      })
      expect(fired).toBe(false)
    })
  })

  describe('trading_rebalance_suggestion', () => {
    it('fires when cash exceeds 5% of total portfolio value', async () => {
      const detector = await loadDetector('trading_rebalance_suggestion')
      const rule = detector.rules[0]!
      const fired = evaluateRule(rule.condition, {
        cash: 12_000_00,
        total_value: 100_000_00,
        cash_pct: 12,
      })
      expect(fired).toBe(true)
    })

    it('does not fire when cash is 5% or less of portfolio value', async () => {
      const detector = await loadDetector('trading_rebalance_suggestion')
      const rule = detector.rules[0]!
      const fired = evaluateRule(rule.condition, {
        cash: 4_000_00,
        total_value: 100_000_00,
        cash_pct: 4,
      })
      expect(fired).toBe(false)
    })

    it('uses the tenant goal\'s cash allocation cap instead of the 5% default', async () => {
      const detector = await loadDetector('trading_rebalance_suggestion')
      const rule = detector.rules[0]!
      const data = { cash: 8_000_00, total_value: 100_000_00, cash_pct: 8 }
      // Default goal (5% cap): 8% cash fires.
      expect(evaluateRule(rule.condition, data)).toBe(true)
      // A goal that raises the cap to 10%: the same 8% cash no longer fires.
      expect(evaluateRule(rule.condition, data, { cash_allocation_max_pct: 10 })).toBe(false)
    })
  })
})
