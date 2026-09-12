import './env.js'

import { randomUUID } from 'node:crypto'

/**
 * Kairos API Server — Fastify
 *
 * Four packages wired together:
 *   @kairos/engine    — evaluate detectors on incoming events
 *   @kairos/pipeline  — ingest connector data + webhook events
 *   @kairos/skills    — plan/execute/finalize skill decisions
 *   @kairos/platform  — JWT auth, money utilities, telemetry
 *
 * Route map:
 *   POST /events              — ingest event, run detectors, persist insights
 *   POST /events/stream       — same, streamed via SSE
 *   POST /webhooks/:connector — receive third-party webhook, run pipeline
 *   GET  /insights            — list insights (tenant-scoped, filterable)
 *   GET  /insights/:id        — single insight
 *   GET  /insights/:id/explain — full rule evaluation trace
 *   POST /insights/:id/approve — approve insight actions
 *   POST /insights/:id/dismiss — dismiss insight
 *   GET  /engine/health       — engine liveness + detector count
 *   GET  /engine/metrics      — per-detector hit rates, latency
 *   GET  /engine/detectors    — full detector inventory
 *   GET  /engine/detectors/:id — single detector spec
 *   GET  /connectors          — list available connectors
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
import { Engine, type Insight, setSchemaRegistry } from '@kairos/engine'
import { ConnectorLoader, EventGenerator } from '@kairos/pipeline'
import { AuthService, canPerform, extractBearerToken, enforceQuota, getAllCircuitBreakers, QuotaExceededError, validateLicenseKey, SafeHttpClient, createLogger, initTelemetry, type ProductAction, type ProductResource } from '@kairos/platform'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerEventRoutes } from './routes/events.js'
import { registerInsightRoutes, cleanupStaleInsightsStartup } from './routes/insights.js'
import { initAuditLogger } from './audit/audit-log.js'
import { registerEngineRoutes } from './routes/engine.js'
import { registerWebhookRoutes } from './routes/webhooks.js'
import { registerAnalyticsRoutes } from './routes/analytics.js'
import { registerPortfolioRoutes } from './routes/portfolio.js'
import { registerPropertyRoutes } from './routes/property.js'
import { registerSocialRoutes } from './routes/social.js'
import { buildAutoTradeIntent } from './trading/auto-trade.js'
import { createPendingTrade, runAutoTradeConfirmationSweep, runTradeReconciliationSweep, initTradeFeatureHashScorer, findExistingAutoTradeForToday } from './trading/trade-confirmation.js'
import { loadLiveTradingOptIn } from './trading/portfolio-data.js'
import { runApprovalTimeoutSweep } from './approvals/timeout-sweep.js'
import { registerControlRoomRoutes } from './routes/control-room.js'
import { registerDetectorCrudRoutes } from './routes/detectors-crud.js'
import { registerAuthUserRoutes } from './routes/auth-users.js'
import { registerSocialAuthRoutes } from './routes/auth-social.js'
import { registerWorkflowRoutes } from './routes/workflows.js'
import { registerOutcomePackRoutes } from './routes/outcome-packs.js'
import { registerVerticalRoutes } from './routes/verticals.js'
import { registerWorkflowTemplateRoutes } from './routes/workflow-templates.js'
import { registerDetectorHealthRoutes } from './routes/detector-health.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerApprovalRoutes } from './routes/approvals.js'
import { createLlmRouterFromEnv, LlmResponseCache, MongoLlmCacheStore, LlmBudgetGuard, LocalEmbeddingProvider } from '@kairos/platform'
import {
  AdaptiveThresholdStore, ScoreCalibrator, IntentClassifier,
  NoveltyTracker, ChangePointDetector, FeatureHashScorer, TenantLevelScorer,
  FederatedLearningService,
} from '@kairos/engine'
import { ApiLlmScorer } from './llm-scorer.js'
import { registerConnectorCredentialRoutes } from './routes/connector-credentials.js'
import { registerIngestRoutes } from './routes/ingest.js'
import { registerDeliveryRoutes } from './routes/delivery.js'
import { DeliveryRouter } from './delivery/delivery-router.js'
import { createMoveJudge } from './delivery/move-judge.js'
import { ConnectorSyncEngine, TokenRefreshScheduler } from '@kairos/pipeline'
import { WorkflowEngine, WorkflowLoader, type WorkflowDef, type EventPayload, connectorSchemaRegistry } from '@kairos/workflows'
import cron from 'node-cron'
import { enqueueWorkflowTrigger, startWorker } from './queue/WorkflowQueue.js'
import { queueManager } from './queue/QueueManager.js'
import { startWebhookWorker } from './queue/WebhookQueue.js'
import { ApiReasoningContextBuilder } from './outcomes/reasoning-context-builder.js'
import { GoalSummarisationJob } from './jobs/goal-summarisation-job.js'
import { registerAttributionRoutes } from './routes/attribution.js'
import { registerVersionRoutes } from './routes/versions.js'
import { registerSsoRoutes } from './routes/auth-sso.js'
import { recordApiRequest, registerMetricsRoutes, recordLlmCacheHitMiss, buildFeatureHashScorerMetrics } from './routes/metrics.js'
import { registerSkillRoutes } from './routes/skills.js'
import { registerPromptRoutes } from './routes/prompts.js'
import { registerPrivacyRoutes } from './routes/privacy.js'
import { registerEventSchemaRoutes } from './routes/event-schemas.js'
import { registerIdentityRoutes } from './routes/identity.js'
import { registerMigrationRoutes } from './routes/migrations.js'
import { registerMlIsolationHealthRoutes } from './routes/ml-isolation-health.js'
import { registerScimRoutes } from './routes/scim.js'
import { registerScimConfigRoutes } from './routes/scim-config.js'
import { GoalMigrationWorker } from './jobs/goal-migration-worker.js'
import { registerDesktopSyncRoutes } from './routes/desktop-sync.js'
import { RetentionWorker } from './jobs/retention-worker.js'
import { InsightSlaWorker } from './jobs/insight-sla-worker.js'
import { EscalationWorker } from './jobs/escalation-worker.js'
import { createCredentialExpiryInsights } from './jobs/connector-health-alert.js'
import { scanAllConnectedInboxes } from './jobs/email-scan.js'
import { registerApiVersioning, rewriteVersionedUrl } from './api-versioning.js'
import { registerOnboardingRoutes } from './routes/onboarding.js'
import { registerGoalRoutes } from './routes/goals.js'
import { registerGoalsAIRoutes } from './routes/goals-ai.js'
import { registerExecutionEventRoutes } from './routes/execution-events.js'
import { registerAuditTrailRoutes } from './routes/audit-trail.js'
import { registerAIPersonalityRoutes } from './routes/ai-personality.js'
import { registerGoalDecompositionRoutes } from './routes/goal-decomposition.js'
import { registerVisualWorkflowRoutes } from './routes/visual-workflow.js'
import { registerWorkflowMarketplaceRoutes } from './routes/marketplace-v2.js'
import { registerFederatedRoutes } from './routes/federated.js'
import { KpiComputeEngine } from './jobs/kpi-compute-engine.js'
import { registerGoalCompilerRoutes } from './routes/goal-compiler.js'
import { registerVerifiedMomentRoutes } from './routes/verified-moments.js'
import { registerMarketplaceRoutes } from './routes/marketplace.js'
import { registerAccountantRoutes } from './routes/accountant.js'
import { registerTenantRoutes } from './routes/tenants.js'
import { registerAlertRuleRoutes } from './routes/alert-rules.js'
import { registerBillingRoutes } from './routes/billing.js'
import { registerBlogRoutes } from './routes/blog.js'
import { registerEntitlementRoutes } from './routes/entitlements.js'
import { registerCollaborationRoutes } from './routes/collaboration.js'
import { registerSearchRoutes } from './routes/search.js'
import { registerDetectorPromotionRoutes } from './routes/detector-promotions.js'
import { registerOutcomeRoutes } from './routes/outcomes.js'
import { registerQueryRoutes } from './routes/query.js'
import { registerTeamRoutes } from './routes/team.js'
import { registerCopilotRoutes } from './routes/copilot.js'
import { registerBenchmarkRoutes } from './routes/benchmarks.js'
import { persistAndDeliverInsights as persistAndDeliverInsightsCore } from './insights-persist.js'
import { deploymentConfig, logDeploymentMode } from './config/deployment.js'
import { addSandboxContext, sandboxMiddleware, sandboxWriteMiddleware } from './middleware/sandbox.js'
import { registerReportRoutes } from './routes/reports.js'
import { registerAutoApprovalRulesRoutes } from './routes/auto-approval-rules.js'
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
let adaptiveThresholds: AdaptiveThresholdStore | undefined
let intentClassifier: IntentClassifier | undefined
let noveltyTracker: NoveltyTracker | undefined
let changePointDetector: ChangePointDetector | undefined
let featureHashScorer: FeatureHashScorer | undefined
let tenantLevelScorer: TenantLevelScorer | undefined
let federatedLearningService: FederatedLearningService | undefined
let kpiComputeEngine: KpiComputeEngine | undefined
// Captures persistAndDeliverInsights (defined inside the Mongo-connect try
// block below, alongside SocialAnalyticsPoller/KpiComputeEngine) so the
// property/social manual-entry routes — registered later, outside that try
// block, where `app` exists — can reuse the same persist+deliver hook.
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
  workflowEngine = new WorkflowEngine({
    db: workflowDb,
    llmFn,
    fetchFn: (url, init) => safeHttp.fetch(url, init),
    sseBroadcast: (tenantId, _event) => {
      log.debug({ tenant_id: tenantId }, 'SSE broadcast')
    },
    // Only ever creates a `pending_trades` record — never calls the broker
    // directly. That record still goes through the full guarded confirm path
    // (packages/engine/src/trading/trade-executor.ts's evaluateTradeExecution)
    // via the per-minute sweep below, same as a manually-confirmed trade.
    createPendingTradeFn: async ({ tenantId, detectorId, eventData, origin, sourceEventId, sourceInsightId, goalId }) => {
      const intent = await buildAutoTradeIntent(tenantId, detectorId, eventData)
      if (!intent) {
        return { created: false, reason: 'No coherent auto-trade recommendation for this detector/ticker' }
      }
      // Concentration-risk and price-drop-alert can both fire for the same
      // ticker in one detector cycle (e.g. a position that's both over-cap
      // and down sharply) — two independent workflow runs would otherwise
      // each reach this closure and create two pending_trades docs for the
      // same ticker, both eventually confirming as separate trades.
      //
      // Gap #21 (TRADING_ENGINE_GAPS.md): the original check only matched
      // status: 'pending'. The moment a trade transitioned to 'executing'
      // or 'executed', this check no longer saw it — a second detector
      // cycle firing for the same ticker later the same day created an
      // independent duplicate. Now widens to also match 'executing' (in-
      // flight) and 'executed'/'logged' (completed today), using the same
      // Europe/London day boundary as countTradesExecutedToday (gap #29
      // fixed the previous UTC mismatch). Rejected/cancelled/
      // expired trades don't block — those didn't execute.
      const existing = await findExistingAutoTradeForToday(workflowDb, tenantId, intent.ticker)
      if (existing) {
        return { created: false, reason: `A pending auto-trade for ${intent.ticker} already exists (${existing['trade_id']})` }
      }
      // Resolve the goal this trade is helping to achieve. Goals link to
      // detectors via detector_ids — find the active goal that uses this
      // detector and link the trade back to it.
      // Gap #8 (TRADING_ENGINE_GAPS.md): origin distinguishes the autonomous
      // bypass (origin='auto' → 'auto_workflow') from the human-approved
      // propose_trim action (origin='manual' → 'manual'). Both go through
      // the same guarded confirm/cancel path — the only difference is the
      // audit trail and confirmation window.
      const tradeOrigin = origin === 'manual' ? 'manual' : 'auto_workflow'
      const { tradeId } = await createPendingTrade(
        tenantId,
        {
          action: intent.action,
          ticker: intent.ticker,
          quantity: intent.quantity,
          price: intent.price,
          // Durable link back to the detector event / insight that caused
          // this trade — see TRADING_ENGINE_GAPS.md gap #25.
          source_event_id: sourceEventId,
          source_insight_id: sourceInsightId,
          // Gap #32: durable link from trade → goal for attribution.
          ...(goalId && { goal_id: goalId }),
        },
        tradeOrigin,
      )
      return { created: true, tradeId }
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

  // ── Consolidated per-minute sweep ─────────────────────────────────────────
  // Previously three separate `* * * * *` crons (auto-trade confirmation,
  // trade reconciliation, approval timeout sweep), each with its own
  // node-cron heartbeat timer. On a 2-CPU Cloud Run instance the event loop
  // is intermittently blocked for >1s by ONNX inference, workflow execution,
  // and GC pauses. node-cron's default `missedExecutionTolerance` is 1000ms,
  // so when the heartbeat fires >1s late the entire tick is SKIPPED — this
  // caused a 50-75% miss rate on all three per-minute sweeps (verified in
  // production logs, pre-existing since at least 2026-07-31).
  //
  // Fix: consolidate into a single cron tick that runs all three sweeps
  // sequentially, with `missedExecutionTolerance: 5000` (5s slack) and
  // `noOverlap: true` (if a sweep takes >1min, skip the next tick instead
  // of queuing up overlapping DB queries). This reduces 3 heartbeat timers
  // to 1 and 3 independent DB connection cycles to 1.
  cron.schedule('* * * * *', async () => {
    // Auto-trade confirmation — confirms autonomous pending trades once
    // their 5-minute human-cancellation window has elapsed. See
    // apps/api/src/trading/trade-confirmation.ts.
    try {
      await runAutoTradeConfirmationSweep()
    } catch (err) {
      log.error({ err }, 'Auto-trade confirmation sweep failed')
    }
    // Trade reconciliation — handles Gap #13 (orphaned `executing` trades),
    // Gap #14 (stale manual pending trades), Gap #15 (broker fill prices).
    try {
      await runTradeReconciliationSweep()
    } catch (err) {
      log.error({ err }, 'Trade reconciliation sweep failed')
    }
    // Approval timeout — resolves human-approval gates past their timeout_at
    // via the node's configured timeout_action. See
    // apps/api/src/approvals/timeout-sweep.ts.
    try {
      await runApprovalTimeoutSweep(workflowDb, workflowEngine, workflowLoader)
    } catch (err) {
      log.error({ err }, 'Approval timeout sweep failed')
    }
  }, { missedExecutionTolerance: 5_000, noOverlap: true })
  log.info({}, 'Consolidated per-minute sweep cron started (auto-trade + reconciliation + approval timeout)')

  // Momentum rebalance sweep — hourly during US market hours
  // (14:00-21:00 UTC / 09:30-16:00 ET, weekdays). The 5-minute
  // cancellation window still executes pending trades quickly, but
  // hourly scoring cuts CPU/cost in half compared to every 30 minutes.
  cron.schedule('0 14-21 * * 1-5', async () => {
    try {
      const { runMomentumRebalanceSweep } = await import('./trading/momentum-rebalance.js')
      await runMomentumRebalanceSweep()
    } catch (err) {
      log.error({ err }, 'Momentum rebalance sweep failed')
    }
  }, { missedExecutionTolerance: 30_000 })
  log.info({}, 'Momentum rebalance sweep cron started (hourly, 14:00-21:00 UTC, weekdays)')

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

  // ── Federated learning round — weekly Monday 4 AM ─────────────────────────
  // Collects gradients from all active tenants, aggregates them with
  // DP noise + secure aggregation + k-anonymity (min 20 tenants), and
  // stores a global model that new tenants warm-start from.
  cron.schedule('0 4 * * 1', async () => {
    if (!federatedLearningService) return
    try {
      const result = await federatedLearningService.runWeeklyRound()
      log.info(result, 'Federated learning weekly round completed')
    } catch (err) {
      log.error({ err }, 'Federated learning weekly round failed')
    }
  }, { missedExecutionTolerance: 60_000 })
  log.info({}, 'Federated learning cron started (weekly Monday 4 AM)')

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

  // ── Goal integrity job — daily at 4:30 AM ─────────────────────────────────
  // EPIC-002: detects duplicate active goals sharing the same template_id+
  // vertical or name. Flags them for manual review — never auto-merges.
  cron.schedule('30 4 * * *', async () => {
    try {
      const { runGoalIntegrityJob } = await import('./jobs/goal-integrity-job.js')
      const result = await runGoalIntegrityJob(workflowDb)
      log.info({ result }, 'Goal integrity job completed')
    } catch (err) {
      log.error({ err }, 'Goal integrity job failed')
    }
  }, { missedExecutionTolerance: 60_000 })
  log.info({}, 'Goal integrity job started (daily 4:30 AM)')

  // ── Social analytics polling — every 6 hours ──────────────────────────────
  // Fetches LinkedIn/Twitter post metrics 24h after publishing and fires
  // social.post.performance events so detectors can measure goal progress.
  const { SocialAnalyticsPoller } = await import('./jobs/social-analytics-poller.js')
  const persistAndDeliverInsights = async (insights: Insight[], tenantId: string): Promise<void> =>
    persistAndDeliverInsightsCore(workflowDb, insights, tenantId, deliveryRouter)

  const socialPoller = new SocialAnalyticsPoller(workflowDb, engine, persistAndDeliverInsights)
  cron.schedule('0 */6 * * *', async () => {
    try {
      const result = await socialPoller.poll()
      if (result.fetched > 0) {
        log.info({ fetched: result.fetched, errors: result.errors }, 'Social analytics poll complete')
      }
    } catch (err) {
      log.error({ err }, 'Social analytics poll failed')
    }
  }, { missedExecutionTolerance: 60_000 })
  log.info({}, 'Social analytics poller started')
  insightsDeliveryHook = persistAndDeliverInsights

  // ── Universal KPI Compute Engine — 1 AM nightly ───────────────────────────
  // Auto-computes all signal-source KPIs for every active goal.
  // Eliminates the need for manual metric pushes for any goal backed by
  // signals already flowing through Kairos (Xero, Stripe, Shopify, etc.)
  kpiComputeEngine = new KpiComputeEngine(workflowDb, engine, persistAndDeliverInsights)
  const kpiEngineForCron = kpiComputeEngine
  cron.schedule('0 1 * * *', async () => {
    try {
      const result = await kpiEngineForCron.runAll()
      log.info({ kpis_updated: result.kpis_updated, goals_processed: result.goals_processed }, 'KPI compute complete')
    } catch (err) {
      log.error({ err }, 'KPI compute failed')
    }
  }, { missedExecutionTolerance: 60_000 })
  log.info({}, 'KPI compute engine started')

  // ── Intraday KPI compute for trading tenants ──────────────────────────────
  // Trading outcomes move fast — a daily 1 AM compute is too slow for
  // same-day portfolio changes. This runs every 2 hours during market hours
  // (8 AM - 6 PM UTC, covering LSE 08:00-16:30 and partial US market) but
  // only for tenants with trading-related goals (vertical = 'trading-investment').
  cron.schedule('0 8,10,12,14,16,18 * * 1-5', async () => {
    try {
      const tradingTenants = await workflowDb.collection('tenants')
        .find({ active_vertical: 'trading-investment', status: 'active' })
        .project({ tenant_id: 1 })
        .toArray()
      if (tradingTenants.length === 0) return

      const result = await kpiEngineForCron.runAll()
      log.info({
        kpis_updated: result.kpis_updated,
        goals_processed: result.goals_processed,
        trading_tenants: tradingTenants.length,
        mode: 'intraday',
      }, 'Intraday KPI compute complete for trading tenants')
    } catch (err) {
      log.error({ err }, 'Intraday KPI compute failed')
    }
  }, { missedExecutionTolerance: 60_000 })
  log.info({}, 'Intraday KPI compute for trading tenants started (every 2h, 8-18 UTC, weekdays)')
  const goalSummarisationJob = new GoalSummarisationJob(workflowDb, globalLlmFn)
  const retentionWorker = new RetentionWorker(workflowDb)
  const goalMigrationWorker = new GoalMigrationWorker(workflowDb)
  const insightSlaWorker = new InsightSlaWorker(workflowDb)
  const escalationWorker = new EscalationWorker(workflowDb)
  await retentionWorker.ensureIndexes()
  cron.schedule('30 1 * * *', async () => {
    try {
      const generated = await goalSummarisationJob.run()
      if (generated > 0) log.info({ generated }, 'Goal evidence summaries generated')
    } catch (err) {
      log.error({ err }, 'Goal summarisation failed')
    }
  }, { missedExecutionTolerance: 60_000 })
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

  // ── Adaptive thresholds nightly recompute ─────────────────────────────────
  // Recomputes Bollinger Band thresholds for all tenants at 4 AM daily.
  // Without this, thresholds go stale — detectors keep using last week's
  // mean/std instead of adapting to recent activity. The recompute also
  // invalidates the in-memory cache so the next event picks up fresh values.
  cron.schedule('0 4 * * *', async () => {
    if (!adaptiveThresholds) return
    try {
      const signalTypes = [
        { signal_type: 'invoice_overdue', fields: ['amount_minor', 'days_late'] },
        { signal_type: 'payment_failed', fields: ['amount_minor'] },
        { signal_type: 'portfolio_position', fields: ['quantity', 'current_price', 'avg_price'] },
        { signal_type: 'portfolio_summary', fields: ['total_value', 'cash'] },
      ]
      const { computed, skipped } = await adaptiveThresholds.recomputeAll(signalTypes)
      adaptiveThresholds.invalidateCache()
      log.info({ computed, skipped }, 'Adaptive thresholds nightly recompute complete')
    } catch (err) {
      log.error({ err }, 'Adaptive thresholds nightly recompute failed')
    }
  }, { missedExecutionTolerance: 60_000 })
  log.info({}, 'Adaptive thresholds nightly recompute scheduled (0 4 * * *)')

  if (goalMigrationWorker.isEnabled()) {
    cron.schedule('0 3 * * *', async () => {
      try {
        await goalMigrationWorker.runAllTenants()
      } catch (err) {
        log.error({ err }, 'Goal migration worker failed')
      }
    }, { missedExecutionTolerance: 60_000 })
    log.info({}, 'Goal migration worker started')
  } else {
    log.info({}, 'Goal migration worker disabled')
  }

  // ── Gap #30: Strategy eval crons ──────────────────────────────────────────
  // Two weekly jobs that answer "is the strategy actually good" against real
  // data — the missing automated evaluation layer identified in gap #30.

  // 1. Shadow backtest — runs the DTFE engine in paper mode against real
  //    market price history, persists the result to `shadow_backtest_reports`.
  //    Runs at 6 AM every Monday for every active tenant.
  //
  //    Data source priority (most efficient free-tier usage):
  //      1. market_price signals already synced to the DB (by any connector)
  //      2. yfinance Python bridge (free, 20+ years, no API key)
  //      3. Alpha Vantage API (fallback, per-tenant connector credentials)
  //
  //    Position sizing uses portfolio-tier defaults based on each tenant's
  //    actual portfolio value, so small portfolios (£1K) get fewer, larger
  //    positions instead of many tiny ones.
  cron.schedule('0 6 * * 1', async () => {
    try {
      const { runShadowBacktestForReport } = await import('./jobs/shadow-backtest-runner.js')
      const { decryptIfNeeded } = await import('@kairos/platform')
      const { buildSnapshotFromSignals } = await import('./trading/portfolio-data.js')

      // Find all active tenants (any tenant with portfolio_summary signals
      // or any connector credential — they're "active" in the trading vertical)
      const tenantIdsWithSignals = await workflowDb.collection('signals')
        .distinct('tenant_id', { signal_type: 'portfolio_summary' })
      const tenantIdsWithCreds = await workflowDb.collection('connector_credentials')
        .distinct('tenant_id', {})
      const allTenantIds = Array.from(new Set([...tenantIdsWithSignals, ...tenantIdsWithCreds]))

      if (allTenantIds.length === 0) {
        log.warn({}, 'Shadow backtest skipped — no active tenants found.')
        return
      }

      // Pre-fetch Alpha Vantage credentials per tenant (for fallback)
      const avCredsByTenant = new Map<string, string>()
      const avCreds = await workflowDb.collection('connector_credentials')
        .find({ connector_id: 'alpha-vantage' })
        .project({ tenant_id: 1, api_key: 1, _id: 0 })
        .toArray()
      for (const cred of avCreds) {
        try {
          const apiKey = decryptIfNeeded(cred['api_key'] as string)
          if (apiKey) avCredsByTenant.set(cred['tenant_id'] as string, apiKey)
        } catch { /* skip undecryptable */ }
      }

      let successCount = 0
      let failCount = 0

      for (const tenantId of allTenantIds) {
        try {
          // Fetch the tenant's actual portfolio value for tier-based sizing
          let portfolioValueMinor: number | undefined
          try {
            const recentSignals = await workflowDb.collection('signals')
              .find({ tenant_id: tenantId, signal_type: { $in: ['portfolio_summary', 'portfolio_position'] } })
              .sort({ created_at: -1 })
              .limit(100)
              .toArray()
            if (recentSignals.length > 0) {
              const snapshot = buildSnapshotFromSignals(tenantId, recentSignals as Record<string, unknown>[])
              if (snapshot.totalValue > 0) portfolioValueMinor = snapshot.totalValue
            }
          } catch { /* portfolio value lookup is best-effort */ }

          const report = await runShadowBacktestForReport({
            db: workflowDb,
            tenantId,
            alphaVantageKey: avCredsByTenant.get(tenantId) ?? process.env['ALPHA_VANTAGE_API_KEY'],
            portfolioValueMinor,
          })
          if (report) {
            await workflowDb.collection('shadow_backtest_reports').insertOne(report)
            log.info({
              tenant_id: tenantId,
              tickers: report.tickers,
              return_pct: report.total_return_pct,
              data_source: report.data_source,
              tier: report.portfolio_tier,
            }, 'Shadow backtest complete')
            successCount++
          } else {
            log.warn({ tenant_id: tenantId }, 'Shadow backtest returned null — all data sources failed (DB signals, yfinance, Alpha Vantage)')
            failCount++
          }
        } catch (err) {
          log.error({ err, tenant_id: tenantId }, 'Shadow backtest failed for tenant')
          failCount++
        }
      }

      log.info({ success: successCount, failed: failCount, tenants: allTenantIds.length }, 'Shadow backtest cron sweep complete')
    } catch (err) {
      log.error({ err }, 'Shadow backtest cron failed')
    }
  }, { missedExecutionTolerance: 60_000 })
  log.info({}, 'Shadow backtest cron started (weekly Mon 6 AM, per-tenant, multi-source)')

  // 2. FeatureHashScorer offline eval — computes precision/recall/AUC/
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

  // ── Adaptive thresholds ───────────────────────────────────────────────────
  // Bollinger Band thresholds computed nightly — injected into EvaluationContext
  // so detector YAML can reference context.adaptive_thresholds["invoice_overdue.amount_minor.2sigma"]
  adaptiveThresholds = new AdaptiveThresholdStore(workflowDb)
  log.info({}, 'Adaptive threshold store ready')

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

  // ── Federated learning service ────────────────────────────────────────────
  // Wires the FederatedLearning engine into the actual training loop.
  // Weekly rounds collect gradients from all active tenants, aggregate them
  // with DP noise + secure aggregation + k-anonymity, and store a global
  // model that new tenants warm-start from (solving cold-start).
  federatedLearningService = new FederatedLearningService(
    workflowDb,
    tenantLevelScorer,
  )

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
  // Also wire into trade-confirmation so auto-trades feed the same positive
  // signal to online learning that human approval does (gap #4).
  initTradeFeatureHashScorer(featureHashScorer)
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
// Delivery router (created during Mongo startup) wired into the event pipeline
await registerEventRoutes(app, engine, adaptiveThresholds, intentClassifier, deliveryRouter, featureHashScorer)
await registerInsightRoutes(app, engine, featureHashScorer, workflowDb, tenantLevelScorer)
await registerEngineRoutes(app, engine, scoreCalibrator, noveltyTracker, changePointDetector, featureHashScorer, kpiComputeEngine)
await registerWebhookRoutes(app, engine, connectorLoader, eventGenerator, workflowDb ?? null)
await registerAnalyticsRoutes(app, workflowDb)
await registerPortfolioRoutes(app, engine, insightsDeliveryHook)
await registerPropertyRoutes(app, engine, insightsDeliveryHook)
await registerSocialRoutes(app, engine, insightsDeliveryHook)
await registerControlRoomRoutes(app, workflowDb)
await registerDetectorCrudRoutes(app, engine, workflowDb)
await registerVerticalRoutes(app, workflowDb)
await registerAuthUserRoutes(app, auth)
if (workflowDb) {
  await registerSocialAuthRoutes(app, auth, workflowDb)
}
if (workflowLoader && workflowEngine) {
  await registerWorkflowRoutes(app, workflowLoader, workflowEngine, workflowDb)
  registerVersionRoutes(app, workflowDb, workflowLoader)
  registerOutcomePackRoutes(app, workflowDb, workflowLoader)
  registerWorkflowTemplateRoutes(app, workflowDb)
  registerDetectorHealthRoutes(app, workflowDb)
}
if (workflowDb) {
  registerSettingsRoutes(app, workflowDb)
  registerApprovalRoutes(app, workflowDb, workflowEngine, workflowLoader)
  registerReportRoutes(app, workflowDb)
  registerAutoApprovalRulesRoutes(app, workflowDb)
  registerCaseStudyRoutes(app, workflowDb)
  registerBenchmarkRoutes(app, workflowDb)
  registerConnectorCredentialRoutes(app, workflowDb, connectorLoader, eventGenerator, engine)
  registerAttributionRoutes(app, workflowDb)
  await registerIngestRoutes(app, engine, workflowDb)
  registerDeliveryRoutes(app, workflowDb, deliveryRouter)
  await registerSkillRoutes(app, workflowDb)
  registerPromptRoutes(app, workflowDb)
  registerPrivacyRoutes(app, workflowDb)
  registerEventSchemaRoutes(app, workflowDb)
  registerIdentityRoutes(app, workflowDb)
  registerMigrationRoutes(app, workflowDb)
  registerMlIsolationHealthRoutes(app, workflowDb)
  registerScimRoutes(app, workflowDb)
  registerScimConfigRoutes(app, workflowDb)
  registerDesktopSyncRoutes(app, workflowDb)
  registerOnboardingRoutes(app, workflowDb, engine)
  registerGoalRoutes(app, workflowDb, kpiComputeEngine, engine, deliveryRouter)
  registerGoalsAIRoutes(app, workflowDb)
  registerExecutionEventRoutes(app, workflowDb)
  registerAuditTrailRoutes(app, workflowDb)
  registerAIPersonalityRoutes(app, workflowDb)
  registerGoalDecompositionRoutes(app, workflowDb)
  registerVisualWorkflowRoutes(app, workflowDb)
  registerWorkflowMarketplaceRoutes(app, workflowDb)
  registerFederatedRoutes(app, workflowDb, federatedLearningService!.federatedLearning)
  registerGoalCompilerRoutes(app, workflowDb, engine, globalLlmFn)
  registerVerifiedMomentRoutes(app, workflowDb)
  registerMarketplaceRoutes(app, workflowDb)
  registerAccountantRoutes(app, workflowDb)
  registerTenantRoutes(app, workflowDb)
  registerBillingRoutes(app, workflowDb)
  registerBlogRoutes(app, workflowDb)
  registerEntitlementRoutes(app, workflowDb)
  registerCollaborationRoutes(app, workflowDb)
  registerSearchRoutes(app, workflowDb)
  registerDetectorPromotionRoutes(app, workflowDb, engine, path.join(ROOT, 'detector-evals'))
  registerAlertRuleRoutes(app, workflowDb)
  registerOutcomeRoutes(app, workflowDb)
  registerQueryRoutes(app, workflowDb)
  registerTeamRoutes(app, workflowDb)
  registerCopilotRoutes(app, workflowDb, corsOrigin)
  registerDocumentRoutes(app, workflowDb)
  registerFamilyConnectorRoutes(app, workflowDb)
  registerFamilyGroupRoutes(app, workflowDb)
  registerGrowthEventRoutes(app, workflowDb)
  registerFamilyInboxRoutes(app, workflowDb)
  await registerFamilyFinancialProfileRoutes(app, workflowDb, engine, insightsDeliveryHook)
}
registerSsoRoutes(app, auth, workflowDb)
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
