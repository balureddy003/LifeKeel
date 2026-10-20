import type { Db } from 'mongodb'

/**
 * metrics_daily — pre-aggregated daily counts for operator dashboards.
 *
 * Doc shape: { _id: '<day>|<metric>|<dim>', day, metric, dim, count, updated_at }
 *   metric: 'growth_event' | 'signup' | 'lead' | 'login' | 'support_case'
 *   dim:    dimension value (utm_source for signup, source for lead,
 *           event name for growth_event, '' otherwise)
 *
 * The overview page's per-load aggregations scan growth_events/users/leads
 * raw; at 1M users that's a collection scan per page load. This job rolls
 * each day's counts into single-doc lookups, recomputed for today +
 * yesterday each run so late-arriving events land correctly. Reads fall
 * back to raw aggregation until the backfill marker is set.
 */

import { COHORT_DAYS, cohortFunnelRows, eventFunnelRows } from '../marketing/funnel.js'

const RECENT_COHORT_DAYS = 3

const META_ID = 'meta'
const BACKFILL_DAYS = 90

interface MetricDoc {
  /** '<day>|<metric>|<dim>' for data rows, 'meta' for the job marker. */
  _id: string
  day?: string
  metric?: string
  dim?: string
  count?: number
  updated_at?: Date
  backfilled_at?: Date
  last_run_at?: Date
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10)
const dayStart = (day: string) => new Date(`${day}T00:00:00.000Z`)
const dayEnd = (day: string) => new Date(`${day}T23:59:59.999Z`)

async function rollupDay(db: Db, day: string): Promise<number> {
  const range = { $gte: dayStart(day), $lte: dayEnd(day) }
  const upserts: { metric: string; dim: string; count: number }[] = []

  const events = await db
    .collection('growth_events')
    .aggregate([
      { $match: { created_at: range } },
      { $group: { _id: '$event', count: { $sum: 1 } } },
    ])
    .toArray()
  for (const e of events)
    upserts.push({ metric: 'growth_event', dim: e['_id'] as string, count: e['count'] as number })

  const signups = await db
    .collection('users')
    .aggregate([
      { $match: { created_at: range } },
      { $group: { _id: { $ifNull: ['$attribution.utm_source', 'direct'] }, count: { $sum: 1 } } },
    ])
    .toArray()
  for (const s of signups)
    upserts.push({ metric: 'signup', dim: s['_id'] as string, count: s['count'] as number })

  const leads = await db
    .collection('leads')
    .aggregate([
      { $match: { created_at: range } },
      { $group: { _id: { $ifNull: ['$source', 'unknown'] }, count: { $sum: 1 } } },
    ])
    .toArray()
  for (const l of leads)
    upserts.push({ metric: 'lead', dim: l['_id'] as string, count: l['count'] as number })

  for (const f of await eventFunnelRows(db, day, range))
    upserts.push({ metric: f.metric, dim: f.dim, count: f.count })

  const logins = await db
    .collection('login_events')
    .countDocuments({ created_at: range, success: true })
  if (logins > 0) upserts.push({ metric: 'login', dim: '', count: logins })

  const cases = await db.collection('support_cases').countDocuments({ created_at: range })
  if (cases > 0) upserts.push({ metric: 'support_case', dim: '', count: cases })

  if (upserts.length === 0) return 0
  const coll = db.collection<MetricDoc>('metrics_daily')
  await coll.bulkWrite(
    upserts.map((u) => ({
      updateOne: {
        filter: { _id: `${day}|${u.metric}|${u.dim}` },
        update: {
          $set: { day, metric: u.metric, dim: u.dim, count: u.count, updated_at: new Date() },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  )
  return upserts.length
}

/** The signup cohorts of the last 30 days, recomputed as they mature (PRD-210 funnel). */
async function rollupCohorts(db: Db, now: Date, full: boolean): Promise<number> {
  const coll = db.collection<MetricDoc>('metrics_daily')
  let written = 0
  // Recent cohorts change quickly, so every run refreshes the last few days; the whole 30-day window
  // is recomputed once a day (the first run after midnight UTC) and on the first-ever run.
  const span = full ? COHORT_DAYS : RECENT_COHORT_DAYS
  for (let i = 0; i < span; i++) {
    const day = dayKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000))
    const rowsForDay = await cohortFunnelRows(db, day, { $gte: dayStart(day), $lte: dayEnd(day) })
    if (rowsForDay.length === 0) continue
    // The visit and click rows share the day key; replace only this day's cohort steps.
    await coll.bulkWrite(
      rowsForDay.map((r) => ({
        updateOne: {
          filter: { _id: `${day}|funnel|${r.dim}` },
          update: {
            $set: { day, metric: 'funnel', dim: r.dim, count: r.count, updated_at: new Date() },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    )
    written += rowsForDay.length
  }
  return written
}

/** Roll up today and yesterday, plus a one-time 90-day backfill. */
export async function runMetricsRollup(
  db: Db,
  now = new Date(),
): Promise<{ rolled_days: number; rows: number }> {
  const coll = db.collection<MetricDoc>('metrics_daily')
  const meta = await coll.findOne({ _id: META_ID })
  const days: string[] = []

  if (!meta?.['backfilled_at']) {
    for (let i = BACKFILL_DAYS - 1; i >= 0; i--) {
      days.push(dayKey(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)))
    }
  } else {
    days.push(dayKey(now), dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000)))
  }

  let rows = 0
  for (const day of [...new Set(days)]) rows += await rollupDay(db, day)
  rows += await rollupCohorts(db, now, !meta?.['backfilled_at'] || now.getUTCHours() === 0)

  await coll.updateOne(
    { _id: META_ID },
    { $set: { backfilled_at: meta?.['backfilled_at'] ?? now, last_run_at: now } },
    { upsert: true },
  )
  return { rolled_days: new Set(days).size, rows }
}

/** True once the backfill has populated history — reads can trust rollups. */
export async function isRollupReady(db: Db): Promise<boolean> {
  const meta = await db
    .collection<MetricDoc>('metrics_daily')
    .findOne({ _id: META_ID }, { projection: { backfilled_at: 1 } })
  return Boolean(meta?.['backfilled_at'])
}

/**
 * Read daily counts for a metric over the last `days` days.
 * Returns rows shaped { day, dim, count }.
 */
export async function readDailyRollup(
  db: Db,
  metric: string,
  days: number,
): Promise<{ day: string; dim: string; count: number }[]> {
  const since = dayKey(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000))
  return db
    .collection<MetricDoc>('metrics_daily')
    .find({ day: { $gte: since }, metric }, { projection: { _id: 0, day: 1, dim: 1, count: 1 } })
    .sort({ day: 1 })
    .toArray()
    .then((docs) => docs.map((d) => ({ day: d.day!, dim: d.dim!, count: d.count! })))
}
