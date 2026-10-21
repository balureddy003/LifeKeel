import { describe, expect, it } from 'vitest'
import { firstVisitSubline } from '../firstVisitCopy'

// UAT P8: the dashboard greeted a first-time visitor "Everything looks
// stable." while the score ring below showed readiness 0.
describe('firstVisitSubline', () => {
  it('claims stability only when the on-track condition holds', () => {
    expect(firstVisitSubline({ score: 80, openInsightCount: 0 })).toBe('Everything looks stable.')
  })

  it('does not claim stability at readiness 0', () => {
    const line = firstVisitSubline({ score: 0, openInsightCount: 0 })
    expect(line).not.toContain('stable')
  })

  it('does not claim stability with open insights', () => {
    const line = firstVisitSubline({ score: 85, openInsightCount: 2 })
    expect(line).not.toContain('stable')
  })

  it('does not claim stability below the on-track threshold', () => {
    const line = firstVisitSubline({ score: 69, openInsightCount: 0 })
    expect(line).not.toContain('stable')
  })
})
