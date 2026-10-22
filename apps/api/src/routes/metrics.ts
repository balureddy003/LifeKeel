/**
 * Prometheus Metrics Endpoint
 *
 * GET /metrics — standard Prometheus text format (no auth required)
 *
 * Gauges / counters exported:
 *   lifekeel_engine_evaluations_total      counter
 *   lifekeel_engine_detectors_loaded       gauge
 *   lifekeel_engine_hit_rate               gauge    (detector_id)
 *   lifekeel_engine_latency_ms_avg         gauge
 *   lifekeel_llm_cost_microdollars_total   counter
 *   lifekeel_calibration_ece               gauge    (detector_id)
 *   lifekeel_circuit_breaker_state         gauge    (provider; 0=closed 1=open 2=half-open)
 *   lifekeel_billing_credits_consumed_total counter
 *   lifekeel_billing_payment_failures_total counter
 *   lifekeel_billing_webhook_errors_total   counter (event_type)
 *   lifekeel_insight_route_errors_total     counter (route)
 */

import type { FastifyInstance } from 'fastify'
import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client'
import type { Engine, ScoreCalibrator } from '@lifekeel/engine'
import { getAllCircuitBreakers } from '@lifekeel/platform'

// ── Singleton registry (created once, reused on hot-reload) ──────────────────

let _registry: Registry | null = null

function getRegistry(): Registry {
  if (!_registry) {
    _registry = new Registry()
    collectDefaultMetrics({ register: _registry })
  }
  return _registry
}

/** Prometheus text exposition of the shared registry (used by tests and ops tooling). */
export async function renderMetrics(): Promise<string> {
  return getRegistry().metrics()
}

// ── Metric singletons ────────────────────────────────────────────────────────

let evaluationsTotal: Counter | null = null
let detectorsLoaded: Gauge | null = null
let hitRate: Gauge | null = null
let latencyAvg: Gauge | null = null
let calibrationEce: Gauge | null = null
let circuitBreakerState: Gauge | null = null
let apiRequests: Counter | null = null
let apiLatency: Histogram | null = null
let eventsIngested: Counter | null = null
let insightsGenerated: Counter | null = null
let deliveryLatency: Histogram | null = null
let llmCacheHits: Counter | null = null
let llmCacheMisses: Counter | null = null
let billingCreditsConsumed: Counter | null = null
let billingPaymentFailures: Counter | null = null
let billingWebhookErrors: Counter | null = null
let insightRouteErrors: Counter | null = null
let featureHashEvictions: Counter | null = null
let featureHashCacheHits: Counter | null = null
let featureHashCacheMisses: Counter | null = null
let localModelCalls: Counter | null = null
let processorViolations: Counter | null = null
let localModelLatency: Histogram | null = null
let localModelQueueWait: Histogram | null = null
let localModelCost: Counter | null = null
let shadowComparisons: Counter | null = null
let emailEncoderOutcomes: Counter | null = null
let emailFunnel: Counter | null = null
let outputGuardBlocks: Counter | null = null
let emailClassifyFailures: Counter | null = null
let documentExtractionRetries: Counter | null = null
let deviceEscalations: Counter | null = null
let assistantAnswerRoutes: Counter | null = null

