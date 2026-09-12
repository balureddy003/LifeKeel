/**
 * ML Component Metrics
 *
 * Per-tenant metrics for ML components (calibration, novelty tracking, queues).
 * Provides observability for ML operations and enables detection of
 * cross-tenant anomalies or resource abuse.
 *
 * ADR-0019: Tenant ML Isolation
 */

import { createLogger } from '../logger.js'

const log = createLogger({ service: 'ml-metrics', version: '0.0.0' })

// Simple in-memory metrics (can be replaced with Prometheus/StatsD)
interface MetricValue {
  count: number
  sum: number
  min: number
  max: number
  lastUpdated: Date
}

class MetricsRegistry {
  private metrics = new Map<string, MetricValue>()

  record(metricName: string, value: number, tags: Record<string, string>): void {
    const key = this.metricKey(metricName, tags)
    const existing = this.metrics.get(key)

    if (existing) {
      existing.count++
      existing.sum += value
      existing.min = Math.min(existing.min, value)
      existing.max = Math.max(existing.max, value)
      existing.lastUpdated = new Date()
    } else {
      this.metrics.set(key, {
        count: 1,
        sum: value,
        min: value,
        max: value,
        lastUpdated: new Date(),
      })
    }
  }

  increment(metricName: string, tags: Record<string, string>): void {
    this.record(metricName, 1, tags)
  }

  get(metricName: string, tags: Record<string, string>): MetricValue | undefined {
    return this.metrics.get(this.metricKey(metricName, tags))
  }

  getAllByPrefix(prefix: string): Array<{ name: string; tags: Record<string, string>; value: MetricValue }> {
    const results: Array<{ name: string; tags: Record<string, string>; value: MetricValue }> = []
    for (const [key, value] of this.metrics.entries()) {
      if (key.startsWith(prefix)) {
        const { name, tags } = this.parseMetricKey(key)
        results.push({ name, tags, value })
      }
    }
    return results
  }

  reset(): void {
    this.metrics.clear()
  }

  private metricKey(name: string, tags: Record<string, string>): string {
    const tagStr = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',')
    return `${name}{${tagStr}}`
  }

  private parseMetricKey(key: string): { name: string; tags: Record<string, string> } {
    const [name, tagPart] = key.split('{')
    const tagStr = tagPart?.replace('}', '') ?? ''
    const tags: Record<string, string> = {}
    if (tagStr) {
      for (const pair of tagStr.split(',')) {
        const [k, v] = pair.split('=')
        if (k && v) tags[k] = v
      }
    }
    return { name: name ?? '', tags }
  }
}

const registry = new MetricsRegistry()

// ── Calibration Metrics ───────────────────────────────────────────────────────

export function recordCalibrationFit(tenantId: string, detectorId: string, durationMs: number, sampleCount: number): void {
  registry.record('calibration_fit_duration_ms', durationMs, { tenant_id: tenantId, detector_id: detectorId })
  registry.record('calibration_fit_sample_count', sampleCount, { tenant_id: tenantId, detector_id: detectorId })
  registry.increment('calibration_fit_total', { tenant_id: tenantId, detector_id: detectorId })
}

export function recordCalibrationQuery(tenantId: string, detectorId: string, cacheHit: boolean): void {
  registry.increment('calibration_query_total', { tenant_id: tenantId, detector_id: detectorId, cache_hit: String(cacheHit) })
}

export function recordCalibrationError(tenantId: string, detectorId: string, errorType: string): void {
  registry.increment('calibration_error_total', { tenant_id: tenantId, detector_id: detectorId, error_type: errorType })
}

// ── Novelty Metrics ─────────────────────────────────────────────────────────────

export function recordNoveltyLoad(tenantId: string, field: string, durationMs: number): void {
  registry.record('novelty_load_duration_ms', durationMs, { tenant_id: tenantId, field })
  registry.increment('novelty_load_total', { tenant_id: tenantId, field })
}

export function recordNoveltyObserve(tenantId: string, field: string, valueCount: number): void {
  registry.record('novelty_observe_count', valueCount, { tenant_id: tenantId, field })
  registry.increment('novelty_observe_total', { tenant_id: tenantId, field })
}

export function recordNoveltyScore(tenantId: string, field: string, score: number): void {
  registry.record('novelty_score', score, { tenant_id: tenantId, field })
  registry.increment('novelty_score_total', { tenant_id: tenantId, field })
}

export function recordNoveltyFlush(tenantId: string, durationMs: number): void {
  registry.record('novelty_flush_duration_ms', durationMs, { tenant_id: tenantId })
  registry.increment('novelty_flush_total', { tenant_id: tenantId })
}

export function recordNoveltyError(tenantId: string, field: string, errorType: string): void {
  registry.increment('novelty_error_total', { tenant_id: tenantId, field, error_type: errorType })
}

// ── Queue Metrics ─────────────────────────────────────────────────────────────

export function recordQueueJobEnqueued(tenantId: string, queue: string, priority: number): void {
  registry.increment('queue_job_enqueued_total', { tenant_id: tenantId, queue, priority: String(priority) })
}

export function recordQueueJobDequeued(tenantId: string, queue: string): void {
  registry.increment('queue_job_dequeued_total', { tenant_id: tenantId, queue })
}

export function recordQueueJobProcessed(tenantId: string, queue: string, durationMs: number, success: boolean): void {
  registry.record('queue_job_duration_ms', durationMs, { tenant_id: tenantId, queue, status: success ? 'success' : 'failure' })
  registry.increment('queue_job_processed_total', { tenant_id: tenantId, queue, status: success ? 'success' : 'failure' })
}

export function recordQueueJobFailed(tenantId: string, queue: string, errorType: string): void {
  registry.increment('queue_job_failed_total', { tenant_id: tenantId, queue, error_type: errorType })
}

