import './env.js'

import { randomUUID } from 'node:crypto'

/**
 * Agent Oak API Server — Fastify
 *
 * A full copy of kairos-ai's apps/api, trimmed to what Agent Oak (apps/web)
 * actually calls plus the marketing surfaces (blog, case studies, growth
 * events) that support self-serve growth. See SECURITY.md for the full
 * list of routes/crons/packages removed and why.
 *
 * Packages wired together:
 *   @agentoak/engine    — evaluate detectors (family_* only) on incoming events
 *   @agentoak/pipeline  — connector data ingestion (email/Gmail)
 *   @agentoak/workflows — connector credential/OAuth plumbing, schema registry
 *   @agentoak/platform  — JWT auth, money utilities, telemetry
 *
 * Route map (registered further down — search "Modular route handlers"):
 *   /auth/*, /connectors/*, /family*, /documents*, /billing/*, /inbox*,
 *   /insights, /blog/*, /case-studies, /growth/*, /metrics
 *   GET  /health              — server liveness (unauthenticated)
 */

import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import helmet from '@fastify/helmet'
import compress from '@fastify/compress'
import sensible from '@fastify/sensible'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { ZodTypeProvider, jsonSchemaTransform } from 'fastify-type-provider-zod'
import { Engine, type Insight, setSchemaRegistry } from '@agentoak/engine'
import { ConnectorLoader, EventGenerator } from '@agentoak/pipeline'
import { AuthService, canPerform, extractBearerToken, enforceQuota, getAllCircuitBreakers, QuotaExceededError, validateLicenseKey, SafeHttpClient, createLogger, initTelemetry, type ProductAction, type ProductResource } from '@agentoak/platform'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerInsightRoutes, cleanupStaleInsightsStartup } from './routes/insights.js'
import { recordApiRequest, registerMetricsRoutes, recordLlmCacheHitMiss, buildFeatureHashScorerMetrics } from './routes/metrics.js'
import { initAuditLogger } from './audit/audit-log.js'
import { loadLiveTradingOptIn } from './trading/portfolio-data.js'
import { registerAuthUserRoutes } from './routes/auth-users.js'
import { registerSocialAuthRoutes } from './routes/auth-social.js'
import { createLlmRouterFromEnv, LlmResponseCache, MongoLlmCacheStore, LlmBudgetGuard, LocalEmbeddingProvider } from '@agentoak/platform'
import {
  ScoreCalibrator, IntentClassifier,
  NoveltyTracker, ChangePointDetector, FeatureHashScorer, TenantLevelScorer,
} from '@agentoak/engine'
import { ApiLlmScorer } from './llm-scorer.js'
import { registerConnectorCredentialRoutes } from './routes/connector-credentials.js'
import { DeliveryRouter } from './delivery/delivery-router.js'
import { createMoveJudge } from './delivery/move-judge.js'
import { ConnectorSyncEngine, TokenRefreshScheduler } from '@agentoak/pipeline'
import { WorkflowEngine, WorkflowLoader, type WorkflowDef, type EventPayload, connectorSchemaRegistry } from '@agentoak/workflows'
import cron from 'node-cron'
import { enqueueWorkflowTrigger, startWorker } from './queue/WorkflowQueue.js'
import { queueManager } from './queue/QueueManager.js'
import { startWebhookWorker } from './queue/WebhookQueue.js'
import { ApiReasoningContextBuilder } from './outcomes/reasoning-context-builder.js'
import { RetentionWorker } from './jobs/retention-worker.js'
import { InsightSlaWorker } from './jobs/insight-sla-worker.js'
import { EscalationWorker } from './jobs/escalation-worker.js'
import { createCredentialExpiryInsights } from './jobs/connector-health-alert.js'
import { scanAllConnectedInboxes } from './jobs/email-scan.js'
import { registerApiVersioning, rewriteVersionedUrl } from './api-versioning.js'
import { registerBillingRoutes } from './routes/billing.js'
import { registerBlogRoutes } from './routes/blog.js'
import { persistAndDeliverInsights as persistAndDeliverInsightsCore } from './insights-persist.js'
import { deploymentConfig, logDeploymentMode } from './config/deployment.js'
import { addSandboxContext, sandboxMiddleware, sandboxWriteMiddleware } from './middleware/sandbox.js'
import { registerCaseStudyRoutes } from './routes/case-studies.js'
import { registerDocumentRoutes } from './routes/documents.js'
import { registerFamilyConnectorRoutes } from './routes/family-connectors.js'
import { registerFamilyGroupRoutes } from './routes/family-group.js'
import { registerGrowthEventRoutes } from './routes/growth-events.js'
import { registerFamilyFinancialProfileRoutes } from './routes/family-financial-profile.js'
import { registerFamilyInboxRoutes } from './routes/family-inbox.js'
import { sendOpsAlert } from './lib/ops-alerts.js'

// Inject the connector schema registry so the engine can validate event schema compatibility.
setSchemaRegistry(connectorSchemaRegistry)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')

// ─── Bootstrap ────────────────────────────────────────────────────────────────

await initTelemetry('kairos-api')

const log = createLogger({ service: 'api', version: process.env['npm_package_version'] ?? '0.0.0' })

// These are instantiated before MongoDB connects — they degrade gracefully
// when DB is unavailable (calibrator/thresholds use identity/fallback values)
let scoreCalibrator: ScoreCalibrator | undefined
let intentClassifier: IntentClassifier | undefined
let noveltyTracker: NoveltyTracker | undefined
let changePointDetector: ChangePointDetector | undefined
let featureHashScorer: FeatureHashScorer | undefined
let tenantLevelScorer: TenantLevelScorer | undefined
// Captures persistAndDeliverInsights (defined inside the Mongo-connect try
// block below) so routes registered later, outside that try block, where
// `app` exists, can reuse the same persist+deliver hook.
let insightsDeliveryHook: ((insights: Insight[], tenantId: string) => Promise<void>) | undefined

// Engine is created before DB connects — calibrator is set after DB is ready
// (engine.options is mutable; we assign it before the first evaluate() call)
const engine = new Engine({
  detectorsDir: path.join(ROOT, 'detectors'),
  hotReload: process.env['NODE_ENV'] === 'development',
  strictValidation: process.env['NODE_ENV'] === 'production',
})

const connectorLoader = new ConnectorLoader()
const eventGenerator = new EventGenerator()
const jwtSecret = process.env['JWT_SECRET'] ?? ''
if (process.env['NODE_ENV'] === 'production' && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be set to a strong value in production')
}
const auth = new AuthService(jwtSecret || 'change-me-in-production')
if (process.env['KAIROS_LICENSE_KEY'] && process.env['KAIROS_LICENSE_PUBLIC_KEY']) {
  const license = await validateLicenseKey(process.env['KAIROS_LICENSE_KEY'], process.env['KAIROS_LICENSE_PUBLIC_KEY'])
  if (license.expired && !license.grace_period) process.env['KAIROS_EDITION'] = 'busl'
}
// LLM function available module-wide for the goal compiler and other routes
const globalLlmFn = createLlmRouterFromEnv()

// Workflow engine — MongoDB-backed (shares the singleton client from db.ts)
import { getMongoClient, closeDb } from './db.js'
let workflowDb!: import('mongodb').Db
let workflowEngine!: WorkflowEngine
let workflowLoader!: WorkflowLoader
let deliveryRouter: DeliveryRouter | undefined
// Scheduled cron tasks keyed by workflow ID — replaced when workflows hot-reload
const scheduledCronTasks = new Map<string, ReturnType<typeof cron.schedule>>()

function scheduledConnectors(def: WorkflowDef): string[] {
  return [...new Set(def.nodes
    .filter(node => node.type === 'connector_action')
    .map(node => (node.config as { connector?: unknown }).connector)
    .filter((connector): connector is string => typeof connector === 'string' && connector.length > 0))]
}

