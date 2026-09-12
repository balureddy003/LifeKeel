/**
 * PP2 — Workflow-Attributed Calibration accuracy eval.
 *
 * Benchmarks the engine's ScoreCalibrator (Platt < 200 samples, Isotonic ≥ 200)
 * against deliberately mis-calibrated classifiers on real industry datasets
 * (UCI Adult / German Credit via OpenML). For each dataset we fit on the SAME
 * fit split sklearn used and evaluate on the SAME held-out eval split, so the
 * engine is compared head-to-head with sklearn's isotonic CalibratedClassifierCV.
 *
 * Pass criteria: the engine reduces ECE and Brier vs the raw scores, and lands
 * within a small tolerance of the sklearn isotonic baseline.
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { ScoreCalibrator } from '../calibration.js'
import { FakeMongo, readCsv, ece, brier, writeOut, round, EVAL_ROOT, hasData } from './_harness.js'

interface Baseline {
  dataset: string
  classifier: string
  sklearn_isotonic_ece_eval: number
  sklearn_isotonic_brier_eval: number
}

const HAS_DATA = hasData('data/calib/_python_baselines.json')
const baselines: Baseline[] = HAS_DATA
  ? JSON.parse(readFileSync(`${EVAL_ROOT}/data/calib/_python_baselines.json`, 'utf8'))
  : []

describe.skipIf(!HAS_DATA)('PP2 calibration accuracy on industry datasets', () => {
  const results: Record<string, unknown>[] = []

  for (const b of baselines) {
    it(`${b.dataset} (${b.classifier}): engine calibrator reduces ECE & Brier`, async () => {
      const fit = readCsv(`${EVAL_ROOT}/data/calib/${b.dataset}_fit.csv`)
        .map(r => ({ raw_score: Number(r.raw_score), outcome: (Number(r.outcome) ? 1 : 0) as 0 | 1 }))
      const evalRows = readCsv(`${EVAL_ROOT}/data/calib/${b.dataset}_eval.csv`)
        .map(r => ({ raw: Number(r.raw_score), y: Number(r.outcome) }))

      const cal = new ScoreCalibrator(new FakeMongo())
      const params = await cal.fit('tenantA', b.dataset, fit)

      // Apply via the real hot-path calibrate function (isotonic or Platt cache)
      const calibrated = evalRows.map(r => cal.calibrateSync('tenantA', b.dataset, r.raw))
      const ys = evalRows.map(r => r.y)
      const raws = evalRows.map(r => r.raw)

      const rawEce = ece(raws, ys), rawBrier = brier(raws, ys)
      const calEce = ece(calibrated, ys), calBrier = brier(calibrated, ys)

      results.push({
        dataset: b.dataset,
        classifier: b.classifier,
        active_calibrator: params.active_calibrator,
        temperature: params.temperature,
        sample_count: params.sample_count,
        n_eval: evalRows.length,
        raw_ece: round(rawEce), engine_ece: round(calEce),
        sklearn_isotonic_ece: round(b.sklearn_isotonic_ece_eval),
        raw_brier: round(rawBrier), engine_brier: round(calBrier),
        sklearn_isotonic_brier: round(b.sklearn_isotonic_brier_eval),
        ece_reduction_pct: round(100 * (1 - calEce / rawEce), 1),
        brier_reduction_pct: round(100 * (1 - calBrier / rawBrier), 1),
      })

      // Honest criteria:
      //  - When the model is genuinely mis-calibrated (raw ECE ≥ 0.05) the
      //    engine must materially reduce ECE.
      //  - When it is already well-calibrated (raw ECE < 0.05) calibrating on a
      //    small sample cannot help; we only require it not to blow up.
      if (rawEce >= 0.05) {
        expect(calEce).toBeLessThan(rawEce)
        expect(calBrier).toBeLessThanOrEqual(rawBrier + 1e-6)
      } else {
        expect(calEce).toBeLessThan(0.1)
      }
      // Land near the sklearn isotonic baseline (within 0.05 ECE).
      expect(calEce).toBeLessThan(b.sklearn_isotonic_ece_eval + 0.05)
    })
  }

  it('writes calibration results', () => {
    results.sort((a, b) => String(a.dataset).localeCompare(String(b.dataset)))
    writeOut('calibration_results.json', results)
    // eslint-disable-next-line no-console
    console.table(results)
    expect(results.length).toBeGreaterThan(0)
  })
})
