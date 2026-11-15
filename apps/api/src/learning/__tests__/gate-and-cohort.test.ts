/**
 * Cross-tenant learning is gated off (intent 96, CLAUDE.md rule 3). The gate fails closed, and a cohort
 * is only ever shown as counts, above a minimum size, with small cells suppressed.
 */
import { describe, expect, it } from 'vitest'
import { learningGate } from '../gate.js'
import { aggregateCohort, bandOf, MIN_COHORT } from '../cohort.js'

describe('learningGate', () => {
  it('is closed by default', () => {
    expect(learningGate({}).open).toBe(false)
  })

  it('stays closed when the flag is on but no privacy review is recorded', () => {
    const g = learningGate({ LIFEKEEL_CROSS_TENANT_LEARNING: 'true' })
    expect(g.open).toBe(false)
    expect(g.reason).toMatch(/privacy review/)
  })

  it('stays closed for a blank or placeholder review reference', () => {
    expect(
      learningGate({ LIFEKEEL_CROSS_TENANT_LEARNING: 'true', LEARNING_PRIVACY_REVIEW_REF: '  ' })
        .open,
    ).toBe(false)
  })

  it('opens only with the flag and a recorded review reference', () => {
    const g = learningGate({
      LIFEKEEL_CROSS_TENANT_LEARNING: 'true',
      LEARNING_PRIVACY_REVIEW_REF: 'PRIV-2026-14',
    })
    expect(g.open).toBe(true)
  })

  it('a review reference without the flag does not open it', () => {
    expect(learningGate({ LEARNING_PRIVACY_REVIEW_REF: 'PRIV-2026-14' }).open).toBe(false)
  })
})

describe('bandOf', () => {
  it('buckets runway months into coarse bands, and open-ended into the top band', () => {
    expect(bandOf(0)).toBe('0-3')
    expect(bandOf(2)).toBe('0-3')
    expect(bandOf(3)).toBe('3-6')
    expect(bandOf(11)).toBe('6-12')
    expect(bandOf(12)).toBe('12+')
    expect(bandOf(null)).toBe('12+')
  })
})

describe('aggregateCohort', () => {
  const many = (n: number, band: '0-3' | '3-6' | '6-12' | '12+') => Array(n).fill(band)

  it('gives nothing below the minimum cohort size', () => {
    expect(aggregateCohort(many(MIN_COHORT - 1, '3-6'))).toBeNull()
  })

  it('gives counts per band at or above the minimum, and no identifiers', () => {
    const r = aggregateCohort([...many(10, '3-6'), ...many(10, '6-12')])
    expect(r).toEqual({ total: 20, bands: { '0-3': null, '3-6': 10, '6-12': 10, '12+': null } })
  })

  it('suppresses cells smaller than 5 so a small group cannot be picked out', () => {
    const r = aggregateCohort([...many(16, '3-6'), ...many(4, '0-3')])
    expect(r?.bands['0-3']).toBeNull()
    expect(r?.bands['3-6']).toBe(16)
  })

  it('honours a larger minimum', () => {
    expect(aggregateCohort(many(20, '3-6'), 50)).toBeNull()
  })
})