async function scheduledTenantIds(def: WorkflowDef): Promise<string[]> {
  const explicitTenantId = (def as unknown as { tenant_id?: string }).tenant_id
  if (explicitTenantId) return [explicitTenantId]

  const connectors = scheduledConnectors(def)
  if (connectors.length === 0) return ['system']

  const tenantIds = await workflowDb.collection('connector_credentials').distinct('tenant_id', {
    connector_id: { $in: connectors },
  })
  if (connectors.length === 1) return (tenantIds as string[]).filter(Boolean)

  const readyTenantIds: string[] = []
  for (const tenantId of tenantIds as string[]) {
    const connectedCount = await workflowDb.collection('connector_credentials').countDocuments({
      tenant_id: tenantId,
      connector_id: { $in: connectors },
    })
    if (connectedCount >= connectors.length) readyTenantIds.push(tenantId)
  }
  return readyTenantIds
}


try {
  const mongoClient = await getMongoClient()
  workflowDb = mongoClient.db(process.env['MONGODB_DB'] ?? 'kairos')
  deliveryRouter = new DeliveryRouter(workflowDb, createMoveJudge(globalLlmFn, workflowDb))
  workflowLoader = new WorkflowLoader(path.join(ROOT, 'definitions/workflows'), workflowDb)

  // One-time cleanup: archive stale pre-fix insight records (A1/A2/A3
  // patterns) that are still live on Home. Runs in the background —
  // doesn't block startup. Safe to run multiple times (idempotent).
  cleanupStaleInsightsStartup(workflowDb).catch(err =>
    log.error({ err }, 'Startup stale-insight cleanup failed'),
  )

  // LLM router: per-tenant config from DB, falls back to env vars
  // The factory is called per-run so tenant key changes take effect immediately
  const envLlmFn = createLlmRouterFromEnv()

  const llmFn = async (system: string, prompt: string, model?: string): Promise<string> => {
    // tenantId injected into AsyncLocalStorage by WorkflowEngine — not yet wired;
    // for now fall back to env-based router. Per-tenant routing is done at
    // the workflow/run level in the /workflows/:id/run handler below.
    return envLlmFn(system, prompt, model)
  }

  const safeHttp = new SafeHttpClient()
  // createPendingTradeFn intentionally omitted (it's optional on
  // WorkflowEngine) — that hook only fires from a workflow node, and no
  // workflow routes exist to create a workflow in the first place. See
  // ARCHITECTURE.md for what was trimmed and why.
  workflowEngine = new WorkflowEngine({
    db: workflowDb,
    llmFn,
    fetchFn: (url, init) => safeHttp.fetch(url, init),
    sseBroadcast: (tenantId, _event) => {
      log.debug({ tenant_id: tenantId }, 'SSE broadcast')
    },
  })
  workflowLoader.loadAll()
  log.info({ count: workflowLoader.getAll().length }, 'Workflow engine ready')

  // ── Cron scheduler: schedule each workflow directly via node-cron ───────
  // Replaces the old every-minute polling approach + custom cron parser.
  // Each workflow with a valid cron schedule gets its own node-cron task.
  // Hot-reload cancels and reschedules the affected workflow.
  function scheduleWorkflowCron(def: WorkflowDef): void {
    if (!def.trigger.schedule || !cron.validate(def.trigger.schedule)) return
    // Cancel existing task if any (hot-reload)
    const existing = scheduledCronTasks.get(def.id)
    if (existing) existing.stop()
    const task = cron.schedule(def.trigger.schedule, async () => {
      const now = new Date()
      try {
        const tenantIds = await scheduledTenantIds(def)
        for (const tenantId of tenantIds) {
          const cronEvent = {
            event_type: 'schedule',
            tenant_id: tenantId,
            data: { scheduled_at: now.toISOString(), cron: def.trigger.schedule, source: 'cron' },
            id: `cron_${def.id}_${tenantId}_${now.getTime()}`,
            created_at: now,
          }
          await enqueueWorkflowTrigger(def, cronEvent, tenantId)
          log.info({ workflow_id: def.id, tenant_id: tenantId }, 'Cron enqueued workflow')
        }
      } catch (err) {
        log.error({ workflow_id: def.id, err }, 'Cron failed to start workflow')
      }
    }, { missedExecutionTolerance: 30_000, noOverlap: true })
    scheduledCronTasks.set(def.id, task)
  }

  // Schedule all initially-loaded workflows
  for (const def of workflowLoader.getAll()) scheduleWorkflowCron(def)
  // Re-schedule on hot-reload
  workflowLoader.watch(id => {
    const reloaded = workflowLoader.getAll().find(d => d.id === id)
    if (reloaded) scheduleWorkflowCron(reloaded)
    log.info({ workflow_id: id }, 'Workflow hot-reloaded')
  })
  log.info({ count: scheduledCronTasks.size }, 'Cron scheduler started')

  // ── Goal autonomy scheduler ─────────────────────────────────────────────
  // Runs the next workflow-backed plan step for active template goals.
  cron.schedule('*/15 * * * *', async () => {
    const now = new Date()
    try {
      const goals = await workflowDb.collection('goals').find({
        status: 'active',
        'execution_plan.enabled': true,
        'execution_plan.status': 'active',
        $or: [
          { 'execution_plan.next_run_at': { $exists: false } },
          { 'execution_plan.next_run_at': { $lte: now } },
        ],
      }).limit(100).toArray()

      for (const goal of goals) {
        const kpis = Array.isArray(goal['kpis']) ? goal['kpis'] as Array<{
          current?: number
          target?: number
          direction?: 'increase' | 'decrease'
        }> : []
        const achieved = kpis.length > 0 && kpis.every(kpi => {
          const current = Number(kpi.current ?? 0)
          const target = Number(kpi.target ?? 0)
          return kpi.direction === 'decrease' ? current <= target : current >= target
        })
        if (achieved) {
          await workflowDb.collection('goals').updateOne(
            { id: goal['id'], tenant_id: goal['tenant_id'] },
            {
              $set: {
                status: 'achieved',
                'execution_plan.enabled': false,
                'execution_plan.status': 'completed',
                'execution_plan.completed_at': now,
                updated_at: now,
              },
            },
          )
          continue
        }

        const plan = goal['execution_plan'] as {
          cadence?: 'daily' | 'weekly'
          cycle_count?: number
          steps?: Array<{ id: string; workflow_id?: string }>
        } | undefined
        const workflowSteps = (plan?.steps ?? []).filter(step => step.workflow_id)
        if (workflowSteps.length === 0) continue

        const cycleCount = plan?.cycle_count ?? 0
        const step = workflowSteps[cycleCount % workflowSteps.length]!
        const def = workflowLoader.get(step.workflow_id!)
        if (!def) {
          await workflowDb.collection('goals').updateOne(
            { id: goal['id'], tenant_id: goal['tenant_id'] },
            { $set: { 'execution_plan.status': 'blocked', 'execution_plan.blocked_reason': `Workflow ${step.workflow_id} not found`, updated_at: now } },
          )
          continue
        }

        const pendingApproval = await workflowDb.collection('workflow_approvals').findOne({
          tenant_id: goal['tenant_id'],
          workflow_id: def.id,
          status: 'pending',
        })
        const cadenceMs = plan?.cadence === 'weekly' ? 7 * 86_400_000 : 86_400_000
        const nextRunAt = new Date(now.getTime() + cadenceMs)

        if (!pendingApproval) {
          const event = {
            event_type: 'goal_plan_cycle',
            tenant_id: goal['tenant_id'],
            data: {
              goal_id: goal['id'],
              goal_name: goal['name'],
              goal_description: goal['description'],
              plan_step_id: step.id,
              cycle_count: cycleCount + 1,
              source: 'goal_autonomy',
            },
            id: `goal_${goal['id']}_${now.getTime()}`,
            created_at: now,
          }
          await enqueueWorkflowTrigger(def, event, goal['tenant_id'])
        }

        await workflowDb.collection('goals').updateOne(
          { id: goal['id'], tenant_id: goal['tenant_id'] },
          {
            $set: {
              'execution_plan.last_run_at': now,
              'execution_plan.next_run_at': nextRunAt,
              'execution_plan.last_step_id': step.id,
              updated_at: now,
            },
            ...(!pendingApproval ? { $inc: { 'execution_plan.cycle_count': 1 } } : {}),
          },
        )
      }
    } catch (err) {
      log.error({ err }, 'Goal autonomy scheduler failed')
    }
  }, { missedExecutionTolerance: 30_000, noOverlap: true })
  log.info({}, 'Goal autonomy scheduler started')

  // ── Connector sync engine — polling + token refresh ───────────────────────
  // Wires connector-driven insights (e.g. Trading 212 concentration-risk,
  // rebalance-suggestion) into the same DeliveryRouter used for goal-progress
  // insights — a live sync now reaches the tenant (WhatsApp/SMS/email, with a
  // signed approve/dismiss link) without them needing to poll the app. This
  // is deliberately the same "draft + notify + human approves" shape as the
  // existing marketing_kairos_x_daily_capability workflow, reusing infra
  // instead of adding a second bespoke mechanism.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const syncEngine = new ConnectorSyncEngine(workflowDb as any, eventGenerator, engine,
    async (insights, tenantId) => {
      // Computed once per callback (one tenant per call) rather than per
      // insight — feeds the auto_approve_condition bypass in human_approval
      // nodes (packages/workflows/src/nodes/NodeExecutor.ts) for the two
      // autonomous-trading-eligible detectors. See the "Autonomous trade
      // execution" plan for why only concentration-risk/price-drop qualify.
      const liveTradingOptIn = await loadLiveTradingOptIn(tenantId).catch(() => null)
      const autoTradingEnabled = liveTradingOptIn?.autoTradingEnabled ?? false

      await Promise.allSettled([
        ...(deliveryRouter
          ? insights.map(insight => deliveryRouter!.deliver(insight as unknown as Record<string, unknown>, tenantId))
          : []),
        ...insights.flatMap(insight => {
          const matchingWorkflows = workflowLoader.getByDetector(insight.detector_id)
          return matchingWorkflows.map(def => {
            // The template engine (packages/workflows/src/engine/TemplateEngine.ts)
            // only does dot-path lookups, not arithmetic — so "_minor" (pence/cents)
            // fields need a precomputed display counterpart, same convention as the
            // other workflow YAMLs' `_display` fields (e.g. amount_display).
            const featureSnapshot = insight.feature_snapshot ?? {}
            const minorFieldDisplays = Object.fromEntries(
              Object.entries(featureSnapshot)
                .filter((entry): entry is [string, number] => entry[0].endsWith('_minor') && typeof entry[1] === 'number')
                .map(([key, value]) => [`${key.slice(0, -'_minor'.length)}_display`, (value / 100).toFixed(2)]),
            )
            const event: EventPayload = {
              id: randomUUID(),
              tenant_id: tenantId,
              event_type: 'detector_signal',
              detector_id: insight.detector_id,
              insight_id: insight.id,
              data: { ...featureSnapshot, ...minorFieldDisplays, auto_trading_enabled: autoTradingEnabled },
              created_at: new Date(),
            }
            return enqueueWorkflowTrigger(def, event, tenantId).catch(err =>
              log.error({ workflow_id: def.id, insight_id: insight.id, err }, 'Failed to enqueue workflow trigger from insight'),
            )
          })
        }),
      ])
    },
  )

  // Token refresh every 10 minutes — refreshes tokens expiring within 30 min
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokenRefresher = new TokenRefreshScheduler(workflowDb as any)
  tokenRefresher.start(10 * 60 * 1000)
  log.info({}, 'Token refresh scheduler started')

  // Connector poll every 15 minutes — incremental sync of all connected tenants
  cron.schedule('*/15 * * * *', async () => {
    try {
      await syncEngine.pollAll(connectorLoader.list())
    } catch (err) {
      log.error({ err }, 'Connector poll failed')
    }
  }, { missedExecutionTolerance: 30_000, noOverlap: true })
  log.info({}, 'Connector sync cron started')

  // Connector credential-health alert — runs shortly after each poll so tenants
  // are notified immediately when an API key expires or is revoked in the
  // background. Creates a deduplicated high-urgency insight per tenant+connector.
  cron.schedule('*/15 * * * *', async () => {
    try {
      await createCredentialExpiryInsights({ db: workflowDb, lookbackMs: 20 * 60 * 1000 })
    } catch (err) {
      log.error({ err }, 'Connector health alert failed')
    }
  }, { missedExecutionTolerance: 30_000 })
  log.info({}, 'Connector health alert cron started')

  // Email connector scan every 15 minutes — classifies new mail on every
  // connected mailbox (any IMAP provider) into Inbox items, and routes
  // document-like attachments through the same OCR pipeline manual uploads
  // use. Also triggered on-demand right after connecting (see
  // family-connectors.ts) and via POST /connectors/email/scan.
  cron.schedule('*/15 * * * *', async () => {
    try {
      await scanAllConnectedInboxes(workflowDb)
    } catch (err) {
      log.error({ err }, 'Email scan cron failed')
    }
  }, { missedExecutionTolerance: 30_000, noOverlap: true })
  log.info({}, 'Email scan cron started')

  // Trading (auto-trade confirmation, reconciliation, momentum rebalance)
  // and workflow-approval-timeout sweeps removed — Agent Oak has no trading
  // vertical and no workflow engine to create approval gates in the first
  // place. See SECURITY.md for the full list of what was trimmed.

  // ── Daily digest delivery — batch low/medium insights into a summary ──────
  // Runs at 08:00 daily; sends each tenant their queued insights as one email.
  if (deliveryRouter) {
    const dr = deliveryRouter
    cron.schedule('0 8 * * *', async () => {
      try {
        const tenants = await workflowDb.collection('digest_queue').distinct('tenant_id', { sent: false })
        for (const tenantId of tenants) {
          await dr.sendDigest(tenantId as string)
        }
      } catch (err) {
        log.error({ err }, 'Daily digest failed')
      }
    }, { missedExecutionTolerance: 60_000 })
    log.info({}, 'Daily digest cron started')
  }

  // ── Calibration drift alerting — 2 AM nightly ────────────────────────────
  // Compares per-detector ECE against previous run; alerts when ECE > 0.10 or
  // increases by > 0.05 since last check.
  cron.schedule('0 2 * * *', async () => {
    if (!scoreCalibrator) return
    try {
      const histCol   = workflowDb.collection('calibration_ece_history')
      const alertCol  = workflowDb.collection('calibration_alerts')
      const now       = new Date()

      const tenantIds = await workflowDb.collection('calibration_params').distinct('tenant_id')
      for (const tenantIdValue of tenantIds) {
        const tenantId = String(tenantIdValue)
        const allParams = await scoreCalibrator.getAllParams(tenantId)
        for (const p of allParams) {
        const prev = await histCol.findOne({ tenant_id: tenantId, detector_id: p.detector_id }) as { ece: number } | null
        const previousEce = prev?.ece ?? 0
        const eceDelta    = p.ece - previousEce

        if (p.ece > 0.10 || eceDelta > 0.05) {
          log.warn({ detector_id: p.detector_id, ece: p.ece }, 'ECE drift alert')
          await alertCol.insertOne({
            tenant_id:         tenantId,
            detector_id:       p.detector_id,
            ece:               p.ece,
            previous_ece:      previousEce,
            brier_score:       p.brier_score,
            active_calibrator: p.active_calibrator,
            alerted_at:        now,
          })
        }

        // Upsert current ECE into history for next comparison
        await histCol.updateOne(
          { tenant_id: tenantId, detector_id: p.detector_id },
          { $set: { tenant_id: tenantId, ece: p.ece, checked_at: now } },
          { upsert: true },
        )
        }
      }
    } catch (err) {
      log.error({ err }, 'Calibration drift check failed')
    }
  }, { missedExecutionTolerance: 60_000 })
  log.info({}, 'Calibration drift cron started')

  // ── Calibration fitting — 3 AM nightly (D1b) ──────────────────────────────
  // Builds calibration pairs from recent approve/dismiss receipts (which now
  // carry metadata.insight_score) and calls ScoreCalibrator.fit() to update
  // per-detector temperature parameters. This is the feedback loop that was
  // missing — the calibrator was real code but had no training data source.
  //
  // Adaptive window: starts at 30 days. If a detector has <30 pairs in that
  // window (low-volume or seasonal), expands up to 180 days to gather more
  // data. This prevents seasonal detectors (e.g. quarterly billing cycles)
  // from losing all training data.
  //
  // Outcome mapping (bug fix):
  //   approved, auto_approved → 1 (positive signal — user or policy endorsed)
  //   dismissed, auto_dismissed → 0 (negative signal — user or policy rejected)
  //   policy_blocked, budget_blocked → excluded (not user decisions, no signal)
  cron.schedule('0 3 * * *', async () => {
    if (!scoreCalibrator) return
    try {
      const receiptsCol = workflowDb.collection('action_receipts')
      const now = Date.now()
      const SHORT_WINDOW_DAYS = 30
      const LONG_WINDOW_DAYS = 180
      const MIN_PAIRS_FOR_EXPANSION = 30

      // Start with the short window. Don't require metadata.insight_score to
      // exist — older receipts (before the fix that always populates it) would
      // be silently skipped, preventing calibration from ever running for
      // tenants with historical decisions but no LLM scoring enabled.
      const cutoff = new Date(now - SHORT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      const tenantIds = await receiptsCol.distinct('tenant_id', {
        executed_at: { $gte: cutoff },
      })
      for (const tenantIdValue of tenantIds) {
        const tenantId = String(tenantIdValue)
        const receipts = await receiptsCol.find({
          tenant_id: tenantId,
          executed_at: { $gte: cutoff },
        }).toArray() as unknown as Array<{
          detector_id?: string
          outcome: string
          executed_at?: Date
          metadata?: { insight_score?: number }
          insight_id?: string
        }>
        // Group pairs by detector_id, then fit each detector separately.
        // For receipts without metadata.insight_score (legacy), look up the
        // score from the insight document as a fallback.
        const byDetector = new Map<string, Array<{ raw_score: number; outcome: 0 | 1 }>>()
        for (const r of receipts) {
          if (!r.detector_id) continue
          // Skip non-decision outcomes — they carry no user signal
          if (r.outcome === 'policy_blocked' || r.outcome === 'budget_blocked') continue
          let rawScore: number | undefined = r.metadata?.insight_score
          // Fallback: look up the score from the insight document for legacy
          // receipts that don't have metadata.insight_score populated.
          if (typeof rawScore !== 'number' && r.insight_id && workflowDb) {
            const insight = await workflowDb.collection('insights').findOne(
              { id: r.insight_id, tenant_id: tenantId },
              { projection: { 'confidence_breakdown.combined_score': 1, confidence: 1 } },
            ) as Record<string, unknown> | null
            const breakdown = insight?.['confidence_breakdown'] as Record<string, number> | undefined
            rawScore = breakdown?.['combined_score'] ?? (insight?.['confidence'] as number | undefined)
          }
          if (typeof rawScore !== 'number') continue
          const pair = {
            raw_score: rawScore,
            outcome: ((r.outcome === 'approved' || r.outcome === 'auto_approved') ? 1 : 0) as 0 | 1,
          }
          const existing = byDetector.get(r.detector_id) ?? []
          existing.push(pair)
          byDetector.set(r.detector_id, existing)
        }
        for (const [detectorId, pairs] of byDetector) {
          if (pairs.length < 5) continue // need at least 5 pairs to attempt fitting

          // Adaptive window: if low volume in 30 days, expand to 180 days
          let finalPairs = pairs
          if (pairs.length < MIN_PAIRS_FOR_EXPANSION) {
            const longCutoff = new Date(now - LONG_WINDOW_DAYS * 24 * 60 * 60 * 1000)
            const longReceipts = await receiptsCol.find({
              tenant_id: tenantId,
              detector_id: detectorId,
              executed_at: { $gte: longCutoff, $lt: cutoff },
            }).toArray() as unknown as Array<{
              outcome: string
              metadata?: { insight_score?: number }
              insight_id?: string
            }>
            const extraPairs: Array<{ raw_score: number; outcome: 0 | 1 }> = []
            for (const r of longReceipts) {
              if (r.outcome === 'policy_blocked' || r.outcome === 'budget_blocked') continue
              let longScore: number | undefined = r.metadata?.insight_score
              if (typeof longScore !== 'number' && r.insight_id && workflowDb) {
                const insight = await workflowDb.collection('insights').findOne(
                  { id: r.insight_id, tenant_id: tenantId },
                  { projection: { 'confidence_breakdown.combined_score': 1, confidence: 1 } },
                ) as Record<string, unknown> | null
                const breakdown = insight?.['confidence_breakdown'] as Record<string, number> | undefined
                longScore = breakdown?.['combined_score'] ?? (insight?.['confidence'] as number | undefined)
              }
              if (typeof longScore !== 'number') continue
              extraPairs.push({
                raw_score: longScore,
                outcome: ((r.outcome === 'approved' || r.outcome === 'auto_approved') ? 1 : 0) as 0 | 1,
              })
            }
            if (extraPairs.length > 0) {
              finalPairs = [...extraPairs, ...pairs]
              log.info({ tenant_id: tenantId, detector_id: detectorId, short_pairs: pairs.length, long_pairs: extraPairs.length }, 'Calibration window expanded for low-volume detector')
            }
          }

          await scoreCalibrator.fit(tenantId, detectorId, finalPairs)
          log.info({ tenant_id: tenantId, detector_id: detectorId, pairs: finalPairs.length }, 'Calibration fitting completed')
        }
      }
    } catch (err) {
      log.error({ err }, 'Calibration fitting cron failed')
    }
  }, { missedExecutionTolerance: 60_000 })
  log.info({}, 'Calibration fitting cron started (nightly 3 AM)')

  // Federated learning round removed — cross-tenant model aggregation isn't
  // relevant to a single-vertical family app, and requires a min-20-tenant
  // cohort to run at all.

  // ── Billing cron — daily at 4 AM ──────────────────────────────────────────
  // Handles outcome charge settlement (H3), trial expiration (H5),
  // payment failure recovery (H6), and billing cycle resets (H4).
  // All jobs are idempotent — safe to run multiple times.
  cron.schedule('0 4 * * *', async () => {
    try {
      const { runBillingCron } = await import('./jobs/billing-cron.js')
      await runBillingCron(workflowDb)
    } catch (err) {
      log.error({ err }, 'Billing cron failed')
    }
  }, { missedExecutionTolerance: 60_000 })
  log.info({}, 'Billing cron started (daily 4 AM)')

  // Goal integrity job removed — goals are dead code in Agent Oak's frontend
  // (useFamilyGoals() is defined but never rendered).

  // Social analytics polling, Universal/Intraday KPI compute, goal
  // summarisation, goal migration, and adaptive thresholds (Bollinger Band
  // recompute for invoice/payment/portfolio signal types) all removed —
  // social/goals/trading-vertical specific, none of it reachable from
  // Agent Oak. `persistAndDeliverInsights` stays: registerFamilyFinancialProfileRoutes
  // (kept) needs it as `insightsDeliveryHook`.
  const persistAndDeliverInsights = async (insights: Insight[], tenantId: string): Promise<void> =>
    persistAndDeliverInsightsCore(workflowDb, insights, tenantId, deliveryRouter)
  insightsDeliveryHook = persistAndDeliverInsights

  const retentionWorker = new RetentionWorker(workflowDb)
  const insightSlaWorker = new InsightSlaWorker(workflowDb)
  const escalationWorker = new EscalationWorker(workflowDb)
  await retentionWorker.ensureIndexes()
  cron.schedule('0 2 * * *', async () => {
    try {
      await retentionWorker.run()
    } catch (err) {
      log.error({ err }, 'Retention worker failed')
    }
  }, { missedExecutionTolerance: 60_000 })
  cron.schedule('*/15 * * * *', async () => {
    await Promise.allSettled([insightSlaWorker.run(), escalationWorker.run()])
  }, { missedExecutionTolerance: 60_000 })

  // Shadow backtest cron removed — trading-vertical only (DTFE engine paper
  // trading against market price history).

  // FeatureHashScorer offline eval — computes precision/recall/AUC/
  //    calibration for the online-learning layer against held-out
  //    approve/dismiss history. Runs at 7 AM every Monday.
  //    Persists per-detector reports to `feature_hash_eval_reports`.
  cron.schedule('0 7 * * 1', async () => {
    try {
      const { runFeatureHashEval } = await import('./jobs/feature-hash-eval.js')
      const reports = await runFeatureHashEval(workflowDb)
      if (reports.length > 0) {
        log.info({ detectors: reports.length }, 'FeatureHashScorer eval complete')
      }
    } catch (err) {
      log.error({ err }, 'FeatureHashScorer eval failed')
    }
  }, { missedExecutionTolerance: 60_000 })
  log.info({}, 'FeatureHashScorer eval cron started (weekly Mon 7 AM)')

  // ── Queue setup ───────────────────────────────────────────────────────────
  await queueManager.connect()
  startWorker(workflowEngine, workflowLoader, workflowDb)
  startWebhookWorker(engine, connectorLoader, eventGenerator, workflowDb)
  log.info({}, 'Workflow queue worker started')

  // ── Score calibration ─────────────────────────────────────────────────────
  // Loads per-detector temperature params into memory; calibrateSync() is then
  // zero-latency on the hot evaluation path.
  scoreCalibrator = new ScoreCalibrator(workflowDb)
  await scoreCalibrator.warmCache()
  // Wire calibrator into engine now that it's ready
  engine.options.calibrator = scoreCalibrator
  engine.options.reasoningContextBuilder = new ApiReasoningContextBuilder(workflowDb)
  log.info({}, 'Score calibrator ready')

  // ── LLM scorer (D1b) ───────────────────────────────────────────────────────
  // Wires the LLM scorer into the engine, opening the gate that was previously
  // dead code. The scorer itself checks per-tenant opt-in (tenant_settings:
  // llm_scoring_config.enabled=true) before calling the LLM, so the cost is
  // opt-in. Tenants without the setting get rule-only scores (unchanged).
  //
  // P0 cost optimisations wired here:
  //   - LlmResponseCache: caches scores by evidence hash (MongoDB-backed)
  //   - LlmBudgetGuard: enforces per-tenant monthly LLM budget
  //   - callStructured: Zod-validated output with free retries
  //   - Disagreement detector: skips LLM score when it agrees with the rule
  const llmCache = new LlmResponseCache(
    new MongoLlmCacheStore(workflowDb),
    3_600_000, // default 1h TTL
    (tenantId, task, hit) => recordLlmCacheHitMiss(tenantId, task, hit),
  )
  const budgetGuard = new LlmBudgetGuard(workflowDb)
  const llmScorer = new ApiLlmScorer(workflowDb, globalLlmFn, {
    cache: llmCache,
    budgetGuard,
    disagreementThreshold: 0.15,
    concurrency: 5,
  })
  engine.options.llmScorer = llmScorer
  log.info({}, 'LLM scorer ready (per-tenant opt-in via tenant_settings:llm_scoring_config, with cache + budget guard)')

  // Adaptive threshold store removed — never wired into engine.options, and
  // its only consumer (the invoice/payment/portfolio signal recompute cron)
  // was trading/accounting-vertical only. No family detector references
  // context.adaptive_thresholds.

  // ── Intent classifier ─────────────────────────────────────────────────────
  // Three-tier (trie → embedding → LLM) classifier loaded at startup.
  // Pre-loads centroids from DB; trie built in memory.
  //
  // P0 cost optimisation: use LocalEmbeddingProvider (ONNX, bge-small-en-v1.5)
  // as the default embedding function for Tier 2. This is free, fast (~5-10ms
  // on CPU), and the accuracy delta for short event text is negligible vs
  // text-embedding-3-small. The LRU embedding cache (default 10K entries, 24h
  // TTL) further reduces cost on repeated event texts. Reserve OpenAI
  // embeddings for long-form RAG (copilot, goal compiler).
  //
  // The llmFn is wired for Tier 3 fallback (ambiguous events only, ~5%).
  let intentEmbedFn: ((text: string) => Promise<number[]>) | undefined
  try {
    const localProvider = new LocalEmbeddingProvider()
    intentEmbedFn = async (text: string) => {
      const [emb] = await localProvider.embed([text])
      return emb ?? []
    }
    log.info({}, 'Intent classifier using local ONNX embeddings (bge-small-en-v1.5)')
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'Local embeddings unavailable — Tier 2 disabled, falling back to trie + LLM only')
  }
  intentClassifier = new IntentClassifier({
    db: workflowDb,
    llmFn: globalLlmFn,
    embedFn: intentEmbedFn,
    embeddingCache: true, // LRU cache (default 10K entries, 24h TTL)
  })
  await intentClassifier.load('system')
  log.info({}, 'Intent classifier ready')

  // ── Lightweight ML layer ──────────────────────────────────────────────────
  noveltyTracker = new NoveltyTracker(workflowDb)
  changePointDetector = new ChangePointDetector(workflowDb)
  // FeatureHashScorer: LRU eviction caps memory at ~200MB (200 models × 1MB).
  // Models are loaded lazily on first score/update — no eager load-all at
  // startup. Evictions and cache hit/miss are exported to Prometheus.
  featureHashScorer = new FeatureHashScorer(
    workflowDb,
    { maxLoadedModels: 200 },
    buildFeatureHashScorerMetrics(),
  )

  // ── Cross-signal tenant-level scorer ──────────────────────────────────────
  // One model per tenant — learns patterns across ALL detectors and signal
  // types for the same entity (e.g. "customer with overdue invoice + cart
  // abandonment = high approval likelihood"). Injects context.tenant_level_score.
  tenantLevelScorer = new TenantLevelScorer(
    workflowDb,
    { maxLoadedTenants: 200 },
  )

  // Federated learning service removed — cross-tenant gradient aggregation
  // isn't relevant to a single-vertical family app.

  // Wire into engine — options are mutable, set before first evaluate()
  engine.options.noveltyTracker = noveltyTracker
  engine.options.changePointDetector = changePointDetector
  engine.options.featureHashScorer = featureHashScorer
  engine.options.tenantLevelScorer = tenantLevelScorer
  // Provide recent insights for cross-signal feature building at inference time
  engine.options.recentInsightsProvider = async (tenantId: string, entityKey: string) => {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const docs = await workflowDb.collection('insights').find({
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
  // Default: track amount_minor + customer_id novelty for all invoice/payment events
  engine.options.noveltyFields = {
    'invoice.overdue':   ['data.amount_minor', 'data.customer_id'],
    'payment.failed':    ['data.amount_minor', 'data.customer_id'],
    'payment.received':  ['data.amount_minor'],
    'cart.abandoned':    ['data.cart_value_minor', 'data.customer_id'],
    '*':                 ['data.amount_minor'],
  }
  engine.options.changePointFields = {
    'revenue.daily':  ['data.revenue_minor', 'data.order_count'],
    'invoice.overdue': ['data.amount_minor', 'data.days_overdue'],
    '*':              ['data.amount_minor'],
  }
  log.info({}, 'Lightweight ML layer ready')

  // Background warm-up — don't await, so server starts immediately
  setImmediate(async () => {
    try {
      const tenantIds = await workflowDb.collection('connector_credentials').distinct('tenant_id')
      // Load novelty sketches for all tenants
      if (noveltyTracker) {
        for (const tid of tenantIds as string[]) {
          await noveltyTracker.load(tid).catch(() => {})
        }
      }
      // Load CUSUM states for all tenants × tracked fields
      if (changePointDetector) {
        const allFields = [...new Set(Object.values(engine.options.changePointFields ?? {}).flat())]
        for (const tid of tenantIds as string[]) {
          await changePointDetector.load(tid, allFields).catch(() => {})
        }
      }
      log.info({ tenants: tenantIds.length }, 'ML caches warmed')
    } catch (err) {
      log.warn({ err }, 'ML cache warm-up failed')
    }
  })

  // ── Audit logger ───────────────────────────────────────────────────────────
  initAuditLogger(workflowDb, deploymentConfig.auditLogEnabled)
  log.info({ enabled: deploymentConfig.auditLogEnabled }, 'Audit logger configured')
} catch (err) {
  log.warn({ err }, 'MongoDB unavailable — workflows/ML features disabled')
}

await engine.load()
await connectorLoader.load(path.join(ROOT, 'connectors'))

// Fail-fast guard: if the engine loaded zero detectors in production, the
// most likely cause is a missing detectors/ directory in the container image
// (e.g. Dockerfile forgot to COPY it). The engine silently swallows ENOENT
// from readdir and boots with zero detectors — which means no insights can
// ever fire for any tenant. Better to crash at startup than run a broken
// service that looks healthy.
if (process.env['NODE_ENV'] === 'production' && engine.detectorCount === 0) {
  log.error({ detectorsDir: path.join(ROOT, 'detectors') }, 'FATAL: engine loaded zero detectors — detectors/ directory is missing or empty. Refusing to start.')
  process.exit(1)
}
if (process.env['NODE_ENV'] === 'production' && connectorLoader.count === 0) {
  log.error({ connectorsDir: path.join(ROOT, 'connectors') }, 'FATAL: connector loader loaded zero connectors — connectors/ directory is missing or empty. Refusing to start.')
  process.exit(1)
}

const app = Fastify({
  logger: true,
  rewriteUrl: rewriteVersionedUrl,
  // Signed delivery action tokens (/a/:token) exceed the 100-char default.
  routerOptions: { maxParamLength: 512 },
}).withTypeProvider<ZodTypeProvider>()
const requestStartedAt = new WeakMap<object, number>()
app.addHook('onRequest', async (request, reply) => {
  requestStartedAt.set(request, performance.now())
  reply.header('X-Request-Id', request.id)
})
app.addHook('onResponse', async (request, reply) => {
  const startedAt = requestStartedAt.get(request) ?? performance.now()
  recordApiRequest(
    request.method,
    request.routeOptions.url ?? request.url,
    reply.statusCode,
    (performance.now() - startedAt) / 1000,
  )
})
// In production set CORS_ORIGIN to the Studio's exact origin (e.g. https://studio.kairos.dev).
// Wildcard is only used in dev/test; cloud mode enforces the env var.
const corsOrigin = deploymentConfig.mode === 'cloud'
  ? (process.env['CORS_ORIGIN'] ?? false)
  : true
await app.register(cors, {
  origin: corsOrigin,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
})

// Security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.)
// In dev mode, relax CSP to allow inline styles/scripts for hot-reload.
await app.register(helmet, {
  contentSecurityPolicy: deploymentConfig.mode === 'dev' ? false : undefined,
  hsts: deploymentConfig.mode === 'dev' ? false : undefined,
})

// Response compression (gzip, deflate, brotli — auto-negotiated)
await app.register(compress)

// Standard error helpers — adds httpErrors (badRequest, notFound, etc.)
// and a global error handler for consistent { error, code, statusCode } responses
await app.register(sensible)
app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
  // @fastify/sensible errors have .statusCode — use them directly
  if (error.statusCode) {
    reply.status(error.statusCode).send({
      error: error.message,
      statusCode: error.statusCode,
    })
    return
  }
  // Log unexpected errors and return a generic 500
  request.log.error({ err: error }, 'Unhandled error')
  // Alert on 5xx errors (rate-limited per error fingerprint)
  void sendOpsAlert({
    title: 'API 5xx Error',
    message: `${error.message}\nRoute: ${request.method} ${request.url}`,
    severity: 'critical',
    fingerprint: `5xx:${request.method}:${request.url}`,
    tenant_id: request.authContext?.tenant_id,
  })
  reply.status(500).send({
    error: 'Internal server error',
    statusCode: 500,
  })
})

