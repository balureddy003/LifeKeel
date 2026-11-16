/**
 * Operator engine-metrics aggregate (intent 97, slice 9).
 *
 * GET /operator/engine-metrics — content-free rollups over
 * engine_metrics_events for a bounded window (default 30d, max 90d). This is
 * the dashboard feed for the extraction loop: event counts, per-field-class
 * verdict counts, check-failure codes, confirm-latency buckets and derived
 * rates. It exposes no tenant ids, no values, no document text — the event
 * schema cannot carry them (slice 1), and the aggregation drops tenant_id by
 * construction. Read-only; gated on operations.read.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { requireOperator } from '../operator/operator-auth.js'
import { ENGINE_METRICS_COLLECTION } from '../resilience/engine-metrics.js'

const MAX_DAYS = 90

export function registerOperatorEngineRoutes(app: FastifyInstance, db: Db): void {
  app.get(
    '/operator/engine-metrics',
    { preHandler: requireOperator(db, 'operations.read') },
    async (request) => {
      const q = request.query as { days?: string }
      const parsed = Number.parseInt(q.days ?? '', 10)
      const days = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_DAYS) : 30
      const since = new Date(Date.now() - days * 86_400_000)

      const [agg] = await db
        .collection(ENGINE_METRICS_COLLECTION)
        .aggregate<{
          by_event: { _id: string; count: number }[]
          per_field_class: {
            _id: string
            suggested: number
            confirmed_unchanged: number
            corrected: number
            check_failed: number
          }[]
          check_failures_by_code: { _id: string; count: number }[]
          confirm_latency: { _id: string; count: number }[]
        }>([
          { $match: { at: { $gte: since } } },
          {
            $facet: {
              by_event: [{ $group: { _id: '$event', count: { $sum: 1 } } }],
              per_field_class: [
                { $match: { field_class: { $ne: 'none' } } },
                {
                  $group: {
                    _id: '$field_class',
                    suggested: {
                      $sum: { $cond: [{ $eq: ['$event', 'extraction_suggested'] }, 1, 0] },
                    },
                    confirmed_unchanged: {
                      $sum: {
                        $cond: [{ $eq: ['$event', 'extraction_confirmed_unchanged'] }, 1, 0],
                      },
                    },
                    corrected: {
                      $sum: { $cond: [{ $eq: ['$event', 'extraction_corrected'] }, 1, 0] },
                    },
                    check_failed: {
                      $sum: { $cond: [{ $eq: ['$event', 'extraction_check_failed'] }, 1, 0] },
                    },
                  },
                },
                { $sort: { _id: 1 } },
              ],
              check_failures_by_code: [
                { $match: { event: 'extraction_check_failed', check: { $ne: 'none' } } },
                { $group: { _id: '$check', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
              ],
              confirm_latency: [
                { $match: { event: 'figures_confirm_latency', bucket: { $ne: 'none' } } },
                { $group: { _id: '$bucket', count: { $sum: 1 } } },
              ],
            },
          },
        ])
        .toArray()

      const byEvent = Object.fromEntries(
        (agg?.by_event ?? []).map((r) => [r._id, r.count]),
      ) as Record<string, number>
      const suggested = byEvent['extraction_suggested'] ?? 0
      const checkFailed = byEvent['extraction_check_failed'] ?? 0
      const unchanged = byEvent['extraction_confirmed_unchanged'] ?? 0
      const corrected = byEvent['extraction_corrected'] ?? 0
      const reviewed = unchanged + corrected

      return {
        generated_at: new Date().toISOString(),
        window_days: days,
        by_event: byEvent,
        per_field_class: (agg?.per_field_class ?? []).map((r) => ({
          field_class: r._id,
          suggested: r.suggested,
          confirmed_unchanged: r.confirmed_unchanged,
          corrected: r.corrected,
          check_failed: r.check_failed,
        })),
        check_failures_by_code: Object.fromEntries(
          (agg?.check_failures_by_code ?? []).map((r) => [r._id, r.count]),
        ),
        confirm_latency: Object.fromEntries(
          (agg?.confirm_latency ?? []).map((r) => [r._id, r.count]),
        ),
        rates: {
          // Guarded ratios only — no division by zero, no invented precision.
          check_failure_per_suggested: suggested > 0 ? checkFailed / suggested : null,
          unchanged_per_reviewed: reviewed > 0 ? unchanged / reviewed : null,
        },
      }
    },
  )
}
