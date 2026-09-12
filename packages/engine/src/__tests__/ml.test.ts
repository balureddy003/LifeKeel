/**
 * @agentoak/engine — lightweight ML layer unit tests
 *
 * Covers: NoveltyTracker, ChangePointDetector, FeatureHashScorer,
 *         ExponentialSmoother, fitIsotonic/applyIsotonic, ScoreCalibrator (Platt + isotonic).
 *
 * All tests use in-memory stubs — no MongoDB required.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { fitIsotonic, applyIsotonic } from '../calibration.js'
import type { CalibrationPair } from '../calibration.js'
import { NoveltyTracker } from '../novelty-tracker.js'
import { ChangePointDetector } from '../change-point.js'
import { FeatureHashScorer } from '../feature-hash-scorer.js'
import { ExponentialSmoother } from '../adaptive-thresholds.js'

// ── Minimal MongoDB collection stub ──────────────────────────────────────────

function makeDb() {
  const store = new Map<string, unknown>()
  const col = {
    createIndex: () => Promise.resolve(),
    replaceOne: (_filter: unknown, doc: unknown) => {
      const key = JSON.stringify(_filter)
      store.set(key, doc)
      return Promise.resolve()
    },
    findOne: (_filter: unknown) => {
      const key = JSON.stringify(_filter)
      return Promise.resolve(store.get(key) ?? null)
    },
    find: () => ({ toArray: () => Promise.resolve([...store.values()]) }),
    distinct: () => Promise.resolve([]),
  }
  return { collection: () => col, store }
}

// ── Isotonic regression ───────────────────────────────────────────────────────

describe('fitIsotonic / applyIsotonic', () => {
  it('returns empty breakpoints for empty input', () => {
    expect(fitIsotonic([])).toEqual([])
  })

  it('single pair produces one breakpoint', () => {
    const bp = fitIsotonic([{ raw_score: 0.8, outcome: 1 }])
    expect(bp).toHaveLength(1)
    expect(bp[0]!.calibrated).toBe(1)
  })

  it('monotone output — calibrated values are non-decreasing', () => {
    const pairs: CalibrationPair[] = [
      { raw_score: 0.2, outcome: 0 },
      { raw_score: 0.4, outcome: 0 },
      { raw_score: 0.6, outcome: 1 },
      { raw_score: 0.8, outcome: 1 },
      { raw_score: 0.9, outcome: 1 },
    ]
    const bp = fitIsotonic(pairs)
    for (let i = 1; i < bp.length; i++) {
      expect(bp[i]!.calibrated).toBeGreaterThanOrEqual(bp[i - 1]!.calibrated)
    }
  })

  it('corrects overconfident scores downward', () => {
    // Model always says 0.95 but only right 60% of time
    const pairs: CalibrationPair[] = Array.from({ length: 10 }, (_, i) => ({
      raw_score: 0.95,
      outcome: i < 6 ? 1 : 0,
    }))
    const bp = fitIsotonic(pairs)
    const calibrated = applyIsotonic(bp, 0.95)
    expect(calibrated).toBeLessThan(0.95)
    expect(calibrated).toBeCloseTo(0.6, 1)
  })

  it('applyIsotonic clamps below lowest breakpoint', () => {
    const bp = fitIsotonic([
      { raw_score: 0.5, outcome: 0 },
      { raw_score: 0.9, outcome: 1 },
    ])
    expect(applyIsotonic(bp, 0.1)).toBe(bp[0]!.calibrated)
  })

  it('applyIsotonic clamps above highest breakpoint', () => {
    const bp = fitIsotonic([
      { raw_score: 0.5, outcome: 0 },
      { raw_score: 0.9, outcome: 1 },
    ])
    expect(applyIsotonic(bp, 0.99)).toBe(bp[bp.length - 1]!.calibrated)
  })
})

// ── ExponentialSmoother ───────────────────────────────────────────────────────

describe('ExponentialSmoother', () => {
  it('initialises estimate to first observed value', async () => {
    const { collection } = makeDb()
    const smoother = new ExponentialSmoother({ collection } as never)
    const state = await smoother.observe('t1', 'invoice.overdue', 'amount_minor', 50000)
    expect(state.estimate).toBe(50000)
    expect(state.sample_count).toBe(1)
  })

  it('smoothes toward new values with α=0.3', async () => {
    const { collection } = makeDb()
    const smoother = new ExponentialSmoother({ collection } as never)
    await smoother.observe('t1', 'sig', 'f', 100)
    const s2 = await smoother.observe('t1', 'sig', 'f', 200)
    // S[2] = 0.3×200 + 0.7×100 = 130
    expect(s2.estimate).toBe(130)
  })

  it('increments sample_count on each observation', async () => {
    const { collection } = makeDb()
    const smoother = new ExponentialSmoother({ collection } as never)
    await smoother.observe('t1', 's', 'f', 1)
    await smoother.observe('t1', 's', 'f', 2)
    const s = await smoother.observe('t1', 's', 'f', 3)
    expect(s.sample_count).toBe(3)
  })

  it('toThreshold upper_2sigma is always above mean', async () => {
    const { collection } = makeDb()
    const smoother = new ExponentialSmoother({ collection } as never)
    await smoother.observe('t1', 's', 'amount', 10000)
    await smoother.observe('t1', 's', 'amount', 20000)
    await smoother.observe('t1', 's', 'amount', 50000)
    const state = smoother.getState('t1', 's', 'amount')!
    const threshold = smoother.toThreshold(state)
    expect(threshold.upper_2sigma).toBeGreaterThan(threshold.mean)
  })

  it('does not replay on second load — returns cached state', async () => {
    const { collection } = makeDb()
    const smoother = new ExponentialSmoother({ collection } as never)
    await smoother.observe('t1', 's', 'f', 100)
    const s1 = smoother.getState('t1', 's', 'f')!
    // Load again — should hit cache, not DB
    await smoother.load('t1', 's', 'f')
    const s2 = smoother.getState('t1', 's', 'f')!
    expect(s2.sample_count).toBe(s1.sample_count)
  })
})

// ── NoveltyTracker ────────────────────────────────────────────────────────────

describe('NoveltyTracker', () => {
  let tracker: NoveltyTracker

  beforeEach(() => {
    const { collection } = makeDb()
    tracker = new NoveltyTracker({ collection } as never)
  })

  it('returns novelty=1.0 for a never-seen value', () => {
    const result = tracker.score('tenant_a', 'data.amount_minor', '999999')
    expect(result.novelty).toBe(1.0)
    expect(result.frequency).toBe(0)
  })

  it('novelty decreases after repeated observations', () => {
    for (let i = 0; i < 20; i++) tracker.observe('t1', 'field', '500')
    const result = tracker.score('t1', 'field', '500')
    // novelty = 1 - log2(20+1)/10 ≈ 0.56 — meaningfully below 1.0
    expect(result.novelty).toBeLessThan(1.0)
    expect(result.frequency).toBeGreaterThanOrEqual(20)
  })

  it('different tenants have isolated sketches', () => {
    tracker.observe('tenant_a', 'amount', '1000')
    tracker.observe('tenant_a', 'amount', '1000')
    const a = tracker.score('tenant_a', 'amount', '1000')
    const b = tracker.score('tenant_b', 'amount', '1000')
    expect(a.frequency).toBeGreaterThan(b.frequency)
    expect(b.novelty).toBe(1.0)
  })

  it('buildContext scores then observes — current event does not inflate its own novelty', () => {
    const ctx = tracker.buildContext('t1', { amount_minor: 500 }, ['data.amount_minor'])
    // First time — must be novel before observing
    expect(ctx.scores['data.amount_minor']).toBe(1.0)
    // Second call — now it's been seen once
    const ctx2 = tracker.buildContext('t1', { amount_minor: 500 }, ['data.amount_minor'])
    expect(ctx2.scores['data.amount_minor']!).toBeLessThan(1.0)
  })

  it('has_rare_value is true when any field novelty > 0.8', () => {
    const ctx = tracker.buildContext('t1', { x: 42 }, ['data.x'])
    expect(ctx.has_rare_value).toBe(true)
  })
})

// ── ChangePointDetector ───────────────────────────────────────────────────────

describe('ChangePointDetector', () => {
  let detector: ChangePointDetector

  beforeEach(() => {
    const { collection } = makeDb()
    detector = new ChangePointDetector({ collection } as never)
  })

  it('does not alarm before min_observations', async () => {
    const result = await detector.update('t1', 'revenue', 999999, { min_observations: 10 })
    expect(result.alarm).toBe(false)
  })

  it('accumulates cusum_up on sustained increases', async () => {
    for (let i = 0; i < 15; i++) {
      await detector.update('t1', 'rev', 1000)
    }
    // Inject a large spike
    const result = await detector.update('t1', 'rev', 9999)
    expect(result.cusum_up).toBeGreaterThan(0)
  })

  it('alarms on a clear downward trend', async () => {
    // Establish baseline
    for (let i = 0; i < 15; i++) await detector.update('t1', 'metric', 1000)
    // Now feed consistently low values to drive cusum_down past threshold
    let alarmFired = false
    for (let i = 0; i < 30; i++) {
      const r = await detector.update('t1', 'metric', 1, { threshold: 2.0, direction: 'down', min_observations: 15 })
      if (r.alarm) { alarmFired = true; break }
    }
    expect(alarmFired).toBe(true)
  })

  it('resets accumulator after alarm', async () => {
    for (let i = 0; i < 15; i++) await detector.update('t1', 'm', 1000)
    let alarmed = false
    for (let i = 0; i < 50; i++) {
      const r = await detector.update('t1', 'm', 1, { threshold: 2.0, direction: 'down', min_observations: 15 })
      if (r.alarm) { alarmed = true; break }
    }
    expect(alarmed).toBe(true)
    // After alarm, cusum should be reset
    const state = detector.getState('t1', 'm')!
    expect(state.cusum_down).toBe(0)
  })

  it('direction=up does not alarm on drops', async () => {
    for (let i = 0; i < 15; i++) await detector.update('t1', 'm', 1000)
    let alarmFired = false
    for (let i = 0; i < 30; i++) {
      const r = await detector.update('t1', 'm', 1, { threshold: 2.0, direction: 'up', min_observations: 15 })
      if (r.alarm) alarmFired = true
    }
    expect(alarmFired).toBe(false)
  })

  it('isolates state per tenant', async () => {
    for (let i = 0; i < 5; i++) await detector.update('ta', 'f', 100)
    const stateA = detector.getState('ta', 'f')
    const stateB = detector.getState('tb', 'f')
    expect(stateA).not.toBeNull()
    expect(stateB).toBeNull()
  })
})

// ── FeatureHashScorer ─────────────────────────────────────────────────────────

describe('FeatureHashScorer', () => {
  let scorer: FeatureHashScorer

  beforeEach(() => {
    const { collection } = makeDb()
    scorer = new FeatureHashScorer({ collection } as never)
  })

  it('returns score in [0,1] range', async () => {
    const result = await scorer.score('tenant-1', 'det1', { industry: 'retail', amount_minor: 5000 }, {
      features: ['data.industry', 'data.amount_minor'],
    })
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
  })

  it('matched=false when score below min_score', async () => {
    // Fresh model — all weights zero — sigmoid(0)=0.5, below default min_score
    const result = await scorer.score('tenant-1', 'det1', { x: 1 }, {
      features: ['data.x'],
      min_score: 0.9,
    })
    expect(result.matched).toBe(false)
  })

  it('online learning: score increases toward 1 after positive updates', async () => {
    const config = { features: ['data.industry', 'data.amount_minor'], l1_reg: 0 }
    const data = { industry: 'retail', amount_minor: 50000 }

    const before = (await scorer.score('tenant-1', 'det1', data, config)).score

    for (let i = 0; i < 50; i++) {
      await scorer.update('tenant-1', 'det1', data, 1, config, undefined, 0.1)
    }

    const after = (await scorer.score('tenant-1', 'det1', data, config)).score
    expect(after).toBeGreaterThan(before)
  })

  it('online learning: score decreases after negative updates', async () => {
    const config = { features: ['data.kind'], l1_reg: 0 }
    const data = { kind: 'noise' }

    // First push score up
    for (let i = 0; i < 30; i++) await scorer.update('tenant-1', 'det1', data, 1, config, undefined, 0.1)
    const high = (await scorer.score('tenant-1', 'det1', data, config)).score

    // Then push score down
    for (let i = 0; i < 60; i++) await scorer.update('tenant-1', 'det1', data, 0, config, undefined, 0.1)
    const low = (await scorer.score('tenant-1', 'det1', data, config)).score

    expect(low).toBeLessThan(high)
  })

  it('includes bigrams — feature count > unigram count', async () => {
    const result = await scorer.score('tenant-1', 'd', { a: 1, b: 2, c: 3 }, {
      features: ['data.a', 'data.b', 'data.c'],
      use_bigrams: true,
    })
    // 3 unigrams + 3 bigrams = 6
    expect(result.feature_count).toBeGreaterThan(3)
  })

  it('no bigrams when use_bigrams=false', async () => {
    const result = await scorer.score('tenant-1', 'd', { a: 1, b: 2 }, {
      features: ['data.a', 'data.b'],
      use_bigrams: false,
    })
    expect(result.feature_count).toBe(2)
  })

  it('isolates models per tenant — updates for tenant A do not change tenant B score', async () => {
    const config = { features: ['data.x'], l1_reg: 0 }
    const data = { x: 'shared_value' }

    // Tenant A trains the model upward
    for (let i = 0; i < 40; i++) {
      await scorer.update('tenant-a', 'det1', data, 1, config, undefined, 0.1)
    }

    const scoreA = await scorer.score('tenant-a', 'det1', data, config)
    const scoreBBefore = await scorer.score('tenant-b', 'det1', data, config)

    // Tenant A continues training
    for (let i = 0; i < 20; i++) {
      await scorer.update('tenant-a', 'det1', data, 1, config, undefined, 0.1)
    }

    const scoreAAfter = await scorer.score('tenant-a', 'det1', data, config)
    const scoreBAfter = await scorer.score('tenant-b', 'det1', data, config)

    // Tenant A's score should have increased from further positive updates
    expect(scoreAAfter.score).toBeGreaterThan(scoreA.score)
    // Tenant B's score should be unchanged by tenant A's updates
    expect(scoreBAfter.score).toBe(scoreBBefore.score)
    // Tenant B's fresh model should still be near the prior (sigmoid(0) = 0.5)
    expect(scoreBAfter.score).toBeCloseTo(0.5, 4)
  })
})
