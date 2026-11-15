/**
 * Engine metrics (intent 97, slice 1) — typed, content-free counters for the
 * resilience engine's extraction loop. An event carries a tenant key, a field
 * class, an outcome and a date: every field besides the tenant key is a closed
 * enum or a Date, so a figure, a name or document text cannot be attached by
 * construction (CLAUDE.md rule 3). Events are emitted through the platform
 * OpenTelemetry tracer and appended to the `engine_metrics_events` collection
 * so the selective-risk gate (slice 4) has real history to learn from.
 *
 * Append-only: nothing ever updates a row. Retention (owner decision
 * 2026-11-15): 24 months, then rows roll up into aggregate counts in
 * metrics_daily and are deleted (see rollupEngineMetricEvents below; run by
 * the retention worker).
 *
 * A metrics write is best-effort: it must never fail the user's request, so
 * emitEngineMetric swallows and logs every failure.
 */
import type { Db } from 'mongodb'
import { createLogger, getTracer } from '@lifekeel/platform'
import { CATEGORIES, FIELD_KEYS, type Category, type FieldKey } from '../extraction/schema.js'
import { DOCUMENT_SCHEMAS, type DocumentType, type Problem } from './extraction-checks.js'

const log = createLogger({ service: 'engine-metrics', version: '0.0.0' })

export const ENGINE_METRICS_COLLECTION = 'engine_metrics_events'

export const ENGINE_METRIC_EVENTS = [
  'extraction_suggested',
  'extraction_check_failed',
  'extraction_confirmed_unchanged',
  'extraction_corrected',
  'statement_rejected',
  'figures_confirmed_one_adult',
  'figures_confirmed_all_adults',
  'figures_confirm_latency',
  // Slice 2: extraction-queue job outcomes — a run either completes (any
  // terminal doc status) or dead-letters after the attempt cap.
  'extraction_run_completed',
  'extraction_run_dead',
] as const
export type EngineMetricEvent = (typeof ENGINE_METRIC_EVENTS)[number]

/** Field names the mechanical checks can flag, from every document schema. */
type SchemaField = {
  [T in DocumentType]: keyof (typeof DOCUMENT_SCHEMAS)[T]['fields']
}[DocumentType]

/** What a count is about: an extracted field, a checked field, or the household figure set. */
export type FieldClass = FieldKey | SchemaField | 'figures'

const SCHEMA_FIELDS = [
  ...new Set(Object.values(DOCUMENT_SCHEMAS).flatMap((s) => Object.keys(s.fields))),
] as SchemaField[]
const FIELD_CLASS_SET = new Set<string>([...FIELD_KEYS, ...SCHEMA_FIELDS, 'figures'])

export const CHECK_CODES = [
  'missing_required',
  'amount_not_whole',
  'date_not_real',
  'monthly_times_twelve_mismatch',
  'lines_do_not_add_up',
  'dates_out_of_order',
  'value_above_limit',
  'balance_does_not_reconcile',
] as const satisfies readonly Problem['code'][]
const CHECK_SET = new Set<string>(CHECK_CODES)

/** Why a bank statement produced no suggestion. */
export const REJECT_REASONS = ['fields_unparsable', 'period_out_of_range', 'check_failed'] as const
export type RejectReason = (typeof REJECT_REASONS)[number]
const REASON_SET = new Set<string>(REJECT_REASONS)

/** Time from the first adult's confirmation to every adult's, bucketed. */
export const CONFIRM_LATENCY_BUCKETS = ['lt_1h', '1h_1d', '1d_7d', '7d_plus'] as const
export type ConfirmLatencyBucket = (typeof CONFIRM_LATENCY_BUCKETS)[number]
const BUCKET_SET = new Set<string>(CONFIRM_LATENCY_BUCKETS)

export const confirmLatencyBucket = (ms: number): ConfirmLatencyBucket =>
  ms < 3_600_000 ? 'lt_1h' : ms < 86_400_000 ? '1h_1d' : ms < 7 * 86_400_000 ? '1d_7d' : '7d_plus'

export interface EngineMetricDoc {
  tenant_id: string
  event: EngineMetricEvent
  field_class: FieldClass | 'none'
  document_category: Category | 'none'
  check: Problem['code'] | 'none'
  reason: RejectReason | 'none'
  bucket: ConfirmLatencyBucket | 'none'
  at: Date
}

