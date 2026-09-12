/**
 * Goals — define measurable business goals with KPIs and track progress.
 *
 * A Goal is a structured intent: "I want to achieve X by Y date".
 * KPIs are the measurable dimensions: metric name, unit, target value.
 * Progress is computed live from the signals/events already in MongoDB.
 *
 * Generic — works for any domain:
 *   Social:   { metric: 'linkedin_followers', target: 5000, unit: 'followers' }
 *   Finance:  { metric: 'overdue_recovery_rate', target: 0.85, unit: 'ratio' }
 *   Ops:      { metric: 'avg_days_to_close', target: 7, unit: 'days' }
 *
 * Progress calculation:
 *   - current value is read from the latest signal snapshot for that metric
 *   - pace = (current - start_value) / days_elapsed
 *   - projected_completion = start_date + target / pace
 *   - status: on_track | behind | ahead | achieved | stalled
 *
 * Routes:
 *   POST   /goals                     — create a goal
 *   GET    /goals                     — list all goals for tenant
 *   GET    /goals/:id                 — single goal with live progress
 *   PATCH  /goals/:id                 — update goal (rename, adjust target)
 *   DELETE /goals/:id                 — archive goal
 *   POST   /goals/:id/kpis/:metric/snapshot  — manually push a metric reading
 *   GET    /goals/:id/insights        — insights linked to this goal
 */

import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db, Collection } from 'mongodb'
import { projectGoal, type Engine, type GoalProjection, type Insight } from '@kairos/engine'
import type { KpiComputeEngine } from '../jobs/kpi-compute-engine.js'
import { XGoalMetricsSync } from '../jobs/x-goal-metrics-sync.js'
import type { DeliveryRouter } from '../delivery/delivery-router.js'
import { persistAndDeliverInsights } from '../insights-persist.js'
import { CausalExperimentTracker, type OutcomeAttribution } from '@kairos/workflows'
import type { GoalReport, Kpi as SharedKpi, GoalDoc as SharedGoalDoc, KpiProgress as SharedKpiProgress, GoalProgress as SharedGoalProgress, KpiReconciliation } from '@kairos/specifications'
import { refreshGoalDetectorActivations } from '../goals/goal-detector-activations.js'
import { computeKpiProgress as sharedComputeKpiProgress, computeOverallStatus as sharedComputeOverallStatus, type KpiForProgress } from '../goals/progress-compute.js'
import { FreeTierPolicy } from '@kairos/platform'
import { getCache } from '../lib/redis-cache.js'
import { createGoalIdempotently } from '../goals/goal-idempotency.js'
import { recordKpiContribution, reconcileGoalKpi } from '../goals/kpi-source-reconciliation.js'

// ── Schema ─────────────────────────────────────────────────────────────────────

const KpiSchema = z.object({
  metric:      z.string().min(1).max(128),
  label:       z.string().min(1).max(256),
  unit:        z.string().max(32).default(''),
  target:      z.number(),
  start_value: z.number().default(0),
  current:     z.number().default(0),
  direction:   z.enum(['increase', 'decrease']).default('increase'),
  kpi_status:  z.enum(['live', 'pending_connector', 'manual_only']).default('live'),
  // ── Universal KPI compute engine config ──────────────────────────────────
  // When source='signals', the nightly KpiComputeEngine auto-updates `current`
  // by running a MongoDB aggregation over the signals collection.
  source:      z.enum(['signals', 'external_api', 'manual']).default('manual'),
  signal_types:             z.array(z.string()).optional(),
  aggregation:              z.enum(['count','sum','avg','last','min','max','rate']).optional(),
  field:                    z.string().optional(),   // dot-path: 'data.amount_minor'
  filter:                   z.string().optional(),   // filtrex: 'data.days_overdue > 0'
  window_days:              z.number().int().optional(),
  denominator_signal_types: z.array(z.string()).optional(),
  denominator_filter:       z.string().optional(),
})

const GoalCreateSchema = z.object({
  name:         z.string().min(1).max(256),
  description:  z.string().max(1000).optional(),
  timeline_days: z.number().int().min(1).max(3650).default(90),
  kpis:         z.array(KpiSchema).min(1).max(10),
  tags:         z.array(z.string()).default([]),
  detector_ids: z.array(z.string()).default([]),  // detectors that feed this goal
  at_risk_threshold: z.number().min(0).max(1).default(0.4),
  template_id: z.string().min(1).optional(),
  vertical: z.string().min(1).optional(),
  parent_goal_id: z.string().min(1).optional(),
})

export type Kpi = z.infer<typeof KpiSchema> & { reconciliation?: KpiReconciliation }
export type GoalCreate = z.infer<typeof GoalCreateSchema>

// GoalDoc uses the shared type from @kairos/specifications, with Date overrides
// for MongoDB compatibility (the shared type uses string | Date for JSON serialization).
export interface GoalDoc extends Omit<SharedGoalDoc, 'start_date' | 'target_date' | 'created_at' | 'updated_at' | 'kpis' | 'trajectory'> {
  start_date: Date
  target_date: Date
  kpis: Kpi[]
  created_at: Date
  updated_at: Date
}

export interface KpiProgress extends SharedKpiProgress {}

export interface GoalProgress extends Omit<SharedGoalProgress, 'goal'> {
  goal: GoalDoc
}

// ── Progress computation ───────────────────────────────────────────────────────
// Gap A4: these now delegate to the shared module in goals/progress-compute.ts
// so that kpi-compute-engine.ts and the frontend all use the same formula.
// The shared module also contains the gap A2 fix for decrease-direction KPIs.

function computeKpiProgress(kpi: Kpi, startDate: Date, timelineDays: number): KpiProgress {
  return sharedComputeKpiProgress(kpi as KpiForProgress, startDate, timelineDays)
}

function computeOverallStatus(kpiProgresses: KpiProgress[]): GoalProgress['overall_status'] {
  return sharedComputeOverallStatus(kpiProgresses)
}

