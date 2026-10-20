/**
 * AI processor registry (PRD-142, CLAUDE.md rule 3).
 *
 * The task registry says what a task may do; this one says who may do it. Every
 * party that can receive a family's content (a hosted model provider, or our own
 * self-hosted model) is an entry with the facts a data-protection review needs:
 * endpoint, region, terms reference, no-training basis, retention per model,
 * sub-processors, transfer mechanism, DPA date, breach-notice SLA and a review
 * date. The loader refuses an entry with any field blank.
 *
 * A hosted processor starts `unreviewed` and every unknown fact is the explicit
 * sentinel `not_reviewed`, never an invented value. It only becomes `approved`
 * when the owner supplies real terms: the loader then refuses the sentinel and
 * requires real dates. A lapsed review blocks it again.
 *
 * Check a call with `checkProcessorForTask`; the gateway applies it before any
 * provider is contacted, in `warn` or `enforce` mode.
 */
import type { AiTaskPolicy } from './task-gateway.js'

export const NOT_REVIEWED = 'not_reviewed'

export type RetentionClass =
  'none' | 'service_transient' | 'zero_data_retention' | 'limited_abuse_log'

/** Exposure ranking: a processor may not retain more than the task tolerates. */
const RETENTION_RANK: Record<RetentionClass, number> = {
  none: 0,
  // Contractual zero retention leaves no copy at the provider, same exposure as none.
  zero_data_retention: 0,
  service_transient: 1,
  limited_abuse_log: 2,
}

export interface ProcessorEntry {
  id: string
  name: string
  /** `self_hosted` runs in LifeKeel-operated infrastructure: no third party sees content. */
  hosting: 'self_hosted' | 'hosted'
  status: 'approved' | 'unreviewed' | 'self_hosted'
  endpoint: string
  region: string
  terms_ref: string
  no_training_basis: string
  /** Retention class per model handle; `*` applies to any model not listed. */
  retention: Record<string, RetentionClass>
  sub_processors: string[]
  transfer_mechanism: string
  dpa_date: string
  breach_notice_sla: string
  reviewed_at: string
  review_due: string
}

export type ProcessorRegistry = Map<string, ProcessorEntry>

export class ProcessorRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProcessorRegistryError'
  }
}

const TEXT_FIELDS = [
  'name',
  'endpoint',
  'region',
  'terms_ref',
  'no_training_basis',
  'transfer_mechanism',
  'dpa_date',
  'breach_notice_sla',
  'reviewed_at',
  'review_due',
] as const

const isRetention = (v: unknown): v is RetentionClass =>
  typeof v === 'string' && v in RETENTION_RANK

const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))

