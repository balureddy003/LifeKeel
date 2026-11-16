/**
 * Engine-metrics watch (intent 97, slice 9) — rising extraction-failure alert.
 *
 * Daily job: compares the mechanical check-failure rate per suggestion over
 * the last 7 days against the prior 7 days in engine_metrics_events and sends
 * an ops alert when it has at least doubled, subject to volume floors so a
 * quiet week cannot alert on noise. Content-free by construction — the event
 * schema carries no values, names or document text, and the alert message
 * carries counts and rates only.
 *
 * Thresholds are provisional (owner tuning is a slice-4-adjacent decision):
 * ratio ≥ 2×, ≥20 suggestions and ≥5 failures in the current week, and a
 * non-zero prior baseline. Never throws — sendOpsAlert swallows its own
 * errors and this job's failures are logged by the scheduler wrapper.
 */
import type { Db } from 'mongodb'
import { createLogger } from '@lifekeel/platform'
import { sendOpsAlert } from '../operator/ops-alerts.js'
import { ENGINE_METRICS_COLLECTION } from '../resilience/engine-metrics.js'

const log = createLogger({ service: 'engine-metrics-watch', version: '0.0.0' })

const WINDOW_DAYS = 7
/** Provisional floors — tune with the owner once real volume exists. */
const MIN_SUGGESTED = 20
const MIN_FAILURES = 5
const ALERT_RATIO = 2

interface WindowCounts {
  suggested: number
  checkFailed: number
}

async function windowCounts(db: Db, start: Date, end: Date): Promise<WindowCounts> {
  const rows = await db
    .collection(ENGINE_METRICS_COLLECTION)
    .aggregate<{ _id: string; count: number }>([
      {
        $match: {
          event: { $in: ['extraction_suggested', 'extraction_check_failed'] },
          at: { $gte: start, $lt: end },
        },
      },
      { $group: { _id: '$event', count: { $sum: 1 } } },
    ])
    .toArray()
  const counts: WindowCounts = { suggested: 0, checkFailed: 0 }
  for (const r of rows) {
    if (r._id === 'extraction_suggested') counts.suggested = r.count
    else if (r._id === 'extraction_check_failed') counts.checkFailed = r.count
  }
  return counts
}

export async function watchEngineMetrics(db: Db, now = new Date()): Promise<void> {
  const dayMs = 86_400_000
  const current = await windowCounts(db, new Date(now.getTime() - WINDOW_DAYS * dayMs), now)
  const prior = await windowCounts(
    db,
    new Date(now.getTime() - 2 * WINDOW_DAYS * dayMs),
    new Date(now.getTime() - WINDOW_DAYS * dayMs),
  )

  // Volume floors: below these the rates are noise, not signal.
  if (current.suggested < MIN_SUGGESTED || current.checkFailed < MIN_FAILURES) return
  // No prior baseline → nothing to compare against; stay quiet.
  if (prior.suggested === 0 || prior.checkFailed === 0) return

  const currentRate = current.checkFailed / current.suggested
  const priorRate = prior.checkFailed / prior.suggested
  if (currentRate < ALERT_RATIO * priorRate) return

  log.warn(
    { current_rate: currentRate, prior_rate: priorRate },
    'extraction check-failure rate rising',
  )
  await sendOpsAlert({
    title: 'Engine extraction check-failure rate rising',
    message:
      `Check failures per suggestion rose from ${priorRate.toFixed(3)} to ` +
      `${currentRate.toFixed(3)} week over week ` +
      `(current week: ${current.checkFailed}/${current.suggested}; ` +
      `prior: ${prior.checkFailed}/${prior.suggested}).`,
    severity: 'warning',
    fingerprint: 'engine-metrics:check-failure-rate',
  })
}
