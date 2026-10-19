import './env.js'

import { randomUUID } from 'node:crypto'

/**
 * LifeKeel API Server — Fastify
 *
 * A full copy of kairos-ai's apps/api, trimmed to what LifeKeel (apps/web)
 * actually calls plus the marketing surfaces (blog, case studies, growth
 * events) that support self-serve growth. See SECURITY.md for the full
 * list of routes/crons/packages removed and why.
 *
 * Packages wired together:
 *   @lifekeel/engine    — evaluate detectors (family_* only) on incoming events
 *   @lifekeel/pipeline  — connector data ingestion (email/Gmail)
 *   @lifekeel/workflows — connector credential/OAuth plumbing, schema registry
 *   @lifekeel/platform  — JWT auth, money utilities, telemetry
 *
 * Route map (registered further down — search "Modular route handlers"):
 *   /auth/*, /connectors/*, /family*, /documents*, /billing/*, /inbox*,
 *   /insights, /blog/*, /case-studies, /growth/*, /metrics
 *   GET  /health              — server liveness (unauthenticated)
 */

import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import helmet from '@fastify/helmet'
import compress from '@fastify/compress'
import sensible from '@fastify/sensible'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { ZodTypeProvider, jsonSchemaTransform } from 'fastify-type-provider-zod'
import { Engine, type Insight, setSchemaRegistry } from '@lifekeel/engine'
import {
  ConnectorLoader,
  EventGenerator,
  ConnectorSyncEngine,
  TokenRefreshScheduler,
} from '@lifekeel/pipeline'
import {
  AuthService,
  canPerform,
  extractBearerToken,
  enforceQuota,
  getAllCircuitBreakers,
  QuotaExceededError,
  validateLicenseKey,
  createLogger,
  initTelemetry,
  type ProductAction,
  type ProductResource,
} from '@lifekeel/platform'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerInsightRoutes, cleanupStaleInsightsStartup } from './routes/insights.js'
import {
  recordApiRequest,
  registerMetricsRoutes,
  recordLlmCacheHitMiss,
  buildFeatureHashScorerMetrics,
} from './routes/metrics.js'
import { initAuditLogger } from './audit/audit-log.js'
import { registerAuthUserRoutes } from './routes/auth-users.js'
import {
  clearSessionCookie,
  isOriginAllowedForCookieAuth,
  readSessionCookie,
} from './auth/session-cookie.js'
import { registerSocialAuthRoutes } from './routes/auth-social.js'
import {
  LlmResponseCache,
  MongoLlmCacheStore,
  LlmBudgetGuard,
  LocalEmbeddingProvider,
} from '@lifekeel/platform'
import {
  ScoreCalibrator,
  IntentClassifier,
  NoveltyTracker,
  ChangePointDetector,
  FeatureHashScorer,
  TenantLevelScorer,
} from '@lifekeel/engine'
import { ApiLlmScorer } from './llm-scorer.js'
import { registerConnectorCredentialRoutes } from './routes/connector-credentials.js'
import { DeliveryRouter } from './delivery/delivery-router.js'
import { createMoveJudge } from './delivery/move-judge.js'
import { localDecisionFromEnv } from './local-model.js'
import { initTaskGateway, taskLlmFor, taskDecideFor, taskVision } from './ai/task-gateway.js'
import { connectorSchemaRegistry } from '@lifekeel/workflows'
import cron from 'node-cron'
import { queueManager } from './queue/QueueManager.js'
import { startWebhookWorker } from './queue/WebhookQueue.js'
import { RetentionWorker } from './jobs/retention-worker.js'
import { InsightSlaWorker } from './jobs/insight-sla-worker.js'
import { EscalationWorker } from './jobs/escalation-worker.js'
import { createCredentialExpiryInsights } from './jobs/connector-health-alert.js'
import {
  scanAllConnectedInboxes,
  enqueueConnectedInboxScans,
  runQueuedInboxScan,
  EMAIL_SCAN_QUEUE,
} from './jobs/email-scan.js'
import { retryFailedDocuments } from './ocr/retry-failed.js'
import {
  withCronLock,
  acquireCronLock,
  releaseCronLock,
  ensureCronLockIndex,
} from './jobs/cron-lock.js'
import { ensureSpendIndexes } from './spend-ledger.js'
import { registerApiVersioning, rewriteVersionedUrl } from './api-versioning.js'
import { registerBillingRoutes } from './routes/billing.js'
import { registerBlogRoutes } from './routes/blog.js'
import { persistAndDeliverInsights as persistAndDeliverInsightsCore } from './insights-persist.js'
import { deploymentConfig, logDeploymentMode } from './config/deployment.js'
import {
  addSandboxContext,
  sandboxMiddleware,
  sandboxWriteMiddleware,
} from './middleware/sandbox.js'
import { registerCaseStudyRoutes } from './routes/case-studies.js'
import { registerDocumentRoutes } from './routes/documents.js'
import { registerVaultRoutes } from './routes/vault.js'
import { registerAuditLogRoutes } from './routes/audit-log.js'
import { registerAutomationSettingsRoutes } from './routes/automation-settings.js'
import { registerAccountRoutes } from './routes/account.js'
import { registerFamilyConnectorRoutes } from './routes/family-connectors.js'
import { registerFamilyGroupRoutes } from './routes/family-group.js'
import { registerFamilyJoinRoutes } from './routes/family-join.js'
import { registerReferralRoutes } from './routes/referrals.js'
import { registerGrowthEventRoutes } from './routes/growth-events.js'
import { registerFamilyFinancialProfileRoutes } from './routes/family-financial-profile.js'
import { registerLifeEventRoutes } from './routes/life-events.js'
import { runChecklistReminderSweep } from './life-events/checklist-reminder.js'
import { registerFamilyInboxRoutes } from './routes/family-inbox.js'
import { registerPushRoutes } from './routes/push.js'
import { registerReminderRoutes } from './routes/reminders.js'
import {
  registerMarketingPostRoutes,
  publishDueMarketingPosts,
  generateDailyMarketingDrafts,
  pollMarketingEngagement,
} from './routes/marketing-posts.js'
import { runMetricsRollup } from './jobs/metrics-rollup.js'
import { runWeeklyDigest } from './operator/weekly-digest.js'
import { runLifecycleSweep } from './marketing/lifecycle-emails.js'
import { runAutopilotSweep, ensureAutopilotIndexes } from './operator/autopilot.js'
import { socialPublisherFromEnv, DbSocialPublisher } from './marketing/social-publisher.js'
import { registerOperatorRoutes } from './routes/operator.js'
import { getPlatformConfig, registerPublicStatusRoute } from './operator/platform-config.js'
import { registerDetectorEvalRoutes, detectorEvalDir } from './routes/detector-evals.js'
import {
  ensureReminderIndexes,
  runPolicyRenewalReminders,
} from './jobs/policy-renewal-reminders.js'
import { runMemberAgentLoop } from './jobs/member-agent-loop.js'
import { runStaleProfileEvaluationSweep } from './jobs/stale-profile-evaluation.js'
import { ensureMemberNudgeIndexes } from './member-nudges.js'
import { runContinuityCheck, ensureContinuityIndexes } from './jobs/continuity-check.js'
import { runFamilyHeartbeat } from './jobs/family-heartbeat.js'
import { registerAssistantRoutes } from './routes/assistant.js'
import { registerSupportRoutes } from './routes/support.js'
import { registerReadinessQuizRoutes } from './routes/readiness-quiz.js'
import { registerFamilyReadinessRoutes } from './routes/family-readiness.js'
import { registerFamilyScenarioRoutes } from './routes/family-scenarios.js'
import { registerFamilyFeedRoutes } from './routes/family-feed.js'
import { registerFamilyNotificationRoutes } from './routes/family-notifications.js'
import { runScenarioWatchlist } from './jobs/scenario-watchlist.js'
import { registerMemberTwinRoutes } from './routes/member-twin.js'
import { registerFamilyContinuityRoutes } from './routes/family-continuity.js'
import { registerFamilyCashflowRoutes } from './routes/family-cashflow.js'
import { registerFamilyAssetRoutes } from './routes/family-assets.js'
import { registerFamilyLegacyRoutes } from './routes/family-legacy.js'
import { registerLeadRoutes } from './routes/leads.js'
import { registerHeartbeatUnsubscribeRoutes } from './routes/heartbeat-unsubscribe.js'
import { registerShareRoutes } from './routes/share.js'
import { registerSendgridWebhookRoutes } from './routes/webhooks-sendgrid.js'
import { sendOpsAlert } from './operator/ops-alerts.js'
import { registerFamilySignalSchemas } from './family/family-signal-schemas.js'

