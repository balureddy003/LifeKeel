/**
 * POST /events — ingest a single event and run all matching detectors
 * POST /events/stream — same, but stream insights via Server-Sent Events
 *
 * Pre-evaluation pipeline (in order):
 *   1. Intent classification (trie → embedding → LLM) — tagged onto business_context
 *   2. Adaptive threshold injection — per-tenant Bollinger Band thresholds into context
 *   3. Engine evaluation — deterministic rules, then optional LLM scoring with calibration
 */

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Engine, AdaptiveThresholdStore, IntentClassifier, FeatureHashScorer } from '@kairos/engine'
import type { DeliveryRouter } from '../delivery/delivery-router.js'
import { buildGoalContext } from '@kairos/platform'
import { getInsightsCollection, getDb } from '../db.js'
import { persistSignal } from '../signals.js'
import { ensureVerifiedMoments } from '../verified-moments.js'
import { recordEventIngested, recordInsightGenerated } from './metrics.js'
import { EventSchemaRegistry } from '../event-schema-registry.js'

// Runtime validation — rejects malformed payloads before they reach the engine
const EventBodySchema = z.object({
  event_type: z.string().min(1).max(128).regex(/^[a-z0-9._-]+$/i, 'event_type must be dot-separated alphanumeric'),
  event_id:   z.string().min(1).max(256).optional(),
  data:       z.record(z.unknown()).default({}),
  business_context: z.record(z.unknown()).optional(),
  schema_version: z.string().regex(/^\d+\.\d+\.\d+$/).default('0.0.0'),
  source: z.string().default('custom'),
})

type EventBody = z.infer<typeof EventBodySchema>

