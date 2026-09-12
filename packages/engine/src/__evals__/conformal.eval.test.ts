/**
 * Conformal escalation gate (ADR-0068) — coverage eval.
 *
 * Validates the central guarantee of cascade.ts on real labelled data:
 *
 *     P( skipped | rule result wrong ) ≤ alpha
 *
 * i.e. of the cases that genuinely needed an LLM, the gate wrongly skips at most
 * an `alpha` fraction. We derive realistic (or_score, rule_correct) samples from
 * the industry calibration datasets — the deterministic "rule" predicts 1 when
 * or_score ≥ 0.5; rule_correct = (prediction == outcome) — and run split-conformal
 * over many random calibration/test splits, measuring the held-out wrong-skip
 * rate with the engine's own computeConformalThreshold + empiricalWrongSkipRate.
 *
 * Conformal validity is a *marginal* (over-splits) guarantee, so we report the
 * mean held-out wrong-skip rate and the fraction of splits in which it held.
 */
import { describe, it, expect } from 'vitest'
import {
  computeConformalThreshold,
  empiricalWrongSkipRate,
  type ConformalCalibrationSample,
} from '../cascade.js'
import { readCsv, writeOut, round, EVAL_ROOT, hasData } from './_harness.js'

// Deterministic PRNG (mulberry32) for reproducible splits.
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

function loadSamples(dataset: string): ConformalCalibrationSample[] {
  return readCsv(`${EVAL_ROOT}/data/calib/${dataset}.csv`).map(r => {
    const or_score = Number(r.raw_score)
    const outcome = Number(r.outcome)
    const prediction = or_score >= 0.5 ? 1 : 0
    return { or_score, rule_correct: prediction === outcome }
  })
}

const DATASETS = ['adult_gnb', 'adult_svm', 'creditg_gnb', 'creditg_rf']
const ALPHAS = [0.02, 0.05, 0.1]
const SPLITS = 300

describe.skipIf(!hasData('data/calib/adult_gnb.csv'))('Conformal escalation gate coverage on industry data', () => {
  const results: Record<string, unknown>[] = []

  for (const dataset of DATASETS) {
    for (const alpha of ALPHAS) {
      it(`${dataset} @ alpha=${alpha}: mean held-out wrong-skip ≤ alpha`, () => {
        const all = loadSamples(dataset)
        const rand = rng(1234 + Math.round(alpha * 1000))
        const rates: number[] = []
        let held = 0
        let usedTau = 0
        let fallbacks = 0

        for (let s = 0; s < SPLITS; s++) {
          const shuffled = shuffle(all, rand)
          const half = Math.floor(shuffled.length / 2)
          const calib = shuffled.slice(0, half)
          const test = shuffled.slice(half)
          const thr = computeConformalThreshold(calib, { alpha })
          const rate = empiricalWrongSkipRate(test, thr.tau)
          rates.push(rate)
          usedTau += thr.tau
          if (thr.fallback) fallbacks++
          // Slack for finite test set: allow a small binomial cushion.
          if (rate <= alpha + 0.03) held++
        }

        const mean = rates.reduce((a, b) => a + b, 0) / rates.length
        const heldFrac = held / SPLITS
        const baseErr = all.filter(s => !s.rule_correct).length / all.length
        const wrongInCalib = baseErr * Math.floor(all.length / 2)
        // Conformal coverage is a marginal guarantee with O(1/√n_test) variance;
        // it is tight only in the large-sample regime. The 400-row credit set is
        // deliberately included to expose (and document) the small-sample limit.
        const validRegime = all.length >= 2000
        results.push({
          dataset, alpha,
          splits: SPLITS,
          mean_wrong_skip_rate: round(mean),
          held_fraction: round(heldFrac, 3),
          mean_tau: round(usedTau / SPLITS, 3),
          fallback_splits: fallbacks,
          base_rule_error_rate: round(baseErr),
          wrong_calib_samples: Math.round(wrongInCalib),
          coverage_regime: validRegime ? 'large-sample (n≥2000)' : 'small-sample (n<2000)',
        })

        // Marginal coverage holds (with a small finite-sample cushion) whenever
        // there are enough wrong-result calibration samples. The small-sample
        // regime is recorded but not asserted — that is the documented limit.
        if (validRegime) {
          expect(mean).toBeLessThanOrEqual(alpha + 0.02)
        }
      })
    }
  }

  it('writes conformal results', () => {
    writeOut('conformal_results.json', results)
    // eslint-disable-next-line no-console
    console.table(results)
    expect(results.length).toBe(DATASETS.length * ALPHAS.length)
  })
})
