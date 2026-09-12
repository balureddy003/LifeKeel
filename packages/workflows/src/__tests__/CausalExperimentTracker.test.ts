import { describe, expect, it } from 'vitest'
import { estimateWithinTenantAttribution, type CausalExperiment } from '../attribution/CausalExperimentTracker.js'

const approvedAt = new Date('2026-02-01T00:00:00.000Z')
const experiment: CausalExperiment = {
  experiment_id: 'experiment-1',
  tenant_id: 'tenant-1',
  goal_id: 'goal-1',
  move_id: 'receipt-1',
  approved_at: approvedAt,
  kpi_snapshot_at_approval: { revenue: 130 },
  observation_windows: [7, 14, 30],
  synthetic_control_source: 'within_tenant_pre_action',
  created_at: approvedAt,
  group: 'treatment',
  randomization_method: 'random',
  stratification_factors: null,
}

describe('within-tenant goal attribution', () => {
  it('subtracts the pre-action trend from observed change', () => {
    const result = estimateWithinTenantAttribution(experiment, 'revenue', [
      { metric: 'revenue', value: 100, recorded_at: new Date('2026-01-01T00:00:00.000Z') },
      { metric: 'revenue', value: 130, recorded_at: new Date('2026-01-31T00:00:00.000Z') },
      { metric: 'revenue', value: 160, recorded_at: new Date('2026-02-08T00:00:00.000Z') },
    ], 7, new Date('2026-02-08T00:00:00.000Z'))

    expect(result.observed_delta).toBe(30)
    expect(result.counterfactual_delta).toBe(7)
    expect(result.attributed_delta).toBe(23)
    expect(result.attribution_confidence).toBeGreaterThan(0)
  })

  it('reports zero confidence with less than 14 days of pre-action history', () => {
    const result = estimateWithinTenantAttribution(experiment, 'revenue', [
      { metric: 'revenue', value: 120, recorded_at: new Date('2026-01-25T00:00:00.000Z') },
      { metric: 'revenue', value: 130, recorded_at: new Date('2026-01-31T00:00:00.000Z') },
    ], 7, new Date('2026-02-08T00:00:00.000Z'))

    expect(result.insufficient_history).toBe(true)
    expect(result.attribution_confidence).toBe(0)
  })
})
