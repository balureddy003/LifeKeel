/**
 * FeatureHashScorer offline evaluation
 *
 * Gap #30 (TRADING_ENGINE_GAPS.md): FeatureHashScorer (the online-learning
 * layer behind detector confidence) has zero offline evaluation — no
 * precision/recall/AUC/calibration check anywhere, live or offline.
 *
 * This script loads historical approve/dismiss insights from the DB, runs
 * them through FeatureHashScorer's score() function, and computes:
 *   - Precision, recall, F1 at the default min_score threshold (0.65)
 *   - AUC-ROC (area under the receiver operating characteristic curve)
 *   - Calibration (mean predicted score vs actual approval rate, binned)
 *   - Confusion matrix at the threshold
 *
 * The eval is train-on-past, test-on-future: insights are sorted by
 * created_at, the first 80% are used to train the scorer (simulating the
 * online updates that already happened), and the last 20% are held out for
 * evaluation. This mirrors how the model is used in production — it scores
 * new insights based on weights learned from past approvals/dismissals.
 *
 * Usage:
 *   MONGODB_URL=mongodb://... pnpm exec tsx scripts/feature-hash-eval.ts
 *
 * Or via the weekly cron in server.ts (see runFeatureHashEval).
 */
import type { Db } from 'mongodb'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'feature-hash-eval', version: '0.0.0' })

export interface FeatureHashEvalReport {
  detector_id: string
  run_at: Date
  total_insights: number
  train_count: number
  test_count: number
  // Metrics on the held-out test set
  precision: number
  recall: number
  f1: number
  auc_roc: number
  // Calibration: predicted vs actual approval rate, binned into 5 buckets
  calibration: Array<{ bin: string; predicted: number; actual: number; count: number }>
  // Confusion matrix at the default threshold
  confusion: { tp: number; fp: number; fn: number; tn: number }
  threshold: number
}

/**
 * Runs the offline eval for a single detector's FeatureHashScorer model.
 * Returns a report that can be persisted to the `feature_hash_eval_reports`
 * collection.
 *
 * This function is exportable so it can be called from the weekly cron in
 * server.ts, not just from the CLI script.
 */
export async function evaluateFeatureHashScorer(
  db: Db,
  detectorId: string,
  threshold = 0.65,
): Promise<FeatureHashEvalReport | null> {
  // Load all approved/dismissed insights for this detector, sorted by time.
  // These are the only insights with a known outcome (label):
  //   approved (state='completed') → outcome 1
  //   dismissed (state='dismissed') → outcome 0
  const insightsCol = db.collection('insights')
  const insights = await insightsCol
    .find({
      detector_id: detectorId,
      state: { $in: ['completed', 'dismissed'] },
    })
    .sort({ created_at: 1 })
    .toArray()

  if (insights.length < 10) {
    // Not enough data to produce a meaningful eval
    return null
  }

  // Split into train (80%) and test (20%), time-ordered
  const splitIdx = Math.floor(insights.length * 0.8)
  const trainSet = insights.slice(0, splitIdx)
  const testSet = insights.slice(splitIdx)

  // Build a scorer and train it on the train set
  // We use a fresh in-memory scorer (not the persisted one) to get a clean
  // train-on-past evaluation
  const { FeatureHashScorer } = await import('@kairos/engine')
  // Use a lightweight in-memory DB mock — we don't need persistence for eval
  const memDb = {
    collection: () => ({
      findOne: async () => null,
      createIndex: async () => '',
      updateOne: async () => ({ acknowledged: true }),
    }),
  }
  const scorer = new FeatureHashScorer(memDb as never)
  const tenantId = 'eval'
  await scorer.load(tenantId, detectorId)

  // Default config — matches the standard FeatureHashConfig defaults
  const config = {
    features: ['data.ticker', 'data.portfolio_weight_pct', 'data.current_price'],
    min_score: threshold,
    use_bigrams: true,
    l2_reg: 0.0001,
    l1_reg: 0.01,
    learning_rate: 0.01,
  }

  // Train on the train set
  for (const insight of trainSet) {
    const outcome: 0 | 1 = insight['state'] === 'completed' ? 1 : 0
    const data = (insight['feature_snapshot'] as Record<string, unknown>) ?? {}
    await scorer.update(tenantId, detectorId, data, outcome, config)
  }

  // Evaluate on the test set
  const predictions: Array<{ score: number; actual: number }> = []
  for (const insight of testSet) {
    const actual: 0 | 1 = insight['state'] === 'completed' ? 1 : 0
    const data = (insight['feature_snapshot'] as Record<string, unknown>) ?? {}
    const result = await scorer.score(tenantId, detectorId, data, config)
    predictions.push({ score: result.score, actual })
  }

  // Compute metrics
  const tp = predictions.filter((p) => p.score >= threshold && p.actual === 1).length
  const fp = predictions.filter((p) => p.score >= threshold && p.actual === 0).length
  const fn = predictions.filter((p) => p.score < threshold && p.actual === 1).length
  const tn = predictions.filter((p) => p.score < threshold && p.actual === 0).length

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

  // AUC-ROC: probability that a random positive is scored higher than a random negative
  const positives = predictions.filter((p) => p.actual === 1)
  const negatives = predictions.filter((p) => p.actual === 0)
  let aucRoc = 0
  if (positives.length > 0 && negatives.length > 0) {
    let correct = 0
    for (const pos of positives) {
      for (const neg of negatives) {
        if (pos.score > neg.score) correct += 1
        else if (pos.score === neg.score) correct += 0.5
      }
    }
    aucRoc = correct / (positives.length * negatives.length)
  }

  // Calibration: bin predictions into 5 buckets (0-0.2, 0.2-0.4, 0.4-0.6, 0.6-0.8, 0.8-1.0)
  const bins = [
    { label: '0.0-0.2', min: 0, max: 0.2 },
    { label: '0.2-0.4', min: 0.2, max: 0.4 },
    { label: '0.4-0.6', min: 0.4, max: 0.6 },
    { label: '0.6-0.8', min: 0.6, max: 0.8 },
    { label: '0.8-1.0', min: 0.8, max: 1.01 },
  ]
  const calibration = bins.map((bin) => {
    const inBin = predictions.filter((p) => p.score >= bin.min && p.score < bin.max)
    const predicted = inBin.length > 0 ? inBin.reduce((s, p) => s + p.score, 0) / inBin.length : 0
    const actual = inBin.length > 0 ? inBin.filter((p) => p.actual === 1).length / inBin.length : 0
    return { bin: bin.label, predicted, actual, count: inBin.length }
  })

  return {
    detector_id: detectorId,
    run_at: new Date(),
    total_insights: insights.length,
    train_count: trainSet.length,
    test_count: testSet.length,
    precision: Math.round(precision * 10000) / 10000,
    recall: Math.round(recall * 10000) / 10000,
    f1: Math.round(f1 * 10000) / 10000,
    auc_roc: Math.round(aucRoc * 10000) / 10000,
    calibration,
    confusion: { tp, fp, fn, tn },
    threshold,
  }
}

