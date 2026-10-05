import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import type {
  KpiReconciliation,
  KpiSourceContribution,
  KpiSourceType,
} from '@lifekeel/specifications'

export const DEFAULT_KPI_DISCREPANCY_THRESHOLD_PCT = 10
export const DEFAULT_KPI_SOURCE_TYPE_PRIORITIES: Record<KpiSourceType, number> = {
  connector: 300,
  computed: 200,
  manual: 100,
}

/**
 * Unit conversion table. Maps (sourceUnit → canonicalUnit) to a multiplier.
 * When a KPI contribution's `unit` differs from the canonical unit for that
 * metric, the reconciliation engine normalizes the value before comparing —
 * preventing a silent unit mismatch from looking like (or masking) a real
 * discrepancy.
 *
 * This is the equivalent of Apple Health normalizing km vs miles before
 * comparing step counts from different sources.
 *
 * Keys are `${sourceUnit}→${canonicalUnit}`. Extend this table as new
 * metric/unit combinations are added.
 */
const UNIT_CONVERSIONS: Record<string, number> = {
  // Currency: pence/cents → major units
  'pence→GBP': 0.01,
  'cents→USD': 0.01,
  'cents→EUR': 0.01,
  'paise→INR': 0.01,
  // Percentage: fraction → percent
  'fraction→pct': 100,
  // Basis points → percent
  'bps→pct': 0.01,
  // Time: seconds → minutes, minutes → hours
  'seconds→minutes': 1 / 60,
  'minutes→hours': 1 / 60,
  'hours→days': 1 / 24,
}

/**
 * Normalize a contribution's value to the canonical unit.
 * Returns the original value if no conversion is needed or known.
 */
function normalizeValue(
  value: number,
  sourceUnit: string | undefined,
  canonicalUnit: string | undefined,
): number {
  if (!sourceUnit || !canonicalUnit || sourceUnit === canonicalUnit) return value
  const key = `${sourceUnit}→${canonicalUnit}`
  const factor = UNIT_CONVERSIONS[key]
  if (factor !== undefined) return value * factor
  // No known conversion — return as-is but the discrepancy check will
  // flag it if the values diverge, which is the safe default.
  return value
}

export interface KpiSourceSettings {
  source_priorities: Record<string, number>
  source_type_priorities: Record<KpiSourceType, number>
  discrepancy_threshold_pct: number
  /** Per-metric canonical unit. When set, contributions in other units
   * are normalized before comparison. E.g. { revenue: 'GBP' } means
   * a contribution reporting revenue in 'pence' will be divided by 100. */
  metric_units: Record<string, string>
}

interface ContributionInput {
  value: number
  sourceId: string
  sourceType?: KpiSourceType
  unit?: string
  periodStart?: Date
  periodEnd?: Date
  observedAt?: Date
  metadata?: Record<string, unknown>
}

interface StoredContribution extends Omit<KpiSourceContribution, 'period_start' | 'period_end' | 'observed_at'> {
  id: string
  period_start: Date
  period_end: Date
  observed_at: Date
  recorded_at: Date
  source: string
}

export function inferKpiSourceType(sourceId: string): KpiSourceType {
  if (sourceId === 'manual' || sourceId.startsWith('manual:')) return 'manual'
  if (sourceId === 'compute_engine') return 'connector'
  if (sourceId.startsWith('computed:')) return 'computed'
  return 'connector'
}

export async function getKpiSourceSettings(db: Db, tenantId: string): Promise<KpiSourceSettings> {
  const doc = await db.collection('tenant_settings').findOne({ tenant_id: tenantId })
  const stored = doc?.['goal_data_sources'] as Partial<KpiSourceSettings> | undefined
  return {
    source_priorities: stored?.source_priorities ?? {},
    source_type_priorities: {
      ...DEFAULT_KPI_SOURCE_TYPE_PRIORITIES,
      ...(stored?.source_type_priorities ?? {}),
    },
    discrepancy_threshold_pct: stored?.discrepancy_threshold_pct ?? DEFAULT_KPI_DISCREPANCY_THRESHOLD_PCT,
    metric_units: stored?.metric_units ?? {},
  }
}

function priorityFor(contribution: KpiSourceContribution, settings: KpiSourceSettings): number {
  return settings.source_priorities[contribution.source_id]
    ?? settings.source_type_priorities[contribution.source_type]
    ?? 0
}

function periodsOverlap(left: KpiSourceContribution, right: KpiSourceContribution): boolean {
  return new Date(left.period_start).getTime() <= new Date(right.period_end).getTime()
    && new Date(right.period_start).getTime() <= new Date(left.period_end).getTime()
}

