import { describe, it, expect } from 'vitest'
import {
  reconcileKpiContributions,
  inferKpiSourceType,
  DEFAULT_KPI_SOURCE_TYPE_PRIORITIES,
  DEFAULT_KPI_DISCREPANCY_THRESHOLD_PCT,
  type KpiSourceSettings,
} from '../goals/kpi-source-reconciliation.js'
import {
  buildGoalIdentityKey,
  GOAL_CREATION_DEBOUNCE_MS,
} from '../goals/goal-idempotency.js'
import type { KpiSourceContribution } from '@kairos/specifications'

function makeContribution(overrides: Partial<KpiSourceContribution>): KpiSourceContribution {
  return {
    tenant_id: 't1',
    goal_id: 'g1',
    metric: 'm1',
    source_id: 'manual',
    source_type: 'manual',
    value: 100,
    period_start: '2025-01-01',
    period_end: '2025-01-01',
    observed_at: '2025-01-01T12:00:00Z',
    ...overrides,
  }
}

const defaultSettings: KpiSourceSettings = {
  source_priorities: {},
  source_type_priorities: { ...DEFAULT_KPI_SOURCE_TYPE_PRIORITIES },
  discrepancy_threshold_pct: DEFAULT_KPI_DISCREPANCY_THRESHOLD_PCT,
  metric_units: {},
}

describe('inferKpiSourceType', () => {
  it('classifies manual sources', () => {
    expect(inferKpiSourceType('manual')).toBe('manual')
    expect(inferKpiSourceType('manual:studio')).toBe('manual')
  })

  it('classifies compute_engine as connector', () => {
    expect(inferKpiSourceType('compute_engine')).toBe('connector')
  })

  it('classifies computed: prefix as computed', () => {
    expect(inferKpiSourceType('computed:forecast')).toBe('computed')
  })

  it('defaults unknown sources to connector', () => {
    expect(inferKpiSourceType('trading-212')).toBe('connector')
  })
})

describe('reconcileKpiContributions', () => {
  it('selects the highest-priority source by source_type', () => {
    const contributions = [
      makeContribution({ source_id: 'manual:studio', source_type: 'manual', value: 90 }),
      makeContribution({ source_id: 'signals:xero', source_type: 'connector', value: 95 }),
    ]
    const result = reconcileKpiContributions('m1', contributions, defaultSettings)
    expect(result).not.toBeNull()
    expect(result!.value).toBe(95)
    expect(result!.selected_source_id).toBe('signals:xero')
    expect(result!.selected_source_type).toBe('connector')
  })

  it('breaks ties by most recent observed_at', () => {
    const contributions = [
      makeContribution({ source_id: 'a', source_type: 'connector', value: 100, observed_at: '2025-01-01T10:00:00Z' }),
      makeContribution({ source_id: 'b', source_type: 'connector', value: 105, observed_at: '2025-01-01T12:00:00Z' }),
    ]
    const result = reconcileKpiContributions('m1', contributions, defaultSettings)
    expect(result!.selected_source_id).toBe('b')
    expect(result!.value).toBe(105)
  })

  it('respects tenant source_priorities override over default type priorities', () => {
    const settings: KpiSourceSettings = {
      ...defaultSettings,
      source_priorities: { 'manual:studio': 500 },
    }
    const contributions = [
      makeContribution({ source_id: 'manual:studio', source_type: 'manual', value: 90 }),
      makeContribution({ source_id: 'signals:xero', source_type: 'connector', value: 95 }),
    ]
    const result = reconcileKpiContributions('m1', contributions, settings)
    expect(result!.selected_source_id).toBe('manual:studio')
    expect(result!.value).toBe(90)
  })

  it('flags a discrepancy when overlapping sources disagree beyond threshold', () => {
    const contributions = [
      makeContribution({ source_id: 'signals:xero', source_type: 'connector', value: 100, period_start: '2025-01-01', period_end: '2025-01-01' }),
      makeContribution({ source_id: 'manual:studio', source_type: 'manual', value: 50, period_start: '2025-01-01', period_end: '2025-01-01' }),
    ]
    const result = reconcileKpiContributions('m1', contributions, defaultSettings)
    expect(result!.discrepancy.detected).toBe(true)
    expect(result!.discrepancy.conflicting_source_ids).toContain('manual:studio')
    expect(result!.discrepancy.max_delta_pct).toBeGreaterThan(10)
  })

  it('does not flag a discrepancy when sources agree within threshold', () => {
    const contributions = [
      makeContribution({ source_id: 'signals:xero', source_type: 'connector', value: 100, period_start: '2025-01-01', period_end: '2025-01-01' }),
      makeContribution({ source_id: 'manual:studio', source_type: 'manual', value: 98, period_start: '2025-01-01', period_end: '2025-01-01' }),
    ]
    const result = reconcileKpiContributions('m1', contributions, defaultSettings)
    expect(result!.discrepancy.detected).toBe(false)
    expect(result!.discrepancy.conflicting_source_ids).toHaveLength(0)
  })

  it('does not flag a discrepancy for non-overlapping periods', () => {
    const contributions = [
      makeContribution({ source_id: 'signals:xero', source_type: 'connector', value: 100, period_start: '2025-01-01', period_end: '2025-01-01' }),
      makeContribution({ source_id: 'manual:studio', source_type: 'manual', value: 50, period_start: '2025-01-02', period_end: '2025-01-02' }),
    ]
    const result = reconcileKpiContributions('m1', contributions, defaultSettings)
    expect(result!.discrepancy.detected).toBe(false)
  })

  it('returns null for empty contributions', () => {
    expect(reconcileKpiContributions('m1', [], defaultSettings)).toBeNull()
  })

  it('preserves all contributions in the result for drill-down', () => {
    const contributions = [
      makeContribution({ source_id: 'a', source_type: 'connector', value: 100 }),
      makeContribution({ source_id: 'b', source_type: 'manual', value: 90 }),
      makeContribution({ source_id: 'c', source_type: 'computed', value: 95 }),
    ]
    const result = reconcileKpiContributions('m1', contributions, defaultSettings)
    expect(result!.contributions).toHaveLength(3)
    // Ranked by priority: connector > computed > manual
    expect(result!.contributions[0]!.source_id).toBe('a')
    expect(result!.contributions[1]!.source_id).toBe('c')
    expect(result!.contributions[2]!.source_id).toBe('b')
  })
})

