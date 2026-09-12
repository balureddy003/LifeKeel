import { describe, expect, it } from 'vitest'
import { projectGoal } from '../goal-trajectory.js'

const start = new Date('2026-01-01T00:00:00.000Z')
const target = new Date('2026-04-11T00:00:00.000Z')

describe('projectGoal', () => {
  it('projects an on-pace KPI to its deadline', () => {
    const projection = projectGoal({
      goal_id: 'goal-1',
      start_date: start,
      target_date: target,
      kpis: [{
        id: 'revenue',
        direction: 'increase',
        start_value: 0,
        current: 50,
        target: 100,
      }],
      detector_signals: [{ detector_id: 'revenue-growth', calibrated_hit_rate: 0.8 }],
      approval_rate: 0.8,
      outcome_attribution_score: 0.8,
      evidence_count: 20,
    }, new Date('2026-02-20T00:00:00.000Z'))

    expect(projection.completion_probability).toBeGreaterThan(0.8)
    expect(projection.projected_completion_date?.toISOString()).toBe(target.toISOString())
    expect(projection.driving_signals).toEqual(['revenue-growth'])
  })

  it('widens confidence near deadline when evidence remains insufficient', () => {
    const input = {
      goal_id: 'goal-1',
      start_date: start,
      target_date: target,
      kpis: [{
        id: 'revenue',
        direction: 'increase' as const,
        start_value: 0,
        current: 10,
        target: 100,
      }],
      evidence_count: 0,
    }
    const early = projectGoal(input, new Date('2026-01-11T00:00:00.000Z'))
    const late = projectGoal(input, new Date('2026-04-01T00:00:00.000Z'))
    const width = (projection: typeof early) =>
      projection.confidence_interval[1] - projection.confidence_interval[0]

    expect(width(late)).toBeGreaterThan(width(early))
  })

  it('identifies low-rate detectors as headwinds', () => {
    const projection = projectGoal({
      goal_id: 'goal-1',
      start_date: start,
      target_date: target,
      kpis: [],
      detector_signals: [{ detector_id: 'churn-risk', calibrated_hit_rate: 0.2 }],
    }, new Date('2026-02-20T00:00:00.000Z'))

    expect(projection.headwinds).toEqual(['churn-risk'])
  })
})