export function parseProcessorRegistry(doc: unknown): ProcessorRegistry {
  const processors = (doc as { processors?: unknown } | null)?.processors
  if (processors === null || typeof processors !== 'object') {
    throw new ProcessorRegistryError("Processor registry has no 'processors' mapping")
  }
  const registry: ProcessorRegistry = new Map()
  for (const [id, raw] of Object.entries(processors as Record<string, unknown>)) {
    if (raw === null || typeof raw !== 'object') {
      throw new ProcessorRegistryError(`Processor '${id}' is not a mapping`)
    }
    const e = raw as Record<string, unknown>
    for (const f of TEXT_FIELDS) {
      if (typeof e[f] !== 'string' || (e[f] as string).trim() === '') {
        throw new ProcessorRegistryError(`Processor '${id}' has a blank '${f}'`)
      }
    }
    if (e['hosting'] !== 'self_hosted' && e['hosting'] !== 'hosted') {
      throw new ProcessorRegistryError(`Processor '${id}' hosting must be self_hosted or hosted`)
    }
    if (
      e['status'] !== 'approved' &&
      e['status'] !== 'unreviewed' &&
      e['status'] !== 'self_hosted'
    ) {
      throw new ProcessorRegistryError(`Processor '${id}' has an invalid status`)
    }
    if ((e['hosting'] === 'self_hosted') !== (e['status'] === 'self_hosted')) {
      throw new ProcessorRegistryError(
        `Processor '${id}': status self_hosted goes with hosting self_hosted, and only with it`,
      )
    }
    const sub = e['sub_processors']
    if (!Array.isArray(sub) || sub.some((s) => typeof s !== 'string' || s.trim() === '')) {
      throw new ProcessorRegistryError(
        `Processor '${id}' needs a sub_processors list (use [${NOT_REVIEWED}] when unknown)`,
      )
    }
    if (sub.length === 0 && e['hosting'] === 'hosted') {
      throw new ProcessorRegistryError(
        `Processor '${id}' has an empty sub_processors list: say 'none' or the names`,
      )
    }
    const retention = e['retention']
    if (
      retention === null ||
      typeof retention !== 'object' ||
      Object.keys(retention as object).length === 0 ||
      !Object.values(retention as object).every(isRetention)
    ) {
      throw new ProcessorRegistryError(`Processor '${id}' needs a retention class per model`)
    }
    if (e['status'] === 'approved') {
      // Approval means real terms, not placeholders.
      for (const f of TEXT_FIELDS) {
        if (e[f] === NOT_REVIEWED) {
          throw new ProcessorRegistryError(
            `Approved processor '${id}' still has '${f}: ${NOT_REVIEWED}'`,
          )
        }
      }
      if ((sub as string[]).includes(NOT_REVIEWED)) {
        throw new ProcessorRegistryError(
          `Approved processor '${id}' still lists sub-processors as ${NOT_REVIEWED}`,
        )
      }
      for (const f of ['dpa_date', 'reviewed_at', 'review_due'] as const) {
        if (!isIsoDate(e[f] as string)) {
          throw new ProcessorRegistryError(`Approved processor '${id}' needs '${f}' as YYYY-MM-DD`)
        }
      }
    }
    registry.set(id, { ...(e as unknown as ProcessorEntry), id })
  }
  if (registry.size === 0)
    throw new ProcessorRegistryError('Processor registry contains no processors')
  return registry
}

export type ProcessorViolationReason =
  | 'processor_unknown'
  | 'processor_not_allowed_for_task'
  | 'processor_unreviewed'
  | 'review_lapsed'
  | 'retention_unknown'
  | 'retention_exceeds_task'

export interface ProcessorViolation {
  reason: ProcessorViolationReason
  task_id: string
  processor: string
  detail: string
}

/**
 * Is this processor allowed to serve this task now? Returns the first
 * violation, or null when it may. Pure: no I/O, no clock besides `now`.
 */
export function checkProcessorForTask(
  registry: ProcessorRegistry,
  policy: AiTaskPolicy,
  processorId: string,
  model: string,
  now: Date,
): ProcessorViolation | null {
  const v = (reason: ProcessorViolationReason, detail: string): ProcessorViolation => ({
    reason,
    task_id: policy.task_id,
    processor: processorId,
    detail,
  })
  const entry = registry.get(processorId)
  if (!entry) return v('processor_unknown', `'${processorId}' is not in the processor registry`)
  if (policy.allowed_processors && !policy.allowed_processors.includes(processorId)) {
    return v(
      'processor_not_allowed_for_task',
      `'${processorId}' is not in task '${policy.task_id}' allowed_processors [${policy.allowed_processors.join(', ')}]`,
    )
  }
  if (entry.status === 'self_hosted') return null
  if (entry.status === 'unreviewed') {
    return v('processor_unreviewed', `'${processorId}' has no reviewed terms yet`)
  }
  if (Date.parse(entry.review_due) < now.getTime()) {
    return v('review_lapsed', `'${processorId}' review was due ${entry.review_due}`)
  }
  const cls = entry.retention[model] ?? entry.retention['*']
  if (!cls) return v('retention_unknown', `no retention class recorded for model '${model}'`)
  const tolerated = policy.provider_retention_class
  if (tolerated && RETENTION_RANK[cls] > RETENTION_RANK[tolerated]) {
    return v(
      'retention_exceeds_task',
      `'${processorId}' keeps data as ${cls}, more than task '${policy.task_id}' tolerates (${tolerated})`,
    )
  }
  return null
}
