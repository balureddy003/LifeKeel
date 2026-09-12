/**
 * ScoreCalibrator — buildCalibrationPairs outcome mapping tests.
 *
 * Verifies the fix for the outcome mapping bug:
 *   Before: only 'converted' → 1, everything else → 0
 *   After:  'approved', 'auto_approved', 'converted' → 1
 *           'dismissed', 'auto_dismissed' → 0
 *           'policy_blocked', 'budget_blocked' → excluded (not user decisions)
 */

import { describe, it, expect } from 'vitest'
import { buildCalibrationPairs } from '../calibration.js'

describe('buildCalibrationPairs outcome mapping', () => {
  it('maps approved → 1', () => {
    const pairs = buildCalibrationPairs([
      { outcome: 'approved', metadata: { insight_score: 0.8 } },
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.outcome).toBe(1)
  })

  it('maps auto_approved → 1 (positive signal)', () => {
    const pairs = buildCalibrationPairs([
      { outcome: 'auto_approved', metadata: { insight_score: 0.7 } },
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.outcome).toBe(1)
  })

  it('maps converted → 1 (backward compatible)', () => {
    const pairs = buildCalibrationPairs([
      { outcome: 'converted', metadata: { insight_score: 0.9 } },
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.outcome).toBe(1)
  })

  it('maps dismissed → 0', () => {
    const pairs = buildCalibrationPairs([
      { outcome: 'dismissed', metadata: { insight_score: 0.6 } },
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.outcome).toBe(0)
  })

  it('maps auto_dismissed → 0', () => {
    const pairs = buildCalibrationPairs([
      { outcome: 'auto_dismissed', metadata: { insight_score: 0.5 } },
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]!.outcome).toBe(0)
  })

  it('excludes policy_blocked (not a user decision)', () => {
    const pairs = buildCalibrationPairs([
      { outcome: 'policy_blocked', metadata: { insight_score: 0.8 } },
    ])
    expect(pairs).toHaveLength(0)
  })

  it('excludes budget_blocked (not a user decision)', () => {
    const pairs = buildCalibrationPairs([
      { outcome: 'budget_blocked', metadata: { insight_score: 0.8 } },
    ])
    expect(pairs).toHaveLength(0)
  })

  it('skips receipts without insight_score in metadata', () => {
    const pairs = buildCalibrationPairs([
      { outcome: 'approved', metadata: {} },
      { outcome: 'approved' },
      { outcome: 'approved', metadata: { insight_score: 'not a number' } as unknown as Record<string, unknown> },
    ])
    expect(pairs).toHaveLength(0)
  })

  it('handles a mixed batch correctly', () => {
    const pairs = buildCalibrationPairs([
      { outcome: 'approved', metadata: { insight_score: 0.9 } },
      { outcome: 'auto_approved', metadata: { insight_score: 0.7 } },
      { outcome: 'dismissed', metadata: { insight_score: 0.6 } },
      { outcome: 'auto_dismissed', metadata: { insight_score: 0.5 } },
      { outcome: 'policy_blocked', metadata: { insight_score: 0.8 } },
      { outcome: 'budget_blocked', metadata: { insight_score: 0.4 } },
      { outcome: 'converted', metadata: { insight_score: 0.95 } },
    ])
    expect(pairs).toHaveLength(5) // 7 - 2 blocked
    expect(pairs.map(p => p.outcome)).toEqual([1, 1, 0, 0, 1])
    expect(pairs.map(p => p.raw_score)).toEqual([0.9, 0.7, 0.6, 0.5, 0.95])
  })
})