function initMetrics(registry: Registry): void {
  if (evaluationsTotal) return // already initialised

  evaluationsTotal = new Counter({
    name: 'lifekeel_engine_evaluations_total',
    help: 'Total number of engine evaluations',
    registers: [registry],
  })

  detectorsLoaded = new Gauge({
    name: 'lifekeel_engine_detectors_loaded',
    help: 'Number of detectors currently loaded in the engine',
    registers: [registry],
  })

  hitRate = new Gauge({
    name: 'lifekeel_engine_hit_rate',
    help: 'Hit rate (insights produced / evaluations) per detector',
    labelNames: ['detector_id'],
    registers: [registry],
  })

  latencyAvg = new Gauge({
    name: 'lifekeel_engine_latency_ms_avg',
    help: 'Average evaluation latency in milliseconds',
    registers: [registry],
  })

  calibrationEce = new Gauge({
    name: 'lifekeel_calibration_ece',
    help: 'Expected Calibration Error (ECE) per detector — lower is better',
    labelNames: ['detector_id'],
    registers: [registry],
  })

  circuitBreakerState = new Gauge({
    name: 'lifekeel_circuit_breaker_state',
    help: 'LLM circuit breaker state per provider (0=closed, 1=open, 2=half-open)',
    labelNames: ['provider'],
    registers: [registry],
  })
  apiRequests = new Counter({
    name: 'lifekeel_api_requests_total',
    help: 'API requests by status class',
    labelNames: ['method', 'route', 'status_class'],
    registers: [registry],
  })
  apiLatency = new Histogram({
    name: 'lifekeel_api_request_duration_seconds',
    help: 'API request duration',
    labelNames: ['method', 'route'],
    buckets: [0.05, 0.1, 0.25, 0.5, 0.8, 1, 2, 5, 10, 30, 60],
    registers: [registry],
  })
  eventsIngested = new Counter({
    name: 'lifekeel_events_ingested_total',
    help: 'Events accepted for evaluation',
    labelNames: ['event_type'],
    registers: [registry],
  })
  insightsGenerated = new Counter({
    name: 'lifekeel_insights_generated_total',
    help: 'Insights generated by detector',
    labelNames: ['detector_id'],
    registers: [registry],
  })
  deliveryLatency = new Histogram({
    name: 'lifekeel_insight_delivery_duration_seconds',
    help: 'Time from insight creation to delivery attempt',
    buckets: [1, 5, 15, 30, 60, 120, 300, 600],
    registers: [registry],
  })
  llmCacheHits = new Counter({
    name: 'lifekeel_llm_cache_hits_total',
    help: 'LLM response cache hits by task',
    labelNames: ['task'],
    registers: [registry],
  })
  llmCacheMisses = new Counter({
    name: 'lifekeel_llm_cache_misses_total',
    help: 'LLM response cache misses by task',
    labelNames: ['task'],
    registers: [registry],
  })
  // M5: Billing metrics
  // B13: no tenant_id labels — per-tenant label cardinality is unbounded and
  // leaks the tenant roster into metrics infrastructure. Tenants live in
  // controlled logs/traces; Prometheus sees bounded aggregates only.
  billingCreditsConsumed = new Counter({
    name: 'lifekeel_billing_credits_consumed_total',
    help: 'Outcome credits consumed',
    registers: [registry],
  })
  billingPaymentFailures = new Counter({
    name: 'lifekeel_billing_payment_failures_total',
    help: 'Payment failures',
    registers: [registry],
  })
  billingWebhookErrors = new Counter({
    name: 'lifekeel_billing_webhook_errors_total',
    help: 'Stripe webhook processing errors by event type',
    labelNames: ['event_type'],
    registers: [registry],
  })
  // KEEL-008: insights.ts's catch blocks only ever run for a genuine
  // unexpected failure (DB outage, timeout, driver bug) — legitimate
  // not-found is always handled by an explicit check inside the try, never
  // a throw. Without this, that failure looked identical to "no insights
  // yet" to both the client and ops.
  insightRouteErrors = new Counter({
    name: 'lifekeel_insight_route_errors_total',
    help: 'Insight route errors that reached the catch block (never a legitimate not-found) by route',
    labelNames: ['route'],
    registers: [registry],
  })
  // ML layer: FeatureHashScorer LRU cache metrics
  featureHashEvictions = new Counter({
    name: 'lifekeel_feature_hash_evictions_total',
    help: 'FeatureHashScorer LRU model evictions by detector',
    labelNames: ['detector_id'],
    registers: [registry],
  })
  featureHashCacheHits = new Counter({
    name: 'lifekeel_feature_hash_cache_hits_total',
    help: 'FeatureHashScorer in-memory model cache hits',
    labelNames: ['detector_id'],
    registers: [registry],
  })
  featureHashCacheMisses = new Counter({
    name: 'lifekeel_feature_hash_cache_misses_total',
    help: 'FeatureHashScorer in-memory model cache misses (required DB load)',
    labelNames: ['detector_id'],
    registers: [registry],
  })
  // Self-hosted model path (see infra/local-judge/README.md). `purpose` is
  // judge | classifier | ocr; high-cardinality ids are deliberately not labels.
  localModelCalls = new Counter({
    name: 'lifekeel_local_model_calls_total',
    help: 'Self-hosted model decisions by purpose and outcome (ok | error)',
    labelNames: ['purpose', 'outcome'],
    registers: [registry],
  })
  // PRD-142: a model call whose processor is not approved for the task. Reason
  // and mode only: no task ids or tenants as labels.
  processorViolations = new Counter({
    name: 'lifekeel_ai_processor_violations_total',
    help: 'AI calls whose processor was not approved for the task, by reason and mode (warn | enforce)',
    labelNames: ['reason', 'mode'],
    registers: [registry],
  })
  localModelLatency = new Histogram({
    name: 'lifekeel_local_model_latency_seconds',
    help: 'Time inside the self-hosted model call (excludes waiting for a concurrency slot)',
    labelNames: ['purpose'],
    buckets: [1, 3, 5, 10, 20, 30, 60, 120, 240],
    registers: [registry],
  })
  localModelQueueWait = new Histogram({
    name: 'lifekeel_local_model_queue_wait_seconds',
    help: 'Time a call waited for a local-model concurrency slot; sustained growth means the model service is undersized',
    labelNames: ['purpose'],
    buckets: [0.1, 1, 5, 15, 30, 60, 120, 300],
    registers: [registry],
  })
  emailEncoderOutcomes = new Counter({
    name: 'lifekeel_email_encoder_total',
    help: 'Email encoder outcomes: gated_skip | gated_pass | error_fell_back | agree | encoder_missed | encoder_extra | shadow_error. encoder_missed is the one that matters.',
    labelNames: ['outcome'],
    registers: [registry],
  })
  emailFunnel = new Counter({
    name: 'lifekeel_email_funnel_total',
    help: 'Where each scanned email stopped in the classification cascade: rule_hit | prefilter_skip | encoder_skip | model_call. model_call / total is the share that cost a model call.',
    labelNames: ['stage'],
    registers: [registry],
  })
  shadowComparisons = new Counter({
    name: 'lifekeel_shadow_comparisons_total',
    help: 'Candidate-vs-authoritative comparisons by purpose and outcome (agree | shadow_more_permissive | shadow_stricter | shadow_error | dropped)',
    labelNames: ['purpose', 'outcome'],
    registers: [registry],
  })
  localModelCost = new Counter({
    name: 'lifekeel_local_model_estimated_cost_usd_total',
    help: 'Estimated USD for busy model time (seconds in calls x LOCAL_MODEL_COST_PER_HOUR_USD); excludes idle instance time',
    labelNames: ['purpose'],
    registers: [registry],
  })
  outputGuardBlocks = new Counter({
    name: 'lifekeel_output_guard_blocks_total',
    help: 'Generated text rejected by the output guard, by reason',
    labelNames: ['reason'],
    registers: [registry],
  })
  emailClassifyFailures = new Counter({
    name: 'lifekeel_email_classify_failures_total',
    help: 'Emails the classifier could not classify (retried on the next scan)',
    registers: [registry],
  })
  documentExtractionRetries = new Counter({
    name: 'lifekeel_document_extraction_retries_total',
    help: 'Documents re-attempted by the OCR retry sweep',
    registers: [registry],
  })
  deviceEscalations = new Counter({
    name: 'lifekeel_device_escalations_total',
    help: 'Server-side invocations of on_device tasks (device tier unavailable/abstained) — the device-vs-hosted coverage signal',
    labelNames: ['task_id'],
    registers: [registry],
  })
  assistantAnswerRoutes = new Counter({
    name: 'lifekeel_assistant_answer_route_total',
    help: 'How each /assistant/ask was answered — the generation-escape-rate signal (verified/clarified = deterministic, generated/fallback = model path)',
    labelNames: ['route'],
    registers: [registry],
  })
}

