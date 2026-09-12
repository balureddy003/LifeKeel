import { describe, expect, it } from 'vitest'
import { GoalDetectorActivationMap } from '../index.js'

const detector = {
  detector_id: 'invoice-risk',
  name: 'Overdue invoice risk',
  evidence_types: ['invoice.overdue'],
  industries: ['*'],
}

describe('GoalDetectorActivationMap', () => {
  const map = new GoalDetectorActivationMap()

  it('activates exact evidence matches', () => {
    const result = map.score({
      goal_id: 'goal-1',
      name: 'Recover invoices',
      evidence_types: ['invoice.overdue'],
    }, detector)
    expect(result).toMatchObject({ active: true, relevance_score: 1, source: 'exact' })
  })

  it('respects explicit detector pins', () => {
    const result = map.score({
      goal_id: 'goal-1',
      name: 'Unrelated goal',
      evidence_types: [],
      detector_ids: ['invoice-risk'],
    }, detector)
    expect(result).toMatchObject({ active: true, source: 'manual' })
  })

  it('leaves unrelated detectors inactive', () => {
    const result = map.score({
      goal_id: 'goal-1',
      name: 'Improve hiring',
      evidence_types: ['candidate.interviewed'],
    }, detector)
    expect(result.active).toBe(false)
  })
})