function buildSummary(overall: string, kpis: KpiProgress[]): string {
  const behind = kpis.filter(k => k.status === 'behind')
  const achieved = kpis.filter(k => k.status === 'achieved')

  if (overall === 'achieved') return `All ${kpis.length} KPIs achieved 🎉`
  if (overall === 'stalled') return `Progress stalled — no movement detected in recent days`
  if (behind.length > 0) {
    return `${behind.length} KPI${behind.length > 1 ? 's' : ''} behind pace: ${behind.map(k => k.label).join(', ')}`
  }
  if (achieved.length > 0) {
    return `${achieved.length}/${kpis.length} KPIs achieved, remaining on track`
  }
  return `On track — ${kpis[0]!.pct_complete * 100 | 0}% complete`
}

/** BUG-002 safeguard: find an existing active goal with the same name for
 * this tenant, so creation can be idempotent instead of producing duplicate
 * documents with disagreeing progress. Returns the existing goal or null. */
export async function findDuplicateGoal(
  col: Collection<GoalDoc>,
  tenantId: string,
  name: string,
): Promise<GoalDoc | null> {
  return col.findOne({
    tenant_id: tenantId,
    name,
    status: { $nin: ['archived', 'achieved', 'failed'] },
  })
}

async function recomputeGoalProjection(db: Db, goal: GoalDoc, asOf = new Date()): Promise<GoalProjection> {
  const atRiskThreshold = goal.at_risk_threshold ?? 0.4
  const snapshots = db.collection('goal_kpi_snapshots')
  const insights = await db.collection<Insight>('insights')
    .find({
      tenant_id: goal.tenant_id,
      created_at: { $gte: goal.start_date },
      ...(goal.detector_ids.length > 0 ? { detector_id: { $in: goal.detector_ids } } : {}),
    })
    .sort({ created_at: -1 })
    .limit(500)
    .toArray()

  const byDetector = new Map<string, { total: number; score: number; headwind: boolean }>()
  for (const insight of insights) {
    const current = byDetector.get(insight.detector_id) ?? { total: 0, score: 0, headwind: false }
    current.total += 1
    current.score += insight.confidence_breakdown.combined_score
    current.headwind ||= insight.category === 'risk' || insight.category === 'compliance'
    byDetector.set(insight.detector_id, current)
  }

  const resolved = insights.filter(insight => insight.state === 'completed' || insight.state === 'dismissed')
  const approved = resolved.filter(insight => insight.state === 'completed').length
  const evidenceCount = await snapshots.countDocuments({
    tenant_id: goal.tenant_id,
    goal_id: goal.id,
    recorded_at: { $gte: goal.start_date, $lte: asOf },
  })

  const projection = projectGoal({
    goal_id: goal.id,
    start_date: goal.start_date,
    target_date: goal.target_date,
    kpis: goal.kpis.map(kpi => ({
      id: kpi.metric,
      direction: kpi.direction,
      start_value: kpi.start_value,
      current: kpi.current,
      target: kpi.target,
    })),
    detector_signals: [...byDetector.entries()].map(([detector_id, value]) => ({
      detector_id,
      calibrated_hit_rate: value.score / value.total,
      direction: value.headwind ? 'headwind' : 'driving',
    })),
    ...(resolved.length > 0 ? { approval_rate: approved / resolved.length } : {}),
    evidence_count: evidenceCount,
  }, asOf)

  const remainingFraction = Math.max(0,
    (goal.target_date.getTime() - asOf.getTime())
      / (goal.target_date.getTime() - goal.start_date.getTime()),
  )
  let status = goal.status
  if (goal.kpis.every(kpi => computeKpiProgress(kpi, goal.start_date, goal.timeline_days).status === 'achieved')) {
    status = 'achieved'
  } else if (asOf >= goal.target_date) {
    status = 'failed'
  } else if (remainingFraction > 0.2 && projection.completion_probability < atRiskThreshold) {
    status = 'at_risk'
  } else if (status === 'at_risk' && projection.completion_probability >= atRiskThreshold) {
    status = 'active'
  }

  await Promise.all([
    db.collection('goal_projections').insertOne({
      ...projection,
      tenant_id: goal.tenant_id,
      status,
      threshold: atRiskThreshold,
    }),
    db.collection<GoalDoc>('goals').updateOne(
      { id: goal.id, tenant_id: goal.tenant_id },
      { $set: { trajectory: projection, status, updated_at: asOf } },
    ),
  ])

  return projection
}

// ── Route registration ─────────────────────────────────────────────────────────