export function reconcileKpiContributions(
  metric: string,
  contributions: KpiSourceContribution[],
  settings: KpiSourceSettings,
  now = new Date(),
): KpiReconciliation | null {
  if (contributions.length === 0) return null

  // Normalize all contributions to the metric's canonical unit before
  // ranking and comparing. This prevents a source reporting in pence
  // from looking like a 100x discrepancy vs a source reporting in GBP.
  const canonicalUnit = settings.metric_units[metric]
  const normalized = contributions.map(c => ({
    ...c,
    value: normalizeValue(c.value, c.unit, canonicalUnit),
  }))

  const ranked = [...normalized].sort((left, right) => {
    const priorityDelta = priorityFor(right, settings) - priorityFor(left, settings)
    if (priorityDelta !== 0) return priorityDelta
    return new Date(right.observed_at).getTime() - new Date(left.observed_at).getTime()
  })
  const selected = ranked[0]!
  const overlapping = ranked.filter(candidate => candidate.source_id !== selected.source_id && periodsOverlap(selected, candidate))
  let maxDeltaPct = 0
  const conflictingSourceIds: string[] = []
  for (const candidate of overlapping) {
    const denominator = Math.max(Math.abs(selected.value), Math.abs(candidate.value), Number.EPSILON)
    const deltaPct = Math.abs(selected.value - candidate.value) / denominator * 100
    maxDeltaPct = Math.max(maxDeltaPct, deltaPct)
    if (deltaPct > settings.discrepancy_threshold_pct) conflictingSourceIds.push(candidate.source_id)
  }
  return {
    metric,
    value: selected.value,
    selected_source_id: selected.source_id,
    selected_source_type: selected.source_type,
    contributions: ranked,
    discrepancy: {
      detected: conflictingSourceIds.length > 0,
      threshold_pct: settings.discrepancy_threshold_pct,
      max_delta_pct: Math.round(maxDeltaPct * 100) / 100,
      conflicting_source_ids: conflictingSourceIds,
    },
    reconciled_at: now,
  }
}

function dayPeriod(observedAt: Date): { start: Date; end: Date } {
  const start = new Date(observedAt)
  start.setUTCHours(0, 0, 0, 0)
  return { start, end: new Date(start.getTime() + 86_400_000 - 1) }
}

function normalizeStoredContribution(doc: Record<string, unknown>): StoredContribution {
  const observedAt = new Date((doc['observed_at'] ?? doc['recorded_at']) as string | Date)
  const period = dayPeriod(observedAt)
  const sourceId = String(doc['source_id'] ?? doc['source'] ?? 'manual')
  return {
    id: String(doc['id'] ?? doc['_id'] ?? randomUUID()),
    tenant_id: String(doc['tenant_id']),
    goal_id: String(doc['goal_id']),
    metric: String(doc['metric']),
    source_id: sourceId,
    source_type: (doc['source_type'] as KpiSourceType | undefined) ?? inferKpiSourceType(sourceId),
    value: Number(doc['value']),
    unit: doc['unit'] as string | undefined,
    period_start: new Date((doc['period_start'] ?? period.start) as string | Date),
    period_end: new Date((doc['period_end'] ?? period.end) as string | Date),
    observed_at: observedAt,
    recorded_at: new Date((doc['recorded_at'] ?? observedAt) as string | Date),
    source: String(doc['source'] ?? sourceId),
    ...(doc['metadata'] ? { metadata: doc['metadata'] as Record<string, unknown> } : {}),
  }
}

export async function reconcileGoalKpi(
  db: Db,
  tenantId: string,
  goalId: string,
  metric: string,
): Promise<KpiReconciliation | null> {
  const docs = await db.collection('goal_kpi_snapshots')
    .find({ tenant_id: tenantId, goal_id: goalId, metric })
    .sort({ recorded_at: -1 })
    .limit(200)
    .toArray()
  const latestBySource = new Map<string, StoredContribution>()
  for (const doc of docs) {
    const contribution = normalizeStoredContribution(doc)
    if (!latestBySource.has(contribution.source_id)) latestBySource.set(contribution.source_id, contribution)
  }
  const settings = await getKpiSourceSettings(db, tenantId)
  const reconciliation = reconcileKpiContributions(metric, [...latestBySource.values()], settings)
  if (!reconciliation) return null
  await db.collection('goals').updateOne(
    { id: goalId, tenant_id: tenantId, 'kpis.metric': metric },
    {
      $set: {
        'kpis.$.current': reconciliation.value,
        'kpis.$.reconciliation': reconciliation,
        updated_at: new Date(),
      },
    },
  ).catch(() => {})
  return reconciliation
}

export async function recordKpiContribution(
  db: Db,
  tenantId: string,
  goalId: string,
  metric: string,
  input: ContributionInput,
): Promise<KpiReconciliation> {
  const observedAt = input.observedAt ?? new Date()
  const period = dayPeriod(observedAt)
  const sourceType = input.sourceType ?? inferKpiSourceType(input.sourceId)
  const contribution: StoredContribution = {
    id: randomUUID(),
    tenant_id: tenantId,
    goal_id: goalId,
    metric,
    source_id: input.sourceId,
    source_type: sourceType,
    value: input.value,
    unit: input.unit,
    period_start: input.periodStart ?? period.start,
    period_end: input.periodEnd ?? period.end,
    observed_at: observedAt,
    recorded_at: observedAt,
    source: input.sourceId,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }
  await db.collection('goal_kpi_snapshots').insertOne(contribution)
  const reconciliation = await reconcileGoalKpi(db, tenantId, goalId, metric)
  if (!reconciliation) throw new Error('KPI contribution could not be reconciled')
  return reconciliation
}
