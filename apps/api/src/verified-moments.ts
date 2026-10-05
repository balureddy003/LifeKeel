import crypto from 'node:crypto'
import type { Db } from 'mongodb'
import type { Insight } from '@lifekeel/engine'

export type VerifiedMomentStatus =
  | 'verified'
  | 'approved'
  | 'dismissed'
  | 'actioned'
  | 'outcome_measured'
  | 'archived'

export interface VerifiedMomentDoc {
  id: string
  tenant_id: string
  insight_id: string
  goal_id?: string
  kpi_metric?: string
  detector_id: string
  rule_id: string
  status: VerifiedMomentStatus
  verification_method: 'deterministic_rule'
  signal_ids: string[]
  evidence_refs: string[]
  confidence: number
  hypothesis: string
  reasoning: string
  actions: string[]
  approved_at?: Date
  dismissed_at?: Date
  actioned_at?: Date
  action_receipt_ids?: string[]
  outcome?: {
    metric: string
    baseline: number
    observed: number
    delta: number
    value_minor_units: number
    currency: string
    measured_at: Date
    source: string
  }
  created_at: Date
  updated_at: Date
}

function insightRecord(insight: Insight): Record<string, unknown> {
  return insight as unknown as Record<string, unknown>
}

function featureSnapshot(insight: Insight): Record<string, unknown> {
  return (insightRecord(insight)['feature_snapshot'] as Record<string, unknown> | undefined) ?? {}
}

export function extractGoalLineage(insight: Insight): { goal_id?: string; kpi_metric?: string } {
  const record = insightRecord(insight)
  const features = featureSnapshot(insight)
  const goalId = features['goal_id'] ?? record['goal_id']
  const metric = features['metric'] ?? record['metric']

  return {
    ...(typeof goalId === 'string' && goalId.length > 0 ? { goal_id: goalId } : {}),
    ...(typeof metric === 'string' && metric.length > 0 ? { kpi_metric: metric } : {}),
  }
}

export async function ensureVerifiedMoment(
  db: Db,
  insight: Insight,
  tenantId = insight.tenant_id,
): Promise<string> {
  const col = db.collection<VerifiedMomentDoc>('verified_moments')
  await Promise.all([
    col.createIndex({ tenant_id: 1, created_at: -1 }),
    col.createIndex({ tenant_id: 1, goal_id: 1, created_at: -1 }),
    col.createIndex({ tenant_id: 1, insight_id: 1 }, { unique: true }),
    col.createIndex({ tenant_id: 1, status: 1 }),
  ]).catch(() => {})

  const id = `vm_${crypto.createHash('sha256').update(`${tenantId}:${insight.id}`).digest('hex').slice(0, 24)}`
  const signalIds = [...new Set([...(insight.derived_from_signals ?? []), ...insight.confidence_breakdown.evidence_refs])]
  const now = new Date()
  const lineage = extractGoalLineage(insight)

  await col.updateOne(
    { tenant_id: tenantId, insight_id: insight.id },
    {
      $setOnInsert: {
        id,
        tenant_id: tenantId,
        insight_id: insight.id,
        detector_id: insight.detector_id,
        rule_id: insight.rule_id,
        status: 'verified',
        verification_method: 'deterministic_rule',
        hypothesis: insight.hypothesis,
        created_at: insight.created_at,
      },
      $set: {
        updated_at: now,
        signal_ids: signalIds,
        evidence_refs: insight.confidence_breakdown.evidence_refs,
        confidence: insight.confidence_breakdown.or_score,
        reasoning: insight.reasoning,
        actions: insight.actions,
        ...lineage,
      },
    },
    { upsert: true },
  )

  return id
}

export async function ensureVerifiedMoments(db: Db, insights: Insight[], tenantId?: string): Promise<void> {
  await Promise.all(insights.map((insight) => ensureVerifiedMoment(db, insight, tenantId ?? insight.tenant_id)))
}

export async function recordMomentDecision(
  db: Db,
  opts: {
    tenantId: string
    insightId: string
    decision: 'approve' | 'dismiss'
    actionReceiptIds?: string[]
  },
): Promise<void> {
  const now = new Date()
  const status: VerifiedMomentStatus = opts.decision === 'approve'
    ? opts.actionReceiptIds && opts.actionReceiptIds.length > 0 ? 'actioned' : 'approved'
    : 'dismissed'

  await db.collection<VerifiedMomentDoc>('verified_moments').updateOne(
    { tenant_id: opts.tenantId, insight_id: opts.insightId },
    {
      $set: {
        status,
        updated_at: now,
        ...(opts.decision === 'approve' ? { approved_at: now } : { dismissed_at: now }),
        ...(status === 'actioned' ? { actioned_at: now } : {}),
        ...(opts.actionReceiptIds ? { action_receipt_ids: opts.actionReceiptIds } : {}),
      },
    },
  )
}

export async function recordMomentOutcome(
  db: Db,
  opts: {
    tenantId: string
    momentId: string
    metric: string
    baseline: number
    observed: number
    valueMinorUnits?: number
    currency?: string
    source?: string
  },
): Promise<boolean> {
  const measuredAt = new Date()
  const result = await db.collection<VerifiedMomentDoc>('verified_moments').updateOne(
    { tenant_id: opts.tenantId, id: opts.momentId },
    {
      $set: {
        status: 'outcome_measured',
        updated_at: measuredAt,
        outcome: {
          metric: opts.metric,
          baseline: opts.baseline,
          observed: opts.observed,
          delta: Math.round((opts.observed - opts.baseline) * 10000) / 10000,
          value_minor_units: Math.round(opts.valueMinorUnits ?? 0),
          currency: opts.currency ?? 'GBP',
          measured_at: measuredAt,
          source: opts.source ?? 'manual',
        },
      },
    },
  )
  return result.matchedCount > 0
}
