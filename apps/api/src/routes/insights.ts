/**
 * /insights — query, act on, and explain insights
 *
 * GET  /insights                  — list with filters
 * GET  /insights/:id              — single insight
 * GET  /insights/:id/explain      — full rule evaluation trace
 * POST /insights/:id/approve      — approve + schedule actions
 * POST /insights/:id/dismiss      — dismiss insight
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import type { Engine, FeatureHashScorer, TenantLevelScorer, RecentInsight } from '@agentoak/engine'
import type { ActionReceipt } from '@agentoak/workflows'
import { ApprovalSignalHealthMonitor, createLogger } from '@agentoak/platform'
import { getInsightsCollection, getReceiptsCollection } from '../db.js'
import { getAuditLogger } from '../audit/audit-log.js'
import { ActionExecutor } from '../actions/action-executor.js'
import { recordMomentDecision } from '../verified-moments.js'
import { startGoalExperimentsForApproval } from '../outcomes/causal-experiments.js'
import {
  consolidateInsights,
  getDetectorPrioritySettings,
  type DetectorPrioritySettings,
} from '../insights/consolidation.js'

const log = createLogger({ service: 'insights', version: '0.0.0' })
import { MongoMemoryRepository } from '@agentoak/mongodb-adapter'
import { createHash, randomUUID } from 'node:crypto'
import { FreeTierPolicy } from '@agentoak/platform'

/**
 * Fetch recent insights for an entity (last 7 days) — used by the
 * TenantLevelScorer to build cross-signal features. Returns the fields
 * needed to build the feature vector: detector_id, signal_type, state,
 * and created_at.
 */
async function fetchRecentInsightsForEntity(
  db: Db,
  tenantId: string,
  entityKey: string,
): Promise<RecentInsight[]> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const docs = await db.collection('insights').find({
    tenant_id: tenantId,
    entity_key: entityKey,
    created_at: { $gte: cutoff },
  }).sort({ created_at: -1 }).limit(50).toArray() as unknown as Array<{
    detector_id?: string
    signal_type?: string
    state?: string
    created_at: Date
  }>
  return docs.map(d => ({
    detector_id: d.detector_id ?? '',
    signal_type: d.signal_type,
    state: d.state,
    created_at: d.created_at,
  }))
}