// OpenAPI/Swagger — auto-generates API docs from Zod schemas.
// Serves at /documentation (Swagger UI) and /documentation/json (raw spec).
// Routes with Zod schemas in their `schema` field are automatically included.
await app.register(swagger, {
  openapi: {
    info: {
      title: 'Kairos API',
      description: 'AI decision platform for SMBs — detectors, connectors, and outcome packs.',
      version: '0.1.0',
    },
  },
  transform: jsonSchemaTransform,
})
await app.register(swaggerUi, {
  routePrefix: '/documentation',
  uiConfig: { docExpansion: 'list', deepLinking: false },
})

// Rate limiting — keyed by tenant_id when authenticated, IP otherwise.
// Limits are generous in dev (1000/min) and calibrated for production cloud mode.
await app.register(rateLimit, {
  global: true,
  max: deploymentConfig.maxWorkflowRunsPerMinute,
  timeWindow: '1 minute',
  keyGenerator: (req) => {
    // Use tenant_id from JWT when available — prevents IP-sharing bypass
    const auth = (req as unknown as { authContext?: { tenant_id: string } }).authContext
    return auth?.tenant_id ?? req.ip
  },
  errorResponseBuilder: (_req, context) => ({
    error: 'Too many requests',
    message: `Rate limit exceeded — max ${context.max} requests/minute per tenant`,
    retry_after_ms: context.ttl,
  }),
  // Health and auth endpoints are exempt
  allowList: (req) => req.url === '/health' || req.url === '/engine/health' || req.url.startsWith('/documentation'),
})