/**
 * Runs the eval for all detectors that have FeatureHashScorer models, and
 * persists each report to the `feature_hash_eval_reports` collection.
 * Returns the list of reports (null entries are skipped).
 */
export async function runFeatureHashEval(db: Db): Promise<FeatureHashEvalReport[]> {
  // Find all detectors that have at least some approved/dismissed insights
  const insightsCol = db.collection('insights')
  const detectorIds = await insightsCol.distinct('detector_id', {
    state: { $in: ['completed', 'dismissed'] },
  })

  const reports: FeatureHashEvalReport[] = []
  for (const detectorId of detectorIds) {
    const report = await evaluateFeatureHashScorer(db, String(detectorId))
    if (report) {
      await db.collection('feature_hash_eval_reports').updateOne(
        { detector_id: report.detector_id, run_at: report.run_at },
        { $set: report },
        { upsert: true },
      )
      reports.push(report)
    }
  }
  return reports
}

// ── CLI entry point ──────────────────────────────────────────────────────────
// Run with: MONGODB_URL=mongodb://... pnpm exec tsx scripts/feature-hash-eval.ts
if (process.argv[1]?.endsWith('feature-hash-eval.ts')) {
  ;(async () => {
    const { MongoClient } = await import('mongodb')
    const url = process.env['MONGODB_URL']
    if (!url) {
      log.error({}, 'MONGODB_URL is required')
      process.exit(1)
    }
    const client = await MongoClient.connect(url)
    const db = client.db()
    log.info({}, 'Running FeatureHashScorer offline eval...')
    const reports = await runFeatureHashEval(db)
    if (reports.length === 0) {
      log.info({}, 'No detectors with enough data to evaluate (need ≥10 approved/dismissed insights).')
    } else {
      for (const r of reports) {
        log.info({ detector_id: r.detector_id }, `=== ${r.detector_id} ===`)
        log.info({ total_insights: r.total_insights, train: r.train_count, test: r.test_count }, `Insights: ${r.total_insights} (train ${r.train_count}, test ${r.test_count})`)
        log.info({ precision: r.precision, recall: r.recall, f1: r.f1 }, `Precision: ${r.precision}  Recall: ${r.recall}  F1: ${r.f1}`)
        log.info({ auc_roc: r.auc_roc }, `AUC-ROC: ${r.auc_roc}`)
        log.info({ threshold: r.threshold, tp: r.confusion.tp, fp: r.confusion.fp, fn: r.confusion.fn, tn: r.confusion.tn }, `Confusion @ threshold ${r.threshold}: TP=${r.confusion.tp} FP=${r.confusion.fp} FN=${r.confusion.fn} TN=${r.confusion.tn}`)
        log.info({}, 'Calibration:')
        for (const c of r.calibration) {
          log.info({ bin: c.bin, predicted: c.predicted.toFixed(3), actual: c.actual.toFixed(3), count: c.count }, `Calibration: ${c.bin}: predicted ${c.predicted.toFixed(3)}, actual ${c.actual.toFixed(3)}, n=${c.count}`)
        }
      }
    }
    await client.close()
  })().catch((err) => {
    log.error({ err }, 'FeatureHashScorer eval CLI failed')
    process.exit(1)
  })
}
