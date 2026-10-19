/**
 * /insights — query, act on, and explain insights
 *
 * GET  /insights                  — list with filters
 * GET  /insights/:id              — single insight
 * GET  /insights/:id/explain      — full rule evaluation trace
 * GET  /insights/:id/action-preview — per-action effects for the approval gate
 * POST /insights/:id/approve         — approve + execute recommended actions
 * POST /insights/:id/retry-execution — retry actions that failed on approve (idempotent)
 * POST /insights/:id/dismiss         — dismiss insight
 * POST /insights/:id/prepare         — draft an outreach message (Tier 1 — never sends)
 * GET  /a/:token                     — signed notification action link (confirm page)
 * POST /a/:token                     — signed notification action link (executes)
 * GET  /why/:token                   — signed notification evidence link (read-only)
 * GET  /insights/review              — insights the judge held back, awaiting review
 * POST /insights/:id/review-release  — organizer override: deliver despite the verdict
 * POST /insights/:id/review-discard  — organizer override: discard the held insight
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import type { Engine, FeatureHashScorer, TenantLevelScorer, RecentInsight } from '@lifekeel/engine'
import type { ActionReceipt } from '@lifekeel/workflows'
import { ApprovalSignalHealthMonitor, createLogger, FreeTierPolicy } from '@lifekeel/platform'
import { familyDataLlmFromEnv } from '../local-model.js'
import { getInsightsCollection, getReceiptsCollection } from '../db.js'
import { getAuditLogger, type AuditAction } from '../audit/audit-log.js'
import type { DeliveryRouter } from '../delivery/delivery-router.js'
import { recordInsightRouteError } from './metrics.js'
import { sendOpsAlert } from '../operator/ops-alerts.js'
import { ActionExecutor, previewActions } from '../actions/action-executor.js'
import { isOriginAllowedForCookieAuth } from '../auth/session-cookie.js'
import { recordMomentDecision } from '../verified-moments.js'
import { generateDraft } from '../insights/generate-draft.js'
import { extractDraftProvenance } from '../insights/draft-provenance.js'
import { isFamilyOrganizer } from '../family/family-permissions.js'
import { listInsightAttributions, recordInsightAction } from '../insights/insight-attribution.js'
import {
  consolidateInsights,
  getDetectorPrioritySettings,
  type DetectorPrioritySettings,
} from '../insights/consolidation.js'

const log = createLogger({ service: 'insights', version: '0.0.0' })

// KEEL-008: every catch block below only ever runs for a genuine unexpected
// failure — the legitimate not-found case is always handled by an explicit
// check inside the try, never a throw. Before this, a real DB outage was
// indistinguishable from "nothing here" to both the client and to ops.
// Response shape/status is deliberately unchanged — this only adds the
// missing internal signal.
function reportInsightRouteError(route: string, err: unknown, tenantId: string): void {
  recordInsightRouteError(route)
  sendOpsAlert({
    severity: 'critical',
    title: 'Insight route error',
    message: `${route} threw: ${err instanceof Error ? err.message : String(err)}`,
    fingerprint: `insight-route-error:${route}`,
    tenant_id: tenantId,
  }).catch(() => {})
}
import { MongoMemoryRepository } from '@lifekeel/mongodb-adapter'
import { createHash, randomUUID } from 'node:crypto'

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
  const docs = (await db
    .collection('insights')
    .find({
      tenant_id: tenantId,
      entity_key: entityKey,
      created_at: { $gte: cutoff },
    })
    .sort({ created_at: -1 })
    .limit(50)
    .toArray()) as unknown as Array<{
    detector_id?: string
    signal_type?: string
    state?: string
    created_at: Date
  }>
  return docs.map((d) => ({
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
  deliveryRouter?: DeliveryRouter,
): Promise<void> {
  const actionExecutor = db ? new ActionExecutor(db) : null
  // Independent instance for insight.prepare (Tier 1 drafting) — same
  // pattern as apps/api/src/routes/assistant.ts, no shared global needed.
  const prepareLlmFn = familyDataLlmFromEnv()

  interface DecisionContext {
    id: string
    tenantId: string
    userId: string
    notes?: string
    reason?: string
    dryRunQuery?: boolean
    via?: string
    ip?: string
    userAgent?: string
  }

  interface DecisionOutcome {
    code: number
    body: Record<string, unknown>
  }

  /** Audit an insight decision without needing a Fastify request — the
   *  signed-link path has no authContext, so tenant/user come from the
   *  verified token instead. */
  const auditInsight = (
    ctx: DecisionContext,
    action: AuditAction,
    resourceId: string,
    metadata: Record<string, unknown>,
  ): void => {
    getAuditLogger()?.log({
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      action,
      resource_type: 'insight',
      resource_id: resourceId,
      metadata,
      ip: ctx.ip ?? '',
      user_agent: ctx.userAgent ?? '',
      timestamp: new Date(),
    })
  }
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
      member_id?: string
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
    // Independent $or clauses compose under $and so goal_id and
    // member_id can combine instead of the last writer clobbering the
    // other's $or.
    const orClauses: Record<string, unknown>[] = []
    if (query.goal_id) {
      orClauses.push({
        $or: [{ goal_id: query.goal_id }, { 'feature_snapshot.goal_id': query.goal_id }],
      })
    }
    // PRD-117: insights attributed to a specific roster member — the
    // per-member earner signals (PRD-104) and renewal attribution carry
    // member_id into feature_snapshot, and the engine derives entity_key
    // from it. All three spellings checked because member attribution
    // landed in feature_snapshot under different field names over time.
    if (query.member_id) {
      orClauses.push({
        $or: [
          { 'feature_snapshot.member_id': query.member_id },
          { 'feature_snapshot.soonest_renewal_member_id': query.member_id },
          { entity_key: query.member_id },
        ],
      })
    }
    if (orClauses.length === 1) filter['$or'] = (orClauses[0] as { $or: unknown }).$or
    else if (orClauses.length > 1) filter['$and'] = orClauses
    // Caller-driven exclusions, folded into the same filter used for both the
    // page of results and the `total` count below — so a preview list and its
    // "how many total" figure never disagree about what's excluded (Home uses
    // this to keep its opportunities count in sync with what LifeKeel Pulse
    // actually renders, instead of filtering client-side after slicing).
    if (query.exclude_category) filter['category'] = { $nin: query.exclude_category.split(',') }
    if (query.exclude_detector_id)
      filter['detector_id'] = { $nin: query.exclude_detector_id.split(',') }

    const limit = Math.min(parseInt(query.limit ?? '20', 10), 100)
    const offset = parseInt(query.offset ?? '0', 10)

    try {
      const col = await getInsightsCollection()
      const [insights, total] = await Promise.all([
        col.find(filter).sort({ created_at: -1 }).skip(offset).limit(limit).toArray(),
        col.countDocuments(filter),
      ])

      return {
        insights,
        total,
        limit,
        offset,
        has_more: offset + limit < total,
      }
    } catch (err) {
      // KEEL-008: was a silent catch — a real DB outage looked identical to
      // "no insights yet" in the response, with nothing to tell them apart
      // in the logs either.
      log.warn({ err }, 'GET /insights failed')
      reportInsightRouteError('GET /insights', err, tenant_id)
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
      filter['$or'] = [{ goal_id: query.goal_id }, { 'feature_snapshot.goal_id': query.goal_id }]
    }

    const limit = Math.min(parseInt(query.limit ?? '20', 10), 100)
    const offset = parseInt(query.offset ?? '0', 10)

    try {
      const col = await getInsightsCollection()
      const insights = (await col
        .find(filter)
        .sort({ created_at: -1 })
        .skip(offset)
        .limit(limit)
        .toArray()) as unknown as import('@lifekeel/engine').Insight[]

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
    } catch (err) {
      log.warn({ err }, 'GET /insights/consolidated failed')
      reportInsightRouteError('GET /insights/consolidated', err, tenant_id)
      return { groups: [], total: 0, limit, offset, has_more: false }
    }
  })

  /**
   * GET /insights/attribution — which family-detector insights were
   * followed by a real family action (profile updated, policy added,
   * document applied, insight approved, playbook step completed) within
   * 30 days of firing. Association, not causation — the UI words it
   * "acted on", never "Keel made them do it".
   */
  app.get('/insights/attribution', async (request, reply) => {
    const { tenant_id } = request.authContext
    if (!db) return { attributions: [] }
    try {
      const rows = await listInsightAttributions(db, tenant_id)
      return {
        attributions: rows.map((r) => ({
          insight_id: r.insight_id,
          detector_id: r.detector_id,
          rule_id: r.rule_id,
          action_type: r.action_type,
          action_at: r.action_at,
          insight_created_at: r.insight_created_at,
        })),
      }
    } catch (err) {
      log.warn({ err }, 'GET /insights/attribution failed')
      return reply.status(500).send({ error: 'Failed to load attribution' })
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
      const insights = (await col
        .find(filter)
        .sort({ created_at: -1 })
        .limit(limit)
        .toArray()) as unknown as import('@lifekeel/engine').Insight[]

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
    } catch (err) {
      log.warn({ err, entityKey }, 'GET /insights/entity/:entityKey failed')
      reportInsightRouteError('GET /insights/entity/:entityKey', err, tenant_id)
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
    } catch (err) {
      log.warn({ err, id }, 'GET /insights/:id failed')
      reportInsightRouteError('GET /insights/:id', err, tenant_id)
      return reply.status(404).send({ error: 'Insight not found' })
    }
  })

  /**
   * GET /insights/:id/action-preview
   * The approval-gate read: returns the insight plus a per-action preview of
   * what POST /insights/:id/approve would actually run — the SAME
   * classification ActionExecutor dispatches on (previewActions shares
   * classifyAction), so the screen a human approves from can't drift from
   * the side effects that execute. Includes the tenant's dry_run flag so the
   * gate can say "nothing will actually send" when that's true.
   */
  app.get<{ Params: { id: string } }>('/insights/:id/action-preview', async (request, reply) => {
    const { tenant_id } = request.authContext
    const { id } = request.params

    try {
      const col = await getInsightsCollection()
      const insight = await col.findOne({ id, tenant_id }) // tenant_id guard
      if (!insight) return reply.status(404).send({ error: 'Insight not found' })

      const tenantSettings = db
        ? await db.collection('tenant_settings').findOne({ tenant_id })
        : null
      const dryRun = tenantSettings?.['automation']?.dry_run_mode === true

      return {
        insight,
        actions: previewActions(
          (insight as unknown as { actions?: string[] }).actions ?? [],
          (
            insight as unknown as {
              action_intents?: {
                type: 'send_email' | 'send_whatsapp' | 'crm_tag' | 'log_only'
                label: string
                params?: Record<string, unknown>
              }[]
            }
          ).action_intents,
        ),
        dry_run: dryRun,
      }
    } catch (err) {
      log.warn({ err, id }, 'GET /insights/:id/action-preview failed')
      reportInsightRouteError('GET /insights/:id/action-preview', err, tenant_id)
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
    } catch (err) {
      log.warn({ err, id: request.params.id }, 'GET /moves/:id/evidence failed')
      reportInsightRouteError('GET /moves/:id/evidence', err, tenant_id)
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
    } catch (err) {
      log.warn({ err, id }, 'GET /insights/:id/explain failed')
      reportInsightRouteError('GET /insights/:id/explain', err, tenant_id)
      return reply.status(404).send({ error: 'Insight not found' })
    }

    const trace = engine.explain(id)
    if (!trace) {
      return reply.status(404).send({
        error:
          'Trace not found. Engine traces the last 1000 evaluations; older insights are not available.',
      })
    }

    return trace
  })

  /**
   * The approve decision, shared by POST /insights/:id/approve and the
   * signed /a/:token notification link — identical quota gates, receipt,
   * learning signal, trust increment, execution, and state write-back in
   * both paths. ctx.userId is the actor ('signed-link' for notification
   * links, which carry no user identity).
   */
  const approveInsightDecision = async (ctx: DecisionContext): Promise<DecisionOutcome> => {
    const { id } = ctx
    const tenant_id = ctx.tenantId
    const notes = ctx.notes

    try {
      if (db) {
        const tenant = await db
          .collection('tenants')
          .findOne({ $or: [{ tenant_id }, { id: tenant_id }] })
        const now = new Date()
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
        const used = await db
          .collection('insights')
          .countDocuments({ tenant_id, approved_at: { $gte: monthStart } })
        // `plan` is the field billing actually maintains on the tenant —
        // `tier` is a lifekeel-era field name nothing writes, so reading it
        // silently capped paid tenants at the free-tier limit.
        const quota = new FreeTierPolicy().check(
          'monthly_move_approvals',
          used,
          String(tenant?.['plan'] ?? 'free'),
        )
        if (!quota.allowed)
          return { code: 402, body: { error: 'Monthly Move approval quota exceeded', quota } }

        // Outcome-credit gate: require a positive balance to approve an insight.
        // Legacy tenants without a billing block are allowed through until migrated.
        const billing = tenant?.['billing']
        if (billing && Number(billing['credits_balance'] ?? 0) <= 0) {
          return {
            code: 402,
            body: {
              error: 'No outcome credits remaining',
              code: 'CREDITS_EXHAUSTED',
              credits_balance: billing['credits_balance'] ?? 0,
            },
          }
        }
      }
      const col = await getInsightsCollection()
      // Durable propose→commit: 'approved' records the human decision
      // immediately (survives a crash before execution below even starts);
      // a second atomic transition after execution flips to 'completed' or
      // 'execution_failed' so state always reflects whether the side
      // effect actually happened, not just whether a human clicked approve.
      const result = await col.findOneAndUpdate(
        { id, tenant_id, state: 'identified' },
        {
          $set: {
            state: 'approved',
            approved_at: new Date(),
            approved_by: ctx.userId,
            ...(notes !== undefined && { approval_notes: notes }),
          },
        },
        { returnDocument: 'after' },
      )

      if (!result) {
        return { code: 404, body: { error: 'Insight not found or not in identified state' } }
      }

      // Insight→action attribution: approving IS the action — attribute
      // it to this insight specifically (not the ambient window-wide
      // sweep a profile save uses). Best-effort; never blocks approval.
      if (db) {
        await recordInsightAction(db, tenant_id, 'insight_approved', { insightIds: [id] }).catch(
          () => {},
        )
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
        const dryRun = ctx.dryRunQuery === true || tenantDryRun

        const receipt: ActionReceipt = {
          id: randomUUID(),
          tenant_id,
          insight_id: id,
          workflow_run_id: (result as Record<string, unknown>)['workflow_run_id'] as
            string | undefined,
          detector_id: result.detector_id as string | undefined,
          action_type: 'insight.approve',
          outcome: tenantDryRun ? 'policy_blocked' : 'approved',
          outcome_reason: tenantDryRun ? 'dry_run_mode' : undefined,
          executed_at: new Date(),
          approved_by: ctx.userId,
          approved_via: ctx.via,
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
              ? (
                  (result as Record<string, unknown>)['confidence_breakdown'] as Record<
                    string,
                    number
                  >
                )['combined_score']
              : ((result as Record<string, unknown>)['confidence'] as number | undefined),
          },
        }
        const receiptsCol = await getReceiptsCollection()
        await receiptsCol.insertOne(receipt)
      }

      // Online SGD update — approval = positive signal (outcome=1)

      if (featureHashScorer && result.detector_id && learningAllowed) {
        const doc = result as Record<string, unknown>
        const features = (doc['feature_snapshot'] as Record<string, unknown> | undefined) ?? {
          hypothesis: result.hypothesis,
          urgency: result.urgency,
          category: result.category,
        }
        featureHashScorer
          .update(tenant_id, result.detector_id as string, features, 1, {
            features: Object.keys(features).map((k) => `data.${k}`),
          })
          .catch(() => {})
      }

      // Cross-signal tenant-level update — learns patterns across all
      // detectors/signal types for the same entity (e.g. "customer with
      // overdue invoice + cart abandonment = high approval likelihood").
      if (tenantLevelScorer && learningAllowed && db) {
        const doc = result as Record<string, unknown>
        const entityKey = (doc['entity_key'] as string | undefined) ?? ''
        const signalType = (doc['signal_type'] as string | undefined) ?? result.category
        if (entityKey) {
          fetchRecentInsightsForEntity(db, tenant_id, entityKey)
            .then((recent) =>
              tenantLevelScorer.update(
                tenant_id,
                entityKey,
                signalType,
                result.detector_id,
                recent,
                1,
              ),
            )
            .catch(() => {})
        }
      }

      auditInsight(ctx, 'insight.approve', id, {
        detector_id: result.detector_id,
        ...(ctx.via ? { via: ctx.via } : {}),
      })

      // Increment trust level for this insight's workflow scope. Real
      // detector-produced insights don't carry workflow_id (only sandbox
      // seeds did) — the detector IS the workflow for them, so the key
      // falls back to detector_id. Without this the counter never moved
      // off zero for any production insight.
      const resultRecord = result as Record<string, unknown>
      const workflowScope = (resultRecord['workflow_id'] ?? resultRecord['detector_id']) as
        string | undefined
      if (db && workflowScope) {
        const workflowId = workflowScope
        const tenantSettings = await db.collection('tenant_settings').findOne({ tenant_id })
        const automation = (tenantSettings?.['automation'] as
          { trust_level_by_workflow?: Record<string, number> } | undefined) ?? {
          trust_level_by_workflow: {},
        }
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
                updated_at: new Date(),
              },
            },
            { upsert: true },
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
      const tenantSettings = db
        ? await db.collection('tenant_settings').findOne({ tenant_id })
        : null
      const tenantDryRun = tenantSettings?.['automation']?.dry_run_mode === true
      const dryRun = ctx.dryRunQuery === true || tenantDryRun
      const executionSummary = actionExecutor
        ? await actionExecutor
            .execute(result as never, result.tenant_id as string, {
              dryRun,
              approvedBy: ctx.userId,
              approvedVia: ctx.via,
            })
            .catch((err) => {
              app.log.error({ err, insight_id: id }, 'Action execution failed')
              return null
            })
        : null

      // Write back the real outcome: 'execution_failed' when the executor
      // threw entirely, or any action came back 'execution_failed'/
      // 'execution_ambiguous' — this is the missing half of propose/commit
      // that used to leave 'completed' set regardless of whether execution
      // ever ran. Insights with no configured executor (db-less deployments,
      // most unit tests) have nothing to execute, so they complete immediately.
      const executionFailed =
        actionExecutor !== null &&
        (executionSummary === null ||
          executionSummary.receipts.some(
            (r) => r.outcome === 'execution_failed' || r.outcome === 'execution_ambiguous',
          ))
      // A 'pending' receipt means another dispatcher holds the claim and
      // its outcome isn't known yet — leave the insight in 'approved'
      // (in-flight) rather than calling it completed or failed.
      const executionPending =
        executionSummary !== null && executionSummary.receipts.some((r) => r.outcome === 'pending')
      const finalUpdate = await col.findOneAndUpdate(
        { id, tenant_id, state: 'approved' },
        {
          $set: {
            state: executionFailed
              ? 'execution_failed'
              : executionPending
                ? 'approved'
                : 'completed',
          },
        },
        { returnDocument: 'after' },
      )
      const finalResult = finalUpdate ?? result

      if (db) {
        const actionReceiptIds = executionSummary?.receipts.map((receipt) => receipt.id) ?? []
        await recordMomentDecision(db, {
          tenantId: tenant_id,
          insightId: id,
          decision: 'approve',
          ...(actionReceiptIds.length > 0 ? { actionReceiptIds } : {}),
        })
      }

      return {
        code: 200,
        body: {
          insight: finalResult,
          message: executionFailed
            ? 'Insight approved; one or more actions failed to execute — see actions for details'
            : 'Insight approved',
          ...(executionSummary && { actions: executionSummary }),
        },
      }
    } catch (err) {
      log.warn({ err, id }, 'POST /insights/:id/approve failed')
      reportInsightRouteError('POST /insights/:id/approve', err, tenant_id)
      return { code: 404, body: { error: 'Insight not found' } }
    }
  }

  /**
   * POST /insights/:id/approve
   * Marks an insight as approved and schedules its recommended actions.
   * Body: { notes?: string }
   */
  app.post<{ Params: { id: string }; Body: { notes?: string } }>(
    '/insights/:id/approve',
    async (request, reply) => {
      const outcome = await approveInsightDecision({
        id: request.params.id,
        tenantId: request.authContext.tenant_id,
        userId: request.authContext.user_id,
        notes: request.body?.notes,
        dryRunQuery: (request.query as Record<string, string>)['dry_run'] === '1',
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      })
      return reply.status(outcome.code).send(outcome.body)
    },
  )

  /**
   * POST /insights/:id/retry-execution
   * Re-runs action execution for an insight stuck in 'execution_failed'
   * (approve ran, but one or more recommended actions definitively or
   * ambiguously failed to execute). Safe to call repeatedly: ActionExecutor's
   * own idempotency (payload_hash per action) skips anything that already
   * succeeded and only re-dispatches the actions that previously failed.
   */
  app.post<{ Params: { id: string } }>('/insights/:id/retry-execution', async (request, reply) => {
    const { tenant_id } = request.authContext
    const { id } = request.params

    if (!actionExecutor) {
      return reply.status(501).send({ error: 'Action execution is not configured' })
    }

    try {
      const col = await getInsightsCollection()
      const result = await col.findOneAndUpdate(
        {
          id,
          tenant_id,
          $or: [
            { state: 'execution_failed' },
            // A crash between the approve transition and the outcome
            // write-back strands an insight in 'approved' forever. Only
            // treat it as retryable once clearly stale, so this can't
            // race an approve that's still in flight.
            { state: 'approved', approved_at: { $lt: new Date(Date.now() - 2 * 60 * 1000) } },
          ],
        },
        { $set: { state: 'approved' } },
        { returnDocument: 'after' },
      )
      if (!result) {
        return reply.status(404).send({ error: 'Insight not found or not in a retryable state' })
      }

      const tenantSettings = db
        ? await db.collection('tenant_settings').findOne({ tenant_id })
        : null
      const tenantDryRun = tenantSettings?.['automation']?.dry_run_mode === true
      const dryRun = (request.query as Record<string, string>)['dry_run'] === '1' || tenantDryRun

      const executionSummary = await actionExecutor
        .execute(result as never, tenant_id, { dryRun, approvedBy: request.authContext.user_id })
        .catch((err) => {
          app.log.error({ err, insight_id: id }, 'Retry action execution failed')
          return null
        })

      const executionFailed =
        executionSummary === null ||
        executionSummary.receipts.some(
          (r) => r.outcome === 'execution_failed' || r.outcome === 'execution_ambiguous',
        )
      const executionPending =
        executionSummary !== null && executionSummary.receipts.some((r) => r.outcome === 'pending')
      const finalUpdate = await col.findOneAndUpdate(
        { id, tenant_id, state: 'approved' },
        {
          $set: {
            state: executionFailed
              ? 'execution_failed'
              : executionPending
                ? 'approved'
                : 'completed',
          },
        },
        { returnDocument: 'after' },
      )

      getAuditLogger()?.fromRequest(request, 'insight.retry_execution', 'insight', id, {})

      return {
        insight: finalUpdate ?? result,
        message: executionFailed
          ? 'Retry attempted; one or more actions are still failing'
          : 'All actions completed',
        actions: executionSummary,
      }
    } catch (err) {
      log.warn({ err, id }, 'POST /insights/:id/retry-execution failed')
      reportInsightRouteError('POST /insights/:id/retry-execution', err, tenant_id)
      return reply.status(404).send({ error: 'Insight not found' })
    }
  })

  /**
   * The dismiss decision, shared by POST /insights/:id/dismiss and the
   * signed /a/:token notification link — see approveInsightDecision.
   */
  const dismissInsightDecision = async (ctx: DecisionContext): Promise<DecisionOutcome> => {
    const { id } = ctx
    const tenant_id = ctx.tenantId
    const reason = ctx.reason

    try {
      if (db) {
        const settings = await db.collection('tenant_settings').findOne({ tenant_id })
        if (settings?.['require_dismissal_note'] === true && !reason?.trim())
          return { code: 400, body: { error: 'Dismissal reason required' } }
      }
      const col = await getInsightsCollection()
      const result = await col.findOneAndUpdate(
        { id, tenant_id, state: { $in: ['identified', 'sent'] } },
        {
          $set: {
            state: 'dismissed',
            dismissed_at: new Date(),
            dismissed_by: ctx.userId,
            ...(reason !== undefined && { dismiss_reason: reason }),
            ...(reason !== undefined && { 'collaboration.resolution_note': reason }),
          },
        },
        { returnDocument: 'after' },
      )

      if (!result) {
        return { code: 404, body: { error: 'Insight not found or already actioned' } }
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
          workflow_run_id: (result as Record<string, unknown>)['workflow_run_id'] as
            string | undefined,
          detector_id: result.detector_id as string | undefined,
          action_type: 'insight.dismiss',
          outcome: 'dismissed',
          outcome_reason: reason,
          executed_at: new Date(),
          approved_by: ctx.userId,
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
              ? (
                  (result as Record<string, unknown>)['confidence_breakdown'] as Record<
                    string,
                    number
                  >
                )['combined_score']
              : ((result as Record<string, unknown>)['confidence'] as number | undefined),
          },
        }
        const receiptsCol = await getReceiptsCollection()
        await receiptsCol.insertOne(receipt)
      }

      // Online SGD update — dismissal = negative signal (outcome=0)

      if (featureHashScorer && result.detector_id && learningAllowed) {
        const doc = result as Record<string, unknown>
        const features = (doc['feature_snapshot'] as Record<string, unknown> | undefined) ?? {
          hypothesis: result.hypothesis,
          urgency: result.urgency,
          category: result.category,
        }
        featureHashScorer
          .update(tenant_id, result.detector_id as string, features, 0, {
            features: Object.keys(features).map((k) => `data.${k}`),
          })
          .catch(() => {})
      }

      // Cross-signal tenant-level update — dismissal = negative signal
      if (tenantLevelScorer && learningAllowed && db) {
        const doc = result as Record<string, unknown>
        const entityKey = (doc['entity_key'] as string | undefined) ?? ''
        const signalType = (doc['signal_type'] as string | undefined) ?? result.category
        if (entityKey) {
          fetchRecentInsightsForEntity(db, tenant_id, entityKey)
            .then((recent) =>
              tenantLevelScorer.update(
                tenant_id,
                entityKey,
                signalType,
                result.detector_id,
                recent,
                0,
              ),
            )
            .catch(() => {})
        }
      }

      auditInsight(ctx, 'insight.dismiss', id, { reason, ...(ctx.via ? { via: ctx.via } : {}) })
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
      return { code: 200, body: { insight: result, message: 'Insight dismissed' } }
    } catch (err) {
      log.warn({ err, id }, 'POST /insights/:id/dismiss failed')
      reportInsightRouteError('POST /insights/:id/dismiss', err, tenant_id)
      return { code: 404, body: { error: 'Insight not found' } }
    }
  }

  /**
   * POST /insights/:id/dismiss
   * Body: { reason?: string }
   */
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/insights/:id/dismiss',
    async (request, reply) => {
      const outcome = await dismissInsightDecision({
        id: request.params.id,
        tenantId: request.authContext.tenant_id,
        userId: request.authContext.user_id,
        reason: request.body?.reason,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      })
      return reply.status(outcome.code).send(outcome.body)
    },
  )

  // ── Signed notification links (/a/, /why/) ────────────────────────────────
  // DeliveryRouter puts these URLs in every delivered notification:
  //   approve_url  /a/<signActionToken(approve)>
  //   dismiss_url  /a/<signActionToken(dismiss)>
  //   why_url      /why/<signEvidenceToken>
  // They're on server.ts's public-path list — the 7-day HMAC token IS the
  // auth. Until now the URLs 404'd, so "approve from the notification" was
  // dead on arrival.
  //
  // GET /a/:token renders a confirmation page rather than acting: mail
  // scanners, chat previews, and browser prefetch all issue GETs, and a
  // prefetch must never approve (and thereby dispatch email/WhatsApp) on
  // the family's behalf. The POST — which only a deliberate button press
  // produces — runs the exact same decision as POST /insights/:id/approve,
  // including the quota/credit gates and dry-run honoring.
  //
  // Approval requires authenticated continuation (intent 02): a bearer
  // token alone can preview, but POST approve only runs when a session
  // belonging to the SAME tenant rides along — the link is a pointer to
  // the decision, not the authority for it. Dismiss keeps bearer
  // semantics deliberately: it has no external side effects, and the
  // worst case of a forwarded link is suppressing an insight the link
  // holder could already read — identical exposure to the notification
  // that carried it.
  const escHtml = (s: unknown): string =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    )

  const linkPage = (title: string, inner: string): string =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title>` +
    `<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.25rem;color:#1e1b33}` +
    `h1{font-size:1.3rem;margin-bottom:.5rem}p{color:#555;line-height:1.5}` +
    `.card{border:1px solid #e3e0ef;border-radius:14px;padding:1.1rem 1.25rem;margin:1.25rem 0;background:#faf9fe}` +
    `button{font:inherit;font-weight:600;padding:.8rem 1.6rem;border-radius:10px;border:0;cursor:pointer}` +
    `.primary{background:#6d4fc4;color:#fff}.secondary{background:#eceaf4;color:#443d66}</style></head><body>${inner}</body></html>`

  const expiredPage = linkPage(
    'Link expired',
    `<h1>This link has expired</h1><p>Open LifeKeel to review the insight directly — notification links are valid for 7 days.</p>`,
  )

  if (deliveryRouter) {
    const router = deliveryRouter

    const appUrl = (process.env['LIFEKEEL_URL'] ?? 'http://localhost:3002').replace(/\/$/, '')

    app.get<{ Params: { token: string } }>('/a/:token', async (request, reply) => {
      const decoded = router.verifyActionToken(request.params.token)
      if (!decoded) return reply.status(410).type('text/html').send(expiredPage)
      const col = await getInsightsCollection()
      const insight = await col.findOne(
        { id: decoded.insight_id, tenant_id: decoded.tenant_id },
        { projection: { hypothesis: 1, reasoning: 1, state: 1, actions: 1, action_intents: 1 } },
      )
      if (!insight)
        return reply
          .status(404)
          .type('text/html')
          .send(linkPage('Not found', `<h1>Insight not found</h1><p>It may have been removed.</p>`))
      const approve = decoded.action === 'approve'

      // Same classified preview as GET /insights/:id/action-preview —
      // previewActions shares ActionExecutor's classifyAction, so what the
      // link shows can't drift from what approving dispatches.
      const preview = approve
        ? previewActions(
            ((insight as { actions?: string[] }).actions ?? []) as string[],
            (insight as { action_intents?: never[] }).action_intents,
          )
            .map(
              (a) =>
                `<li><strong>${escHtml(a.label)}</strong> — ${escHtml(a.summary)}${a.external ? ' (external effect)' : ''}</li>`,
            )
            .join('')
        : ''

      // Opportunistic session: server.ts's open-path hook populates
      // authContext when a valid session cookie/Bearer rides along. Only a
      // session for the token's own tenant counts as continuation.
      const authed = request.authContext?.tenant_id === decoded.tenant_id

      if (approve && !authed) {
        return reply.type('text/html').send(
          linkPage(
            'Sign in to approve',
            `
          <h1>Sign in to approve this insight</h1>
          <div class="card"><strong>${escHtml(insight['hypothesis'] ?? 'Insight')}</strong>
          <p>${escHtml(insight['reasoning'] ?? '')}</p>
          ${preview ? `<ul>${preview}</ul>` : ''}</div>
          <p>Approving runs external actions on your family's behalf, so the link alone isn't enough — sign in, then come back to this link.</p>
          <p><a href="${escHtml(appUrl)}"><button class="primary">Open LifeKeel to sign in</button></a></p>`,
          ),
        )
      }

      const verb = approve ? 'Approve' : 'Dismiss'
      return reply.type('text/html').send(
        linkPage(
          `${verb} insight`,
          `
        <h1>${verb} this insight?</h1>
        <div class="card"><strong>${escHtml(insight['hypothesis'] ?? 'Insight')}</strong>
        <p>${escHtml(insight['reasoning'] ?? '')}</p>
        ${preview ? `<ul>${preview}</ul>` : ''}</div>
        <form method="POST" action="/a/${escHtml(request.params.token)}">
          <button type="submit" class="${approve ? 'primary' : 'secondary'}">${verb}</button>
        </form>`,
        ),
      )
    })

    app.post<{ Params: { token: string } }>('/a/:token', async (request, reply) => {
      const decoded = router.verifyActionToken(request.params.token)
      if (!decoded) return reply.status(410).type('text/html').send(expiredPage)

      // The confirmation form posts from the API's own origin — anything
      // else presenting a browser Origin header is a cross-site attempt.
      // (Non-browser clients omit Origin; the token is still their gate.)
      if (!isOriginAllowedForCookieAuth(request)) {
        return reply
          .status(403)
          .type('text/html')
          .send(linkPage('Not allowed', `<h1>Request rejected</h1>`))
      }

      const base = {
        id: decoded.insight_id,
        tenantId: decoded.tenant_id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      }

      if (decoded.action === 'approve') {
        // Authenticated continuation: the approving session must belong to
        // the token's tenant — an unauthenticated bearer link can no longer
        // dispatch external effects.
        const ctx = request.authContext
        if (!ctx || ctx.tenant_id !== decoded.tenant_id) {
          return reply
            .status(401)
            .type('text/html')
            .send(
              linkPage(
                'Sign in required',
                `<h1>Sign in to approve</h1><p>Open LifeKeel, sign in, then return to this link — it's valid for 7 days.</p>
               <p><a href="${escHtml(appUrl)}"><button class="primary">Open LifeKeel</button></a></p>`,
              ),
            )
        }
        const outcome = await approveInsightDecision({
          ...base,
          userId: ctx.user_id,
          via: 'signed_link',
        })
        if (outcome.code !== 200) {
          const err = (outcome.body as { error?: string }).error ?? 'Please try again'
          return reply
            .status(outcome.code)
            .type('text/html')
            .send(
              linkPage(
                "Couldn't approve",
                `<h1>Couldn't approve that insight</h1><p>${escHtml(err)}</p>`,
              ),
            )
        }
        const msg = (outcome.body as { message?: string }).message ?? 'Done'
        return reply
          .type('text/html')
          .send(linkPage('Done', `<h1>Approved</h1><p>${escHtml(msg)}</p>`))
      }

      // Dismiss keeps bearer semantics — see the comment above GET /a/:token.
      const outcome = await dismissInsightDecision({
        ...base,
        userId: 'signed-link',
        via: 'signed_link',
      })
      if (outcome.code !== 200) {
        const err = (outcome.body as { error?: string }).error ?? 'Please try again'
        return reply
          .status(outcome.code)
          .type('text/html')
          .send(
            linkPage(
              "Couldn't dismiss",
              `<h1>Couldn't dismiss that insight</h1><p>${escHtml(err)}</p>`,
            ),
          )
      }
      const msg = (outcome.body as { message?: string }).message ?? 'Done'
      return reply
        .type('text/html')
        .send(linkPage('Done', `<h1>Dismissed</h1><p>${escHtml(msg)}</p>`))
    })

    // GET /why/:token — read-only evidence view, safe as a plain GET.
    app.get<{ Params: { token: string } }>('/why/:token', async (request, reply) => {
      const decoded = router.verifyEvidenceToken(request.params.token)
      if (!decoded) return reply.status(410).type('text/html').send(expiredPage)
      const col = await getInsightsCollection()
      const insight = await col.findOne(
        { id: decoded.insight_id, tenant_id: decoded.tenant_id },
        {
          projection: {
            hypothesis: 1,
            reasoning: 1,
            detector_id: 1,
            urgency: 1,
            state: 1,
            confidence_breakdown: 1,
            estimated_impact_low: 1,
            estimated_impact_high: 1,
            currency: 1,
            created_at: 1,
          },
        },
      )
      if (!insight)
        return reply
          .status(404)
          .type('text/html')
          .send(linkPage('Not found', `<h1>Insight not found</h1>`))

      const doc = insight as Record<string, unknown>
      const confidence = (insight['confidence_breakdown'] as Record<string, unknown> | undefined)?.[
        'combined_score'
      ]
      const lo = doc['estimated_impact_low']
      const hi = doc['estimated_impact_high']
      const cur = doc['currency']
      const impact =
        typeof lo === 'number' || typeof hi === 'number'
          ? `<p>Estimated impact: ${escHtml(cur ?? '')} ${escHtml(lo ?? '—')}–${escHtml(hi ?? '—')}</p>`
          : ''
      const score =
        typeof confidence === 'number' ? `<p>Confidence: ${(confidence * 100).toFixed(0)}%</p>` : ''
      return reply.type('text/html').send(
        linkPage(
          'Why this insight',
          `
        <h1>Why Keel flagged this</h1>
        <div class="card"><strong>${escHtml(insight['hypothesis'] ?? 'Insight')}</strong>
        <p>${escHtml(insight['reasoning'] ?? '')}</p>
        ${score}${impact}
        <p style="color:#888;font-size:.85rem">Rule: ${escHtml(insight['detector_id'] ?? '—')} · Urgency: ${escHtml(insight['urgency'] ?? '—')} · Status: ${escHtml(insight['state'] ?? '—')}</p></div>`,
        ),
      )
    })

    /**
     * GET /insights/review — the family's view of what the judge held back.
     * Pending rows are still auto-retrying; exhausted rows need a human
     * call. Transparency posture: the family sees Keel's own rejections,
     * with the judge's scores and feedback attached.
     */
    app.get('/insights/review', async (request, reply) => {
      const { tenant_id } = request.authContext
      if (!db) return reply.status(503).send({ error: 'Review queue unavailable' })
      const rows = await router.listReviewQueue(tenant_id)
      const col = await getInsightsCollection()
      const insightIds = rows.map((r) => r['insight_id'] as string)
      const insights = await col
        .find(
          { id: { $in: insightIds }, tenant_id },
          { projection: { id: 1, hypothesis: 1, reasoning: 1, urgency: 1, state: 1, category: 1 } },
        )
        .toArray()
      const byId = new Map(insights.map((i) => [i.id as string, i]))
      return {
        items: rows.map((row) => ({
          queue: row['queue'],
          status: row['status'],
          attempts: row['attempts'] ?? 0,
          verdict: row['verdict'],
          updated_at: row['updated_at'],
          insight: byId.get(row['insight_id'] as string) ?? {
            id: row['insight_id'],
            missing: true,
          },
        })),
      }
    })

    /**
     * POST /insights/:id/review-release — an organizer reads the judge's
     * feedback and decides the insight is fine to send. The human decision
     * IS the gate here, so deliver() runs with the judge bypassed; other
     * gates (quiet hours, digest, dedup) still apply. Organizer-only, same
     * as every other family mutation.
     */
    app.post<{ Params: { id: string } }>('/insights/:id/review-release', async (request, reply) => {
      const { tenant_id, user_id } = request.authContext
      const { id } = request.params
      if (!db) return reply.status(503).send({ error: 'Review queue unavailable' })
      if (!(await isFamilyOrganizer(db, tenant_id, user_id))) {
        return reply
          .status(403)
          .send({ error: 'Only a family organizer can release held insights' })
      }
      const resolved = await router.resolveReviewItem(tenant_id, id, 'released')
      if (!resolved)
        return reply.status(404).send({ error: 'No held review item for this insight' })
      const col = await getInsightsCollection()
      const insight = await col.findOne({ id, tenant_id })
      if (!insight) return reply.status(404).send({ error: 'Insight not found' })
      const result = await router.deliver(insight as Record<string, unknown>, tenant_id, {
        skipJudge: true,
      })
      auditInsight(
        {
          id,
          tenantId: tenant_id,
          userId: user_id,
          via: 'review_release',
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
        'insight.review_release',
        id,
        { queue: resolved.queue },
      )
      return { released: true, delivered: result?.success === true }
    })

    /**
     * POST /insights/:id/review-discard — an organizer agrees with the
     * judge (or just doesn't want it). The review row closes and the
     * insight goes through the normal dismiss path so learning sees it.
     */
    app.post<{ Params: { id: string }; Body: { reason?: string } }>(
      '/insights/:id/review-discard',
      async (request, reply) => {
        const { tenant_id, user_id } = request.authContext
        const { id } = request.params
        if (!db) return reply.status(503).send({ error: 'Review queue unavailable' })
        if (!(await isFamilyOrganizer(db, tenant_id, user_id))) {
          return reply
            .status(403)
            .send({ error: 'Only a family organizer can discard held insights' })
        }
        const resolved = await router.resolveReviewItem(tenant_id, id, 'discarded')
        if (!resolved)
          return reply.status(404).send({ error: 'No held review item for this insight' })
        const outcome = await dismissInsightDecision({
          id,
          tenantId: tenant_id,
          userId: user_id,
          reason: request.body?.reason,
          via: 'review_discard',
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        })
        auditInsight(
          {
            id,
            tenantId: tenant_id,
            userId: user_id,
            via: 'review_discard',
            ip: request.ip,
            userAgent: request.headers['user-agent'],
          },
          'insight.review_discard',
          id,
          { queue: resolved.queue },
        )
        // The row is discarded either way — a non-200 here only means the
        // insight itself was already terminal.
        return { discarded: true, insight_dismissed: outcome.code === 200 }
      },
    )
  }

  /**
   * POST /insights/:id/prepare
   * Tier 1 "prepare, don't send" (docs/prd/103-tier1-prepare-actions.md):
   * drafts an outreach message grounded in this insight for the family to
   * review and send themselves. Deliberately minimal — no quota/credit
   * gates, no ActionReceipt, no scorer updates — those belong to the
   * heavier insight.approve/insight.dismiss flow this route does not
   * extend from. Never sends anything: no email/SMS/API call happens
   * here, on purpose (see apps/api/src/insights/generate-draft.ts).
   */
  app.post<{ Params: { id: string } }>(
    '/insights/:id/prepare',
    // KEEL-015: this route calls an LLM on every request — see the matching
    // rate-limit note on POST /assistant/ask.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { tenant_id } = request.authContext
      const { id } = request.params
      try {
        const col = await getInsightsCollection()
        const insight = await col.findOne({ id, tenant_id })
        if (!insight) return reply.status(404).send({ error: 'Insight not found' })

        const content = await generateDraft(prepareLlmFn, {
          reasoning: insight.reasoning,
          category: insight.category,
          detector_id: insight.detector_id,
        })
        if (!content) {
          return reply.send({
            draft: null,
            error: "Couldn't generate a draft right now — please try again later.",
          })
        }

        // provenance: which of the reasoning's concrete figures the draft
        // actually carried over — the UI's "from your data" vs "Keel's
        // wording" split. See insights/draft-provenance.ts.
        const draft = {
          content,
          generated_at: new Date(),
          provenance: extractDraftProvenance(insight.reasoning, content),
        }
        await col.updateOne({ id, tenant_id }, { $set: { draft } })
        getAuditLogger()?.fromRequest(request, 'insight.prepare', 'insight', id, {})
        return reply.send({ draft })
      } catch (err) {
        log.warn({ err, id }, 'Insight prepare failed')
        reportInsightRouteError('POST /insights/:id/prepare', err, tenant_id)
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
    const receipts = await receiptsCol.find(filter).sort({ executed_at: -1 }).limit(limit).toArray()

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
  app.post<{ Body: { dry_run?: boolean } }>('/insights/cleanup-stale', async (request, reply) => {
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
  })

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
        const samples = await col
          .find(staleFilter)
          .limit(5)
          .project({ _id: 1, tenant_id: 1, reasoning: 1, created_at: 1 })
          .toArray()
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
    log.info(
      { modified: result.modifiedCount, matched: result.matchedCount },
      `Archived ${result.modifiedCount} stale insights (matched ${result.matchedCount})`,
    )
  } catch (err) {
    log.error({ err }, 'Failed to cleanup stale insights')
  }
}