// Multipart support for file uploads (50 MB limit)
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } })
registerApiVersioning(app)

// Preserve exact JSON bytes for webhook HMAC verification before Fastify parses
// the body. Non-JSON payloads keep the default parsers.
// Empty body guard: many POST routes (e.g. POST /delivery/test) send no body
// but still set Content-Type: application/json. JSON.parse('') throws, which
// would 500 before the route handler ever runs. Treat empty/whitespace-only
// bodies as {} so these trigger-only POSTs work correctly.
app.removeContentTypeParser('application/json')
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
  ;(request as unknown as { rawBody?: Buffer }).rawBody = body as Buffer
  try {
    const text = (body as Buffer).toString('utf8')
    done(null, text.trim() === '' ? {} : JSON.parse(text))
  } catch (err) {
    done(err as Error)
  }
})

// ─── Auth middleware ──────────────────────────────────────────────────────────

app.addHook('onRequest', async (request, reply) => {
  const open = ['/health', '/engine/health', '/metrics', '/auth/token', '/auth/demo-token', '/auth/signup', '/auth/login', '/auth/sso/', '/auth/google/', '/auth/github/', '/auth/request-password-reset', '/auth/reset-password', '/auth/verify-email', '/auth/resend-verification', '/entitlements/plans', '/blog/posts', '/a/', '/why/', '/verify/', '/webhooks/', '/inbound/', '/insights/cleanup-stale-all', '/billing/webhook', '/documentation', '/documentation/json', '/documentation/uiOptions', '/documentation/static', '/growth/events']
  if (/^\/connectors\/[^/]+\/oauth\/callback/.test(request.url)) return
  if (/^\/auth\/(google|github)\/callback/.test(request.url)) return
  if (/^\/auth\/(google|github)\/exchange/.test(request.url)) return
  if (open.some((p) => request.url.startsWith(p))) return

  const token = extractBearerToken(request.headers.authorization)
  if (!token) return reply.status(401).send({ error: 'Missing Bearer token' })

  try {
    const ctx = await auth.verify(token)
    if (workflowDb) {
      const user = await workflowDb.collection('users').findOne({
        tenant_id: ctx.tenant_id,
        id: ctx.user_id,
        status: 'suspended',
      })
      if (user) return reply.status(401).send({ error: 'User suspended' })
    }
    request.authContext = ctx

    // Demo tenant guard: block access to sensitive operations for demo users.
    // The demo token carries `demo: true` — even though it has admin roles,
    // this guard prevents the demo user from accessing connector credentials,
    // live trading settings, or creating/confirming trades. This ensures the
    // demo tenant is isolated from real broker data regardless of what's in
    // the production database.
    if (ctx.demo) {
      // Block POST to /portfolio/trades (create/confirm/cancel trades)
      const isTradeWrite = request.method === 'POST' && request.url.startsWith('/portfolio/trades')
      // Block all access to connector credentials (real broker keys)
      const isConnectorCreds = request.url.startsWith('/connector-credentials')
      // Block live trading opt-in toggle and status
      const isLiveTradingSettings = request.url.startsWith('/portfolio/live-trading')
      if (isTradeWrite || isConnectorCreds || isLiveTradingSettings) {
        return reply.status(403).send({ error: 'Demo mode: this operation is not available' })
      }
    }

    // Add sandbox context after auth is verified
    if (workflowDb) {
      await addSandboxContext(request, reply, workflowDb)
      // If sandbox mode is active, intercept GET requests and return simulated data
      const sandboxResult = await sandboxMiddleware(request, reply, workflowDb)
      if (sandboxResult !== undefined) return sandboxResult
    }
    
    const resource = authorizationResource(request.url)
    const action = authorizationAction(request.method, request.url)
    if (resource && !canPerform(ctx.roles, resource, action)) return reply.status(403).send({ error: `Forbidden: cannot ${action} ${resource}` })
    if (deploymentConfig.mode !== 'dev') {
      const tenant = await workflowDb.collection('tenants').findOne({ $or: [{ tenant_id: ctx.tenant_id }, { id: ctx.tenant_id }], status: { $in: ['active', 'trial'] } })
      if (!tenant) return reply.status(403).send({ error: 'Tenant is not provisioned or active' })
      const quotaResource = request.method === 'POST' && request.url.startsWith('/events') ? 'events'
        : request.method === 'POST' && /^\/workflows\/[^/]+\/run/.test(request.url) ? 'workflows'
        : null
      if (quotaResource) {
        try { await enforceQuota(workflowDb, ctx.tenant_id, quotaResource) }
        catch (error) {
          if (error instanceof QuotaExceededError) return reply.header('Retry-After', '86400').status(429).send({ error: error.message, resource: error.resource, used: error.used, limit: error.limit, upgrade_required: true })
          throw error
        }
      }
    }
  } catch {
    return reply.status(401).send({ error: 'Invalid token' })
  }
})