// Inject the connector schema registry so the engine can validate event schema compatibility.
setSchemaRegistry(connectorSchemaRegistry)
// Register family.* signal schemas so persistSignal's validation doesn't
// log "No schema registered" for every financial-profile evaluation.
registerFamilySignalSchemas()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../..')

// ─── Bootstrap ────────────────────────────────────────────────────────────────

await initTelemetry('lifekeel-api')

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
if (process.env['LIFEKEEL_LICENSE_KEY'] && process.env['LIFEKEEL_LICENSE_PUBLIC_KEY']) {
  const license = await validateLicenseKey(
    process.env['LIFEKEEL_LICENSE_KEY'],
    process.env['LIFEKEEL_LICENSE_PUBLIC_KEY'],
  )
  if (license.expired && !license.grace_period) process.env['LIFEKEEL_EDITION'] = 'busl'
}
// LLM access is task-governed (intent 01): every model call resolves a
// policy from definitions/ai-tasks.yaml via taskLlmFor/taskDecideFor.

// MongoDB-backed app database (shares the singleton client from db.ts) —
// "workflowDb" is a legacy name from before the workflow engine was removed;
// it's really just the app's main Db handle, used throughout this file.
import { getMongoClient, closeDb } from './db.js'
let workflowDb!: import('mongodb').Db
let deliveryRouter: DeliveryRouter | undefined

