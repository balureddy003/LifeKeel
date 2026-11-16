/**
 * Background work — every cron scheduleJob + queue consumer, extracted
 * from server.ts (composition root) so boot reads as: connect DB, wire
 * delivery, startBackgroundWork(deps), register routes.
 *
 * Moved verbatim except:
 *  - relative dynamic imports re-pointed ./x → ../x;
 *  - scoreCalibrator reads go through deps.getScoreCalibrator() — the
 *    calibrator is constructed AFTER this block in boot order, and cron
 *    callbacks must see the assigned instance, not a captured undefined;
 *  - the insightsDeliveryHook capture is returned to the caller
 *    (routes registered later reuse the same persist+deliver hook).
 *
 * SERVICE_ROLE stays the caller's concern: `timersEnabled`/
 * `consumersEnabled` arrive already resolved, so the api/jobs/all split
 * is exactly as before — every job still registers for Cloud Scheduler
 * via registerScheduledJob; inline timers only start when enabled.
 */

import cron from 'node-cron'
import type { Db } from 'mongodb'
import { Engine, type Insight, ScoreCalibrator } from '@lifekeel/engine'
import {
  ConnectorLoader,
  EventGenerator,
  ConnectorSyncEngine,
  TokenRefreshScheduler,
} from '@lifekeel/pipeline'
import { createLogger } from '@lifekeel/platform'
import { DeliveryRouter } from '../delivery/delivery-router.js'
import { localDecisionFromEnv } from '../local-model.js'
import { taskLlmFor, taskDecideFor, taskVision } from '../ai/task-gateway.js'
import { purgeExpiredSensitiveFacts } from '../briefs/briefs.js'
import { queueManager } from '../queue/QueueManager.js'
import { startWebhookWorker } from '../queue/WebhookQueue.js'
import { RetentionWorker } from '../jobs/retention-worker.js'
import { InsightSlaWorker } from '../jobs/insight-sla-worker.js'
import { EscalationWorker } from '../jobs/escalation-worker.js'
import { DeliveryRetryWorker } from '../jobs/delivery-retry-worker.js'
import { createCredentialExpiryInsights } from '../jobs/connector-health-alert.js'
import {
  scanAllConnectedInboxes,
  enqueueConnectedInboxScans,
  runQueuedInboxScan,
  EMAIL_SCAN_QUEUE,
} from '../jobs/email-scan.js'
import {
  CAMPAIGN_SEND_QUEUE,
  runCampaignSendJob,
  type CampaignSendJob,
} from '../marketing/campaigns.js'
import { dispatchPendingOcr, retryFailedDocuments } from '../ocr/retry-failed.js'
import { requeueStuckExtractions, startExtractionWorker } from '../ocr/extraction-queue.js'
import {
  withCronLock,
  acquireCronLock,
  releaseCronLock,
  ensureCronLockIndex,
} from '../jobs/cron-lock.js'
import { registerScheduledJob } from '../jobs/scheduled-crons.js'
import { persistAndDeliverInsights as persistAndDeliverInsightsCore } from '../insights-persist.js'
import { cleanupStaleInsightsStartup } from '../routes/insights.js'
import { runChecklistReminderSweep } from '../life-events/checklist-reminder.js'
import {
  publishDueMarketingPosts,
  generateDailyMarketingDrafts,
  pollMarketingEngagement,
} from '../routes/marketing-posts.js'
import { runMetricsRollup } from '../jobs/metrics-rollup.js'
import { watchEngineMetrics } from '../jobs/engine-metrics-watch.js'
import { runAiHealthAlert } from '../jobs/ai-health-alert.js'
import { runWeeklyDigest } from '../operator/weekly-digest.js'
import { runLifecycleSweep } from '../marketing/lifecycle-emails.js'
import { runAutopilotSweep } from '../operator/autopilot.js'
import { readonlyStripeFromEnv, syncRevenue } from '../marketing/revenue.js'
import { checkConnectedProfiles } from '../marketing/profile-sync.js'
import { profileReader } from '../marketing/profile-reader.js'
import { DbSocialPublisher, socialPublisherFromEnv } from '../marketing/social-publisher.js'
import {
  ensureReminderIndexes,
  runPolicyRenewalReminders,
} from '../jobs/policy-renewal-reminders.js'
import { runMemberAgentLoop } from '../jobs/member-agent-loop.js'
import { runStaleProfileEvaluationSweep } from '../jobs/stale-profile-evaluation.js'
import { ensureMemberNudgeIndexes } from '../member-nudges.js'
import { runContinuityCheck, ensureContinuityIndexes } from '../jobs/continuity-check.js'
import { runFamilyHeartbeat } from '../jobs/family-heartbeat.js'
import { runFreshnessCheck } from '../jobs/freshness-check.js'
import { runScenarioWatchlist } from '../jobs/scenario-watchlist.js'