/** M5: Record a credit consumption for Prometheus metrics. */
export function recordCreditsConsumed(_tenantId: string, credits: number): void {
  initMetrics(getRegistry())
  billingCreditsConsumed!.inc(credits)
}

/** M5: Record a payment failure for Prometheus metrics. */
export function recordPaymentFailure(_tenantId: string): void {
  initMetrics(getRegistry())
  billingPaymentFailures!.inc()
}

/** M5: Record a webhook error for Prometheus metrics. */
export function recordWebhookError(eventType: string): void {
  initMetrics(getRegistry())
  billingWebhookErrors!.inc({ event_type: eventType })
}

/** KEEL-008: Record an insight route error for Prometheus metrics. */
export function recordInsightRouteError(route: string): void {
  initMetrics(getRegistry())
  insightRouteErrors!.inc({ route })
}

export function recordApiRequest(
  method: string,
  route: string,
  statusCode: number,
  durationSeconds: number,
): void {
  const registry = getRegistry()
  initMetrics(registry)
  const labels = { method, route, status_class: `${Math.floor(statusCode / 100)}xx` }
  apiRequests!.inc(labels)
  apiLatency!.observe({ method, route }, durationSeconds)
}

export function recordEventIngested(_tenantId: string, eventType: string): void {
  initMetrics(getRegistry())
  eventsIngested!.inc({ event_type: eventType })
}

