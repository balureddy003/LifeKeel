import path from 'node:path'
import { Engine } from '../src/engine.js'
import { DetectorEvalRunner } from '../src/eval-runner.js'

const detectorsDir = path.join(__dirname, '..', '..', '..', 'detectors', 'trading')
const evalCasesDir = path.join(__dirname, '..', '..', '..', 'detector-evals')

async function main() {
  const engine = new Engine({ detectorsDir })
  await engine.load()
  const runner = new DetectorEvalRunner(engine, evalCasesDir)

  const detectorIds = [
    'trading_concentration_risk',
    'trading_price_drop_alert',
    'trading_rebalance_suggestion',
    'trading_dividend_opportunity',
  ]

  console.log('\n=== Trading Detector Golden Dataset Evaluation ===\n')
  for (const id of detectorIds) {
    const report = await runner.run(id)
    console.log(`${id}`)
    console.log(`  cases: ${report.total_cases}, passed: ${report.passed}, failed: ${report.failed}`)
    console.log(`  precision: ${report.precision}, recall: ${report.recall}, f1: ${report.f1}`)
    if (report.false_positives.length > 0) {
      console.log(`  false positives: ${report.false_positives.length}`)
      for (const fp of report.false_positives) console.log(`    - ${fp.case_id}: ${fp.failure_reason}`)
    }
    if (report.false_negatives.length > 0) {
      console.log(`  false negatives: ${report.false_negatives.length}`)
      for (const fn of report.false_negatives) console.log(`    - ${fn.case_id}: ${fn.failure_reason}`)
    }
    console.log()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