export interface BackgroundWorkDeps {
  workflowDb: Db
  engine: Engine
  connectorLoader: ConnectorLoader
  eventGenerator: EventGenerator
  deliveryRouter: DeliveryRouter | undefined
  timersEnabled: boolean
  consumersEnabled: boolean
  /** Same 'api'-service logger as the rest of boot — log output unchanged. */
  log: ReturnType<typeof createLogger>
  /** Read AFTER this function returns — the calibrator is constructed later in boot. */
  getScoreCalibrator: () => ScoreCalibrator | undefined
}

export interface BackgroundWorkResult {
  /** The persist+deliver hook routes reuse; undefined unless timers are enabled
   *  (same guard the inline block applied to insightsDeliveryHook). */
  persistAndDeliverInsights: ((insights: Insight[], tenantId: string) => Promise<void>) | undefined
}

export async function startBackgroundWork(deps: BackgroundWorkDeps): Promise<BackgroundWorkResult> {
  const {
    workflowDb,
    engine,
    connectorLoader,
    eventGenerator,
    deliveryRouter,
    timersEnabled,
    consumersEnabled,
    log,
    getScoreCalibrator,
  } = deps
  let deliveryHook: BackgroundWorkResult['persistAndDeliverInsights']

  // `scheduleJob` is cron.schedule with registration added — same callback,
  // same node-cron options, just named for /internal/cron/<name>.
  const scheduleJob = (
    name: string,
    expr: string,
    fn: () => Promise<unknown>,
    opts?: Parameters<typeof cron.schedule>[2],
  ): void => {
    registerScheduledJob(name, fn)
    if (timersEnabled) {
      cron.schedule(expr, fn, opts)
    } else {
      log.info({ name, expr }, 'Cron registered for Cloud Scheduler')
    }
  }

  // KEEL-003: every cron.schedule job below runs under this lock, keyed by
  // its own name — deploy-api.yml allows up to 4 Cloud Run replicas, and
  // without this, two replicas racing the same job could both act on the
  // same overdue insight/expiring credential and double-fire it.
  await ensureCronLockIndex(workflowDb)

  // One-time cleanup: archive stale pre-fix insight records (A1/A2/A3
  // patterns) that are still live on Home. Runs in the background —
  // doesn't block startup. Safe to run multiple times (idempotent).
  if (timersEnabled) {
    cleanupStaleInsightsStartup(workflowDb).catch((err) =>
      log.error({ err }, 'Startup stale-insight cleanup failed'),
    )
  }

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
  // Registered like every other job so Cloud Scheduler can fire it; the
  // inline interval only runs where timers are enabled (dev/jobs role).
  registerScheduledJob('token-refresh', () =>
    withCronLock(workflowDb, 'token-refresh', async () => {
      await tokenRefresher.refreshExpiring()
    }),
  )
  if (timersEnabled) {
    tokenRefresher.start(10 * 60 * 1000)
    log.info({}, 'Token refresh scheduler started')
  }

  // Connector poll every 15 minutes — incremental sync of all connected tenants
  scheduleJob(
    'connector-sync',
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
  scheduleJob(
    'connector-health',
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

  // DPIA retention (Intent 79): purge expired sensitive brief facts daily.
  // The read-path lazy purge is kept as belt-and-braces; this sweep is what
  // actually bounds retention for briefs nobody opens again.
  scheduleJob(
    'brief-facts-retention',
    '23 4 * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'brief-facts-retention', () =>
          purgeExpiredSensitiveFacts(workflowDb),
        )
      } catch (err) {
        log.error({ err }, 'Sensitive brief facts purge failed')
      }
    },
    { missedExecutionTolerance: 30_000, noOverlap: true },
  )

  // Email connector scan every 15 minutes — classifies new mail on every
  // connected mailbox (any IMAP provider) into Inbox items, and routes
  // document-like attachments through the same OCR pipeline manual uploads
  // use. Also triggered on-demand right after connecting (see
  // family-connectors.ts) and via POST /connectors/email/scan.
  // Opt-in (EMAIL_SCAN_FANOUT=true): one queue job per mailbox so scans run in parallel
  // across workers instead of one after another (see jobs/email-scan.ts).
  const emailScanFanout = process.env['EMAIL_SCAN_FANOUT'] === 'true'
  scheduleJob(
    'email-scan',
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
  const localModelConfigured = Boolean(process.env['LOCAL_JUDGE_BASE_URL'])
  if (localModelConfigured) {
    scheduleJob(
      'document-ocr-retry',
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

  // OCR hand-off for documents the scan worker promoted to 'clean'
  // (CLOUDFLARE_INTEGRATION.md §7.3), plus the reconciler that republishes
  // extraction jobs the queue lost (intent 97 slice 2 — the document row is
  // the durable outbox, so a Redis outage defers work, never drops it).
  // Claimed per row, so one dispatch per document across replicas; free
  // plans go to 'stored'.
  scheduleJob(
    'document-ocr-dispatch',
    '* * * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'document-ocr-dispatch', async () => {
          await dispatchPendingOcr(workflowDb)
          await requeueStuckExtractions(workflowDb)
        })
      } catch (err) {
        log.error({ err }, 'Document OCR dispatch cron failed')
      }
    },
    { missedExecutionTolerance: 30_000, noOverlap: true },
  )

  // Marketing publish sweep — every minute. Channels can't hold schedules,
  // so approved posts with a due scheduled_at are dispatched here; the lock
  // plus the 'publishing' claim guard against double-posting.
  scheduleJob(
    'marketing-publish',
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
  scheduleJob(
    'marketing-generate',
    '23 8 * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'marketing-generate', async () => {
          await generateDailyMarketingDrafts(workflowDb, taskLlmFor('marketing.social_draft.v1'))
          // PRD-210: keep next week's pillar plan drafted for the weekly review.
          const { ensureWeeklyPlans } = await import('../marketing/content-plan.js')
          await ensureWeeklyPlans(workflowDb, taskLlmFor('marketing.social_draft.v1'))
          // Standing approvals: breakers first (they retire expired or stale entries and pause failing
          // networks), then fill the calendar from the approved bank. Publishing is still the sweep's job.
          const { runBreakers, scheduleStanding } = await import('../marketing/standing.js')
          await runBreakers(workflowDb)
          // Drafting candidates is the unattended half: it only fills the bank with text waiting for a
          // person, never schedules or publishes anything.
          const { draftCandidates } = await import('../marketing/candidates.js')
          await draftCandidates(workflowDb, taskLlmFor('marketing.social_draft.v1'))
          await scheduleStanding(workflowDb)
          // PRD-226: re-promote the top-visited guide not pushed in 30 days.
          const { reviveGuides } = await import('../routes/marketing-posts.js')
          await reviveGuides(workflowDb, taskLlmFor('marketing.social_draft.v1'))
        })
      } catch (err) {
        log.error({ err }, 'Marketing draft generation failed')
      }
    },
    { missedExecutionTolerance: 3_600_000 },
  )
  log.info({}, 'Marketing draft generation cron started')

  // Search Console and GA4 read-back (intent 47) — daily at 06:30, read-only. A no-op until
  // GOOGLE_READONLY_SERVICE_ACCOUNT_JSON and the property settings are present.
  scheduleJob(
    'search-readback',
    '30 6 * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'search-readback', async () => {
          const { runSearchReadback } = await import('../marketing/search-readback.js')
          await runSearchReadback(workflowDb)
          // Weekly, on Mondays: turn real queries into a short list of topics for a person to consider.
          if (new Date().getUTCDay() === 1) {
            const { generateSuggestions } = await import('../marketing/topic-suggestions.js')
            await generateSuggestions(workflowDb)
          }
        })
      } catch (err) {
        log.error({ err }, 'Search read-back failed')
      }
    },
    { missedExecutionTolerance: 3_600_000 },
  )
  log.info({}, 'Search read-back cron started')

  // Engagement polling — hourly; refreshes like/repost/reply counts on
  // published posts where the channel exposes public metrics (Bluesky).
  scheduleJob(
    'marketing-engagement',
    '17 * * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'marketing-engagement', async () => {
          await pollMarketingEngagement(workflowDb)
          // Standing approvals: notice failing networks and stale approvals within the hour.
          const { runBreakers } = await import('../marketing/standing.js')
          await runBreakers(workflowDb)
        })
      } catch (err) {
        log.error({ err }, 'Marketing engagement sweep failed')
      }
    },
    { missedExecutionTolerance: 600_000 },
  )

  // Stripe revenue (read-only) — daily at 04:15. Feeds channel economics;
  // a no-op until STRIPE_READONLY_KEY (a restricted rk_ key) is set.
  scheduleJob(
    'revenue-sync',
    '15 4 * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'revenue-sync', async () => {
          const result = await syncRevenue(workflowDb, readonlyStripeFromEnv())
          if (result.configured) log.info({ ...result }, 'Revenue sync run')
        })
      } catch (err) {
        log.error({ err }, 'Revenue sync failed')
      }
    },
    { missedExecutionTolerance: 3_600_000 },
  )
  log.info({}, 'Revenue sync cron started')

  // Daily profile check — 07:10. Read-only: reads each connected
  // platform's live profile and records drift against the approved text. It
  // never writes to a platform; fixing a profile is a human act.
  scheduleJob(
    'profile-check',
    '10 7 * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'profile-check', async () => {
          const r = await checkConnectedProfiles(workflowDb, {
            connectorRead: profileReader(workflowDb),
          })
          log.info({ checked: r.checked, failed: r.failed.length }, 'Profile check run')
        })
      } catch (err) {
        log.error({ err }, 'Profile check failed')
      }
    },
    { missedExecutionTolerance: 3_600_000 },
  )
  log.info({}, 'Daily profile check cron started')

  // Daily metrics rollup — hourly at :40. Recomputes today + yesterday
  // (late-arriving events) into metrics_daily; first run backfills 90 days.
  // Operator dashboards read the rollup instead of scanning raw events.
  scheduleJob(
    'metrics-rollup',
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

  // Engine-metrics watch daily (intent 97, slice 9): alert when the
  // extraction check-failure rate doubles week over week. Content-free
  // counts only; the alert goes through the rate-limited ops channel.
  scheduleJob(
    'engine-metrics-watch',
    '50 6 * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'engine-metrics-watch', async () => {
          await watchEngineMetrics(workflowDb)
        })
      } catch (err) {
        log.error({ err }, 'Engine metrics watch failed')
      }
    },
    { missedExecutionTolerance: 1_800_000 },
  )
  log.info({}, 'Engine metrics watch cron started')

  // AI task failure-share check every 10 minutes (PRD-217) — the October
  // outage fell back on every call for days before a manual probe found
  // it; this pages ops within minutes of a task-level collapse.
  scheduleJob(
    'ai-health-alert',
    '*/10 * * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'ai-health-alert', async () => {
          const result = await runAiHealthAlert(workflowDb)
          if (result.alerted.length > 0) log.warn({ ...result }, 'AI task failure alert fired')
        })
      } catch (err) {
        log.error({ err }, 'AI health alert cron failed')
      }
    },
    { missedExecutionTolerance: 60_000 },
  )
  log.info({}, 'AI health alert cron started')

  // Autopilot sweep — hourly. Evaluates only enabled, off-cooldown Tier 0/1
  // rules; each act writes an autopilot_actions ledger row (dedup-keyed so a
  // target is never touched twice) plus an operator_audit_log entry under
  // actor 'autopilot'. All rules default off — this cron is inert until an
  // operator enables one.
  scheduleJob(
    'autopilot-sweep',
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
  scheduleJob(
    'weekly-digest',
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
  scheduleJob(
    'lifecycle-sweep',
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
    scheduleJob(
      'policy-renewal-reminders',
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
  scheduleJob(
    'member-agent-loop',
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
  scheduleJob(
    'continuity-check',
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
  scheduleJob(
    'checklist-reminder',
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
    scheduleJob(
      name,
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
    scheduleJob(
      'daily-digest',
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
  scheduleJob(
    'calibration-drift',
    '0 2 * * *',
    async () => {
      const scoreCalibrator = getScoreCalibrator()
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
  scheduleJob(
    'erasure-replay',
    '30 4 * * *',
    async () => {
      await withCronLock(workflowDb, 'erasure-replay', async () => {
        const { runErasureReplay } = await import('../jobs/erasure-replay.js')
        await runErasureReplay(workflowDb)
      })
    },
    { missedExecutionTolerance: 60_000 },
  )
  log.info({}, 'Erasure replay cron started')

  // Audit-log seal (G-SEC-03) — seals each closed UTC day into a hash chain
  // and re-verifies it; a failed check pages ops.
  scheduleJob(
    'audit-seal',
    '20 1 * * *',
    async () => {
      await withCronLock(workflowDb, 'audit-seal', async () => {
        const { runAuditSeal } = await import('../jobs/audit-seal.js')
        await runAuditSeal(workflowDb)
      })
    },
    { missedExecutionTolerance: 60_000 },
  )

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
  scheduleJob(
    'calibration-fit',
    '0 3 * * *',
    async () => {
      const scoreCalibrator = getScoreCalibrator()
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
  scheduleJob(
    'billing',
    '0 4 * * *',
    async () => {
      try {
        const { runBillingCron } = await import('../jobs/billing-cron.js')
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
  if (timersEnabled) deliveryHook = persistAndDeliverInsights

  // Stale profile evaluation — daily at 06:30 (before the member agent
  // loop at 07:15 and continuity check at 07:45). Closes the gap where a
  // family autosaves real data across wizard steps but never clicks "Save
  // & Generate Insights" — their profile sits fully accurate and fully
  // un-evaluated otherwise. Tier 0: reuses the exact
  // evaluateProfileAndGenerateInsights() + persistAndDeliverInsights path
  // POST /family/financial-profile/evaluate already runs on demand; this
  // only adds the "someone has to remember to click it" → "guaranteed to
  // eventually happen" part.
  scheduleJob(
    'stale-profile-evaluation',
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

  // PRD-145: freshness check, daily at 06:45 — after the 06:30 profile sweep, so
  // it reads settled profiles. Deterministic; sends nothing itself.
  scheduleJob(
    'freshness-check',
    '45 6 * * *',
    async () => {
      try {
        await withCronLock(workflowDb, 'freshness-check', async () => {
          const summary = await runFreshnessCheck(workflowDb)
          if (summary.failed > 0)
            log.warn({ ...summary }, 'Freshness check completed with failures')
        })
      } catch (err) {
        log.error({ err }, 'Freshness check failed')
      }
    },
    { missedExecutionTolerance: 3_600_000, noOverlap: true },
  )
  log.info({}, 'Freshness check cron started')

  // PRD-136: nightly scenario watchlist recompute — emits scenario_moved
  // feed events when a watched scenario's runway/depletion month moves by
  // ≥0.5 months. Runs after the 06:30 stale-profile sweep so projections
  // see yesterday's freshest data.
  scheduleJob(
    'scenario-watchlist',
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
  scheduleJob(
    'retention',
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
  scheduleJob(
    'insight-sla-escalation',
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
            // Resume persist-then-deliver for insights that stayed
            // 'identified': a crash or all-channel failure between the
            // upsert and the inline deliver() left them durable but never
            // sent, and nothing else looks at that state.
            try {
              const retried = await new DeliveryRetryWorker(workflowDb, deliveryRouter).run()
              if (retried.claimed > 0) {
                log.info({ ...retried }, 'Undelivered insights retried')
              }
            } catch (err) {
              log.error({ err }, 'Delivery retry worker failed')
            }
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
            const { runAutoExecuteTrusted } = await import('../jobs/auto-execute-trusted.js')
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
  scheduleJob(
    'feature-hash-eval',
    '0 7 * * 1',
    async () => {
      try {
        await withCronLock(workflowDb, 'feature-hash-eval', async () => {
          const { runFeatureHashEval } = await import('../jobs/feature-hash-eval.js')
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

  // ── Queue consumers ─────────────────────────────────────────────────────
  // (queueManager.connect() already ran above — it's role-agnostic.)
  // Consumers need a persistent process polling Redis; the api role only
  // runs them with QUEUE_CONSUMERS=on (scale-to-zero makes that mostly
  // moot — intent 92's follow-up is Cloud Tasks for these queues).
  if (consumersEnabled) {
    startWebhookWorker(engine, connectorLoader, eventGenerator, workflowDb, deliveryRouter)
    // Intent 97 slice 2: extraction jobs enqueued by uploads and the
    // dispatch sweep run here — decide/vision are the same governed task
    // fns the request path used.
    startExtractionWorker(workflowDb, {
      decideFor: taskDecideFor('document.extract.v1', localDecisionFromEnv('ocr')),
      visionFor: (tenantId) => taskVision('document.extract.v1', tenantId),
    })
    if (emailScanFanout) {
      // Per-process concurrency; total parallelism is this x replicas. Size it with the
      // model service: each in-flight scan can hold one local-model call (see
      // LOCAL_MODEL_MAX_CONCURRENT and the lifekeel_local_model_queue_wait_seconds metric).
      const scanConcurrency = Number(process.env['EMAIL_SCAN_CONCURRENCY']) || 2
      queueManager.subscribe(
        EMAIL_SCAN_QUEUE,
        (payload) => runQueuedInboxScan(workflowDb, payload),
        {
          concurrency: scanConcurrency,
        },
      )
      log.info({ concurrency: scanConcurrency }, 'Email scan fan-out workers started')
    }

    // Campaign bulk send — one durable job per recipient claim (B11). Bounded
    // concurrency keeps bulk mail under SendGrid's rate ceiling; the claim
    // rows are the durable per-recipient state, so a worker crash loses
    // nothing already claimed.
    const campaignConcurrency = Number(process.env['CAMPAIGN_SEND_CONCURRENCY']) || 4
    queueManager.subscribe(
      CAMPAIGN_SEND_QUEUE,
      (payload) => runCampaignSendJob(workflowDb, payload as CampaignSendJob),
      { concurrency: campaignConcurrency },
    )
    log.info({ concurrency: campaignConcurrency }, 'Campaign send workers started')
    log.info({}, 'Queue consumers started')
  }

  return { persistAndDeliverInsights: deliveryHook }
}