export async function registerEventRoutes(
  app: FastifyInstance,
  engine: Engine,
  adaptiveThresholds?: AdaptiveThresholdStore,
  intentClassifier?: IntentClassifier,
  deliveryRouter?: DeliveryRouter,
  featureHashScorer?: FeatureHashScorer,
): Promise<void> {

  /** Build enriched EvaluationContext for a request — injects thresholds + intent */
  async function buildContext(tenant_id: string, body: EventBody) {
    let businessContext = body.business_context ?? {}

    // ── Intent classification ───────────────────────────────────────────────
    // Adds `intent_class`, `intent_confidence`, `intent_tier` to business_context
    // so detector YAML can gate on: context.intent_class == "invoice_overdue"
    if (intentClassifier) {
      try {
        const classification = await intentClassifier.classify({
          event_type: body.event_type,
          data: body.data,
        })
        businessContext = {
          ...businessContext,
          intent_class: classification.intent,
          intent_confidence: classification.confidence,
          intent_tier: classification.tier_used,
        }
      } catch {
        // classifier failure = no-op, continue without intent
      }
    }

    // ── Adaptive threshold injection ────────────────────────────────────────
    // Injects per-tenant statistical thresholds so detectors can use:
    //   condition: "data.amount_minor > context.adaptive_thresholds['invoice_overdue.amount_minor.2sigma']"
    let adaptive_thresholds: Record<string, number> | undefined
    if (adaptiveThresholds) {
      try {
        adaptive_thresholds = await adaptiveThresholds.buildContextMap(tenant_id, body.event_type)
      } catch {
        // threshold lookup failure = fall back to hardcoded YAML values
      }
    }
    let active_detector_ids: string[] | undefined
    try {
      const db = await getDb()
      const active = await db.collection('goal_detector_activations')
        .distinct('detector_id', { tenant_id, active: true })
      if (active.length > 0) active_detector_ids = active.map(String)
    } catch {
      // Activation lookup failure preserves backward-compatible all-detector evaluation.
    }

    // ── Goal-aware thresholds ────────────────────────────────────────────────
    // Lets detector conditions reference what the tenant's active goal asked
    // for (e.g. "context.goal_kpi_targets['portfolio_concentration_max_pct']")
    // instead of a hardcoded default. Always populated — see buildGoalKpiTargets.
    // Gap #32: also fetches goal_id_by_metric so the detector can thread
    // goal_id into feature_snapshot.
    let goal_kpi_targets: Record<string, number> | undefined
    let goal_id_by_metric: Record<string, string> | undefined
    try {
      const db = await getDb()
      const goalCtx = await buildGoalContext(db, tenant_id)
      goal_kpi_targets = goalCtx.targets
      goal_id_by_metric = Object.keys(goalCtx.goal_id_by_metric).length > 0
        ? goalCtx.goal_id_by_metric
        : undefined
    } catch {
      // Lookup failure = detectors fall back to their own hardcoded defaults.
    }

    return {
      event_type: body.event_type,
      tenant_id,
      event_id: body.event_id ?? crypto.randomUUID(),
      data: body.data,
      schema_version: body.schema_version,
      source: body.source,
      ...(Object.keys(businessContext).length > 0 && { business_context: businessContext }),
      ...(adaptive_thresholds && Object.keys(adaptive_thresholds).length > 0 && { adaptive_thresholds }),
      ...(active_detector_ids && { active_detector_ids }),
      ...(goal_kpi_targets && { goal_kpi_targets }),
      ...(goal_id_by_metric && { goal_id_by_metric }),
    }
  }

  /** POST /events — evaluate and persist insights */
  app.post<{ Body: EventBody }>('/events', async (request, reply) => {
    const parsed = EventBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid event body',
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }

    const traceId = crypto.randomUUID()
    reply.header('X-Trace-Id', traceId)

    const { tenant_id } = request.authContext
    const tenant = await getDb().then(db => db.collection('tenants').findOne({
      $or: [{ tenant_id }, { id: tenant_id }],
    })).catch(() => null)
    if (tenant?.['status'] === 'erasure_pending' || tenant?.['status'] === 'erased') {
      return reply.status(410).send({ error: 'Tenant is not accepting new events' })
    }
    const eventId = parsed.data.event_id ?? crypto.randomUUID()

    // ── Event deduplication ───────────────────────────────────────────────────
    // Connectors guarantee at-least-once delivery; deduplicate by event_id so
    // retried webhooks don't produce duplicate insights or push notifications.
    const deduped = await checkAndMarkEventSeen(tenant_id, eventId)
    if (deduped) {
      request.log.info({ trace_id: traceId, event_id: eventId }, '[events] Duplicate event — skipping evaluation')
      return reply.status(200).send({ status: 'duplicate', event_id: eventId, trace_id: traceId })
    }

    const ctx = await buildContext(tenant_id, { ...parsed.data, event_id: eventId })
    const schemaValidation = await getDb().then(db => new EventSchemaRegistry(db).validate({
      tenant_id,
      event_type: ctx.event_type,
      source: ctx.source,
      schema_version: ctx.schema_version,
      data: ctx.data,
    }))
    if (!schemaValidation.valid) {
      return reply.status(422).send({ error: 'Event schema validation failed', issues: schemaValidation.errors })
    }
    const signalId = await persistSignal({
      tenant_id,
      signal_type: ctx.event_type,
      source: 'api',
      external_id: eventId,
      data: ctx.data,
      schema_version: ctx.schema_version,
      event_source: ctx.source,
    })
    request.log.info({ trace_id: traceId, event_id: eventId, event_type: ctx.event_type, tenant_id }, '[events] Evaluating')

    const result = await engine.evaluate({ ...ctx, derived_from_signals: [signalId] })
    recordEventIngested(tenant_id, ctx.event_type)
    for (const insight of result.insights) recordInsightGenerated(tenant_id, insight.detector_id)
    request.log.info({ trace_id: traceId, insights: result.insights.length, latency_ms: result.latency_ms }, '[events] Evaluation complete')

    // ── Engagement → SkillOptimizer feedback ─────────────────────────────────
    // When real audience engagement data arrives, use it as a training signal
    // for the feature-hash scorer — this is a stronger signal than approve/dismiss
    // because it reflects actual audience response, not just the founder's judgment.
    if (ctx.event_type === 'social.post.performance' && featureHashScorer) {
      const engagementRate = parsed.data.data['engagement_rate'] as number | undefined
      const insightId      = parsed.data.data['insight_id'] as string | undefined

      if (engagementRate !== undefined && insightId) {
        // Fetch the original insight to get its detector context
        getInsightsCollection().then(async col => {
          const originalInsight = await col.findOne({ id: insightId, tenant_id })
          if (!originalInsight || !originalInsight.detector_id) return

          // Classify outcome: > 2% engagement = positive; < 0.5% = negative
          const outcome: 0 | 1 = engagementRate >= 0.02 ? 1 : engagementRate < 0.005 ? 0 : -1 as never
          if (outcome === -1 as never) return  // neutral — skip

          const features = (originalInsight as Record<string, unknown>)['feature_snapshot'] as Record<string, unknown>
            ?? { engagement_rate: engagementRate }

          featureHashScorer?.update(
            tenant_id,
            originalInsight.detector_id as string,
            { ...features, engagement_rate: engagementRate },
            outcome as 0 | 1,
            { features: Object.keys(features).map(k => `data.${k}`) },
          ).catch(() => {})
        }).catch(() => {})
      }
    }

    if (result.insights.length > 0) {
      persistInsights(result.insights, traceId).catch((err) =>
        app.log.error({ err, trace_id: traceId }, 'Failed to persist insights'),
      )

      if (deliveryRouter) {
        for (const insight of result.insights) {
          deliveryRouter
            .deliver(insight as unknown as Record<string, unknown>, tenant_id)
            .catch((err) => app.log.error({ err, insight_id: insight.id, trace_id: traceId }, 'Push delivery failed'))
        }
      }
    }

    return reply.status(200).send({
      trace_id: traceId,
      insights: result.insights,
      detectors_run: result.detectors_run,
      rules_triggered: result.rules_triggered,
      latency_ms: result.latency_ms,
    })
  })

  /**
   * POST /events/stream — SSE streaming evaluation
   *
   * Streams insights as they are produced, one per detector, without
   * waiting for the entire evaluation to complete.
   */
  app.post<{ Body: EventBody }>('/events/stream', async (request, reply) => {
    const parsed = EventBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid event body',
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    const traceId = crypto.randomUUID()
    const { tenant_id } = request.authContext
    const eventId = parsed.data.event_id ?? crypto.randomUUID()

    const deduped = await checkAndMarkEventSeen(tenant_id, eventId)
    if (deduped) {
      return reply.status(200).send({ status: 'duplicate', event_id: eventId, trace_id: traceId })
    }

    const ctx = await buildContext(tenant_id, { ...parsed.data, event_id: eventId })
    const streamSchemaValidation = await getDb().then(db => new EventSchemaRegistry(db).validate({
      tenant_id,
      event_type: ctx.event_type,
      source: ctx.source,
      schema_version: ctx.schema_version,
      data: ctx.data,
    }))
    if (!streamSchemaValidation.valid) {
      return reply.status(422).send({ error: 'Event schema validation failed', issues: streamSchemaValidation.errors })
    }
    const signalId = await persistSignal({
      tenant_id,
      signal_type: ctx.event_type,
      source: 'api_stream',
      external_id: eventId,
      data: ctx.data,
      schema_version: ctx.schema_version,
      event_source: ctx.source,
    })

    const corsOrigin = process.env['CORS_ORIGIN'] ?? '*'

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': corsOrigin,
      'X-Trace-Id': traceId,
    })

    const sendEvent = (data: unknown): void => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    try {
      for await (const insight of engine.evaluateStream({ ...ctx, derived_from_signals: [signalId] })) {
        sendEvent({ type: 'insight', insight, trace_id: traceId })
        persistInsights([insight], traceId).catch((err) =>
          app.log.error({ err, trace_id: traceId }, 'Failed to persist streamed insight'),
        )
      }
      sendEvent({ type: 'done', trace_id: traceId })
    } catch (err) {
      sendEvent({ type: 'error', message: String(err), trace_id: traceId })
    } finally {
      reply.raw.end()
    }
  })
}

