import { describe, expect, it } from 'vitest'
import {
  CascadeScorer,
  StaticConformalGate,
  computeConformalThreshold,
  empiricalWrongSkipRate,
  type ConformalCalibrationSample,
} from '../scoring/cascade.js'

function scorable(id: string, or_score: number) {
  return { id, confidence_breakdown: { or_score } }
}

/** Deterministic synthetic calibration set: low or_score ⇒ more likely wrong. */
function syntheticSamples(n: number): ConformalCalibrationSample[] {
  const samples: ConformalCalibrationSample[] = []
  for (let i = 0; i < n; i++) {
    // pseudo-random but deterministic
    const or_score = ((i * 2654435761) % 1000) / 1000
    // rules wrong with probability that falls as or_score rises
    const wrongDraw = ((i * 40503) % 1000) / 1000
    const rule_correct = wrongDraw < or_score
    samples.push({ or_score, rule_correct })
  }
  return samples
}

describe('computeConformalThreshold', () => {
  it('falls back to the legacy threshold when calibration data is scarce', () => {
    const result = computeConformalThreshold([{ or_score: 0.5, rule_correct: false }], {
      fallbackTau: 0.9,
      minSamples: 20,
    })
    expect(result.fallback).toBe(true)
    expect(result.tau).toBe(0.9)
  })

  it('is deterministic: identical inputs ⇒ identical version + tau', () => {
    const samples = syntheticSamples(500)
    const a = computeConformalThreshold(samples, { alpha: 0.05 })
    const b = computeConformalThreshold(samples, { alpha: 0.05 })
    expect(a.version).toBe(b.version)
    expect(a.tau).toBe(b.tau)
    expect(a.fallback).toBe(false)
  })

  it('changing alpha changes the version (calibration is versioned)', () => {
    const samples = syntheticSamples(500)
    const a = computeConformalThreshold(samples, { alpha: 0.02 })
    const b = computeConformalThreshold(samples, { alpha: 0.1 })
    expect(a.version).not.toBe(b.version)
  })

  it('guarantees empirical wrong-skip rate ≤ alpha on the calibration set', () => {
    const samples = syntheticSamples(2000)
    for (const alpha of [0.02, 0.05, 0.1]) {
      const { tau } = computeConformalThreshold(samples, { alpha, minSamples: 20 })
      // Of the cases that needed escalation, the fraction wrongly skipped must
      // stay within the conformal bound (small slack for ties at tau).
      const rate = empiricalWrongSkipRate(samples, tau)
      expect(rate).toBeLessThanOrEqual(alpha + 0.01)
    }
  })

  it('a smaller alpha never lowers tau (stricter ⇒ escalate more)', () => {
    const samples = syntheticSamples(2000)
    const strict = computeConformalThreshold(samples, { alpha: 0.02 })
    const loose = computeConformalThreshold(samples, { alpha: 0.1 })
    expect(strict.tau).toBeGreaterThanOrEqual(loose.tau)
  })
})

describe('CascadeScorer.decide', () => {
  const threshold = { tau: 0.8, alpha: 0.02, calibration_n: 100, fallback: false, version: 'v1' }

  it('escalates only insights below tau and computes DRR', () => {
    const scorer = new CascadeScorer({ alpha: 0.02 })
    const insights = [
      scorable('a', 0.95),
      scorable('b', 0.5),
      scorable('c', 0.7),
      scorable('d', 0.85),
    ]
    const { escalate, deterministic, telemetry } = scorer.decide(insights, threshold)
    expect(escalate.map((i) => i.id)).toEqual(['b', 'c'])
    expect(deterministic.map((i) => i.id)).toEqual(['a', 'd'])
    expect(telemetry.total).toBe(4)
    expect(telemetry.escalated).toBe(2)
    expect(telemetry.drr).toBe(0.5)
    expect(telemetry.calibration_version).toBe('v1')
  })

  it('is order-stable and caps escalations at batchCap', () => {
    const scorer = new CascadeScorer({ batchCap: 1 })
    const insights = [scorable('a', 0.1), scorable('b', 0.2), scorable('c', 0.3)]
    const { escalate, deterministic } = scorer.decide(insights, threshold)
    expect(escalate.map((i) => i.id)).toEqual(['a'])
    // over-cap insights are treated as deterministic pass-through
    expect(deterministic.map((i) => i.id)).toEqual(['b', 'c'])
  })

  it('Deterministic Mode never escalates (DRR = 100%)', () => {
    const scorer = new CascadeScorer({ deterministicMode: true })
    const insights = [scorable('a', 0.1), scorable('b', 0.2)]
    const { escalate, telemetry } = scorer.decide(insights, threshold)
    expect(escalate).toHaveLength(0)
    expect(telemetry.drr).toBe(1)
  })

  it('CONFORMANCE: identical inputs + fixed version ⇒ identical decisions', () => {
    const scorer = new CascadeScorer({ alpha: 0.02 })
    const insights = [scorable('a', 0.95), scorable('b', 0.5), scorable('c', 0.7)]
    const first = scorer.decide(insights, threshold).decisions
    const second = scorer.decide(insights, threshold).decisions
    expect(first).toEqual(second)
  })
})

describe('StaticConformalGate', () => {
  it('returns a per-tenant threshold and caches by tenant', () => {
    const gate = new StaticConformalGate({ t1: syntheticSamples(500), t2: [] }, { alpha: 0.05 })
    const t1 = gate.getThreshold('t1')
    const t2 = gate.getThreshold('t2')
    expect(t1.fallback).toBe(false)
    expect(t2.fallback).toBe(true) // no samples → fallback
    // cache returns the same object on repeat
    expect(gate.getThreshold('t1')).toBe(t1)
  })
})
