/**
 * Trading detector golden-dataset evaluation.
 *
 * Loads the real trading detector YAMLs from detectors/trading and runs the
 * labelled cases in detector-evals/*.yaml through DetectorEvalRunner.
 *
 * This is the fastest way to catch regressions in the trading vertical's
 * deterministic rules before any real money or user trust is on the line.
 */

import path from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import { Engine } from '../engine.js'
import { DetectorEvalRunner } from '../eval-runner.js'

const TRADING_DETECTORS_DIR = path.join(__dirname, '..', '..', '..', '..', 'detectors', 'trading')
const TRADING_EVAL_CASES_DIR = path.join(__dirname, '..', '..', '..', '..', 'detector-evals')

describe('Trading detector golden datasets', () => {
  let runner: DetectorEvalRunner

  beforeAll(async () => {
    const engine = new Engine({ detectorsDir: TRADING_DETECTORS_DIR })
    await engine.load()
    runner = new DetectorEvalRunner(engine, TRADING_EVAL_CASES_DIR)
  })

  it('trading_concentration_risk passes all golden cases with F1 = 1', async () => {
    const report = await runner.run('trading_concentration_risk')
    expect(report.total_cases).toBeGreaterThan(0)
    expect(report.f1).toBe(1)
    expect(report.precision).toBe(1)
    expect(report.recall).toBe(1)
  })

  it('trading_price_drop_alert passes all golden cases with F1 = 1', async () => {
    const report = await runner.run('trading_price_drop_alert')
    expect(report.total_cases).toBeGreaterThan(0)
    expect(report.f1).toBe(1)
    expect(report.precision).toBe(1)
    expect(report.recall).toBe(1)
  })

  it('trading_rebalance_suggestion passes all golden cases with F1 = 1', async () => {
    const report = await runner.run('trading_rebalance_suggestion')
    expect(report.total_cases).toBeGreaterThan(0)
    expect(report.f1).toBe(1)
    expect(report.precision).toBe(1)
    expect(report.recall).toBe(1)
  })

  it('trading_dividend_opportunity passes all golden cases with F1 = 1', async () => {
    const report = await runner.run('trading_dividend_opportunity')
    expect(report.total_cases).toBeGreaterThan(0)
    expect(report.f1).toBe(1)
    expect(report.precision).toBe(1)
    expect(report.recall).toBe(1)
  })
})