export async function registerInsightRoutes(
  app: FastifyInstance,
  engine: Engine,
  featureHashScorer?: FeatureHashScorer,
  db?: Db,
  tenantLevelScorer?: TenantLevelScorer,
): Promise<void> {
  const actionExecutor = db ? new ActionExecutor(db) : null
  /**
   * GET /insights
   * Query params: category, urgency, state, goal_id, detectors (comma-separated
   * detector_id allowlist), limit (default 20), offset (default 0)
   */
  app.get('/insights', async (request) => {
    const { tenant_id } = request.authContext
    const query = request.query as {
      category?: string
      urgency?: string
      state?: string
      limit?: string
      offset?: string
      assignee?: string
      sla_breached?: string
      goal_id?: string
      exclude_category?: string
      exclude_detector_id?: string
      detectors?: string
    }

    const filter: Record<string, unknown> = { tenant_id }
    if (query.category) filter['category'] = query.category
    if (query.urgency) filter['urgency'] = query.urgency
    if (query.state) filter['state'] = query.state
    // Callers scoped to a specific vertical (e.g. the family app) send this
    // to get only their own detectors' insights back. Previously ignored
    // server-side, so it was a no-op and every caller silently paginated
    // over the tenant's most-recent-N insights across every vertical —
    // a vertical's own insights could fall off the page entirely for a
    // tenant active elsewhere. Filtering here, not just client-side after
    // the page is already capped, is what actually fixes that.
    if (query.detectors) filter['detector_id'] = { $in: query.detectors.split(',') }
    if (query.assignee === 'me') filter['collaboration.assignee_id'] = request.authContext.user_id
    else if (query.assignee) filter['collaboration.assignee_id'] = query.assignee
    if (query.sla_breached === 'true') filter['collaboration.sla_breached_at'] = { $exists: true }
    if (query.goal_id) {
      filter['$or'] = [
        { goal_id: query.goal_id },
        { 'feature_snapshot.goal_id': query.goal_id },
      ]
    }
    // Caller-driven exclusions, folded into the same filter used for both the
    // page of results and the `total` count below — so a preview list and its
    // "how many total" figure never disagree about what's excluded (Home uses
    // this to keep its opportunities count in sync with what Kairos Pulse
    // actually renders, instead of filtering client-side after slicing).
    if (query.exclude_category) filter['category'] = { $nin: query.exclude_category.split(',') }
    if (query.exclude_detector_id) filter['detector_id'] = { $nin: query.exclude_detector_id.split(',') }

    const limit = Math.min(parseInt(query.limit ?? '20', 10), 100)
    const offset = parseInt(query.offset ?? '0', 10)

    try {
      const col = await getInsightsCollection()
      const [insights, total] = await Promise.all([
        col
          .find(filter)
          .sort({ created_at: -1 })
          .skip(offset)
          .limit(limit)
          .toArray(),
        col.countDocuments(filter),
      ])

      return {
        insights,
        total,
        limit,
        offset,
        has_more: offset + limit < total,
      }
    } catch {
      // MongoDB not connected — return empty (graceful degradation)
      return { insights: [], total: 0, limit, offset, has_more: false }
    }
  })

  /**
   * GET /insights/consolidated
   * EPIC-001: Returns insights grouped by entity_key with one primary
   * insight per entity and secondary factors available for drill-down.
   * Contradictory signals are explicitly flagged.
   */
  app.get('/insights/consolidated', async (request) => {
    const { tenant_id } = request.authContext
    const query = request.query as {
      category?: string
      urgency?: string
      state?: string
      limit?: string
      offset?: string
      goal_id?: string
    }

    const filter: Record<string, unknown> = { tenant_id }
    if (query.category) filter['category'] = query.category
    if (query.urgency) filter['urgency'] = query.urgency
    if (query.state) filter['state'] = query.state
    if (query.goal_id) {
      filter['$or'] = [
        { goal_id: query.goal_id },
        { 'feature_snapshot.goal_id': query.goal_id },
      ]
    }

    const limit = Math.min(parseInt(query.limit ?? '20', 10), 100)
    const offset = parseInt(query.offset ?? '0', 10)

    try {
      const col = await getInsightsCollection()
      const insights = await col
        .find(filter)
        .sort({ created_at: -1 })
        .skip(offset)
        .limit(limit)
        .toArray() as unknown as import('@agentoak/engine').Insight[]

      if (!db) {
        return { groups: [], total: 0, limit, offset, has_more: false }
      }

      const tenantDoc = await db.collection('tenant_settings').findOne({ tenant_id })
      const verticalId = tenantDoc?.['active_vertical'] as string | undefined
      const settings = await getDetectorPrioritySettings(db, tenant_id, verticalId)
      const groups = consolidateInsights(insights, settings)
      const total = await col.countDocuments(filter)

      return {
        groups,
        total,
        limit,
        offset,
        has_more: offset + limit < total,
      }
    } catch {
      return { groups: [], total: 0, limit, offset, has_more: false }
    }
  })

  /**
   * GET /insights/entity/:entityKey
   * EPIC-001: Returns all raw insights for a given entity_key — the
   * "See all factors" drill-down view.
   */
  app.get<{ Params: { entityKey: string } }>('/insights/entity/:entityKey', async (request) => {
    const { tenant_id } = request.authContext
    const { entityKey } = request.params
    const query = request.query as { state?: string; limit?: string }

    const filter: Record<string, unknown> = { tenant_id, entity_key: entityKey }
    if (query.state) filter['state'] = query.state

    const limit = Math.min(parseInt(query.limit ?? '50', 10), 200)

    try {
      const col = await getInsightsCollection()
      const insights = await col
        .find(filter)
        .sort({ created_at: -1 })
        .limit(limit)
        .toArray() as unknown as import('@agentoak/engine').Insight[]

      if (!db || insights.length === 0) {
        return { entity_key: entityKey, insights: [], count: 0 }
      }

      const tenantDoc = await db.collection('tenant_settings').findOne({ tenant_id })
      const verticalId = tenantDoc?.['active_vertical'] as string | undefined
      const settings = await getDetectorPrioritySettings(db, tenant_id, verticalId)
      const groups = consolidateInsights(insights, settings)
      return {
        entity_key: entityKey,
        insights,
        count: insights.length,
        consolidated: groups[0] ?? null,
      }
    } catch {
      return { entity_key: entityKey, insights: [], count: 0, consolidated: null }
    }
  })

  /** GET /insights/:id */
  app.get<{ Params: { id: string } }>('/insights/:id', async (request, reply) => {
    const { tenant_id } = request.authContext
    const { id } = request.params

    try {
      const col = await getInsightsCollection()
      const insight = await col.findOne({ id, tenant_id }) // tenant_id guard

      if (!insight) return reply.status(404).send({ error: 'Insight not found' })
      return insight
    } catch {
      return reply.status(404).send({ error: 'Insight not found' })
    }
  })

  /** GET /moves/:id/evidence — structured explanation for programmatic consumers. */
  app.get<{ Params: { id: string } }>('/moves/:id/evidence', async (request, reply) => {
    const { tenant_id } = request.authContext
    try {
      const col = await getInsightsCollection()
      const insight = await col.findOne(
        { id: request.params.id, tenant_id },
        { projection: { id: 1, evidence_trail: 1, judge_verdict: 1 } },
      )
      if (!insight) return reply.status(404).send({ error: 'Move not found' })
      return {
        move_id: insight.id,
        evidence_trail: insight.evidence_trail,
        judge_verdict: insight.judge_verdict,
      }
    } catch {
      return reply.status(404).send({ error: 'Move not found' })
    }
  })

  /**
   * GET /insights/:id/explain
   * Returns the full rule evaluation trace (evidence chain) for an insight.
   * Trace is buffered in-memory for the last 1000 evaluations.
   */
  app.get<{ Params: { id: string } }>('/insights/:id/explain', async (request, reply) => {
    const { tenant_id } = request.authContext
    const { id } = request.params

    try {
      const col = await getInsightsCollection()
      const insight = await col.findOne({ id, tenant_id }, { projection: { id: 1 } })
      if (!insight) return reply.status(404).send({ error: 'Insight not found' })
    } catch {
      return reply.status(404).send({ error: 'Insight not found' })
    }

    const trace = engine.explain(id)
    if (!trace) {
      return reply.status(404).send({
        error: 'Trace not found. Engine traces the last 1000 evaluations; older insights are not available.',
      })
    }

    return trace
  })

  /**
   * POST /insights/:id/approve
   * Marks an insight as approved and schedules its recommended actions.
   * Body: { notes?: string }
   */
  app.post<{ Params: { id: string }; Body: { notes?: string } }>(
    '/insights/:id/approve',
    async (request, reply) => {
      const { tenant_id } = request.authContext
      const { id } = request.params
      const { notes } = request.body ?? {}

      try {
        if (db) {
          const tenant = await db.collection('tenants').findOne({ $or: [{ tenant_id }, { id: tenant_id }] })
          const now = new Date()
          const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
          const used = await db.collection('insights').countDocuments({ tenant_id, approved_at: { $gte: monthStart } })
          const quota = new FreeTierPolicy().check('monthly_move_approvals', used, String(tenant?.['tier'] ?? 'free'))
          if (!quota.allowed) return reply.status(402).send({ error: 'Monthly Move approval quota exceeded', quota })

          // Outcome-credit gate: require a positive balance to approve an insight.
          // Legacy tenants without a billing block are allowed through until migrated.
          const billing = tenant?.['billing']
          if (billing && Number(billing['credits_balance'] ?? 0) <= 0) {
            return reply.status(402).send({
              error: 'No outcome credits remaining',
              code: 'CREDITS_EXHAUSTED',
              credits_balance: billing['credits_balance'] ?? 0,
            })
          }
        }
        const col = await getInsightsCollection()
        const result = await col.findOneAndUpdate(
          { id, tenant_id, state: 'identified' },
          {
            $set: {
              state: 'completed',
              approved_at: new Date(),
              approved_by: request.authContext.user_id,
              ...(notes !== undefined && { approval_notes: notes }),
            },
          },
          { returnDocument: 'after' },
        )

        if (!result) {
          return reply.status(404).send({ error: 'Insight not found or not in identified state' })
        }

        // Check learning health before creating receipt
        let learningAllowed = true
        if (db) {
          const monitor = new ApprovalSignalHealthMonitor(db)
          learningAllowed = !(await monitor.shouldPauseLearning(tenant_id))
        }

        // Create ActionReceipt for the approval
        if (db) {
          const tenantSettings = await db.collection('tenant_settings').findOne({ tenant_id })
          const tenantDryRun = tenantSettings?.['automation']?.dry_run_mode === true
          const dryRun = (request.query as Record<string, string>)['dry_run'] === '1' || tenantDryRun

          const receipt: ActionReceipt = {
            id: randomUUID(),
            tenant_id,
            insight_id: id,
            workflow_run_id: (result as Record<string, unknown>)['workflow_run_id'] as string | undefined,
            detector_id: result.detector_id as string | undefined,
            action_type: 'insight.approve',
            outcome: tenantDryRun ? 'policy_blocked' : 'approved',
            outcome_reason: tenantDryRun ? 'dry_run_mode' : undefined,
            executed_at: new Date(),
            approved_by: request.authContext.user_id,
            payload_hash: createHash('sha256').update(JSON.stringify({ id, notes })).digest('hex'),
            dry_run: dryRun,
            learning_suppressed: !learningAllowed,
            // D1b: record the insight's combined_score at approval time so
            // ScoreCalibrator.buildCalibrationPairs can pair this action with
            // the score the user was reacting to.
            // Always provide a numeric value — MongoDB drops `undefined` fields,
            // which makes the calibration cron's `$exists: true` filter skip
            // all receipts from tenants without LLM scoring enabled.
            metadata: {
              insight_score: (result as Record<string, unknown>)['confidence_breakdown']
                ? ((result as Record<string, unknown>)['confidence_breakdown'] as Record<string, number>)['combined_score']
                : (result as Record<string, unknown>)['confidence'] as number | undefined,
            },
          }
          const receiptsCol = await getReceiptsCollection()
          await receiptsCol.insertOne(receipt)
        }

        // Online SGD update — approval = positive signal (outcome=1)

        if (featureHashScorer && result.detector_id && learningAllowed) {
          const doc = result as Record<string, unknown>
          const features = (doc['feature_snapshot'] as Record<string, unknown> | undefined)
            ?? { hypothesis: result.hypothesis, urgency: result.urgency, category: result.category }
          featureHashScorer.update(
            tenant_id,
            result.detector_id as string,
            features,
            1,
            { features: Object.keys(features).map(k => `data.${k}`) },
          ).catch(() => {})
        }

        // Cross-signal tenant-level update — learns patterns across all
        // detectors/signal types for the same entity (e.g. "customer with
        // overdue invoice + cart abandonment = high approval likelihood").
        if (tenantLevelScorer && learningAllowed && db) {
          const doc = result as Record<string, unknown>
          const entityKey = (doc['entity_key'] as string | undefined) ?? ''
          const signalType = (doc['signal_type'] as string | undefined) ?? result.category
          if (entityKey) {
            fetchRecentInsightsForEntity(db, tenant_id, entityKey).then(recent =>
              tenantLevelScorer.update(tenant_id, entityKey, signalType, result.detector_id, recent, 1)
            ).catch(() => {})
          }
        }

        getAuditLogger()?.fromRequest(request, 'insight.approve', 'insight', id, { detector_id: result.detector_id })

        // Increment trust level for this workflow if it has a workflow_id
        const resultRecord = result as Record<string, unknown>
        if (db && resultRecord['workflow_id']) {
          const workflowId = resultRecord['workflow_id'] as string
          const tenantSettings = await db.collection('tenant_settings').findOne({ tenant_id })
          const automation = (tenantSettings?.['automation'] as { trust_level_by_workflow?: Record<string, number> } | undefined) ?? { trust_level_by_workflow: {} }
          const currentLevel = automation.trust_level_by_workflow?.[workflowId] ?? 0
          
          // Only increment if not already at or above 5 (prevent double-counting)
          if (currentLevel < 5) {
            const newLevel = currentLevel + 1
            
            // Update trust level
            await db.collection('tenant_settings').updateOne(
              { tenant_id },
              { 
                $set: { 
                  [`automation.trust_level_by_workflow.${workflowId}`]: newLevel,
                  updated_at: new Date() 
                } 
              },
              { upsert: true }
            )
            
            // Check if trust level reached 5 and emit event
            if (newLevel === 5) {
              await db.collection('system_events').insertOne({
                tenant_id,
                type: 'workflow.trust_upgraded',
                workflow_id: workflowId,
                trust_level: newLevel,
                created_at: new Date(),
              })
            }
          }
        }

        // Execute recommended actions — fire-and-forget so approval response is instant.
        // Pass dryRun=true if the query param ?dry_run=1 is set (useful for testing).
        // Also respect tenant-level dry_run_mode setting from automation settings.
        const tenantSettings = db ? await db.collection('tenant_settings').findOne({ tenant_id }) : null
        const tenantDryRun = tenantSettings?.['automation']?.dry_run_mode === true
        const dryRun = (request.query as Record<string, string>)['dry_run'] === '1' || tenantDryRun
        const executionSummary = actionExecutor
          ? await actionExecutor.execute(result as never, result.tenant_id as string, {
              dryRun,
              approvedBy: request.authContext.user_id,
            }).catch((err) => { app.log.error({ err, insight_id: id }, 'Action execution failed'); return null })
          : null

        if (db) {
          const actionReceiptIds = executionSummary?.receipts.map(receipt => receipt.id) ?? []
          await recordMomentDecision(db, {
            tenantId: tenant_id,
            insightId: id,
            decision: 'approve',
            ...(actionReceiptIds.length > 0 ? { actionReceiptIds } : {}),
          })
          await startGoalExperimentsForApproval(db, result, actionReceiptIds)
        }

        return {
          insight: result,
          message: 'Insight approved',
          ...(executionSummary && { actions: executionSummary }),
        }
      } catch {
        return reply.status(404).send({ error: 'Insight not found' })
      }
    },
  )

  /**
   * POST /insights/:id/dismiss
   * Body: { reason?: string }
   */
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/insights/:id/dismiss',
    async (request, reply) => {
      const { tenant_id } = request.authContext
      const { id } = request.params
      const { reason } = request.body ?? {}

      try {
        if (db) {
          const settings = await db.collection('tenant_settings').findOne({ tenant_id })
          if (settings?.['require_dismissal_note'] === true && !reason?.trim()) return reply.status(400).send({ error: 'Dismissal reason required' })
        }
        const col = await getInsightsCollection()
        const result = await col.findOneAndUpdate(
          { id, tenant_id, state: { $in: ['identified', 'sent'] } },
          {
            $set: {
              state: 'dismissed',
              dismissed_at: new Date(),
              dismissed_by: request.authContext.user_id,
              ...(reason !== undefined && { dismiss_reason: reason }),
              ...(reason !== undefined && { 'collaboration.resolution_note': reason }),
            },
          },
          { returnDocument: 'after' },
        )

        if (!result) {
          return reply.status(404).send({ error: 'Insight not found or already actioned' })
        }

        // Check learning health before creating receipt
        let learningAllowed = true
        if (db) {
          const monitor = new ApprovalSignalHealthMonitor(db)
          learningAllowed = !(await monitor.shouldPauseLearning(tenant_id))
        }

        // Create ActionReceipt for the dismissal
        if (db) {
          const receipt: ActionReceipt = {
            id: randomUUID(),
            tenant_id,
            insight_id: id,
            workflow_run_id: (result as Record<string, unknown>)['workflow_run_id'] as string | undefined,
            detector_id: result.detector_id as string | undefined,
            action_type: 'insight.dismiss',
            outcome: 'dismissed',
            outcome_reason: reason,
            executed_at: new Date(),
            approved_by: request.authContext.user_id,
            payload_hash: createHash('sha256').update(JSON.stringify({ id, reason })).digest('hex'),
            dry_run: false,
            learning_suppressed: !learningAllowed,
            // D1b: record the insight's combined_score at dismissal time so
            // ScoreCalibrator.buildCalibrationPairs can pair this action with
            // the score the user was reacting to.
            // Always provide a numeric value — MongoDB drops `undefined` fields,
            // which makes the calibration cron's `$exists: true` filter skip
            // all receipts from tenants without LLM scoring enabled.
            metadata: {
              insight_score: (result as Record<string, unknown>)['confidence_breakdown']
                ? ((result as Record<string, unknown>)['confidence_breakdown'] as Record<string, number>)['combined_score']
                : (result as Record<string, unknown>)['confidence'] as number | undefined,
            },
          }
          const receiptsCol = await getReceiptsCollection()
          await receiptsCol.insertOne(receipt)
        }

        // Online SGD update — dismissal = negative signal (outcome=0)

        if (featureHashScorer && result.detector_id && learningAllowed) {
          const doc = result as Record<string, unknown>
          const features = (doc['feature_snapshot'] as Record<string, unknown> | undefined)
            ?? { hypothesis: result.hypothesis, urgency: result.urgency, category: result.category }
          featureHashScorer.update(
            tenant_id,
            result.detector_id as string,
            features,
            0,
            { features: Object.keys(features).map(k => `data.${k}`) },
          ).catch(() => {})
        }

        // Cross-signal tenant-level update — dismissal = negative signal
        if (tenantLevelScorer && learningAllowed && db) {
          const doc = result as Record<string, unknown>
          const entityKey = (doc['entity_key'] as string | undefined) ?? ''
          const signalType = (doc['signal_type'] as string | undefined) ?? result.category
          if (entityKey) {
            fetchRecentInsightsForEntity(db, tenant_id, entityKey).then(recent =>
              tenantLevelScorer.update(tenant_id, entityKey, signalType, result.detector_id, recent, 0)
            ).catch(() => {})
          }
        }

        getAuditLogger()?.fromRequest(request, 'insight.dismiss', 'insight', id, { reason })
        if (db) {
          await recordMomentDecision(db, { tenantId: tenant_id, insightId: id, decision: 'dismiss' })
          const content = `${result.detector_id} fired and was dismissed. ${result.reasoning}`
          await new MongoMemoryRepository(db).save({
            id: randomUUID(),
            tenant_id,
            scope_type: 'detector',
            scope_id: result.detector_id,
            memory_type: 'episodic',
            content,
            content_hash: createHash('sha256').update(content).digest('hex'),
            metadata: { trigger_id: result.id, approved: false, dismiss_reason: reason ?? null },
            tags: [result.detector_id],
            created_at: new Date(),
            expires_at: new Date(Date.now() + 180 * 86_400_000),
          })
        }
        return { insight: result, message: 'Insight dismissed' }
      } catch {
        return reply.status(404).send({ error: 'Insight not found' })
      }
    },
  )

  /**
   * GET /receipts
   * Query action receipts with filters
   * Query params: insight_id, outcome, days (default 30), limit (default 50)
   */
  app.get('/receipts', async (request) => {
    const { tenant_id } = request.authContext
    const query = request.query as {
      insight_id?: string
      outcome?: string
      days?: string
      limit?: string
    }

    if (!db) return { receipts: [] }

    const filter: Record<string, unknown> = { tenant_id }
    if (query.insight_id) filter['insight_id'] = query.insight_id
    if (query.outcome) filter['outcome'] = query.outcome

    const days = Math.min(365, Math.max(1, parseInt(query.days ?? '30', 10) || 30))
    const since = new Date(Date.now() - days * 864e5)
    filter['executed_at'] = { $gte: since }

    const limit = Math.min(100, parseInt(query.limit ?? '50', 10) || 50)

    const receiptsCol = await getReceiptsCollection()
    const receipts = await receiptsCol
      .find(filter)
      .sort({ executed_at: -1 })
      .limit(limit)
      .toArray()

    return { receipts }
  })

  /**
   * POST /insights/cleanup-stale
   * Archives stale pre-fix insight cards that contain known broken content:
   *   - "minor_currency" in reasoning text (A1 leak, pre-fix records)
   *   - False "goal achieved" in reasoning when state is still 'identified' (A2)
   *   - Suggestions to increase a target beyond 100% for bounded metrics (A3)
   *
   * These records won't self-correct because the insight text is baked in at
   * creation time. This endpoint archives them so they drop out of the feed.
   * Only archives insights in 'identified' or 'sent' state — already
   * dismissed/completed insights are left alone.
   */
  app.post<{ Body: { dry_run?: boolean } }>(
    '/insights/cleanup-stale',
    async (request, reply) => {
      const { tenant_id } = request.authContext
      const { dry_run } = request.body ?? {}

      if (!db) return reply.status(503).send({ error: 'Database not connected' })

      const col = await getInsightsCollection()
      const staleFilter: Record<string, unknown> = {
        tenant_id,
        state: { $in: ['identified', 'sent'] },
        $or: [
          // A1: raw "minor_currency" leaked into reasoning text
          { reasoning: { $regex: /minor_currency/i } },
          // A2: false "goal achieved" in reasoning while still open
          { reasoning: { $regex: /goal achieved/i } },
          // A3: suggestion to increase target beyond 100% for bounded metrics
          { reasoning: { $regex: /increase.*target.*\b1[0-9]{2}%/i } },
        ],
      }

      if (dry_run) {
        const count = await col.countDocuments(staleFilter)
        return { dry_run: true, would_archive: count }
      }

      const result = await col.updateMany(staleFilter, {
        $set: {
          state: 'archived',
          archived_at: new Date(),
          archived_reason: 'stale pre-fix content (A1/A2/A3 cleanup)',
        },
      })

      getAuditLogger()?.fromRequest(request, 'insight.cleanup_stale', 'insights', 'bulk', {
        archived: result.modifiedCount,
      })

      return {
        archived: result.modifiedCount,
        matched: result.matchedCount,
      }
    },
  )

  /**
   * POST /insights/cleanup-stale-all
   * System-level endpoint that archives stale insights across ALL tenants.
   * Protected by a system admin token (SYSTEM_ADMIN_TOKEN env var), not
   * tenant auth. Used for one-time cleanup of pre-fix insight records that
   * are still live on Home but contain broken content (A1/A2/A3 patterns).
   */
  app.post<{ Body: { dry_run?: boolean; token?: string } }>(
    '/insights/cleanup-stale-all',
    async (request, reply) => {
      const adminToken = process.env['SYSTEM_ADMIN_TOKEN']
      if (!adminToken) {
        return reply.status(503).send({ error: 'System admin token not configured' })
      }
      const bodyToken = request.body?.token ?? request.headers['x-system-token']
      if (bodyToken !== adminToken) {
        return reply.status(403).send({ error: 'Invalid system token' })
      }
      const { dry_run } = request.body ?? {}

      if (!db) return reply.status(503).send({ error: 'Database not connected' })

      const col = await getInsightsCollection()
      const staleFilter: Record<string, unknown> = {
        state: { $in: ['identified', 'sent'] },
        $or: [
          { reasoning: { $regex: /minor_currency/i } },
          { reasoning: { $regex: /goal achieved/i } },
          { reasoning: { $regex: /increase.*target.*\b1[0-9]{2}%/i } },
        ],
      }

      if (dry_run) {
        const count = await col.countDocuments(staleFilter)
        const samples = await col.find(staleFilter).limit(5).project({ _id: 1, tenant_id: 1, reasoning: 1, created_at: 1 }).toArray()
        return { dry_run: true, would_archive: count, samples }
      }

      const result = await col.updateMany(staleFilter, {
        $set: {
          state: 'archived',
          archived_at: new Date(),
          archived_reason: 'stale pre-fix content (A1/A2/A3 system cleanup)',
        },
      })

      return {
        archived: result.modifiedCount,
        matched: result.matchedCount,
      }
    },
  )
}

/**
 * One-time startup cleanup: archives stale pre-fix insight records across
 * all tenants. Called from server.ts after MongoDB connects. Runs in the
 * background — doesn't block server startup.
 */
export async function cleanupStaleInsightsStartup(db: Db): Promise<void> {
  try {
    const col = db.collection('insights')
    const staleFilter: Record<string, unknown> = {
      state: { $in: ['identified', 'sent'] },
      $or: [
        { reasoning: { $regex: /minor_currency/i } },
        { reasoning: { $regex: /goal achieved/i } },
        { reasoning: { $regex: /increase.*target.*\b1[0-9]{2}%/i } },
      ],
    }
    const count = await col.countDocuments(staleFilter)
    if (count === 0) return
    const result = await col.updateMany(staleFilter, {
      $set: {
        state: 'archived',
        archived_at: new Date(),
        archived_reason: 'stale pre-fix content (A1/A2/A3 startup cleanup)',
      },
    })
    log.info({ modified: result.modifiedCount, matched: result.matchedCount }, `Archived ${result.modifiedCount} stale insights (matched ${result.matchedCount})`)
  } catch (err) {
    log.error({ err }, 'Failed to cleanup stale insights')
  }
}