// Sandbox writes that need the parsed body (currently just PUT /auth/profile)
// can't be handled in the onRequest hook above — the body isn't parsed yet
// at that point in Fastify's lifecycle, so req.body reads as undefined
// regardless of what the client sent. preHandler runs after body parsing.
app.addHook('preHandler', async (request, reply) => {
  if (!workflowDb || !request.authContext) return
  const result = await sandboxWriteMiddleware(request, reply, workflowDb)
  if (result !== undefined) return result
})

function authorizationResource(url: string): ProductResource | null {
  const segment = url.split('?')[0]?.split('/')[1]
  const map: Record<string, ProductResource> = { insights: 'insights', goals: 'goals', outcomes: 'goals', workflows: 'workflows', detectors: 'detectors', connectors: 'connectors', analytics: 'analytics', team: 'users', settings: 'settings', export: 'audit' }
  return segment ? map[segment] ?? null : null
}

function authorizationAction(method: string, url: string): ProductAction {
  if (url.includes('/approve') || url.includes('/dismiss')) return 'approve'
  if (url.includes('/assign')) return 'assign'
  if (url.startsWith('/export')) return 'export'
  if (method === 'GET') return 'read'
  if (method === 'POST') return 'create'
  if (method === 'DELETE') return 'delete'
  return 'update'
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** POST /auth/token — issue a JWT (dev/demo only; secured in prod by env flag) */
app.post<{ Body: { tenant_id: string; user_id?: string } }>('/auth/token', async (request, reply) => {
  if (process.env['NODE_ENV'] === 'production' && !process.env['ALLOW_DEMO_TOKENS']) {
    return reply.status(403).send({ error: 'Demo tokens disabled in production' })
  }
  const { tenant_id, user_id = 'studio_user' } = request.body
  if (!tenant_id) return reply.status(400).send({ error: 'tenant_id required' })
  const token = await auth.sign({ sub: user_id, tenant_id, roles: ['admin'] })
  return reply.send({ token, tenant_id, expires_in: '7d' })
})

/** GET /auth/demo-token — quick demo token for acme-corp (Studio settings page)
 *  SECURITY: disabled in production unless ALLOW_DEMO_TOKENS=1 is explicitly set.
 *  The demo token carries a `demo: true` claim that triggers a guard in the
 *  auth middleware (below) blocking access to connector credentials, live
 *  trading settings, and trade creation — so even if acme-corp has real
 *  broker connections in the database, a demo visitor cannot see or use them. */
app.get('/auth/demo-token', async (_request, reply) => {
  if (process.env['NODE_ENV'] === 'production' && !process.env['ALLOW_DEMO_TOKENS']) {
    return reply.status(403).send({ error: 'Demo tokens disabled in production' })
  }
  const token = await auth.sign({ sub: 'demo_user', tenant_id: 'acme-corp', roles: ['admin'], demo: true })
  return reply.send({ token, tenant_id: 'acme-corp', note: 'Demo token — do not use in production' })
})

/** GET / — Studio home page fallback when the Studio app is not deployed */
app.get('/', async (_request, reply) => {
  const apiUrl = process.env['API_BASE_URL'] ?? 'http://localhost:3001'
  return reply.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kairos Studio</title>
<style>
  :root{color-scheme:light dark;}
  body{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:720px;margin:60px auto;padding:24px;line-height:1.5;background:#fafafa;color:#111;}
  h1{margin:0 0 8px;font-size:1.6rem;}
  .subtitle{color:#666;margin-bottom:24px;}
  .card{background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.05);}
  .card h2{margin:0 0 12px;font-size:1.1rem;}
  .btn{display:inline-block;margin:4px 8px 4px 0;padding:8px 14px;border-radius:8px;background:#111;color:#fff;text-decoration:none;font-size:0.9rem;}
  .btn:hover{background:#333;}
  .token-box{background:#f5f5f5;padding:12px;border-radius:8px;word-break:break-all;font-family:monospace;font-size:12px;color:#333;}
  .hidden{display:none;}
  .login-prompt{margin-top:24px;}
  .status{display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.8rem;background:#d1fae5;color:#065f46;margin-left:8px;}
</style>
</head>
<body>
  <h1>Kairos Studio</h1>
  <p class="subtitle">AI decision platform</p>

  <div class="card" id="authCard">
    <h2>Authentication <span class="status" id="authStatus">checking...</span></h2>
    <div id="tokenSection" class="hidden">
      <p>Logged in as tenant <b id="tenantName">-</b>.</p>
      <p class="token-box" id="tokenBox">-</p>
      <button onclick="copyToken()" class="btn">Copy token</button>
    </div>
    <div id="loginPrompt" class="login-prompt">
      <a class="btn" href="${apiUrl}/auth/google/login?app=studio">Sign in with Google</a>
    </div>
  </div>

  <div class="card hidden" id="navCard">
    <h2>Portfolio & Trading</h2>
    <a class="btn" href="/portfolio/holdings" data-api>Holdings</a>
    <a class="btn" href="/portfolio/recommendations" data-api>Recommendations</a>
    <a class="btn" href="/portfolio/scores" data-api>Momentum Scores</a>
    <a class="btn" href="/portfolio/trades" data-api>Trades</a>
    <a class="btn" href="/portfolio/home-kpis" data-api>KPIs</a>
  </div>

  <script>
    function parseHash() {
      const hash = window.location.hash.slice(1)
      const params = new URLSearchParams(hash)
      return {
        token: params.get('token'),
        tenant: params.get('tenant')
      }
    }
    function setCookie(name, value, days) {
      const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString()
      document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; Secure; SameSite=Lax'
    }
    function getCookie(name) {
      const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
      return m ? decodeURIComponent(m[2]) : null
    }
    function init() {
      const { token, tenant } = parseHash()
      const savedToken = getCookie('kairos_token') || token
      const savedTenant = getCookie('kairos_tenant') || tenant

      if (token) {
        setCookie('kairos_token', token, 30)
        if (tenant) setCookie('kairos_tenant', tenant, 30)
        // remove token from URL fragment for cleanliness
        history.replaceState(null, '', window.location.pathname)
      }

      if (savedToken) {
        document.getElementById('authStatus').textContent = 'authenticated'
        document.getElementById('tokenSection').classList.remove('hidden')
        document.getElementById('navCard').classList.remove('hidden')
        document.getElementById('loginPrompt').classList.add('hidden')
        document.getElementById('tokenBox').textContent = savedToken
        if (savedTenant) document.getElementById('tenantName').textContent = savedTenant

        // Rewrite nav links to include token as Bearer for convenience
        document.querySelectorAll('a[data-api]').forEach((a) => {
          a.addEventListener('click', async (e) => {
            e.preventDefault()
            const res = await fetch(a.href, { headers: { Authorization: 'Bearer ' + savedToken } })
            const text = await res.text()
            const w = window.open()
            w.document.write('<pre>' + text.replace(/</g, '&lt;') + '</pre>')
          })
        })
      } else {
        document.getElementById('authStatus').textContent = 'signed out'
      }
    }
    function copyToken() {
      const text = document.getElementById('tokenBox').textContent
      navigator.clipboard.writeText(text)
    }
    init()
  </script>
</body>
</html>`)
})

/** GET /health — unauthenticated liveness probe */
app.get('/health', async () => ({
  status: 'ok',
  version: process.env['npm_package_version'] ?? '0.1.0',
  detectors: engine.detectorCount,
  connectors: connectorLoader.count,
  signal_types: engine.registeredSignalTypes,
}))
app.get('/health/live', async () => ({ status: 'live' }))
app.get('/health/ready', async (_request, reply) => {
  let mongodb = 'disconnected'
  try {
    await workflowDb.command({ ping: 1 })
    mongodb = 'connected'
  } catch {
    // reported below
  }
  const ready = mongodb === 'connected' && queueManager.isAvailable()
  return reply.status(ready ? 200 : 503).send({
    status: ready ? 'ready' : 'not_ready',
    dependencies: {
      mongodb,
      redis: queueManager.isAvailable() ? 'connected' : 'disconnected',
      migration_version: process.env['MIGRATION_VERSION'] ?? 'unmanaged',
    },
    circuits: Object.fromEntries([...getAllCircuitBreakers()].map(([key, breaker]) => [key, breaker.getState()])),
    adapter: process.env['KAIROS_STORAGE_ADAPTER'] === 'sqlite' ? 'sqlite' : 'mongodb',
    mode: process.env['KAIROS_STORAGE_ADAPTER'] === 'sqlite' ? 'offline' : 'cloud',
  })
})

/** GET /connectors — list available connectors (pipeline connectors only) */
app.get('/pipeline-connectors', async () => ({
  connectors: connectorLoader.list().map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    signal_types: c.signal_types,
  })),
}))

// Modular route handlers
// Trimmed to what Agent Oak (apps/web) actually calls, plus the marketing
// surfaces (blog, case studies, growth events) that support self-serve
// growth. Everything else kairos-ai's apps/api serves — trading/property/
// social verticals, workflows/goals, SCIM, federated learning, the
// marketplace, teams — isn't reachable from Agent Oak and was removed rather
// than left dead in the route table. See SECURITY.md for the full list of
// what was dropped and why.
await registerInsightRoutes(app, engine, featureHashScorer, workflowDb, tenantLevelScorer)
await registerAuthUserRoutes(app, auth)
if (workflowDb) {
  await registerSocialAuthRoutes(app, auth, workflowDb)
}
if (workflowDb) {
  registerCaseStudyRoutes(app, workflowDb)
  registerConnectorCredentialRoutes(app, workflowDb, connectorLoader, eventGenerator, engine)
  registerBillingRoutes(app, workflowDb)
  registerBlogRoutes(app, workflowDb)
  registerDocumentRoutes(app, workflowDb)
  registerFamilyConnectorRoutes(app, workflowDb)
  registerFamilyGroupRoutes(app, workflowDb)
  registerGrowthEventRoutes(app, workflowDb)
  registerFamilyInboxRoutes(app, workflowDb)
  await registerFamilyFinancialProfileRoutes(app, workflowDb, engine, insightsDeliveryHook)
}
// Prometheus metrics — generic ops/observability, not vertical-specific.
await registerMetricsRoutes(app, engine, scoreCalibrator)

// ─── Start ───────────────────────────────────────────────────────────────────

logDeploymentMode()
log.info({ mode: deploymentConfig.mode }, 'Queue mode')

// Run pending database migrations before accepting traffic
try {
  const { runMigrations } = await import('./migrate.js')
  await runMigrations()
} catch (err) {
  log.error({ err }, 'Database migration failed — starting anyway')
}

const port = parseInt(process.env['PORT'] ?? '3001', 10)
await app.listen({ port, host: '0.0.0.0' })
log.info({ port }, 'Kairos API started')

// ─── Graceful shutdown ────────────────────────────────────────────────────────

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    log.info({ signal }, 'Shutting down')
    // Flush in-memory ML buffers and close all connections to prevent data loss on deploys
    await Promise.allSettled([
      noveltyTracker?.flushAll(),
      featureHashScorer?.flushAll(),
      queueManager.shutdown(),
      closeDb(),
    ])
    await engine.shutdown()
    await app.close()
    process.exit(0)
  })
}

// ─── Unhandled error handlers ─────────────────────────────────────────────────
// Prevent silent crashes — log structured errors for observability and alerting

process.on('unhandledRejection', (reason) => {
  log.error({ reason }, 'Unhandled promise rejection')
})

process.on('uncaughtException', (error) => {
  log.error({ err: error }, 'Uncaught exception — exiting')
  process.exit(1)
})

// ─── Type augmentation ────────────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    authContext: { tenant_id: string; user_id: string; roles: string[]; demo?: boolean }
  }
}