export function recordInsightGenerated(_tenantId: string, detectorId: string): void {
  initMetrics(getRegistry())
  insightsGenerated!.inc({ detector_id: detectorId })
}

export function recordDeliveryLatency(seconds: number): void {
  initMetrics(getRegistry())
  deliveryLatency!.observe(seconds)
}

/** Record an LLM cache hit or miss for Prometheus metrics. */
export function recordLlmCacheHitMiss(_tenantId: string, task: string, hit: boolean): void {
  initMetrics(getRegistry())
  if (hit) {
    llmCacheHits!.inc({ task })
  } else {
    llmCacheMisses!.inc({ task })
  }
}

/** PRD-142: one model call the processor registry flagged (and refused, in enforce mode). */
export function recordProcessorViolation(reason: string, mode: 'warn' | 'enforce'): void {
  initMetrics(getRegistry())
  processorViolations!.inc({ reason, mode })
}

/** Self-hosted model: record one decision (outcome, model time, and wait for a slot). */
export function recordLocalModelCall(
  purpose: string,
  ok: boolean,
  latencySeconds: number,
  queueWaitSeconds: number,
  costUsd = 0,
): void {
  initMetrics(getRegistry())
  if (costUsd > 0) localModelCost!.inc({ purpose }, costUsd)
  localModelCalls!.inc({ purpose, outcome: ok ? 'ok' : 'error' })
  localModelLatency!.observe({ purpose }, latencySeconds)
  localModelQueueWait!.observe({ purpose }, queueWaitSeconds)
}

/** Email encoder: record what it did for one email (see email/classify.ts EncoderOutcome). */
export function recordEmailEncoderOutcome(outcome: string): void {
  initMetrics(getRegistry())
  emailEncoderOutcomes!.inc({ outcome })
}

/** Email cascade: record the stage that settled (or sent to the model) one email. */
export function recordEmailFunnelStage(stage: string): void {
  initMetrics(getRegistry())
  emailFunnel!.inc({ stage })
}

/** Shadow mode: record one comparison of a candidate against the authoritative evaluator. */
export function recordShadowComparison(purpose: string, outcome: string): void {
  initMetrics(getRegistry())
  shadowComparisons!.inc({ purpose, outcome })
}

/** Output guard: record one rejected generation. `reason` is the guard reason code (no free text). */
export function recordOutputGuardBlock(reason: string): void {
  initMetrics(getRegistry())
  outputGuardBlocks!.inc({ reason })
}

