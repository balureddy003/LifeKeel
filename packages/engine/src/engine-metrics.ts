/**
 * EngineMetrics — production-grade observability for the LifeKeel Engine
 *
 * Tracks per-detector and aggregate statistics without any external dependency.
 * Emit these to Prometheus / Datadog / OTel via the `snapshot()` method.
 */

export interface DetectorMetrics {
  detector_id: string
  evaluations: number
  hits: number // evaluations that produced ≥1 insight
  rules_triggered: number
  total_latency_ms: number
  avg_latency_ms: number
  hit_rate: number // hits / evaluations
  last_evaluated_at: Date | null
}

export interface EngineMetrics {
  total_evaluations: number
  total_hits: number
  total_insights_produced: number
  total_rules_triggered: number
  total_latency_ms: number
  avg_latency_ms: number
  evaluations_per_second: number // rolling 60s window
  uptime_seconds: number
  detectors: Record<string, DetectorMetrics>
}

export class MetricsCollector {
  private readonly startedAt = Date.now()

  // Aggregate counters
  private totalEvaluations = 0
  private totalHits = 0
  private totalInsights = 0
  private totalRulesTriggered = 0
  private totalLatencyMs = 0

  // Per-detector counters
  private readonly byDetector = new Map<string, DetectorMetrics>()

  // Rolling window for evaluations/sec (last 60s)
  private readonly recentTimestamps: number[] = []

  // ─── Recording ───────────────────────────────────────────────────────────────

  record(opts: {
    detector_id: string
    latency_ms: number
    rules_triggered: number
    insights_produced: number
  }): void {
    const { detector_id, latency_ms, rules_triggered, insights_produced } = opts
    const hit = insights_produced > 0

    // Aggregate
    this.totalEvaluations++
    if (hit) this.totalHits++
    this.totalInsights += insights_produced
    this.totalRulesTriggered += rules_triggered
    this.totalLatencyMs += latency_ms

    // Per-detector
    const existing = this.byDetector.get(detector_id) ?? {
      detector_id,
      evaluations: 0,
      hits: 0,
      rules_triggered: 0,
      total_latency_ms: 0,
      avg_latency_ms: 0,
      hit_rate: 0,
      last_evaluated_at: null,
    }
    existing.evaluations++
    if (hit) existing.hits++
    existing.rules_triggered += rules_triggered
    existing.total_latency_ms += latency_ms
    existing.avg_latency_ms = existing.total_latency_ms / existing.evaluations
    existing.hit_rate = existing.hits / existing.evaluations
    existing.last_evaluated_at = new Date()
    this.byDetector.set(detector_id, existing)

    // Rolling window
    const now = Date.now()
    this.recentTimestamps.push(now)
    // Trim to last 60s
    const cutoff = now - 60_000
    while (this.recentTimestamps.length > 0 && this.recentTimestamps[0]! < cutoff) {
      this.recentTimestamps.shift()
    }
  }

  // ─── Snapshot ─────────────────────────────────────────────────────────────────

  snapshot(): EngineMetrics {
    const uptimeSec = (Date.now() - this.startedAt) / 1000
    const detectors: Record<string, DetectorMetrics> = {}
    for (const [id, m] of this.byDetector) detectors[id] = { ...m }

    return {
      total_evaluations: this.totalEvaluations,
      total_hits: this.totalHits,
      total_insights_produced: this.totalInsights,
      total_rules_triggered: this.totalRulesTriggered,
      total_latency_ms: this.totalLatencyMs,
      avg_latency_ms: this.totalEvaluations > 0 ? this.totalLatencyMs / this.totalEvaluations : 0,
      evaluations_per_second: this.recentTimestamps.length / 60,
      uptime_seconds: uptimeSec,
      detectors,
    }
  }

  reset(): void {
    this.totalEvaluations = 0
    this.totalHits = 0
    this.totalInsights = 0
    this.totalRulesTriggered = 0
    this.totalLatencyMs = 0
    this.byDetector.clear()
    this.recentTimestamps.length = 0
  }
}
