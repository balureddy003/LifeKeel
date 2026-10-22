/**
 * AI task failure-share alert (PRD-217 §7).
 *
 * The October Ask Keel outage ran for days before someone probed production
 * by hand — every governed call was failing and nothing surfaced it. This
 * job is the check that would have paged: every run aggregates the last
 * hour of ai_task_calls per task and raises a critical ops alert when a
 * task has real volume and ≥80% failures.
 *
 * Calls refused by the operator disable switch (outcome 'disabled') are
 * excluded — a deliberately-off task is operator state, not an outage.
 * Dedup is two-layer: the fingerprint is keyed per task per hour and
 * sendOpsAlert applies its own per-fingerprint cooldown.
 */

import type { Db } from 'mongodb'
import { sendOpsAlert } from '../operator/ops-alerts.js'

const WINDOW_MS = 60 * 60 * 1000
const MIN_CALLS = 5
const FAILURE_SHARE = 0.8

export interface AiHealthAlertResult {
  checked_tasks: number
  alerted: string[]
}

export async function runAiHealthAlert(db: Db, now = new Date()): Promise<AiHealthAlertResult> {
  const since = new Date(now.getTime() - WINDOW_MS)
  const rows = await db
    .collection('ai_task_calls')
    .aggregate([
      { $match: { created_at: { $gte: since }, outcome: { $ne: 'disabled' } } },
      {
        $group: {
          _id: '$task_id',
          calls: { $sum: 1 },
          failures: { $sum: { $cond: ['$ok', 0, 1] } },
          models: { $addToSet: '$model' },
          processors: { $addToSet: '$processor' },
        },
      },
      { $match: { calls: { $gte: MIN_CALLS } } },
    ])
    .toArray()

  const alerted: string[] = []
  // YYYY-MM-DDTHH — one alert per task per hour at most.
  const hourKey = now.toISOString().slice(0, 13)
  for (const row of rows) {
    const calls = row['calls'] as number
    const failures = row['failures'] as number
    if (failures / calls < FAILURE_SHARE) continue
    const taskId = row['_id'] as string
    await sendOpsAlert({
      title: `AI task '${taskId}' failing`,
      message:
        `${failures}/${calls} calls failed in the last hour ` +
        `(${Math.round((failures / calls) * 100)}%). ` +
        `Processor: ${(row['processors'] as (string | null)[]).filter(Boolean).join(', ') || 'unknown'} · ` +
        `models: ${(row['models'] as string[]).join(', ')}. ` +
        `Check /operator/ai for the task card and breaker state.`,
      severity: 'critical',
      fingerprint: `ai-task-failing:${taskId}:${hourKey}`,
    })
    alerted.push(taskId)
  }
  return { checked_tasks: rows.length, alerted }
}