export function recordEmailClassifyFailure(): void {
  initMetrics(getRegistry())
  emailClassifyFailures!.inc()
}

/** Device-first: a on_device task ran server-side this call. */
export function recordDeviceEscalation(taskId: string): void {
  initMetrics(getRegistry())
  deviceEscalations!.inc({ task_id: taskId })
}

/**
 * PRD-212: how /assistant/ask answered one question. The generation-escape
 * rate is `generated / sum(all routes)`.
 */
export type AssistantAnswerRoute =
  'emergency' | 'verified' | 'clarified' | 'generated' | 'fallback' | 'quarantined'

export function recordAssistantAnswerRoute(route: AssistantAnswerRoute): void {
  initMetrics(getRegistry())
  assistantAnswerRoutes!.inc({ route })
}

export function recordDocumentExtractionRetries(count: number): void {
  initMetrics(getRegistry())
  documentExtractionRetries!.inc(count)
}

/** ML layer: record a FeatureHashScorer LRU eviction. */
export function recordFeatureHashEviction(_tenantId: string, detectorId: string): void {
  initMetrics(getRegistry())
  featureHashEvictions!.inc({ detector_id: detectorId })
}

/** ML layer: record a FeatureHashScorer cache hit/miss. */
export function recordFeatureHashCacheHitMiss(
  _tenantId: string,
  detectorId: string,
  hit: boolean,
): void {
  initMetrics(getRegistry())
  if (hit) {
    featureHashCacheHits!.inc({ detector_id: detectorId })
  } else {
    featureHashCacheMisses!.inc({ detector_id: detectorId })
  }
}

/**
 * Build a FeatureHashScorerMetrics adapter that wires the scorer's cache
 * events into Prometheus counters. Pass this to the FeatureHashScorer
 * constructor.
 */
export function buildFeatureHashScorerMetrics(): import('@lifekeel/engine').FeatureHashScorerMetrics {
  return {
    onEviction: (tenantId, detectorId) => recordFeatureHashEviction(tenantId, detectorId),
    onCacheHit: (tenantId, detectorId) => recordFeatureHashCacheHitMiss(tenantId, detectorId, true),
    onCacheMiss: (tenantId, detectorId) =>
      recordFeatureHashCacheHitMiss(tenantId, detectorId, false),
  }
}

// Track previous evaluation total to compute delta for the counter
const _prevEvaluations: { value: number } = { value: 0 }

export async function registerMetricsRoutes(
  app: FastifyInstance,
  engine: Engine,
  calibrator?: ScoreCalibrator,
): Promise<void> {
  const registry = getRegistry()
  initMetrics(registry)

  app.get('/metrics', async (_req, reply) => {
    // ── Engine metrics ──────────────────────────────────────────────────────
    const snap = engine.metrics.snapshot()

    // evaluations_total: increment by delta since last scrape
    const delta = snap.total_evaluations - _prevEvaluations.value
    if (delta > 0) {
      evaluationsTotal!.inc(delta)
      _prevEvaluations.value = snap.total_evaluations
    }

    detectorsLoaded!.set(engine.detectorCount)
    latencyAvg!.set(snap.avg_latency_ms)

    for (const [detId, dm] of Object.entries(snap.detectors)) {
      hitRate!.set({ detector_id: detId }, dm.hit_rate)
    }

    // ── Calibration ECE ─────────────────────────────────────────────────────
    if (calibrator) {
      try {
        const params = await calibrator.getAllParams('system')
        for (const p of params) {
          calibrationEce!.set({ detector_id: p.detector_id }, p.ece ?? 0)
        }
      } catch {
        // calibrator unavailable — skip
      }
    }

    // ── Circuit breaker states ──────────────────────────────────────────────
    for (const [key, cb] of getAllCircuitBreakers()) {
      circuitBreakerState!.set({ provider: key }, cb.getStateNumeric())
    }

    // ── Render ──────────────────────────────────────────────────────────────
    const output = await registry.metrics()
    return reply.header('Content-Type', registry.contentType).send(output)
  })
}
