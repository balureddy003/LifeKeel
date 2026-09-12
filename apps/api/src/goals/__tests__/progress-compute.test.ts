/**
 * Tests for the shared goal-progress computation module.
 *
 * Covers the four Part A fixes from GOAL_PROGRESS_AND_UX_GAPS.md:
 * A1: minor_currency formatting
 * A2: decrease-direction KPI starting below target (no false "achieved")
 * A3: suggested_new_target clamping
 * A4: consolidation (both backend paths use the same function)
 */
import { describe, expect, it } from 'vitest'
import {
  computeKpiProgress,
  computeOverallStatus,
  formatValueForDisplay,
  displayUnitLabel,
  computeSuggestedNewTarget,
  type KpiForProgress,
} from '../progress-compute.js'

const NOW = new Date('2025-01-15T12:00:00Z')
const START_DATE = new Date('2025-01-01T12:00:00Z')
const TIMELINE_DAYS = 90

function makeKpi(overrides: Partial<KpiForProgress> = {}): KpiForProgress {
  return {
    metric: 'test_metric',
    label: 'Test Metric',
    unit: 'count',
    target: 100,
    current: 50,
    start_value: 0,
    direction: 'increase',
    ...overrides,
  }
}

// Mock Date.now for deterministic tests
beforeAll(() => {
  vi.stubGlobal('Date', class extends Date {
    constructor(date?: string | number | Date) {
      if (date) super(date)
      else super(NOW)
    }
    static now() { return NOW.getTime() }
  })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

import { beforeAll, afterAll, vi } from 'vitest'

describe('computeKpiProgress', () => {
  it('computes correct progress for an increase-direction KPI at 50%', () => {
    const result = computeKpiProgress(makeKpi({ current: 50, target: 100, start_value: 0 }), START_DATE, TIMELINE_DAYS)
    expect(result.pct_complete).toBe(0.5)
    expect(result.status).not.toBe('achieved')
  })

  it('computes 100% when an increase-direction KPI reaches its target', () => {
    const result = computeKpiProgress(makeKpi({ current: 100, target: 100, start_value: 0 }), START_DATE, TIMELINE_DAYS)
    expect(result.pct_complete).toBe(1)
    expect(result.status).toBe('achieved')
  })

  it('gap A2: does NOT force 100% for a decrease-direction KPI starting below target', () => {
    // max_drawdown_pct: start_value=0, target=20, direction=decrease
    // Old formula: totalNeeded = 0 - 20 = -20 <= 0 → pctComplete = 1 (wrong!)
    // New formula: totalNeeded < 0, current (5) > target (20) is false for
    // decrease direction (need current <= target to be achieved), so
    // hasCrossedTarget = false → pctComplete = 0
    const result = computeKpiProgress(
      makeKpi({
        metric: 'max_drawdown_pct',
        unit: 'percent',
        target: 20,
        start_value: 0,
        current: 5,
        direction: 'decrease',
      }),
      START_DATE,
      TIMELINE_DAYS,
    )
    expect(result.pct_complete).toBe(0)
    expect(result.status).not.toBe('achieved')
  })

  it('gap A2: does force 100% for a decrease-direction KPI that has improved past its target', () => {
    // max_drawdown_pct: start_value=15, target=20, direction=decrease
    // Current=10 means drawdown decreased from 15 to 10 (good direction).
    // totalNeeded = 15 - 20 = -5 <= 0, but delta = 15 - 10 = 5 > 0,
    // so the KPI genuinely improved — pctComplete = 1.
    const result = computeKpiProgress(
      makeKpi({
        metric: 'max_drawdown_pct',
        unit: 'percent',
        target: 20,
        start_value: 15,
        current: 10,
        direction: 'decrease',
      }),
      START_DATE,
      TIMELINE_DAYS,
    )
    expect(result.pct_complete).toBe(1)
    expect(result.status).toBe('achieved')
  })

  it('gap A2: decrease-direction KPI at start_value=target (totalNeeded=0) is not auto-achieved', () => {
    // start_value=20, target=20, direction=decrease, current=25
    // totalNeeded = 20 - 20 = 0 <= 0, hasCrossedTarget = 25 <= 20 = false
    const result = computeKpiProgress(
      makeKpi({
        target: 20,
        start_value: 20,
        current: 25,
        direction: 'decrease',
      }),
      START_DATE,
      TIMELINE_DAYS,
    )
    expect(result.pct_complete).toBe(0)
    expect(result.status).not.toBe('achieved')
  })

  it('computes correct progress for a decrease-direction KPI moving toward target', () => {
    // start_value=100, target=50, direction=decrease, current=75
    // delta = 100 - 75 = 25, totalNeeded = 100 - 50 = 50, pctComplete = 25/50 = 0.5
    const result = computeKpiProgress(
      makeKpi({
        target: 50,
        start_value: 100,
        current: 75,
        direction: 'decrease',
      }),
      START_DATE,
      TIMELINE_DAYS,
    )
    expect(result.pct_complete).toBe(0.5)
  })

  describe('gap A5: percent-unit KPIs are gauges, not accumulators', () => {
    it('does not mark a low-but-nonzero increase-direction rate as "ahead" just because it projects to finish within the timeline', () => {
      // monthly_return_pct on a real account: current=2.96, target=20, 14
      // days elapsed of a 90-day timeline. Old formula pace-projected this
      // single low reading as "ahead" (216-day projection < 90-day timeline
      // in the real case that motivated this fix); it should instead read
      // as behind, since 2.96/20 = 14.8% of target is nowhere close.
      const result = computeKpiProgress(
        makeKpi({ metric: 'monthly_return_pct', unit: 'percent', target: 20, start_value: 0, current: 2.96, direction: 'increase' }),
        START_DATE,
        TIMELINE_DAYS,
      )
      expect(result.status).not.toBe('ahead')
      expect(result.status).toBe('behind')
    })

    it('marks an increase-direction rate close to target as on_track', () => {
      const result = computeKpiProgress(
        makeKpi({ metric: 'cash_deployed_pct', unit: 'percent', target: 95, start_value: 0, current: 87.11, direction: 'increase' }),
        START_DATE,
        TIMELINE_DAYS,
      )
      expect(result.status).toBe('on_track')
    })

    it('does not mark a decrease-direction ceiling sitting safely under its limit as "stalled"', () => {
      // max_drawdown_pct: current=1.25 well under a 20 cap, not moving
      // (pace_per_day <= 0). Old formula: not-moving == stalled, regardless
      // of how far under the ceiling the KPI actually sits. A ceiling
      // that isn't being approached needs no motion to be healthy.
      const result = computeKpiProgress(
        makeKpi({ metric: 'max_drawdown_pct', unit: 'percent', target: 20, start_value: 0, current: 1.25, direction: 'decrease' }),
        START_DATE,
        TIMELINE_DAYS,
      )
      expect(result.status).not.toBe('stalled')
      expect(result.status).toBe('on_track')
    })

    it('marks a decrease-direction ceiling that has been breached as behind, not on_track', () => {
      const result = computeKpiProgress(
        makeKpi({ metric: 'portfolio_concentration_max_pct', unit: '%', target: 10, start_value: 0, current: 17.14, direction: 'decrease' }),
        START_DATE,
        TIMELINE_DAYS,
      )
      expect(result.status).toBe('behind')
    })

    it('does not apply gauge status to non-percent KPIs (portfolio value keeps pace-based projection)', () => {
      const result = computeKpiProgress(
        makeKpi({ metric: 'portfolio_value_minor', unit: 'minor_currency', target: 446000, start_value: 0, current: 200000, direction: 'increase' }),
        START_DATE,
        TIMELINE_DAYS,
      )
      // 200000/446000 over 14 of 90 days projects well ahead of schedule —
      // this KPI is a real accumulating total, so the pace model is valid.
      expect(result.status).toBe('ahead')
    })
  })
})

describe('computeOverallStatus', () => {
  it('returns achieved when all KPIs are achieved', () => {
    const kpis = [
      { status: 'achieved' } as never,
      { status: 'achieved' } as never,
    ]
    expect(computeOverallStatus(kpis)).toBe('achieved')
  })

  it('returns stalled when any KPI is stalled', () => {
    const kpis = [
      { status: 'on_track' } as never,
      { status: 'stalled' } as never,
    ]
    expect(computeOverallStatus(kpis)).toBe('stalled')
  })

  it('returns behind when any KPI is behind (and none stalled)', () => {
    const kpis = [
      { status: 'on_track' } as never,
      { status: 'behind' } as never,
    ]
    expect(computeOverallStatus(kpis)).toBe('behind')
  })

  it('returns ahead when all KPIs are ahead or achieved', () => {
    const kpis = [
      { status: 'ahead' } as never,
      { status: 'achieved' } as never,
    ]
    expect(computeOverallStatus(kpis)).toBe('ahead')
  })

  it('returns on_track otherwise', () => {
    const kpis = [
      { status: 'on_track' } as never,
      { status: 'ahead' } as never,
    ]
    expect(computeOverallStatus(kpis)).toBe('on_track')
  })
})

describe('formatValueForDisplay (gap A1)', () => {
  it('formats minor_currency as £ with 2 decimal places', () => {
    expect(formatValueForDisplay(535200, 'minor_currency')).toBe('£5352.00')
  })

  it('formats minor currency units as £ with 2 decimal places', () => {
    expect(formatValueForDisplay(446000, 'minor currency units')).toBe('£4460.00')
  })

  it('passes through non-currency values as-is', () => {
    expect(formatValueForDisplay(95, 'percent')).toBe('95%')
    expect(formatValueForDisplay(5000, 'followers')).toBe('5000')
  })
})

describe('displayUnitLabel (gap A1)', () => {
  it('returns empty string for minor_currency (already in £ format)', () => {
    expect(displayUnitLabel('minor_currency')).toBe('')
  })

  it('returns empty string for "minor currency units"', () => {
    expect(displayUnitLabel('minor currency units')).toBe('')
  })

  it('returns empty string for percent (already formatted into value)', () => {
    expect(displayUnitLabel('percent')).toBe('')
    expect(displayUnitLabel('followers')).toBe('followers')
  })
})

describe('computeSuggestedNewTarget (gap A3)', () => {
  it('applies 1.2× multiplier for increase direction', () => {
    expect(computeSuggestedNewTarget(100, 'increase', 'count')).toBe(120)
  })

  it('applies 0.8× multiplier for decrease direction', () => {
    expect(computeSuggestedNewTarget(100, 'decrease', 'count')).toBe(80)
  })

  it('clamps percent-unit targets to 100', () => {
    // 95 * 1.2 = 114 → clamped to 100
    expect(computeSuggestedNewTarget(95, 'increase', 'percent')).toBe(100)
  })

  it('clamps ratio-unit targets to 1', () => {
    // 0.85 * 1.2 = 1.02 → clamped to 1
    expect(computeSuggestedNewTarget(0.85, 'increase', 'ratio')).toBe(1)
  })

  it('does not clamp minor_currency (money is unbounded)', () => {
    expect(computeSuggestedNewTarget(446000, 'increase', 'minor_currency')).toBe(535200)
  })

  it('does not clamp generic unit types', () => {
    expect(computeSuggestedNewTarget(5000, 'increase', 'followers')).toBe(6000)
  })
})