try {
  const mongoClient = await getMongoClient()
  workflowDb = mongoClient.db(process.env['MONGODB_DB'] ?? 'lifekeel')
  // Load the AI task registry before any model path is wired — production
  // fails closed on unknown task_ids from here on (intent 01).
  initTaskGateway(workflowDb)
  // Self-hosted judge model (infra/local-judge): when configured, no insight text
  // is sent to a cloud LLM and the judge spends no tokens.
  const localModelConfigured = Boolean(process.env['LOCAL_JUDGE_BASE_URL'])
  log.info(
    {
      judge: localModelConfigured
        ? process.env['JUDGE_SHADOW'] === 'true'
          ? 'cloud-with-local-shadow'
          : 'local'
        : 'llm',
    },
    'Move judge backend',
  )
  deliveryRouter = new DeliveryRouter(
    workflowDb,
    createMoveJudge(
      taskLlmFor('insight.delivery_judge.v1'),
      workflowDb,
      taskDecideFor('insight.delivery_judge.v1', localDecisionFromEnv('judge')),
      {
        shadow: process.env['JUDGE_SHADOW'] === 'true',
      },
    ),
  )
  // KEEL-003: every cron.schedule job below runs under this lock, keyed by
  // its own name — deploy-api.yml allows up to 4 Cloud Run replicas, and
  // without this, two replicas racing the same job could both act on the
  // same overdue insight/expiring credential and double-fire it.
  await ensureCronLockIndex(workflowDb)
  await ensureSpendIndexes(workflowDb)

  // One-time cleanup: archive stale pre-fix insight records (A1/A2/A3
  // patterns) that are still live on Home. Runs in the background —
  // doesn't block startup. Safe to run multiple times (idempotent).
  cleanupStaleInsightsStartup(workflowDb).catch((err) =>
    log.error({ err }, 'Startup stale-insight cleanup failed'),
  )

  // ── Connector sync engine — polling + token refresh ───────────────────────
  // Wires connector-driven insights into the same DeliveryRouter used for
  // goal-progress insights — a live sync reaches the tenant (WhatsApp/SMS/
  // email, with a signed approve/dismiss link) without them needing to poll
  // the app. The workflow-triggering half of this callback (matching an
  // insight's detector to a workflow YAML and enqueueing it) was removed
  // 2026-09-12 along with the rest of the dead WorkflowEngine/WorkflowLoader
  // machinery — see ARCHITECTURE.md.

  const syncEngine = new ConnectorSyncEngine(
    workflowDb as any,
    eventGenerator,
    engine,
    async (insights, tenantId) => {
      if (!deliveryRouter) return
      await Promise.allSettled(
        insights.map((insight) =>
          deliveryRouter!.deliver(insight as unknown as Record<string, unknown>, tenantId),
        ),
      )
    },
  )

  // Token refresh every 10 minutes — refreshes tokens expiring within 30 min

  const tokenRefresher = new TokenRefreshScheduler(workflowDb as any)
  tokenRefresher.start(10 * 60 * 1000)
  log.info({}, 'Token refresh scheduler started')

  // Connector poll every 15 minutes — incremental sync of all connected tenants
  cron.schedule(
    '*/15 * * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'connector-sync', () =>
          syncEngine.pollAll(connectorLoader.list()),
        )
      } catch (err) {
        log.error({ err }, 'Connector poll failed')
      }
    },
    { missedExecutionTolerance: 30_000, noOverlap: true },
  )
  log.info({}, 'Connector sync cron started')

  // Connector credential-health alert — runs shortly after each poll so tenants
  // are notified immediately when an API key expires or is revoked in the
  // background. Creates a deduplicated high-urgency insight per tenant+connector.
  cron.schedule(
    '*/15 * * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'connector-health', async () => {
          await createCredentialExpiryInsights({ db: workflowDb, lookbackMs: 20 * 60 * 1000 })
        })
      } catch (err) {
        log.error({ err }, 'Connector health alert failed')
      }
    },
    { missedExecutionTolerance: 30_000 },
  )
  log.info({}, 'Connector health alert cron started')

  // Email connector scan every 15 minutes — classifies new mail on every
  // connected mailbox (any IMAP provider) into Inbox items, and routes
  // document-like attachments through the same OCR pipeline manual uploads
  // use. Also triggered on-demand right after connecting (see
  // family-connectors.ts) and via POST /connectors/email/scan.
  // Opt-in (EMAIL_SCAN_FANOUT=true): one queue job per mailbox so scans run in parallel
  // across workers instead of one after another (see jobs/email-scan.ts).
  const emailScanFanout = process.env['EMAIL_SCAN_FANOUT'] === 'true'
  cron.schedule(
    '*/15 * * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'email-scan', () =>
          emailScanFanout
            ? // Fan-out: this tick only enqueues (fast); workers below do the scans in parallel.
              // allowInline: a scan is idempotent and re-runnable — losing one
              // fan-out to a crash costs nothing durable.
              enqueueConnectedInboxScans(workflowDb, (q, p) =>
                queueManager.publish(q, p, { allowInline: true }),
              ).then(() => undefined)
            : scanAllConnectedInboxes(workflowDb),
        )
      } catch (err) {
        log.error({ err }, 'Email scan cron failed')
      }
    },
    { missedExecutionTolerance: 30_000, noOverlap: true },
  )
  log.info({}, 'Email scan cron started')

  // Retry documents whose local OCR/extraction failed (status 'error'). Only
  // relevant when the self-hosted model is configured; bounded per document by
  // MAX_DOCUMENT_ATTEMPTS and per sweep by SWEEP_LIMIT (see ocr/retry-failed.ts).
  if (localModelConfigured) {
    cron.schedule(
      '*/10 * * * *',
      async () => {
        try {
          await withCronLock(workflowDb, 'document-ocr-retry', () =>
            retryFailedDocuments(
              workflowDb,
              taskDecideFor('document.extract.v1', localDecisionFromEnv('ocr')),
              (tenantId) => taskVision('document.extract.v1', tenantId),
            ),
          )
        } catch (err) {
          log.error({ err }, 'Document OCR retry cron failed')
        }
      },
      { missedExecutionTolerance: 30_000, noOverlap: true },
    )
    log.info({}, 'Document OCR retry cron started')
  }

  // Marketing publish sweep — every minute. Channels can't hold schedules,
  // so approved posts with a due scheduled_at are dispatched here; the lock
  // plus the 'publishing' claim guard against double-posting.
  cron.schedule(
    '* * * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'marketing-publish', async () => {
          await publishDueMarketingPosts(
            workflowDb,
            new DbSocialPublisher(workflowDb, socialPublisherFromEnv()),
          )
        })
      } catch (err) {
        log.error({ err }, 'Marketing publish sweep failed')
      }
    },
    { missedExecutionTolerance: 30_000, noOverlap: true },
  )
  log.info({}, 'Marketing publish cron started')

  // Daily draft generation — queues one AI draft per opted-in tenant for
  // review. Never publishes; it only fills the morning review queue.
  cron.schedule(
    '23 8 * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'marketing-generate', async () => {
          await generateDailyMarketingDrafts(workflowDb, taskLlmFor('marketing.social_draft.v1'))
        })
      } catch (err) {
        log.error({ err }, 'Marketing draft generation failed')
      }
    },
    { missedExecutionTolerance: 3_600_000 },
  )
  log.info({}, 'Marketing draft generation cron started')

  // Engagement polling — hourly; refreshes like/repost/reply counts on
  // published posts where the channel exposes public metrics (Bluesky).
  cron.schedule(
    '17 * * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'marketing-engagement', async () => {
          await pollMarketingEngagement(workflowDb)
        })
      } catch (err) {
        log.error({ err }, 'Marketing engagement sweep failed')
      }
    },
    { missedExecutionTolerance: 600_000 },
  )

  // Daily metrics rollup — hourly at :40. Recomputes today + yesterday
  // (late-arriving events) into metrics_daily; first run backfills 90 days.
  // Operator dashboards read the rollup instead of scanning raw events.
  cron.schedule(
    '40 * * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'metrics-rollup', async () => {
          const summary = await runMetricsRollup(workflowDb)
          log.info({ ...summary }, 'Metrics rollup run')
        })
      } catch (err) {
        log.error({ err }, 'Metrics rollup failed')
      }
    },
    { missedExecutionTolerance: 1_800_000 },
  )
  log.info({}, 'Metrics rollup cron started')

  // Autopilot sweep — hourly. Evaluates only enabled, off-cooldown Tier 0/1
  // rules; each act writes an autopilot_actions ledger row (dedup-keyed so a
  // target is never touched twice) plus an operator_audit_log entry under
  // actor 'autopilot'. All rules default off — this cron is inert until an
  // operator enables one.
  cron.schedule(
    '50 * * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'autopilot-sweep', async () => {
          const actions = await runAutopilotSweep(workflowDb)
          if (actions.length > 0) {
            log.info(
              { count: actions.length, rules: [...new Set(actions.map((a) => a.rule))] },
              'Autopilot sweep',
            )
          }
        })
      } catch (err) {
        log.error({ err }, 'Autopilot sweep failed')
      }
    },
    { missedExecutionTolerance: 1_800_000 },
  )
  log.info({}, 'Autopilot sweep cron started')

  // Weekly operator digest — Mondays 08:30. Persisted to operator_digests
  // and posted to the ops Slack channel (best-effort, never throws).
  cron.schedule(
    '30 8 * * 1',
    async () => {
      try {
        await withCronLock(workflowDb, 'weekly-digest', async () => {
          const digest = await runWeeklyDigest(workflowDb)
          log.info({ id: digest.id }, 'Weekly operator digest')
        })
      } catch (err) {
        log.error({ err }, 'Weekly digest failed')
      }
    },
    { missedExecutionTolerance: 3_600_000 },
  )
  log.info({}, 'Weekly digest cron started')

  // Lifecycle email sweep — hourly at :25. Lead nurture, activation and
  // upgrade nudges; consent/suppression/marketing_paused gated, ledger-deduped.
  cron.schedule(
    '25 * * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'lifecycle-sweep', async () => {
          const sent = await runLifecycleSweep(workflowDb)
          if (sent.length > 0) log.info({ count: sent.length }, 'Lifecycle emails sent')
        })
      } catch (err) {
        log.error({ err }, 'Lifecycle sweep failed')
      }
    },
    { missedExecutionTolerance: 1_800_000 },
  )
  log.info({}, 'Lifecycle email cron started')

  // Policy renewal reminders — hourly. Tier 3 autonomy: deterministic,
  // deduped, consent re-checked at send time, push-only to the member's
  // own devices. Hourly (not daily) so a reminder deferred by quiet hours
  // still goes out later the same day instead of waiting a full cycle.
  if (deliveryRouter) {
    const dr = deliveryRouter
    await ensureReminderIndexes(workflowDb)
    cron.schedule(
      '17 * * * *',
      async () => {
        try {
          await withCronLock(workflowDb, 'policy-renewal-reminders', async () => {
            const summary = await runPolicyRenewalReminders(workflowDb, (tenantId, reminder) =>
              dr.deliverReminder(tenantId, reminder),
            )
            if (summary.sent > 0 || summary.failed > 0) {
              log.info({ ...summary }, 'Policy renewal reminder run')
            }
          })
        } catch (err) {
          log.error({ err }, 'Policy renewal reminder run failed')
        }
      },
      { missedExecutionTolerance: 60_000 },
    )
    log.info({}, 'Policy renewal reminder cron started')
  }

  // Member agent loop — daily at 07:15. Rebuilds every member twin and
  // reconciles the agent's nudges into member_nudges, so proactive member
  // guidance exists even when nobody opens the page. Write-only state —
  // no notifications are delivered (Tier 0, deterministic).
  await ensureMemberNudgeIndexes(workflowDb)
  cron.schedule(
    '15 7 * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'member-agent-loop', async () => {
          const summary = await runMemberAgentLoop(workflowDb)
          if (summary.failed > 0)
            log.warn({ ...summary }, 'Member agent loop completed with failures')
        })
      } catch (err) {
        log.error({ err }, 'Member agent loop failed')
      }
    },
    { missedExecutionTolerance: 3_600_000, noOverlap: true },
  )
  log.info({}, 'Member agent loop cron started')

  // Continuity check — daily at 07:45 (after the agent loop). Advances the
  // watching → check_in_sent → alerted state machine for families whose
  // organizer enabled the switch. Email-only; the state machine itself is
  // the guarantee against double-sends.
  await ensureContinuityIndexes(workflowDb)
  cron.schedule(
    '45 7 * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'continuity-check', async () => {
          await runContinuityCheck(workflowDb)
        })
      } catch (err) {
        log.error({ err }, 'Continuity check failed')
      }
    },
    { missedExecutionTolerance: 3_600_000 },
  )
  log.info({}, 'Continuity check cron started')

  // Checklist reminder — Tier 3, daily at 08:10. Nudges the reporting user
  // (only — see checklist-reminder.ts) when a bereavement/disability/
  // medical life event they reported 3+ days ago still has unchecked
  // response-plan steps. One email ever per event, same dedupe shape as
  // vault-reminder.ts.
  cron.schedule(
    '10 8 * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'checklist-reminder', async () => {
          const sent = await runChecklistReminderSweep(workflowDb)
          if (sent > 0) log.info({ sent }, 'Checklist reminder sweep')
        })
      } catch (err) {
        log.error({ err }, 'Checklist reminder sweep failed')
      }
    },
    { missedExecutionTolerance: 3_600_000 },
  )
  log.info({}, 'Checklist reminder cron started')

  // Family heartbeat — PRD-136 §4. Weekly Monday 08:00 and monthly on the
  // 1st 08:00; sends one "what moved" email per active adult roster member
  // for each tenant whose heartbeat_cadence matches. Idempotent per
  // (tenant, member, window) via heartbeat_sends, so a retried run sends
  // nothing twice.
  for (const [name, schedule, cadence] of [
    ['family-heartbeat-weekly', '0 8 * * 1', 'weekly'],
    ['family-heartbeat-monthly', '0 8 1 * *', 'monthly'],
  ] as const) {
    cron.schedule(
      schedule,
      async () => {
        try {
          await withCronLock(workflowDb, name, async () => {
            const r = await runFamilyHeartbeat(workflowDb, { cadence })
            if (r.sent > 0) log.info({ cadence, ...r }, 'Family heartbeat sent')
            if (r.failed > 0) log.error({ cadence, ...r }, 'Family heartbeat missed deliveries')
          })
        } catch (err) {
          log.error({ err, cadence }, 'Family heartbeat sweep failed')
        }
      },
      { missedExecutionTolerance: 3_600_000 },
    )
    log.info({ schedule, cadence }, 'Family heartbeat cron started')
  }

  // Trading (auto-trade confirmation, reconciliation, momentum rebalance)
  // and workflow-approval-timeout sweeps removed — LifeKeel has no trading
  // vertical and no workflow engine to create approval gates in the first
  // place. See SECURITY.md for the full list of what was trimmed.

  // ── Daily digest delivery — batch low/medium insights into a summary ──────
  // Runs at 08:00 daily; sends each tenant their queued insights as one email.
  if (deliveryRouter) {
    const dr = deliveryRouter
    cron.schedule(
      '0 8 * * *',
      async () => {
        try {
          await withCronLock(workflowDb, 'daily-digest', async () => {
            const tenants = await workflowDb
              .collection('digest_queue')
              .distinct('tenant_id', { sent: false })
            for (const tenantId of tenants) {
              await dr.sendDigest(tenantId as string)
            }
          })
        } catch (err) {
          log.error({ err }, 'Daily digest failed')
        }
      },
      { missedExecutionTolerance: 60_000 },
    )
    log.info({}, 'Daily digest cron started')
  }

  // ── Calibration drift alerting — 2 AM nightly ────────────────────────────
  // Compares per-detector ECE against previous run; alerts when ECE > 0.10 or
  // increases by > 0.05 since last check.
  cron.schedule(
    '0 2 * * *',
    async () => {
      if (!scoreCalibrator) return
      const lockOwner = await acquireCronLock(workflowDb, 'calibration-drift')
      if (!lockOwner) return
      try {
        const histCol = workflowDb.collection('calibration_ece_history')
        const alertCol = workflowDb.collection('calibration_alerts')
        const now = new Date()

        const tenantIds = await workflowDb.collection('calibration_params').distinct('tenant_id')
        for (const tenantIdValue of tenantIds) {
          const tenantId = String(tenantIdValue)
          const allParams = await scoreCalibrator.getAllParams(tenantId)
          for (const p of allParams) {
            const prev = (await histCol.findOne({
              tenant_id: tenantId,
              detector_id: p.detector_id,
            })) as { ece: number } | null
            const previousEce = prev?.ece ?? 0
            const eceDelta = p.ece - previousEce

            if (p.ece > 0.1 || eceDelta > 0.05) {
              log.warn({ detector_id: p.detector_id, ece: p.ece }, 'ECE drift alert')
              await alertCol.insertOne({
                tenant_id: tenantId,
                detector_id: p.detector_id,
                ece: p.ece,
                previous_ece: previousEce,
                brier_score: p.brier_score,
                active_calibrator: p.active_calibrator,
                alerted_at: now,
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
      } finally {
        await releaseCronLock(workflowDb, 'calibration-drift', lockOwner)
      }
    },
    { missedExecutionTolerance: 60_000 },
  )
  log.info({}, 'Calibration drift cron started')

  // ── Erasure replay — 4:30 AM daily ─────────────────────────────────────────
  // Backup↔erasure reconciliation (intent 04): a restore taken before an
  // account deletion can resurrect the tenant's rows — and their tombstone.
  // Re-wiping every status:'deleted' tenant makes the erasure durable across
  // restores. Idempotent and a no-op when nothing is tombstoned.
  cron.schedule(
    '30 4 * * *',
    async () => {
      await withCronLock(workflowDb, 'erasure-replay', async () => {
        const { runErasureReplay } = await import('./jobs/erasure-replay.js')
        await runErasureReplay(workflowDb)
      })
    },
    { missedExecutionTolerance: 60_000 },
  )
  log.info({}, 'Erasure replay cron started')

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
  cron.schedule(
    '0 3 * * *',
    async () => {
      if (!scoreCalibrator) return
      const lockOwner = await acquireCronLock(workflowDb, 'calibration-fit')
      if (!lockOwner) return
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
          const receipts = (await receiptsCol
            .find({
              tenant_id: tenantId,
              executed_at: { $gte: cutoff },
            })
            .toArray()) as unknown as Array<{
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
              const insight = (await workflowDb
                .collection('insights')
                .findOne(
                  { id: r.insight_id, tenant_id: tenantId },
                  { projection: { 'confidence_breakdown.combined_score': 1, confidence: 1 } },
                )) as Record<string, unknown> | null
              const breakdown = insight?.['confidence_breakdown'] as
                Record<string, number> | undefined
              rawScore =
                breakdown?.['combined_score'] ?? (insight?.['confidence'] as number | undefined)
            }
            if (typeof rawScore !== 'number') continue
            const pair = {
              raw_score: rawScore,
              outcome: (r.outcome === 'approved' || r.outcome === 'auto_approved' ? 1 : 0) as 0 | 1,
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
              const longReceipts = (await receiptsCol
                .find({
                  tenant_id: tenantId,
                  detector_id: detectorId,
                  executed_at: { $gte: longCutoff, $lt: cutoff },
                })
                .toArray()) as unknown as Array<{
                outcome: string
                metadata?: { insight_score?: number }
                insight_id?: string
              }>
              const extraPairs: Array<{ raw_score: number; outcome: 0 | 1 }> = []
              for (const r of longReceipts) {
                if (r.outcome === 'policy_blocked' || r.outcome === 'budget_blocked') continue
                let longScore: number | undefined = r.metadata?.insight_score
                if (typeof longScore !== 'number' && r.insight_id && workflowDb) {
                  const insight = (await workflowDb
                    .collection('insights')
                    .findOne(
                      { id: r.insight_id, tenant_id: tenantId },
                      { projection: { 'confidence_breakdown.combined_score': 1, confidence: 1 } },
                    )) as Record<string, unknown> | null
                  const breakdown = insight?.['confidence_breakdown'] as
                    Record<string, number> | undefined
                  longScore =
                    breakdown?.['combined_score'] ?? (insight?.['confidence'] as number | undefined)
                }
                if (typeof longScore !== 'number') continue
                extraPairs.push({
                  raw_score: longScore,
                  outcome: (r.outcome === 'approved' || r.outcome === 'auto_approved' ? 1 : 0) as
                    0 | 1,
                })
              }
              if (extraPairs.length > 0) {
                finalPairs = [...extraPairs, ...pairs]
                log.info(
                  {
                    tenant_id: tenantId,
                    detector_id: detectorId,
                    short_pairs: pairs.length,
                    long_pairs: extraPairs.length,
                  },
                  'Calibration window expanded for low-volume detector',
                )
              }
            }

            await scoreCalibrator.fit(tenantId, detectorId, finalPairs)
            log.info(
              { tenant_id: tenantId, detector_id: detectorId, pairs: finalPairs.length },
              'Calibration fitting completed',
            )
          }
        }
      } catch (err) {
        log.error({ err }, 'Calibration fitting cron failed')
      } finally {
        await releaseCronLock(workflowDb, 'calibration-fit', lockOwner)
      }
    },
    { missedExecutionTolerance: 60_000 },
  )
  log.info({}, 'Calibration fitting cron started (nightly 3 AM)')

  // Federated learning round removed — cross-tenant model aggregation isn't
  // relevant to a single-vertical family app, and requires a min-20-tenant
  // cohort to run at all.

  // ── Billing cron — daily at 4 AM ──────────────────────────────────────────
  // Handles outcome charge settlement (H3), trial expiration (H5),
  // payment failure recovery (H6), and billing cycle resets (H4).
  // All jobs are idempotent — safe to run multiple times.
  cron.schedule(
    '0 4 * * *',
    async () => {
      try {
        const { runBillingCron } = await import('./jobs/billing-cron.js')
        await runBillingCron(workflowDb)
      } catch (err) {
        log.error({ err }, 'Billing cron failed')
      }
    },
    { missedExecutionTolerance: 60_000 },
  )
  log.info({}, 'Billing cron started (daily 4 AM)')

  // Goal integrity job removed — goals are dead code in LifeKeel's frontend
  // (useFamilyGoals() is defined but never rendered).

  // Social analytics polling, Universal/Intraday KPI compute, goal
  // summarisation, goal migration, and adaptive thresholds (Bollinger Band
  // recompute for invoice/payment/portfolio signal types) all removed —
  // social/goals/trading-vertical specific, none of it reachable from
  // LifeKeel. `persistAndDeliverInsights` stays: registerFamilyFinancialProfileRoutes
  // (kept) needs it as `insightsDeliveryHook`.
  const persistAndDeliverInsights = async (insights: Insight[], tenantId: string): Promise<void> =>
    persistAndDeliverInsightsCore(workflowDb, insights, tenantId, deliveryRouter)
  insightsDeliveryHook = persistAndDeliverInsights

  // Stale profile evaluation — daily at 06:30 (before the member agent
  // loop at 07:15 and continuity check at 07:45). Closes the gap where a
  // family autosaves real data across wizard steps but never clicks "Save
  // & Generate Insights" — their profile sits fully accurate and fully
  // un-evaluated otherwise. Tier 0: reuses the exact
  // evaluateProfileAndGenerateInsights() + persistAndDeliverInsights path
  // POST /family/financial-profile/evaluate already runs on demand; this
  // only adds the "someone has to remember to click it" → "guaranteed to
  // eventually happen" part.
  cron.schedule(
    '30 6 * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'stale-profile-evaluation', async () => {
          const summary = await runStaleProfileEvaluationSweep(
            workflowDb,
            engine,
            persistAndDeliverInsights,
          )
          if (summary.failed > 0)
            log.warn({ ...summary }, 'Stale profile evaluation sweep completed with failures')
        })
      } catch (err) {
        log.error({ err }, 'Stale profile evaluation sweep failed')
      }
    },
    { missedExecutionTolerance: 3_600_000, noOverlap: true },
  )
  log.info({}, 'Stale profile evaluation cron started')

  // PRD-136: nightly scenario watchlist recompute — emits scenario_moved
  // feed events when a watched scenario's runway/depletion month moves by
  // ≥0.5 months. Runs after the 06:30 stale-profile sweep so projections
  // see yesterday's freshest data.
  cron.schedule(
    '30 5 * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'scenario-watchlist', async () => {
          const summary = await runScenarioWatchlist(workflowDb)
          if (summary.moved > 0) log.info({ ...summary }, 'Scenario watchlist recomputed')
        })
      } catch (err) {
        log.error({ err }, 'Scenario watchlist failed')
      }
    },
    { missedExecutionTolerance: 3_600_000, noOverlap: true },
  )
  log.info({}, 'Scenario watchlist cron started')

  const retentionWorker = new RetentionWorker(workflowDb)
  const insightSlaWorker = new InsightSlaWorker(workflowDb)
  const escalationWorker = new EscalationWorker(workflowDb)
  await retentionWorker.ensureIndexes()
  cron.schedule(
    '0 2 * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'retention', () => retentionWorker.run())
      } catch (err) {
        log.error({ err }, 'Retention worker failed')
      }
    },
    { missedExecutionTolerance: 60_000 },
  )
  cron.schedule(
    '*/15 * * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'insight-sla-escalation', async () => {
          // KEEL-003: this previously had zero error logging at all — a bare
          // Promise.allSettled with no per-job check, unlike every other
          // cron job in this file. A rejection here (e.g. escalationWorker
          // throwing) was silently swallowed with no way to ever notice.
          const results = await Promise.allSettled([insightSlaWorker.run(), escalationWorker.run()])
          const names = ['insightSlaWorker', 'escalationWorker']
          results.forEach((result, i) => {
            if (result.status === 'rejected') {
              log.error({ job: names[i], err: result.reason }, 'Insight SLA/escalation job failed')
            }
          })
          // The escalation worker only claims insights and queues
          // delivery_queue rows — drainDeliveryQueue is the missing consumer
          // that actually sends them. Runs in the same lock cycle so an
          // escalation queued this tick goes out this tick.
          if (deliveryRouter) {
            try {
              const drained = await deliveryRouter.drainDeliveryQueue()
              if (drained.sent > 0 || drained.failed > 0) {
                log.info({ ...drained }, 'Delivery queue drained')
              }
            } catch (err) {
              log.error({ err }, 'Delivery queue drain failed')
            }
            // Judge review queues — passesMoveJudge writes, drainReviewQueues
            // consumes: retries due rewrites, re-evaluates blocks, resolves
            // rows whose insights went terminal another way.
            try {
              const reviewed = await deliveryRouter.drainReviewQueues()
              if (reviewed.retried > 0 || reviewed.released > 0 || reviewed.resolved > 0) {
                log.info({ ...reviewed }, 'Judge review queues drained')
              }
            } catch (err) {
              log.error({ err }, 'Judge review queue drain failed')
            }
          }
          // Trusted-scope auto-execution — spends the trust approvals earned.
          // Opt-in + trust threshold + log_only-only + grace period all gate
          // inside the worker; nothing external can ever dispatch from here.
          try {
            const { runAutoExecuteTrusted } = await import('./jobs/auto-execute-trusted.js')
            const auto = await runAutoExecuteTrusted(workflowDb)
            if (auto.executed > 0 || auto.failed > 0) {
              log.info({ ...auto }, 'Trusted-scope auto-execution completed')
            }
          } catch (err) {
            log.error({ err }, 'Trusted-scope auto-execution failed')
          }
        })
      } catch (err) {
        log.error({ err }, 'Insight SLA/escalation cron failed')
      }
    },
    { missedExecutionTolerance: 60_000 },
  )

  // Shadow backtest cron removed — trading-vertical only (DTFE engine paper
  // trading against market price history).

  // FeatureHashScorer offline eval — computes precision/recall/AUC/
  //    calibration for the online-learning layer against held-out
  //    approve/dismiss history. Runs at 7 AM every Monday.
  //    Persists per-detector reports to `feature_hash_eval_reports`.
  cron.schedule(
    '0 7 * * 1',
    async () => {
      try {
        await withCronLock(workflowDb, 'feature-hash-eval', async () => {
          const { runFeatureHashEval } = await import('./jobs/feature-hash-eval.js')
          const reports = await runFeatureHashEval(workflowDb)
          if (reports.length > 0) {
            log.info({ detectors: reports.length }, 'FeatureHashScorer eval complete')
          }
        })
      } catch (err) {
        log.error({ err }, 'FeatureHashScorer eval failed')
      }
    },
    { missedExecutionTolerance: 60_000 },
  )
  log.info({}, 'FeatureHashScorer eval cron started (weekly Mon 7 AM)')

  // ── Queue setup ───────────────────────────────────────────────────────────
  await queueManager.connect()
  startWebhookWorker(engine, connectorLoader, eventGenerator, workflowDb, deliveryRouter)
  if (emailScanFanout) {
    // Per-process concurrency; total parallelism is this x replicas. Size it with the
    // model service: each in-flight scan can hold one local-model call (see
    // LOCAL_MODEL_MAX_CONCURRENT and the lifekeel_local_model_queue_wait_seconds metric).
    const scanConcurrency = Number(process.env['EMAIL_SCAN_CONCURRENCY']) || 2
    queueManager.subscribe(EMAIL_SCAN_QUEUE, (payload) => runQueuedInboxScan(workflowDb, payload), {
      concurrency: scanConcurrency,
    })
    log.info({ concurrency: scanConcurrency }, 'Email scan fan-out workers started')
  }
  log.info({}, 'Queue manager connected')

  // ── Score calibration ─────────────────────────────────────────────────────
  // Loads per-detector temperature params into memory; calibrateSync() is then
  // zero-latency on the hot evaluation path.
  scoreCalibrator = new ScoreCalibrator(workflowDb)
  await scoreCalibrator.warmCache()
  // Wire calibrator into engine now that it's ready
  engine.options.calibrator = scoreCalibrator
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
  const llmScorer = new ApiLlmScorer(workflowDb, taskLlmFor('insight.score_enrichment.v1'), {
    cache: llmCache,
    budgetGuard,
    disagreementThreshold: 0.15,
    concurrency: 5,
  })
  engine.options.llmScorer = llmScorer
  log.info(
    {},
    'LLM scorer ready (per-tenant opt-in via tenant_settings:llm_scoring_config, with cache + budget guard)',
  )

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
    log.warn(
      { err: (err as Error).message },
      'Local embeddings unavailable — Tier 2 disabled, falling back to trie + LLM only',
    )
  }
  // No live classify() callers exist — the Tier-3 LLM fallback therefore
  // gets no fn rather than an ungoverned one (intent 01 tripwire).
  intentClassifier = new IntentClassifier({
    db: workflowDb,
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
  tenantLevelScorer = new TenantLevelScorer(workflowDb, { maxLoadedTenants: 200 })

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
    const docs = (await workflowDb
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
  // Default: track amount_minor + customer_id novelty for all invoice/payment events
  engine.options.noveltyFields = {
    'invoice.overdue': ['data.amount_minor', 'data.customer_id'],
    'payment.failed': ['data.amount_minor', 'data.customer_id'],
    'payment.received': ['data.amount_minor'],
    'cart.abandoned': ['data.cart_value_minor', 'data.customer_id'],
    '*': ['data.amount_minor'],
  }
  engine.options.changePointFields = {
    'revenue.daily': ['data.revenue_minor', 'data.order_count'],
    'invoice.overdue': ['data.amount_minor', 'data.days_overdue'],
    '*': ['data.amount_minor'],
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
  log.error(
    { detectorsDir: path.join(ROOT, 'detectors') },
    'FATAL: engine loaded zero detectors — detectors/ directory is missing or empty. Refusing to start.',
  )
  process.exit(1)
}
if (process.env['NODE_ENV'] === 'production' && connectorLoader.count === 0) {
  log.error(
    { connectorsDir: path.join(ROOT, 'connectors') },
    'FATAL: connector loader loaded zero connectors — connectors/ directory is missing or empty. Refusing to start.',
  )
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
// In production set CORS_ORIGIN to the app's exact origin(s) — comma-separated
// list allowed (e.g. "https://app.lifekeel.co.uk,https://app.lifekeel.si"),
// matching the split session-cookie.ts applies for its Origin allowlist.
// Wildcard is only used in dev/test; cloud mode enforces the env var.
const corsOrigin =
  deploymentConfig.mode === 'cloud'
    ? (process.env['CORS_ORIGIN']
        ?.split(',')
        .map((o) => o.trim())
        .filter(Boolean) ?? false)
    : true
await app.register(cors, {
  origin: corsOrigin,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  // Required for the httpOnly session cookie to ride credentialed
  // cross-origin fetches (web app on Firebase → API on Cloud Run).
  credentials: true,
})

// HttpOnly session-cookie support — token lookup falls back to
// `lifekeel_session` when no Bearer header is present (see
// lib/session-cookie.ts and the auth hook below).
await app.register(cookie)

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
      title: 'LifeKeel API',
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
  allowList: (req) =>
    req.url === '/health' || req.url === '/engine/health' || req.url.startsWith('/documentation'),
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
  // PRD-110: '/family/join' is deliberately NOT a prefix of the organizer-only
  // '/family/access-requests*' endpoints below — this array is matched by
  // startsWith, so '/family/join-requests' would have made those public too.
  const open = [
    '/health',
    '/engine/health',
    '/status',
    '/metrics',
    '/auth/token',
    '/auth/demo-token',
    '/auth/signup',
    '/auth/login',
    '/auth/logout',
    '/auth/mfa/verify',
    '/auth/sso/',
    '/auth/google/',
    '/auth/github/',
    '/auth/request-password-reset',
    '/auth/reset-password',
    '/auth/verify-email',
    '/auth/resend-verification',
    '/entitlements/plans',
    '/blog/posts',
    '/a/',
    '/why/',
    '/verify/',
    '/webhooks/',
    '/inbound/',
    '/insights/cleanup-stale-all',
    '/billing/webhook',
    '/documentation',
    '/documentation/json',
    '/documentation/uiOptions',
    '/documentation/static',
    '/growth/events',
    '/readiness-quiz',
    '/leads',
    '/users/unsubscribe',
    '/heartbeat/unsubscribe',
    '/share/',
    '/family/join',
    '/family/invite/',
  ]
  if (/^\/connectors\/[^/]+\/oauth\/callback/.test(request.url)) return
  if (/^\/auth\/(google|github)\/callback/.test(request.url)) return
  if (/^\/auth\/(google|github)\/exchange/.test(request.url)) return
  if (open.some((p) => request.url.startsWith(p))) {
    // Dual-mode open routes (e.g. /auth/resend-verification) behave
    // differently when a valid Bearer token rides along — authenticate it
    // opportunistically instead of dropping it. A bad/absent token just
    // falls through to the route's public path; only a request that would
    // have been auth-gated anyway should ever see 401 here.
    const bearer = extractBearerToken(request.headers.authorization)
    const opportunistic = bearer ?? readSessionCookie(request)
    if (opportunistic) {
      try {
        request.authContext = await auth.verify(opportunistic)
      } catch {
        /* stay on the public path */
      }
    }
    return
  }

  // Bearer wins when both are present — an explicit header is always a
  // deliberate credential; the cookie is the ambient browser session.
  const bearer = extractBearerToken(request.headers.authorization)
  const token = bearer ?? readSessionCookie(request)
  if (!token) return reply.status(401).send({ error: 'Missing Bearer token' })

  // SameSite=None cookies ride cross-site requests, so cookie-authed
  // mutations need the Origin allowlist as the CSRF boundary (bearer-auth
  // requests can't be forged cross-origin and skip the check entirely).
  if (!bearer && !isOriginAllowedForCookieAuth(request)) {
    return reply.status(403).send({ error: 'Origin not allowed' })
  }

  try {
    const ctx = await auth.verify(token)
    // MFA pending tokens are only exchangeable at /auth/mfa/verify — they
    // must never function as session credentials anywhere else.
    if (ctx.mfa_pending) return reply.status(401).send({ error: 'MFA verification required' })
    let authedUser: Record<string, unknown> | null = null
    if (workflowDb) {
      const user = await workflowDb
        .collection('users')
        .findOne(
          { tenant_id: ctx.tenant_id, id: ctx.user_id },
          { projection: { status: 1, sessions_revoked_at: 1, last_seen_at: 1 } },
        )
      authedUser = user
      if (user?.['status'] === 'suspended')
        return reply.status(401).send({ error: 'User suspended' })
      // Operator session revocation: reject tokens issued before
      // sessions_revoked_at. JWT iat is seconds; <= guards a token minted
      // in the same second the revocation landed.
      const revokedAt = user?.['sessions_revoked_at'] as Date | undefined
      if (revokedAt && ctx.iat !== undefined && ctx.iat <= Math.floor(revokedAt.getTime() / 1000)) {
        return reply.status(401).send({ error: 'Session revoked' })
      }

      // Operator-controlled maintenance mode: everything except the
      // operator console routes gets a 503 — operators must stay able to
      // reach the API or the flag couldn't be turned back off.
      if (!request.url.startsWith('/operator/')) {
        const config = await getPlatformConfig(workflowDb)
        if (config.maintenance_mode)
          return reply.status(503).send({ error: 'Maintenance mode — try again shortly' })
      }
    }
    request.authContext = ctx

    // PRD-130: heartbeat for the continuity switch — throttled to one
    // write per hour per user so an active session costs almost nothing
    // but a silent organizer is still detectable. Fire-and-forget: a
    // missed beat skews the inactivity clock by an hour at most, never
    // blocks a request.
    if (workflowDb && ctx.user_id) {
      const lastSeen = authedUser?.['last_seen_at'] as Date | undefined
      if (!lastSeen || Date.now() - lastSeen.getTime() > 60 * 60 * 1000) {
        workflowDb
          .collection('users')
          .updateOne(
            { tenant_id: ctx.tenant_id, id: ctx.user_id },
            { $set: { last_seen_at: new Date() } },
          )
          .catch(() => {})
      }
    }

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
    if (resource && !canPerform(ctx.roles, resource, action))
      return reply.status(403).send({ error: `Forbidden: cannot ${action} ${resource}` })
    if (deploymentConfig.mode !== 'dev') {
      const tenant = await workflowDb.collection('tenants').findOne({
        $or: [{ tenant_id: ctx.tenant_id }, { id: ctx.tenant_id }],
        status: { $in: ['active', 'trial'] },
      })
      if (!tenant) return reply.status(403).send({ error: 'Tenant is not provisioned or active' })
      const quotaResource =
        request.method === 'POST' && request.url.startsWith('/events') ? 'events' : null
      if (quotaResource) {
        try {
          await enforceQuota(workflowDb, ctx.tenant_id, quotaResource)
        } catch (error) {
          if (error instanceof QuotaExceededError)
            return reply.header('Retry-After', '86400').status(429).send({
              error: error.message,
              resource: error.resource,
              used: error.used,
              limit: error.limit,
              upgrade_required: true,
            })
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
  const map: Record<string, ProductResource> = {
    insights: 'insights',
    goals: 'goals',
    outcomes: 'goals',
    detectors: 'detectors',
    connectors: 'connectors',
    analytics: 'analytics',
    team: 'users',
    settings: 'settings',
    account: 'settings',
    reminders: 'insights',
    export: 'audit',
    'audit-log': 'audit',
  }
  return segment ? (map[segment] ?? null) : null
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
app.post<{ Body: { tenant_id: string; user_id?: string } }>(
  '/auth/token',
  async (request, reply) => {
    if (process.env['NODE_ENV'] === 'production' && !process.env['ALLOW_DEMO_TOKENS']) {
      return reply.status(403).send({ error: 'Demo tokens disabled in production' })
    }
    const { tenant_id, user_id = 'studio_user' } = request.body
    if (!tenant_id) return reply.status(400).send({ error: 'tenant_id required' })
    const token = await auth.sign({ sub: user_id, tenant_id, roles: ['admin'] })
    return reply.send({ token, tenant_id, expires_in: '7d' })
  },
)

/** POST /auth/logout — clears the httpOnly session cookie. Deliberately on
 *  the open-routes list: a logout must succeed even with an expired/invalid
 *  session, and clearing a cookie is harmless to call without auth. Bearer
 *  clients are unaffected (they just drop their token client-side). */
app.post('/auth/logout', async (_request, reply) => {
  clearSessionCookie(reply)
  return reply.send({ ok: true })
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
  const token = await auth.sign({
    sub: 'demo_user',
    tenant_id: 'acme-corp',
    roles: ['admin'],
    demo: true,
  })
  return reply.send({
    token,
    tenant_id: 'acme-corp',
    note: 'Demo token — do not use in production',
  })
})

/** GET / — Studio home page fallback when the Studio app is not deployed */
app.get('/', async (_request, reply) => {
  const apiUrl = process.env['API_BASE_URL'] ?? 'http://localhost:3001'
  return reply.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LifeKeel Studio</title>
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
  <h1>LifeKeel Studio</h1>
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
      const savedToken = getCookie('lifekeel_token') || token
      const savedTenant = getCookie('lifekeel_tenant') || tenant

      if (token) {
        setCookie('lifekeel_token', token, 30)
        if (tenant) setCookie('lifekeel_tenant', tenant, 30)
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
// Public product status — stays reachable during maintenance so the
// frontend can render the outage banner instead of dead pages.
registerPublicStatusRoute(app, () => workflowDb)
// Readiness-side schema checks: the canary only ever calls /health/ready,
// so migration/index state must surface HERE for the deploy gate intent 08
// describes to be real — a deploy whose migrations didn't land reports
// not_ready and never takes traffic. Index verification is cached — a
// canary shouldn't issue indexes() per collection on every hit.
let indexCheckCache: { at: number; missing: string[] } | null = null
async function criticalIndexesMissing(): Promise<string[]> {
  if (indexCheckCache && Date.now() - indexCheckCache.at < 60_000) return indexCheckCache.missing
  const { verifyCriticalIndexes } = await import('./migrate.js')
  // Fail closed: an index check that can't run reports a missing index,
  // not an empty list — a gate that silently opens on error isn't a gate.
  const missing = workflowDb ? await verifyCriticalIndexes(workflowDb) : ['<index check failed>']
  indexCheckCache = { at: Date.now(), missing }
  return missing
}

app.get('/health/ready', async (_request, reply) => {
  let mongodb = 'disconnected'
  try {
    await workflowDb.command({ ping: 1 })
    mongodb = 'connected'
  } catch {
    // reported below
  }
  let migrationVersion: string | null = null
  let pending: string[] = []
  let missingIndexes: string[] = []
  if (mongodb === 'connected') {
    const { migrationHead, pendingMigrations, migrations: expected } = await import('./migrate.js')
    migrationVersion = await migrationHead(workflowDb).catch(() => null)
    // Fail closed: an unreadable ledger reports everything pending rather
    // than nothing.
    pending = await pendingMigrations(workflowDb).catch(() => expected.map((m) => m.id))
    missingIndexes = await criticalIndexesMissing().catch(() => ['<index check failed>'])
  }
  const migrationsPending = mongodb === 'connected' && pending.length > 0
  const ready =
    mongodb === 'connected' &&
    queueManager.isAvailable() &&
    !migrationsPending &&
    missingIndexes.length === 0
  return reply.status(ready ? 200 : 503).send({
    status: ready ? 'ready' : 'not_ready',
    dependencies: {
      mongodb,
      redis: queueManager.isAvailable() ? 'connected' : 'disconnected',
      migration_version: migrationVersion ?? 'unknown',
      migration_pending: migrationsPending,
      ...(missingIndexes.length > 0 ? { missing_indexes: missingIndexes } : {}),
    },
    circuits: Object.fromEntries(
      [...getAllCircuitBreakers()].map(([key, breaker]) => [key, breaker.getState()]),
    ),
    adapter: process.env['LIFEKEEL_STORAGE_ADAPTER'] === 'sqlite' ? 'sqlite' : 'mongodb',
    mode: process.env['LIFEKEEL_STORAGE_ADAPTER'] === 'sqlite' ? 'offline' : 'cloud',
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
// Trimmed to what LifeKeel (apps/web) actually calls, plus the marketing
// surfaces (blog, case studies, growth events) that support self-serve
// growth. Everything else kairos-ai's apps/api serves — trading/property/
// social verticals, workflows/goals, SCIM, federated learning, the
// marketplace, teams — isn't reachable from LifeKeel and was removed rather
// than left dead in the route table. See SECURITY.md for the full list of
// what was dropped and why.
await registerInsightRoutes(
  app,
  engine,
  featureHashScorer,
  workflowDb,
  tenantLevelScorer,
  deliveryRouter,
)
await registerAuthUserRoutes(app, auth)
if (workflowDb) {
  await registerSocialAuthRoutes(app, auth, workflowDb)
}
if (workflowDb) {
  registerCaseStudyRoutes(app, workflowDb)
  registerConnectorCredentialRoutes(app, workflowDb, connectorLoader, eventGenerator, engine)
  registerBillingRoutes(app, workflowDb)
  registerBlogRoutes(app, workflowDb)
  registerDocumentRoutes(app, workflowDb, engine, insightsDeliveryHook)
  registerVaultRoutes(app, workflowDb, engine, insightsDeliveryHook)
  registerAuditLogRoutes(app, workflowDb)
  registerAutomationSettingsRoutes(app, workflowDb)
  registerAccountRoutes(app, workflowDb)
  registerFamilyConnectorRoutes(app, workflowDb)
  registerFamilyGroupRoutes(app, workflowDb)
  registerFamilyJoinRoutes(app, workflowDb, auth)
  registerReferralRoutes(app, workflowDb)
  registerGrowthEventRoutes(app, workflowDb)
  registerFamilyInboxRoutes(app, workflowDb, engine, insightsDeliveryHook)
  registerAssistantRoutes(app, workflowDb)
  registerSupportRoutes(app, workflowDb)
  registerReadinessQuizRoutes(app, workflowDb, engine)
  registerFamilyReadinessRoutes(app, workflowDb)
  registerFamilyScenarioRoutes(app, workflowDb)
  registerFamilyFeedRoutes(app, workflowDb)
  registerFamilyNotificationRoutes(app, workflowDb)
  registerMemberTwinRoutes(app, workflowDb)
  registerFamilyContinuityRoutes(app, workflowDb)
  registerFamilyCashflowRoutes(app, workflowDb)
  registerFamilyAssetRoutes(app, workflowDb, engine, insightsDeliveryHook)
  registerFamilyLegacyRoutes(app, workflowDb, engine, insightsDeliveryHook)
  await registerLeadRoutes(app, workflowDb)
  await registerHeartbeatUnsubscribeRoutes(app, workflowDb)
  await registerShareRoutes(app)
  registerSendgridWebhookRoutes(app, workflowDb)
  await registerFamilyFinancialProfileRoutes(app, workflowDb, engine, insightsDeliveryHook)
  registerLifeEventRoutes(app, workflowDb)
  registerPushRoutes(app, workflowDb, deliveryRouter)
  registerReminderRoutes(app, workflowDb)
  registerMarketingPostRoutes(app, workflowDb)
  ensureAutopilotIndexes(workflowDb)
  await registerOperatorRoutes(app, workflowDb)
  registerDetectorEvalRoutes(app, workflowDb, engine, detectorEvalDir(ROOT))
}
// Prometheus metrics — generic ops/observability, not vertical-specific.
await registerMetricsRoutes(app, engine, scoreCalibrator)

// ─── Start ───────────────────────────────────────────────────────────────────

logDeploymentMode()
log.info({ mode: deploymentConfig.mode }, 'Queue mode')

// Run pending database migrations before accepting traffic. In production
// deployment modes a failed migration fails the boot — "starting anyway"
// is how a half-migrated schema took traffic undetected (intent 08). Dev
// keeps the warn-and-continue behavior.
try {
  const { runMigrations } = await import('./migrate.js')
  const result = await runMigrations(workflowDb)
  if (result.failed.length > 0) {
    const msg = `Migrations failed: ${result.failed.join(', ')}`
    if (deploymentConfig.mode !== 'dev') throw new Error(msg)
    log.error({ failed: result.failed }, 'Database migration failed — starting anyway (dev)')
  }
} catch (err) {
  if (deploymentConfig.mode !== 'dev') throw err
  log.error({ err }, 'Database migration failed — starting anyway (dev)')
}

const port = parseInt(process.env['PORT'] ?? '3001', 10)
await app.listen({ port, host: '0.0.0.0' })
log.info({ port }, 'LifeKeel API started')

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