export function registerGoalRoutes(
  app: FastifyInstance,
  db: Db,
  kpiEngine?: KpiComputeEngine,
  engine?: Engine,
  deliveryRouter?: DeliveryRouter,
): void {
  const col = db.collection<GoalDoc>('goals')
  const snapshots = db.collection('goal_kpi_snapshots')
  const projections = db.collection('goal_projections')

  // Indexes
  Promise.all([
    col.createIndex({ tenant_id: 1, created_at: -1 }),
    col.createIndex({ tenant_id: 1, status: 1 }),
    snapshots.createIndex({ tenant_id: 1, goal_id: 1, metric: 1, recorded_at: -1 }),
    snapshots.createIndex({ tenant_id: 1, goal_id: 1, metric: 1, source_id: 1, observed_at: -1 }),
    projections.createIndex({ tenant_id: 1, goal_id: 1, as_of: -1 }),
  ]).catch(() => {})

  async function reconcileGoalForRead(goal: GoalDoc): Promise<GoalDoc> {
    const reconciliations = await Promise.all(
      goal.kpis.map(kpi => reconcileGoalKpi(db, goal.tenant_id, goal.id, kpi.metric)),
    )
    return {
      ...goal,
      kpis: goal.kpis.map((kpi, index) => {
        const reconciliation = reconciliations[index]
        return reconciliation ? { ...kpi, current: reconciliation.value, reconciliation } : kpi
      }),
    }
  }

  function progressForGoal(goal: GoalDoc): GoalProgress {
    const kpiProgresses = goal.kpis.map(kpi => {
      const progress = computeKpiProgress(kpi, goal.start_date, goal.timeline_days)
      return { ...progress, ...(kpi.reconciliation && { reconciliation: kpi.reconciliation }) }
    })
    const overall = computeOverallStatus(kpiProgresses)
    const now = new Date()
    const duration = goal.target_date.getTime() - goal.start_date.getTime()
    const pctTimeElapsed = duration > 0
      ? Math.min(1, Math.max(0, (now.getTime() - goal.start_date.getTime()) / duration))
      : 1
    return {
      goal,
      kpis: kpiProgresses,
      overall_status: overall,
      pct_time_elapsed: Math.round(pctTimeElapsed * 1000) / 1000,
      summary: buildSummary(overall, kpiProgresses),
    }
  }

  // ── POST /goals ──────────────────────────────────────────────────────────────
  app.post<{ Body: GoalCreate }>('/goals', async (req, reply) => {
    const sunset = process.env['LEGACY_GOALS_SUNSET'] ?? '2028-06-06T00:00:00.000Z'
    reply.header('Deprecation', 'Sat, 06 Jun 2026 00:00:00 GMT')
    reply.header('Sunset', new Date(sunset).toUTCString())
    reply.header('Link', '<https://docs.kairos.ai/migration/goals-to-outcomes>; rel="successor-version"')
    if (Date.now() >= new Date(sunset).getTime()) {
      return reply.status(410).send({ error: 'Legacy goal creation has been sunset; use OutcomeContract API' })
    }
    const parsed = GoalCreateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid goal',
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }

    const { tenant_id } = req.authContext
    const tenant = await db.collection('tenants').findOne({ $or: [{ tenant_id }, { id: tenant_id }] })
    const activeGoals = await col.countDocuments({ tenant_id, status: { $nin: ['archived', 'achieved', 'failed'] } })
    const quota = new FreeTierPolicy().check('active_goals', activeGoals, String(tenant?.['tier'] ?? 'free'))
    if (!quota.allowed) return reply.status(402).send({ error: 'Active goal quota exceeded', quota })

    // BUG-002 safeguard: if an active goal with the same name already exists
    // for this tenant, return it idempotently instead of creating a duplicate
    // document. Without this, confirming a compile twice or re-creating a
    // goal produces two records with different IDs and disagreeing progress.
    const existing = await findDuplicateGoal(col, tenant_id, parsed.data.name)
    if (existing) {
      return reply.status(200).send({ goal: existing, deduplicated: true })
    }

    // Connector pre-flight check for KPIs with source: 'signals'
    const connectedConnectors = await db.collection('connector_credentials')
      .find({ tenant_id })
      .project({ connector_id: 1 })
      .toArray()
    const connectedConnectorIds = new Set(connectedConnectors.map(c => c['connector_id'] as string))
    
    // Map signal types to required connectors
    const signalTypeToConnector: Record<string, string> = {
      'xero.invoice.paid': 'xero',
      'xero.invoice.created': 'xero',
      'stripe.payment.succeeded': 'stripe',
      'stripe.invoice.paid': 'stripe',
      'hubspot.contact.created': 'hubspot',
      'hubspot.deal.created': 'hubspot',
      // Add more mappings as needed
    }
    
    const kpisWithStatus = parsed.data.kpis.map(kpi => {
      let kpiStatus: 'live' | 'pending_connector' | 'manual_only' = 'live'
      
      if (kpi.source === 'manual') {
        kpiStatus = 'manual_only'
      } else if (kpi.source === 'signals' && kpi.signal_types) {
        // Check if any signal type requires a connector that's not connected
        const missingConnector = kpi.signal_types.some(signalType => {
          const requiredConnector = signalTypeToConnector[signalType]
          return requiredConnector && !connectedConnectorIds.has(requiredConnector)
        })
        if (missingConnector) {
          kpiStatus = 'pending_connector'
        }
      }
      
      return { ...kpi, kpi_status: kpiStatus }
    })
    
    const now = new Date()
    const targetDate = new Date(now.getTime() + parsed.data.timeline_days * 86_400_000)

    const goal: GoalDoc = {
      id: randomUUID(),
      tenant_id,
      name: parsed.data.name,
      ...(parsed.data.description && { description: parsed.data.description }),
      timeline_days: parsed.data.timeline_days,
      start_date: now,
      target_date: targetDate,
      kpis: kpisWithStatus,
      tags: parsed.data.tags,
      detector_ids: parsed.data.detector_ids,
      at_risk_threshold: parsed.data.at_risk_threshold,
      status: 'active',
      ...(parsed.data.template_id && { template_id: parsed.data.template_id }),
      ...(parsed.data.vertical && { vertical: parsed.data.vertical }),
      ...(parsed.data.parent_goal_id && { parent_goal_id: parsed.data.parent_goal_id }),
      created_at: now,
      updated_at: now,
    }

    if (parsed.data.template_id && parsed.data.vertical) {
      const result = await createGoalIdempotently(
        db,
        tenant_id,
        parsed.data.template_id,
        parsed.data.vertical,
        goal,
        now,
      )
      if (result.created && engine) await refreshGoalDetectorActivations(db, engine, result.goal)
      return reply.status(result.created ? 201 : 200).send({ goal: result.goal, deduplicated: !result.created })
    }

    await col.insertOne(goal)
    if (engine) await refreshGoalDetectorActivations(db, engine, goal)
    return reply.status(201).send({ goal })
  })

  // ── GET /goals ───────────────────────────────────────────────────────────────
  app.get<{ Querystring: { status?: string } }>('/goals', async (req) => {
    const { tenant_id } = req.authContext
    const filter: Record<string, unknown> = { tenant_id }
    if (req.query.status) filter['status'] = req.query.status

    const goals = await col
      .find(filter)
      .sort({ created_at: -1 })
      .limit(50)
      .toArray()

    return { goals }
  })

  // ── GET /goals/:id ───────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/goals/:id', async (req, reply) => {
    const { tenant_id } = req.authContext
    const cacheKey = `goal:${req.params.id}:${tenant_id}`
    
    // Try cache first
    const cache = getCache()
    const cached = await cache.get(cacheKey)
    if (cached) {
      return { goal: cached }
    }
    
    // Cache miss - fetch from database
    const goal = await col.findOne({ id: req.params.id, tenant_id })
    if (!goal) return reply.status(404).send({ error: 'Goal not found' })

    // Get insight counts for 7d and 30d
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const insightFilterBase: Record<string, unknown> = {
      tenant_id,
      $or: [
        { 'feature_snapshot.goal_id': goal.id },
        { goal_id: goal.id },
      ],
    }
    if (goal.detector_ids?.length > 0) {
      ;(insightFilterBase['$or'] as Record<string, unknown>[]).push({
        detector_id: { $in: goal.detector_ids },
        created_at: { $gte: goal.created_at },
      })
    }

    const insightsCount7d = await db.collection('insights').countDocuments({
      ...insightFilterBase,
      created_at: { $gte: sevenDaysAgo },
    })
    const insightsCount30d = await db.collection('insights').countDocuments({
      ...insightFilterBase,
      created_at: { $gte: thirtyDaysAgo },
    })

    const goalWithCounts = {
      ...goal,
      insights_count_7d: insightsCount7d,
      insights_count_30d: insightsCount30d,
    }
    
    // Cache the result
    await cache.set(cacheKey, goalWithCounts)
    
    return { goal: goalWithCounts }
  })

  // ── GET /goals/:id/progress ──────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/goals/:id/progress', async (req, reply) => {
    const { tenant_id } = req.authContext
    const storedGoal = await col.findOne({ id: req.params.id, tenant_id })
    if (!storedGoal) return reply.status(404).send({ error: 'Goal not found' })
    const goal = await reconcileGoalForRead(storedGoal)
    const progress = progressForGoal(goal)
    if (progress.overall_status === 'achieved' && goal.status !== 'achieved') {
      col.updateOne({ id: goal.id, tenant_id }, { $set: { status: 'achieved', updated_at: new Date() } }).catch(() => {})
    }
    return { progress }
  })

  app.get<{ Querystring: { status?: string } }>('/goals/progress', async req => {
    const { tenant_id } = req.authContext
    const status = req.query.status ?? 'active'
    const filter: Record<string, unknown> = { tenant_id }
    if (status !== 'all') filter['status'] = status
    const storedGoals = await col.find(filter).sort({ created_at: -1 }).limit(50).toArray()
    const goals = await Promise.all(storedGoals.map(reconcileGoalForRead))
    return { goals: goals.map(progressForGoal) }
  })

  app.get<{ Params: { id: string } }>('/goals/:id/projection', async (req, reply) => {
    const { tenant_id } = req.authContext
    const goal = await col.findOne({ id: req.params.id, tenant_id })
    if (!goal) return reply.status(404).send({ error: 'Goal not found' })

    const projection = await recomputeGoalProjection(db, goal)
    return { projection }
  })

  app.post<{ Params: { id: string } }>('/goals/:id/attributions/recompute', async (req, reply) => {
    const { tenant_id } = req.authContext
    const goal = await col.findOne({ id: req.params.id, tenant_id })
    if (!goal) return reply.status(404).send({ error: 'Goal not found' })

    const tracker = new CausalExperimentTracker(db)
    const experiments = await db.collection('causal_experiments')
      .find({ tenant_id, goal_id: goal.id })
      .toArray()
    const results = (await Promise.all(experiments.map(experiment =>
      tracker.computeDueAttributions(tenant_id, String(experiment['experiment_id'])),
    ))).flat()
    return { computed: results.length, attributions: results }
  })

  app.get<{ Params: { id: string } }>('/goals/:id/report', async (req, reply) => {
    const { tenant_id } = req.authContext
    const goal = await col.findOne({ id: req.params.id, tenant_id })
    if (!goal) return reply.status(404).send({ error: 'Goal not found' })
    if (goal.status !== 'achieved' && goal.status !== 'failed') {
      return reply.status(409).send({ error: 'Goal Report is available only after a goal closes' })
    }

    const all = await db.collection<OutcomeAttribution>('outcome_attributions')
      .find({ tenant_id, goal_id: goal.id })
      .sort({ window_days: -1 })
      .toArray()
    const latest = new Map<string, OutcomeAttribution>()
    for (const attribution of all) {
      const key = `${attribution.move_id}:${attribution.metric}`
      if (!latest.has(key)) latest.set(key, attribution)
    }
    const attributions = [...latest.values()]
    const experiments = await db.collection('causal_experiments')
      .find({ tenant_id, goal_id: goal.id })
      .toArray()
    const approvedAt = new Map(experiments.map(experiment => [
      String(experiment['move_id']),
      (experiment['approved_at'] as Date).toISOString(),
    ]))
    const byMove = new Map<string, OutcomeAttribution[]>()
    for (const attribution of attributions) {
      byMove.set(attribution.move_id, [...(byMove.get(attribution.move_id) ?? []), attribution])
    }
    const total = attributions.reduce((sum, attribution) => sum + attribution.attributed_delta, 0)
    const ciLow = attributions.reduce((sum, attribution) => sum + attribution.confidence_interval[0], 0)
    const ciHigh = attributions.reduce((sum, attribution) => sum + attribution.confidence_interval[1], 0)
    const report: GoalReport = {
      api_version: 'kairos.io/v1',
      kind: 'GoalReport',
      id: `goal-report-${goal.id}`,
      tenant_id,
      goal_id: goal.id,
      goal_name: goal.name,
      status: goal.status,
      generated_at: new Date().toISOString(),
      kpi_results: goal.kpis.map(kpi => ({
        id: kpi.metric,
        unit: kpi.unit,
        target: kpi.target,
        achieved: kpi.current,
      })),
      moves: [...byMove.entries()].map(([move_id, values]) => {
        const attributedDelta = values.reduce((sum, value) => sum + value.attributed_delta, 0)
        return {
          move_id,
          approved_at: approvedAt.get(move_id) ?? goal.updated_at.toISOString(),
          attributed_delta: attributedDelta,
          attribution_confidence: values.reduce(
            (sum, value) => sum + value.attribution_confidence,
            0,
          ) / values.length,
          positive: attributedDelta > 0,
        }
      }),
      total_attributed_delta: total,
      attribution_confidence_interval: [ciLow, ciHigh],
      insufficient_history: attributions.length === 0
        || attributions.some(attribution => attribution.insufficient_history),
    }
    await db.collection<GoalReport>('goal_reports').updateOne(
      { tenant_id, goal_id: goal.id },
      { $set: report },
      { upsert: true },
    )
    return { report }
  })

  // ── PATCH /goals/:id ─────────────────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: Partial<GoalCreate> & { remove_kpis?: string[] } }>(
    '/goals/:id',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const { name, description, timeline_days, tags, detector_ids, at_risk_threshold, kpis, remove_kpis } = req.body

      // Debug: log what we received for kpis to diagnose silent-ignore reports
      if (kpis !== undefined) {
        req.log.info({ kpis_received: kpis, kpis_length: kpis?.length, goal_id: req.params.id }, 'PATCH /goals/:id received kpis field')
      }
      if (remove_kpis !== undefined) {
        req.log.info({ remove_kpis, goal_id: req.params.id }, 'PATCH /goals/:id received remove_kpis field')
      }

      const update: Record<string, unknown> = { updated_at: new Date() }
      if (name) update['name'] = name
      if (description !== undefined) update['description'] = description
      if (timeline_days) {
        update['timeline_days'] = timeline_days
        // Recompute target_date based on original start_date
        const goal = await col.findOne({ id: req.params.id, tenant_id })
        if (goal) {
          update['target_date'] = new Date(goal.start_date.getTime() + timeline_days * 86_400_000)
        }
      }
      if (tags) update['tags'] = tags
      if (detector_ids) update['detector_ids'] = detector_ids
      if (at_risk_threshold !== undefined) update['at_risk_threshold'] = at_risk_threshold

      // KPI removal: remove_kpis is an array of metric names to remove from
      // the goal. Validates that at least one KPI remains (goals require
      // >= 1 KPI). Runs before KPI edits so the merge sees the post-removal
      // state.
      if (remove_kpis && remove_kpis.length > 0) {
        const goal = await col.findOne({ id: req.params.id, tenant_id })
        if (!goal) return reply.status(404).send({ error: 'Goal not found' })
        const removeSet = new Set(remove_kpis)
        const remaining = goal.kpis.filter(k => !removeSet.has(k.metric))
        const notFound = remove_kpis.filter(m => !goal.kpis.some(k => k.metric === m))
        if (remaining.length === 0) {
          return reply.status(400).send({ error: 'Cannot remove all KPIs — a goal must have at least one KPI' })
        }
        if (notFound.length > 0) {
          req.log.warn({ notFound, goal_id: req.params.id }, 'PATCH /goals/:id remove_kpis: some metrics not found on goal')
        }
        update['kpis'] = remaining
      }

      // KPI updates: merge incoming KPI fields into existing KPIs by metric name.
      // This allows editing targets, labels, units, etc. without replacing the
      // entire KPI array. Previously kpis was silently dropped from PATCH.
      // If remove_kpis already set update['kpis'], merge into that post-removal
      // array instead of re-fetching the goal.
      if (kpis && kpis.length > 0) {
        let baseKpis: Kpi[]
        if (update['kpis'] && Array.isArray(update['kpis'])) {
          // remove_kpis already ran — use the post-removal array
          baseKpis = update['kpis'] as Kpi[]
        } else {
          const goal = await col.findOne({ id: req.params.id, tenant_id })
          if (!goal) return reply.status(404).send({ error: 'Goal not found' })
          baseKpis = goal.kpis
        }
        const existingByMetric = new Map(baseKpis.map(k => [k.metric, k]))
        for (const incoming of kpis) {
          const existing = existingByMetric.get(incoming.metric)
          if (existing) {
            // Merge: only override fields that are present in the incoming KPI
            existingByMetric.set(incoming.metric, {
              ...existing,
              ...Object.fromEntries(
                Object.entries(incoming).filter(([, v]) => v !== undefined)
              ),
            })
          } else {
            // New KPI — validate it has the required fields
            const parsed = KpiSchema.safeParse(incoming)
            if (!parsed.success) {
              return reply.status(400).send({
                error: `Invalid KPI '${incoming.metric ?? 'unknown'}'`,
                issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
              })
            }
            existingByMetric.set(parsed.data.metric, parsed.data)
          }
        }
        update['kpis'] = [...existingByMetric.values()]
      }

      const result = await col.findOneAndUpdate(
        { id: req.params.id, tenant_id },
        { $set: update },
        { returnDocument: 'after' },
      )
      if (!result) return reply.status(404).send({ error: 'Goal not found' })
      if (engine) await refreshGoalDetectorActivations(db, engine, result)
      
      // Invalidate cache
      const cache = getCache()
      const cacheKey = `goal:${req.params.id}:${tenant_id}`
      await cache.delete(cacheKey)
      
      // Diagnostic: include which fields were actually updated so the
      // caller can verify the PATCH was applied (not just 200'd silently).
      const updatedFields = Object.keys(update).filter(k => k !== 'updated_at')
      return { goal: result, updated_fields: updatedFields }
    },
  )

  app.get<{ Params: { id: string } }>('/goals/:id/detector-activations', async (req, reply) => {
    const { tenant_id } = req.authContext
    const goal = await col.findOne({ id: req.params.id, tenant_id })
    if (!goal) return reply.status(404).send({ error: 'Goal not found' })
    const activations = await db.collection('goal_detector_activations')
      .find({ tenant_id, goal_id: goal.id })
      .sort({ active: -1, relevance_score: -1 })
      .toArray()
    return { goal_id: goal.id, activations }
  })

  app.put<{
    Params: { id: string; detectorId: string }
    Body: { active: boolean }
  }>('/goals/:id/detector-activations/:detectorId', async (req, reply) => {
    const { tenant_id } = req.authContext
    const goal = await col.findOne({ id: req.params.id, tenant_id })
    if (!goal) return reply.status(404).send({ error: 'Goal not found' })
    await db.collection('goal_detector_activations').updateOne(
      { tenant_id, goal_id: goal.id, detector_id: req.params.detectorId },
      { $set: {
        tenant_id,
        goal_id: goal.id,
        detector_id: req.params.detectorId,
        active: req.body.active,
        relevance_score: req.body.active ? 1 : 0,
        source: 'manual',
        updated_at: new Date(),
      } },
      { upsert: true },
    )
    return { ok: true }
  })

  // ── POST /goals/:id/autonomy ────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { enabled: boolean; fully_autonomous?: boolean; max_daily_actions?: number } }>(
    '/goals/:id/autonomy',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const enabled = req.body?.enabled === true
      const fullyAutonomous = req.body?.fully_autonomous === true
      const maxDailyActions = req.body?.max_daily_actions ?? 10

      const update: Record<string, unknown> = {
        'execution_plan.enabled': enabled,
        'execution_plan.status': enabled ? 'active' : 'paused',
        'execution_plan.approval_required': !fullyAutonomous,
        'execution_plan.max_daily_actions': maxDailyActions,
        ...(enabled ? { 'execution_plan.next_run_at': new Date() } : {}),
        updated_at: new Date(),
      }

      // Add trust_level validation for fully autonomous mode
      if (fullyAutonomous) {
        const settings = await db.collection('tenant_settings').findOne({ tenant_id })
        const automation = settings?.['automation'] as { trust_level?: number } | undefined
        if ((automation?.trust_level ?? 0) < 3) {
          return reply.status(403).send({
            error: 'Insufficient trust level for fully autonomous mode',
            required: 3,
            current: automation?.trust_level ?? 0,
          })
        }
      }

      const result = await col.findOneAndUpdate(
        { id: req.params.id, tenant_id, execution_plan: { $exists: true } } as Record<string, unknown>,
        { $set: update },
        { returnDocument: 'after' },
      )
      if (!result) return reply.status(404).send({ error: 'Goal execution plan not found' })
      return { goal: result }
    },
  )

  // ── GET /goals/:id/autonomy-readiness ───────────────────────────────────────────
  // UX-008: Autonomy Readiness Meter — checks if goal is ready for autonomous mode
  app.get<{ Params: { id: string } }>('/goals/:id/autonomy-readiness', async (req) => {
    const { tenant_id } = req.authContext
    const goal = await col.findOne({ id: req.params.id, tenant_id })
    if (!goal) return { error: 'Goal not found' }

    const settings = await db.collection('tenant_settings').findOne({ tenant_id })
    const automation = settings?.['automation'] as { trust_level?: number; max_daily_actions?: number; allow_undo?: boolean } | undefined

    // Check historical approvals (from insights collection)
    const insightsCol = db.collection('insights')
    const approvedCount = await insightsCol.countDocuments({
      tenant_id,
      goal_id: req.params.id,
      state: 'approved',
    })

    // Check detector F1 scores (from detector_health collection)
    const detectorHealthCol = db.collection('detector_health')
    const detectorHealth = await detectorHealthCol.findOne({ tenant_id })
    const avgF1 = detectorHealth?.['avg_f1'] as number | undefined ?? 0

    // Check action spend cap configuration
    const spendCapConfigured = automation?.max_daily_actions !== undefined && automation.max_daily_actions > 0

    // Check undo/pause enabled
    const undoPauseEnabled = automation?.allow_undo === true

    // Check notification channel verified
    const notifications = settings?.['notifications'] as { whatsapp_verified?: boolean; email_verified?: boolean } | undefined
    const notificationVerified = notifications?.whatsapp_verified === true || notifications?.email_verified === true

    const checklist = {
      enough_historical_approvals: {
        met: approvedCount >= 10,
        current: approvedCount,
        required: 10,
      },
      detector_f1_above_threshold: {
        met: avgF1 >= 0.7,
        current: avgF1,
        required: 0.7,
      },
      action_spend_cap_configured: {
        met: spendCapConfigured,
      },
      undo_pause_enabled: {
        met: undoPauseEnabled,
      },
      notification_channel_verified: {
        met: notificationVerified,
      },
    }

    const allMet = Object.values(checklist).every(item => item.met === true)
    const reasons = Object.entries(checklist)
      .filter(([_, item]) => !item.met)
      .map(([key, _]) => {
        const keyMap: Record<string, string> = {
          enough_historical_approvals: 'Need at least 10 manual approvals',
          detector_f1_above_threshold: 'Detector F1 score must be above 70%',
          action_spend_cap_configured: 'Configure max daily actions limit',
          undo_pause_enabled: 'Enable undo/pause functionality',
          notification_channel_verified: 'Verify notification channel (WhatsApp or email)',
        }
        return keyMap[key] || key
      })

    return {
      eligible: allMet,
      checklist,
      reasons,
    }
  })

  // ── POST /goals/:id/autonomous-pause ───────────────────────────────────────────
  // Instant kill switch for autonomous mode
  app.post<{ Params: { id: string } }>('/goals/:id/autonomous-pause', async (req) => {
    const { tenant_id } = req.authContext
    const result = await col.findOneAndUpdate(
      { id: req.params.id, tenant_id },
      {
        $set: {
          'execution_plan.enabled': false,
          'execution_plan.status': 'paused',
          updated_at: new Date(),
        },
      },
      { returnDocument: 'after' },
    )
    if (!result) return { error: 'Goal not found' }
    return { ok: true, goal: result }
  })

  // ── DELETE /goals/:id ────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/goals/:id', async (req, reply) => {
    const { tenant_id } = req.authContext
    const result = await col.findOneAndUpdate(
      { id: req.params.id, tenant_id },
      { $set: { status: 'archived', updated_at: new Date() } },
      { returnDocument: 'after' },
    )
    if (!result) return reply.status(404).send({ error: 'Goal not found' })
    await db.collection('goal_detector_activations').updateMany(
      { tenant_id, goal_id: req.params.id },
      { $set: { active: false, updated_at: new Date() } },
    )
    
    // Invalidate cache
    const cache = getCache()
    const cacheKey = `goal:${req.params.id}:${tenant_id}`
    await cache.delete(cacheKey)
    
    return { goal: result, message: 'Goal archived' }
  })

  // ── POST /goals/:id/kpis/:metric/snapshot ────────────────────────────────────
  // Manually push a metric reading (or called by the analytics polling job).
  app.post<{
    Params: { id: string; metric: string }
    Body: {
      value: number
      source?: string
      source_type?: 'connector' | 'computed' | 'manual'
      period_start?: string
      period_end?: string
      metadata?: Record<string, unknown>
    }
  }>('/goals/:id/kpis/:metric/snapshot', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { id, metric } = req.params
    const { value: contributedValue, source = 'manual', source_type, period_start, period_end, metadata } = req.body

    const goal = await col.findOne({ id, tenant_id })
    if (!goal) return reply.status(404).send({ error: 'Goal not found' })

    const kpiIdx = goal.kpis.findIndex(k => k.metric === metric)
    if (kpiIdx === -1) return reply.status(404).send({ error: `KPI '${metric}' not found on this goal` })

    const reconciliation = await recordKpiContribution(db, tenant_id, id, metric, {
      value: contributedValue,
      sourceId: source,
      sourceType: source_type,
      ...(period_start && { periodStart: new Date(period_start) }),
      ...(period_end && { periodEnd: new Date(period_end) }),
      metadata,
    })
    const value = reconciliation.value

    const updatedGoal = {
      ...goal,
      kpis: goal.kpis.map((kpi, index) => index === kpiIdx ? { ...kpi, current: value, reconciliation } : kpi),
    }
    await recomputeGoalProjection(db, updatedGoal)

    if (engine) {
      const updatedKpi = { ...goal.kpis[kpiIdx]!, current: value }
      const kpiProgress = computeKpiProgress(updatedKpi, goal.start_date, goal.timeline_days)
      const now = new Date()
      const pctTimeElapsed = Math.min(1,
        (now.getTime() - goal.start_date.getTime()) /
        (goal.target_date.getTime() - goal.start_date.getTime()),
      )
      const remainingDelta = updatedKpi.direction === 'increase'
        ? updatedKpi.target - value
        : value - updatedKpi.target
      const requiredPace = kpiProgress.days_remaining > 0
        ? Math.max(0, remainingDelta) / kpiProgress.days_remaining
        : null
      const requiredPaceMultiplier = requiredPace !== null && kpiProgress.pace_per_day > 0
        ? requiredPace / kpiProgress.pace_per_day
        : null

      const evaluation = await engine.evaluate({
        event_type: 'goal.kpi.updated',
        tenant_id,
        event_id: `manual_kpi_${id}_${metric}_${Date.now()}`,
        data: {
          goal_id: id,
          goal_name: goal.name,
          metric,
          label: updatedKpi.label,
          unit: updatedKpi.unit,
          value,
          current: value,
          prev_value: goal.kpis[kpiIdx]!.current,
          target: updatedKpi.target,
          start_value: updatedKpi.start_value,
          direction: updatedKpi.direction,
          timeline_days: goal.timeline_days,
          days_elapsed: kpiProgress.days_elapsed,
          days_remaining: kpiProgress.days_remaining,
          pct_complete: kpiProgress.pct_complete,
          pct_complete_percent: Math.round(kpiProgress.pct_complete * 1000) / 10,
          pct_time_elapsed: Math.round(pctTimeElapsed * 1000) / 1000,
          pct_time_elapsed_percent: Math.round(pctTimeElapsed * 1000) / 10,
          pace_per_day: kpiProgress.pace_per_day,
          required_pace_per_day: requiredPace !== null ? Math.round(requiredPace * 100) / 100 : null,
          required_pace_multiplier: requiredPaceMultiplier !== null
            ? Math.round(requiredPaceMultiplier * 100) / 100
            : null,
          projected_days: kpiProgress.projected_days,
          days_early: kpiProgress.projected_days !== null
            ? Math.max(0, Math.round(goal.timeline_days - kpiProgress.projected_days))
            : 0,
          suggested_new_target: updatedKpi.direction === 'increase'
            ? Math.round(updatedKpi.target * 1.2 * 100) / 100
            : Math.round(updatedKpi.target * 0.8 * 100) / 100,
          source,
        },
      })

      await persistAndDeliverGoalInsights(db, evaluation.insights, tenant_id, deliveryRouter)
    }

    return { ok: true, metric, contributed_value: contributedValue, value, reconciliation }
  })

  // ── GET /goals/:id/kpis/:metric/history ──────────────────────────────────────
  app.get<{
    Params: { id: string; metric: string }
    Querystring: { days?: string }
  }>('/goals/:id/kpis/:metric/history', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { id, metric } = req.params
    const days = parseInt(req.query.days ?? '30', 10)
    const since = new Date(Date.now() - days * 86_400_000)

    const goal = await col.findOne({ id, tenant_id })
    if (!goal) return reply.status(404).send({ error: 'Goal not found' })

    const history = await snapshots
      .find({ tenant_id, goal_id: id, metric, recorded_at: { $gte: since } })
      .sort({ recorded_at: 1 })
      .toArray()

    return { metric, history }
  })

  app.get<{ Params: { id: string; metric: string } }>(
    '/goals/:id/kpis/:metric/data-sources',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const { id, metric } = req.params
      const goal = await col.findOne({ id, tenant_id })
      if (!goal) return reply.status(404).send({ error: 'Goal not found' })
      if (!goal.kpis.some(kpi => kpi.metric === metric)) {
        return reply.status(404).send({ error: `KPI '${metric}' not found on this goal` })
      }
      const reconciliation = await reconcileGoalKpi(db, tenant_id, id, metric)
      return { metric, reconciliation }
    },
  )

  // ── GET /goals/:id/insights ──────────────────────────────────────────────────
  // Return insights that were produced by detectors linked to this goal.
  app.get<{
    Params: { id: string }
    Querystring: { limit?: string }
  }>('/goals/:id/insights', async (req, reply) => {
    const { tenant_id } = req.authContext
    const goal = await col.findOne({ id: req.params.id, tenant_id })
    if (!goal) return reply.status(404).send({ error: 'Goal not found' })

    const limit = parseInt(req.query.limit ?? '20', 10)
    const insightFilter: Record<string, unknown> = {
      tenant_id,
      $or: [
        { 'feature_snapshot.goal_id': goal.id },
        { goal_id: goal.id },
      ],
    }
    if (goal.detector_ids.length > 0) {
      ;(insightFilter['$or'] as Record<string, unknown>[]).push({
        detector_id: { $in: goal.detector_ids },
        created_at: { $gte: goal.created_at },
      })
    }
    const insights = await db.collection('insights')
      .find(insightFilter)
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray()

    return { goal_id: goal.id, insights }
  })

  // ── GET /goals/:id/trades ───────────────────────────────────────────────────
  // Return pending and executed trades linked to this goal. Trades are linked
  // via goal_id (set by the workflow trade_intent flow or the direct API).
  // Also matches trades whose source_insight_id links back to this goal via
  // detector_ids — the indirect path for trades created before goal_id was
  // added to the trade document.
  app.get<{ Params: { id: string } }>('/goals/:id/trades', async (req, reply) => {
    const { tenant_id } = req.authContext
    const goal = await col.findOne({ id: req.params.id, tenant_id })
    if (!goal) return reply.status(404).send({ error: 'Goal not found' })

    // Direct link: trade has goal_id matching this goal
    const filter: Record<string, unknown> = {
      tenant_id,
      $or: [
        { goal_id: goal.id },
      ],
    }

    // Indirect link: trade has source_insight_id, and that insight's detector
    // is linked to this goal via detector_ids. Only add this path if the goal
    // has detector_ids.
    if (goal.detector_ids.length > 0) {
      // Find insight IDs from this goal's detectors
      const insightIds = await db.collection('insights')
        .find({ tenant_id, detector_id: { $in: goal.detector_ids }, created_at: { $gte: goal.created_at } })
        .project({ _id: 0, id: 1 })
        .toArray()
      const ids = insightIds.map(i => i['id']).filter(Boolean) as string[]
      if (ids.length > 0) {
        ;(filter['$or'] as Record<string, unknown>[]).push({ source_insight_id: { $in: ids } })
      }
    }

    const trades = await db.collection('pending_trades')
      .find(filter)
      .sort({ created_at: -1 })
      .limit(100)
      .toArray()

    return { goal_id: goal.id, trades }
  })

  // ── POST /goals/:id/kpis/recompute ───────────────────────────────────────────
  // Trigger on-demand KPI recomputation for a specific goal.
  // Useful after connecting a new data source or to get a fresh reading immediately.
  app.post<{ Params: { id: string } }>('/goals/:id/kpis/recompute', async (req, reply) => {
    const { tenant_id } = req.authContext
    if (!kpiEngine) {
      return reply.status(503).send({ error: 'KPI compute engine not available (MongoDB required)' })
    }
    try {
      const results = await kpiEngine.runGoal(req.params.id, tenant_id)
      const goal = await col.findOne({ id: req.params.id, tenant_id })
      const hasXKpis = goal?.kpis.some(kpi =>
        [
          'twitter_followers',
          'twitter_engagement_rate',
          'twitter_impressions',
          'x_followers',
          'x_engagement_rate',
          'x_impressions',
          'twitter_x_followers',
          'twitter_x_engagement_rate',
          'twitter_x_impressions',
        ].includes(kpi.metric),
      ) ?? false
      const externalSync = hasXKpis
        ? await new XGoalMetricsSync(db).syncGoal(tenant_id, req.params.id)
        : null
      return { recomputed: results.length, results, external_sync: externalSync }
    } catch (err) {
      return reply.status(400).send({ error: String(err) })
    }
  })

  // ── GET /goals/kpi-sources ───────────────────────────────────────────────────
  // Returns the available signal types and aggregation options so the Goal Compiler
  // and Studio UI can guide users in defining KPI definitions.
  app.get('/goals/kpi-sources', async (req) => {
    const { tenant_id } = req.authContext
    // Get distinct signal types this tenant has ingested
    const signalTypes = await db.collection('signals')
      .distinct('signal_type', { tenant_id })
    // Also include all signal types from connected connectors
    const credentials = await db.collection('connector_credentials')
      .find({ tenant_id })
      .toArray() as unknown as Array<{ connector_id: string }>
    const connectorIds = credentials.map(c => c.connector_id)

    return {
      signal_types: signalTypes,
      connected_connectors: connectorIds,
      aggregations: ['count', 'sum', 'avg', 'last', 'min', 'max', 'rate'],
      examples: [
        { label: 'Overdue invoice count',  source: 'signals', signal_types: ['invoice.overdue'],     aggregation: 'count' },
        { label: 'Monthly revenue',        source: 'signals', signal_types: ['payment.received'],     aggregation: 'sum',   field: 'data.amount_minor', window_days: 30 },
        { label: 'Avg days to pay',        source: 'signals', signal_types: ['payment.received'],     aggregation: 'avg',   field: 'data.days_to_pay' },
        { label: 'Churn rate',             source: 'signals', signal_types: ['subscription.cancelled'], aggregation: 'rate', denominator_signal_types: ['subscription.created'], window_days: 30 },
        { label: 'Avg review score',       source: 'signals', signal_types: ['review.created'],       aggregation: 'avg',   field: 'data.rating', window_days: 90 },
        { label: 'Support tickets open',   source: 'signals', signal_types: ['ticket.created'],       aggregation: 'count', filter: 'data.status == "open"' },
        { label: 'X followers',            source: 'external_api', metric: 'twitter_followers',       connector_id: 'twitter_x' },
        { label: 'X impressions',          source: 'external_api', metric: 'twitter_impressions',     connector_id: 'twitter_x' },
        { label: 'X engagement rate',      source: 'external_api', metric: 'twitter_engagement_rate', connector_id: 'twitter_x' },
      ],
    }
  })
}

async function persistAndDeliverGoalInsights(
  db: Db,
  insights: Insight[],
  tenantId: string,
  deliveryRouter?: DeliveryRouter,
): Promise<void> {
  return persistAndDeliverInsights(db, insights, tenantId, deliveryRouter)
}