export interface EngineMetricInput {
  tenantId: string
  event: EngineMetricEvent
  fieldClass?: FieldClass
  documentCategory?: Category
  check?: Problem['code']
  reason?: RejectReason
  bucket?: ConfirmLatencyBucket
  at?: Date
}

const require = (name: string, set: Set<string>, v: string | undefined): string => {
  if (v === undefined || !set.has(v)) throw new RangeError(`unknown ${name}: ${String(v)}`)
  return v
}
const optional = (name: string, set: Set<string>, v: string | undefined) =>
  v === undefined ? 'none' : require(name, set, v)

/**
 * The only way to build a storable event. Throws on anything outside the
 * closed enums — callers must not catch-and-store raw strings.
 */
export function buildEngineMetricEvent(input: EngineMetricInput): EngineMetricDoc {
  if (!input.tenantId) throw new RangeError('tenant key is required')
  return {
    tenant_id: input.tenantId,
    event: require('event', new Set(ENGINE_METRIC_EVENTS), input.event) as EngineMetricEvent,
    field_class: optional('field_class', FIELD_CLASS_SET, input.fieldClass) as FieldClass | 'none',
    document_category: optional(
      'document_category',
      new Set<string>(CATEGORIES),
      input.documentCategory,
    ) as Category | 'none',
    check: optional('check', CHECK_SET, input.check) as Problem['code'] | 'none',
    reason: optional('reason', REASON_SET, input.reason) as RejectReason | 'none',
    bucket: optional('bucket', BUCKET_SET, input.bucket) as ConfirmLatencyBucket | 'none',
    at: input.at ?? new Date(),
  }
}

/** The document category as a closed enum; anything else lands on 'other'. */
export const asCategory = (v: unknown): Category =>
  typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v) ? (v as Category) : 'other'

/**
 * Append one event: an OTel span attribute set plus a row in
 * engine_metrics_events. Never throws — a metrics failure is logged and
 * dropped so it can never fail the user's request.
 */
export async function emitEngineMetric(db: Db, input: EngineMetricInput): Promise<void> {
  try {
    const doc = buildEngineMetricEvent(input)
    const span = getTracer().startSpan('engine.metric')
    span.setAttribute('tenant_id', doc.tenant_id)
    span.setAttribute('engine.event', doc.event)
    for (const [attr, v] of [
      ['engine.field_class', doc.field_class],
      ['engine.document_category', doc.document_category],
      ['engine.check', doc.check],
      ['engine.reason', doc.reason],
      ['engine.bucket', doc.bucket],
    ] as const) {
      if (v !== 'none') span.setAttribute(attr, v)
    }
    span.setStatus({ code: 1 })
    span.end()
    await db.collection<EngineMetricDoc>(ENGINE_METRICS_COLLECTION).insertOne(doc)
  } catch (err) {
    log.warn({ event: input.event, err: String(err) }, 'engine metric event dropped')
  }
}

/** Owner decision 2026-11-15: raw events are kept 24 months, then rolled up and deleted. */
export const ENGINE_METRICS_RETENTION_DAYS = 730

/**
 * Roll events older than the retention window into aggregate counts
 * (metrics_daily, metric 'engine_metric', dim '<event>|<field_class>|<category>')
 * and delete the rolled rows. Counts only — no tenant key, no content —
 * matching the existing rollup's shape.
 */
export async function rollupEngineMetricEvents(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ENGINE_METRICS_RETENTION_DAYS * 86_400_000)
  const grouped = await db
    .collection<EngineMetricDoc>(ENGINE_METRICS_COLLECTION)
    .aggregate<{ _id: { day: string; dim: string }; count: number }>([
      { $match: { at: { $lt: cutoff } } },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$at' } },
            dim: {
              $concat: ['$event', '|', '$field_class', '|', '$document_category'],
            },
          },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray()
  if (grouped.length === 0) return 0
  await db
    .collection<{
      _id: string
      day?: string
      metric?: string
      dim?: string
      count?: number
      updated_at?: Date
    }>('metrics_daily')
    .bulkWrite(
      grouped.map((g) => ({
        updateOne: {
          filter: { _id: `${g._id.day}|engine_metric|${g._id.dim}` },
          update: {
            $set: {
              day: g._id.day,
              metric: 'engine_metric',
              dim: g._id.dim,
              updated_at: now,
            },
            $inc: { count: g.count },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    )
  const { deletedCount } = await db
    .collection(ENGINE_METRICS_COLLECTION)
    .deleteMany({ at: { $lt: cutoff } })
  return deletedCount
}