// ── Cross-Tenant Isolation Metrics ─────────────────────────────────────────────

export function recordCrossTenantAccessAttempt(sourceTenant: string, targetTenant: string, component: string): void {
  registry.increment('cross_tenant_access_attempt_total', { 
    source_tenant: sourceTenant, 
    target_tenant: targetTenant, 
    component 
  })
  log.warn({ source_tenant: sourceTenant, target_tenant: targetTenant, component }, 'Cross-tenant access attempt detected')
}

export function recordMissingTenantId(component: string, operation: string): void {
  registry.increment('missing_tenant_id_total', { component, operation })
  log.error({ component, operation }, 'Missing tenant_id in ML operation')
}

// ── Metrics API ───────────────────────────────────────────────────────────────

export function getCalibrationMetrics(tenantId?: string): Array<{ name: string; tags: Record<string, string>; value: MetricValue }> {
  const prefix = 'calibration_'
  const all = registry.getAllByPrefix(prefix)
  if (tenantId) {
    return all.filter(m => m.tags.tenant_id === tenantId)
  }
  return all
}

export function getNoveltyMetrics(tenantId?: string): Array<{ name: string; tags: Record<string, string>; value: MetricValue }> {
  const prefix = 'novelty_'
  const all = registry.getAllByPrefix(prefix)
  if (tenantId) {
    return all.filter(m => m.tags.tenant_id === tenantId)
  }
  return all
}

export function getQueueMetrics(tenantId?: string): Array<{ name: string; tags: Record<string, string>; value: MetricValue }> {
  const prefix = 'queue_'
  const all = registry.getAllByPrefix(prefix)
  if (tenantId) {
    return all.filter(m => m.tags.tenant_id === tenantId)
  }
  return all
}

export function getIsolationMetrics(): Array<{ name: string; tags: Record<string, string>; value: MetricValue }> {
  return registry.getAllByPrefix('cross_tenant_').concat(registry.getAllByPrefix('missing_tenant_'))
}

export function getAllMetrics(): Array<{ name: string; tags: Record<string, string>; value: MetricValue }> {
  return Array.from(registry['metrics'].entries()).map(([key, value]) => {
    const { name, tags } = registry['parseMetricKey'](key)
    return { name, tags, value }
  })
}

export function resetMetrics(): void {
  registry.reset()
}

// ── Metrics Summary ───────────────────────────────────────────────────────────

export function getMetricsSummary(): {
  calibration: { total_operations: number; tenants: number; avg_duration_ms: number }
  novelty: { total_operations: number; tenants: number; avg_score: number }
  queue: { total_jobs: number; tenants: number; avg_duration_ms: number }
  isolation: { cross_tenant_attempts: number; missing_tenant_ids: number }
} {
  const calibrationMetrics = getCalibrationMetrics()
  const noveltyMetrics = getNoveltyMetrics()
  const queueMetrics = getQueueMetrics()
  const isolationMetrics = getIsolationMetrics()

  const calibrationOps = calibrationMetrics.filter(m => m.name === 'calibration_fit_total').reduce((sum, m) => sum + m.value.count, 0)
  const calibrationTenants = new Set(calibrationMetrics.map(m => m.tags.tenant_id)).size
  const calibrationDuration = calibrationMetrics.filter(m => m.name === 'calibration_fit_duration_ms')
  const avgCalibrationDuration = calibrationDuration.length > 0
    ? calibrationDuration.reduce((sum, m) => sum + m.value.sum, 0) / calibrationDuration.reduce((sum, m) => sum + m.value.count, 0)
    : 0

  const noveltyOps = noveltyMetrics.filter(m => m.name.includes('_total')).reduce((sum, m) => sum + m.value.count, 0)
  const noveltyTenants = new Set(noveltyMetrics.map(m => m.tags.tenant_id)).size
  const noveltyScore = noveltyMetrics.filter(m => m.name === 'novelty_score')
  const avgNoveltyScore = noveltyScore.length > 0
    ? noveltyScore.reduce((sum, m) => sum + m.value.sum, 0) / noveltyScore.reduce((sum, m) => sum + m.value.count, 0)
    : 0

  const queueJobs = queueMetrics.filter(m => m.name === 'queue_job_processed_total').reduce((sum, m) => sum + m.value.count, 0)
  const queueTenants = new Set(queueMetrics.map(m => m.tags.tenant_id)).size
  const queueDuration = queueMetrics.filter(m => m.name === 'queue_job_duration_ms')
  const avgQueueDuration = queueDuration.length > 0
    ? queueDuration.reduce((sum, m) => sum + m.value.sum, 0) / queueDuration.reduce((sum, m) => sum + m.value.count, 0)
    : 0

  const crossTenantAttempts = isolationMetrics.filter(m => m.name === 'cross_tenant_access_attempt_total').reduce((sum, m) => sum + m.value.count, 0)
  const missingTenantIds = isolationMetrics.filter(m => m.name === 'missing_tenant_id_total').reduce((sum, m) => sum + m.value.count, 0)

  return {
    calibration: {
      total_operations: calibrationOps,
      tenants: calibrationTenants,
      avg_duration_ms: Math.round(avgCalibrationDuration * 1000) / 1000,
    },
    novelty: {
      total_operations: noveltyOps,
      tenants: noveltyTenants,
      avg_score: Math.round(avgNoveltyScore * 1000) / 1000,
    },
    queue: {
      total_jobs: queueJobs,
      tenants: queueTenants,
      avg_duration_ms: Math.round(avgQueueDuration * 1000) / 1000,
    },
    isolation: {
      cross_tenant_attempts: crossTenantAttempts,
      missing_tenant_ids: missingTenantIds,
    },
  }
}