describe('buildGoalIdentityKey', () => {
  it('normalizes template_id and vertical to lowercase', () => {
    expect(buildGoalIdentityKey('DivPort', 'Trading')).toBe('divport::trading')
  })

  it('trims whitespace', () => {
    expect(buildGoalIdentityKey('  template  ', '  vertical  ')).toBe('template::vertical')
  })
})

describe('GOAL_CREATION_DEBOUNCE_MS', () => {
  it('is 5 minutes', () => {
    expect(GOAL_CREATION_DEBOUNCE_MS).toBe(5 * 60 * 1000)
  })
})

describe('unit normalization', () => {
  it('normalizes pence to GBP before comparing', () => {
    const settings: KpiSourceSettings = {
      ...defaultSettings,
      metric_units: { revenue: 'GBP' },
    }
    const contributions = [
      makeContribution({ source_id: 'signals:xero', source_type: 'connector', value: 100, unit: 'GBP' }),
      makeContribution({ source_id: 'manual:studio', source_type: 'manual', value: 10000, unit: 'pence' }),
    ]
    const result = reconcileKpiContributions('revenue', contributions, settings)
    expect(result).not.toBeNull()
    // Both normalize to 100 GBP — no discrepancy despite raw values differing 100x
    expect(result!.discrepancy.detected).toBe(false)
  })

  it('normalizes fraction to pct before comparing', () => {
    const settings: KpiSourceSettings = {
      ...defaultSettings,
      metric_units: { conversion_rate: 'pct' },
    }
    const contributions = [
      makeContribution({ source_id: 'signals:ga', source_type: 'connector', value: 5.0, unit: 'pct' }),
      makeContribution({ source_id: 'manual:studio', source_type: 'manual', value: 0.05, unit: 'fraction' }),
    ]
    const result = reconcileKpiContributions('conversion_rate', contributions, settings)
    expect(result).not.toBeNull()
    // 5.0 pct == 0.05 fraction → no discrepancy
    expect(result!.discrepancy.detected).toBe(false)
  })

  it('still flags real discrepancies after normalization', () => {
    const settings: KpiSourceSettings = {
      ...defaultSettings,
      metric_units: { revenue: 'GBP' },
    }
    const contributions = [
      makeContribution({ source_id: 'signals:xero', source_type: 'connector', value: 100, unit: 'GBP' }),
      makeContribution({ source_id: 'manual:studio', source_type: 'manual', value: 5000, unit: 'pence' }),
    ]
    const result = reconcileKpiContributions('revenue', contributions, settings)
    expect(result).not.toBeNull()
    // 100 GBP vs 50 GBP (5000 pence) → 50% discrepancy, above 10% threshold
    expect(result!.discrepancy.detected).toBe(true)
  })

  it('passes through unknown units without crashing', () => {
    const settings: KpiSourceSettings = {
      ...defaultSettings,
      metric_units: { revenue: 'GBP' },
    }
    const contributions = [
      makeContribution({ source_id: 'signals:xero', source_type: 'connector', value: 100, unit: 'GBP' }),
      makeContribution({ source_id: 'manual:studio', source_type: 'manual', value: 200, unit: 'custom_unit' }),
    ]
    const result = reconcileKpiContributions('revenue', contributions, settings)
    expect(result).not.toBeNull()
    // Unknown unit → no conversion → values differ → discrepancy flagged (safe default)
    expect(result!.discrepancy.detected).toBe(true)
  })
})
