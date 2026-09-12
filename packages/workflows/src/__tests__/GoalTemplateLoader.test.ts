import { describe, it, expect } from 'vitest'
import { repoRoot } from '@agentoak/platform'
import { loadGoalTemplates } from '../loader/GoalTemplateLoader.js'

describe('GoalTemplateLoader', () => {
  const templates = loadGoalTemplates(repoRoot())

  it('loads all shipped goal templates', () => {
    expect(templates.length).toBeGreaterThanOrEqual(2)
    const ids = templates.map(t => t.id)
    expect(ids).toContain('diversified-portfolio-yield')
    expect(ids).toContain('compound-growth-trading')
  })

  it('loads the compound-growth-trading template with aggressive but guarded KPIs', () => {
    const tpl = templates.find(t => t.id === 'compound-growth-trading')
    expect(tpl).toBeDefined()
    expect(tpl!.required_connectors).toContain('trading-212')
    expect(tpl!.spec.kpis).toHaveLength(4)

    const valueKpi = tpl!.spec.kpis.find(k => k.metric === 'portfolio_value_minor')
    expect(valueKpi).toBeDefined()
    expect(valueKpi!.target).toBe(446_000) // £4,460 in minor units
    expect(valueKpi!.start_value).toBe(50_000) // £500 in minor units

    const returnKpi = tpl!.spec.kpis.find(k => k.metric === 'monthly_return_pct')
    expect(returnKpi).toBeDefined()
    expect(returnKpi!.target).toBe(20)
    expect(returnKpi!.field).toBe('data.monthly_return_pct')

    expect(tpl!.spec.warnings.length).toBeGreaterThan(0)
    expect(tpl!.spec.warnings.some(w => w.includes('20%'))).toBe(true)
  })

  it('loads the diversified-portfolio-yield template with consistent trading field names', () => {
    const tpl = templates.find(t => t.id === 'diversified-portfolio-yield')
    expect(tpl).toBeDefined()

    const concentrationKpi = tpl!.spec.kpis.find(k => k.metric === 'portfolio_concentration_max_pct')
    expect(concentrationKpi).toBeDefined()
    expect(concentrationKpi!.field).toBe('data.portfolio_weight_pct')

    const isaKpi = tpl!.spec.kpis.find(k => k.metric === 'isa_allowance_used_pct')
    expect(isaKpi).toBeDefined()
    expect(isaKpi!.signal_types).toContain('portfolio_summary')
  })

  it('loads all three trading-investment goal templates with required connector and detectors', () => {
    const tradingIds = ['diversified-portfolio-yield', 'compound-growth-trading', 'realistic-compound-growth-trading']
    const detectorIds = [
      'trading_concentration_risk',
      'trading_price_drop_alert',
      'trading_dividend_opportunity',
      'trading_rebalance_suggestion',
    ]

    for (const id of tradingIds) {
      const tpl = templates.find(t => t.id === id)
      expect(tpl).toBeDefined()
      expect(tpl!.required_connectors).toContain('trading-212')
      const templateDetectorIds = tpl!.spec.detectors.map(d => d.id)
      expect(templateDetectorIds.length).toBeGreaterThanOrEqual(3)
      for (const detectorId of detectorIds) {
        if (id === 'compound-growth-trading' && detectorId === 'trading_dividend_opportunity') continue
        expect(templateDetectorIds).toContain(detectorId)
      }
    }
  })
})