// ── Event deduplication ───────────────────────────────────────────────────────
// Uses MongoDB with a TTL index (24h) to deduplicate by tenant_id + event_id.
// Returns true if this event was already seen (is a duplicate).
async function checkAndMarkEventSeen(tenantId: string, eventId: string): Promise<boolean> {
  try {
    const db = await getDb()
    const col = db.collection('event_dedup')
    // Ensure TTL index exists (idempotent)
    col.createIndex({ seen_at: 1 }, { expireAfterSeconds: 86_400 }).catch(() => {})
    col.createIndex({ tenant_id: 1, event_id: 1 }, { unique: true }).catch(() => {})

    const result = await col.insertOne({
      tenant_id: tenantId,
      event_id: eventId,
      seen_at: new Date(),
    })
    return !result.acknowledged
  } catch (err: unknown) {
    // Duplicate key error (code 11000) = event already seen
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 11000) {
      return true
    }
    // Any other DB error — allow through (fail open, don't drop events)
    return false
  }
}

async function persistInsights(
  insights: Awaited<ReturnType<Engine['evaluate']>>['insights'],
  traceId?: string,
): Promise<void> {
  const col = await getInsightsCollection()
  const db = await getDb()

  // For each insight, check if its detector is linked to any goal.
  // Two paths to find the goal_id:
  //   1. The goal lists this detector in its detector_ids (explicit wiring)
  //   2. The insight's feature_snapshot carries a goal_id from the event
  //      payload (e.g. social_goal_progress fires for any goal.kpi.updated
  //      event, and the KPI compute engine includes goal_id in the payload —
  //      but the goal doesn't list social_goal_progress in detector_ids)
  const insightsWithGoalId = await Promise.all(
    insights.map(async (insight) => {
      if (!insight.detector_id) return insight

      // Path 2: check feature_snapshot for goal_id from the event payload
      const snapshotGoalId = (insight.feature_snapshot as Record<string, unknown> | undefined)?.['goal_id']
      if (typeof snapshotGoalId === 'string' && snapshotGoalId) {
        return { ...insight, goal_id: snapshotGoalId }
      }

      // Path 1: query goals collection for goals that have this detector_id
      // Scoped to the insight's tenant_id to prevent cross-tenant goal matching
      const goals = await db.collection('goals')
        .find({ tenant_id: insight.tenant_id, detector_ids: insight.detector_id })
        .project({ id: 1 })
        .toArray()

      // If a goal is found, add the first goal_id to the insight
      if (goals.length > 0) {
        return { ...insight, goal_id: goals[0].id }
      }

      return insight
    })
  )

  // B4 (GOAL_PROGRESS_AND_UX_GAPS.md): before building the upsert ops,
  // filter out insights whose equivalent condition was recently dismissed
  // or completed. The previous dedup filter excluded dismissed/completed
  // insights from matching (`state: { $nin: ['dismissed', ...] }`), so
  // once a user dismissed an insight, the next detector evaluation created
  // a brand-new duplicate for the same condition. This caused 21 historical
  // near-duplicates to flood the feed alongside the 8 real open decisions.
  //
  // Cooldown: 7 days for dismissed insights (the user may want to see the
  // condition again if circumstances change). Completed insights are
  // suppressed permanently (the user already acted on it).
  const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
  const now = new Date()
  const dismissCutoff = new Date(now.getTime() - DISMISS_COOLDOWN_MS)

  const filteredInsights: typeof insightsWithGoalId = []
  for (const insight of insightsWithGoalId) {
    const ticker = (insight.feature_snapshot as Record<string, unknown> | undefined)?.['ticker']
    const identityFilter: Record<string, unknown> = {
      tenant_id: insight.tenant_id,
      detector_id: insight.detector_id,
      hypothesis: insight.hypothesis,
      ...(ticker !== undefined ? { 'feature_snapshot.ticker': ticker } : {}),
    }

    // Check for a completed insight — suppress permanently
    const completed = await col.findOne({
      ...identityFilter,
      state: 'completed',
    })
    if (completed) continue // user already acted on this condition

    // Check for a recently dismissed insight — suppress within cooldown
    const recentlyDismissed = await col.findOne({
      ...identityFilter,
      state: 'dismissed',
      dismissed_at: { $gte: dismissCutoff },
    })
    if (recentlyDismissed) continue // user dismissed this recently

    filteredInsights.push(insight)
  }

  // Built alongside `ops` below and reused after the write completes — see
  // the comment on `ensureVerifiedMoments` at the bottom of this function for
  // why the same filter is needed twice.
  const dedupeFilters: Record<string, unknown>[] = []

  const ops = filteredInsights.map((insight) => {
    // Detector.detectAll() mints a fresh crypto.randomUUID() on every call, so
    // upserting on `{ id: insight.id }` can never match a prior document — it
    // was always an unconditional insert. Re-evaluating the same condition
    // (e.g. every connector poll/backfill) therefore created a fresh duplicate
    // insight each time instead of refreshing the existing open one. Dedupe on
    // the natural identity of "this condition, for this holding, still open"
    // instead: same tenant + detector + rule, same ticker if the rule is
    // holding-scoped, and not already resolved.
    //
    // B4: dismissed/completed insights are now caught by the pre-check above,
    // so the dedup filter only needs to match open insights. Old dismissed
    // insights outside the 7-day cooldown are allowed to get a fresh insight.
    //
    // HOME-01/HOME-03: for goal-progress insights (social_goal_progress), the
    // KPI compute engine fires one event per KPI, and the detector evaluates
    // each independently — so a goal with two KPIs (e.g. portfolio_growth_pct
    // and portfolio_value_gbp) gets two insights with opposite verdicts (one
    // "behind pace", one "ahead of pace") or the same recommendation in two
    // units (95%→100% and £4460→£5352). Dedup these at the GOAL level (not per
    // hypothesis) so only the latest evaluation per goal is open at any time.
    // The hypothesis is moved into $set so the existing doc's verdict updates.
    const ticker = (insight.feature_snapshot as Record<string, unknown> | undefined)?.['ticker']
    const goalId = (insight as { goal_id?: string }).goal_id
    const isGoalProgressInsight = insight.detector_id === 'social_goal_progress' && goalId
    const dedupeFilter: Record<string, unknown> = isGoalProgressInsight
      ? {
          tenant_id: insight.tenant_id,
          detector_id: insight.detector_id,
          goal_id: goalId,
          state: { $nin: ['dismissed', 'completed', 'archived'] },
        }
      : {
          tenant_id: insight.tenant_id,
          detector_id: insight.detector_id,
          hypothesis: insight.hypothesis,
          ...(ticker !== undefined ? { 'feature_snapshot.ticker': ticker } : {}),
          state: { $nin: ['dismissed', 'completed', 'archived'] },
        }
    dedupeFilters.push(dedupeFilter)
    const { feature_snapshot, confidence_breakdown, evidence_trail, derived_from_signals, reasoning, estimated_impact_low, estimated_impact_high, ...firstSeenFields } = insight
    // For goal-progress insights, hypothesis changes between evaluations
    // (behind_pace → ahead_of_pace), so it must be in $set, not $setOnInsert.
    const setFields: Record<string, unknown> = { feature_snapshot, confidence_breakdown, evidence_trail, derived_from_signals, reasoning, estimated_impact_low, estimated_impact_high }
    const onInsertFields: Record<string, unknown> = { ...firstSeenFields, ...(traceId && { trace_id: traceId }) }
    if (isGoalProgressInsight) {
      setFields.hypothesis = insight.hypothesis
      delete onInsertFields.hypothesis
    }
    return {
      updateOne: {
        filter: dedupeFilter,
        update: {
          $set: setFields,
          $setOnInsert: onInsertFields,
        },
        upsert: true,
      },
    }
  })
  if (ops.length > 0) await col.bulkWrite(ops, { ordered: false })
  if (filteredInsights.length > 0) {
    // ensureVerifiedMoments dedupes on insight_id — but `filteredInsights` here
    // still carries each insight's fresh per-cycle UUID (see comment above),
    // not the stable id the bulkWrite above just matched-or-inserted on. Using
    // the in-memory objects directly meant a brand-new "verified moment" was
    // created on every detector cycle for as long as a condition stayed open,
    // instead of one moment per condition. Re-read the just-written documents
    // by the same identity filter so moments dedupe on the persisted id.
    const persisted = await Promise.all(
      dedupeFilters.map((filter, i) => col.findOne(filter).then((doc) => doc ?? filteredInsights[i]!)),
    )
    await ensureVerifiedMoments(db, persisted)
  }
}
