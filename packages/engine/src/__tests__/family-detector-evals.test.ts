/**
 * Family detector golden-dataset evals.
 *
 * Runs every detector-evals/*.yaml case file through DetectorEvalRunner +
 * a real Engine over detectors/family/*.yaml — the same production artifacts
 * the API loads. This is the promotion gate's contract as a test: a YAML
 * edit that drops recall or adds a false positive fails here before it can
 * be promoted, and POST /detectors/:id/eval enforces the same F1 floor.
 *
 * F1 across the full golden set must stay at 1.0 — the datasets are
 * hand-authored to be unambiguous; a miss means the detector regressed,
 * not that the case is marginal.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { Engine } from '../engine.js'
import { DetectorEvalRunner } from '../eval-runner.js'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const engine = new Engine({ detectorsDir: path.join(ROOT, 'detectors'), strictValidation: false })
const runner = new DetectorEvalRunner(engine, path.join(ROOT, 'detector-evals'))

const FAMILY_DETECTORS = [
  'family_protection_gap',
  'family_emergency_fund_adequacy',
  'family_retirement_gap',
  'family_education_shortfall',
  'family_estate_readiness',
  'family_debt_health',
  'family_policy_review',
  'family_education_pacing',
  'family_emergency_trajectory',
]

describe('family detector golden datasets', () => {
  for (const detectorId of FAMILY_DETECTORS) {
    it(`${detectorId} passes every golden case (F1 = 1.0)`, async () => {
      const report = await runner.run(detectorId)
      expect(report.total_cases).toBeGreaterThan(0)
      const failures = report.case_results
        .filter((r) => !r.passed)
        .map((r) => `${r.case_id}: ${r.failure_reason ?? 'unexpected insight'}`)
      expect(failures).toEqual([])
      expect(report.f1).toBe(1)
    })
  }

  it('runAll covers every family detector with a golden dataset', async () => {
    const reports = await runner.runAll()
    expect([...reports.keys()].sort()).toEqual([...FAMILY_DETECTORS].sort())
  })
})
