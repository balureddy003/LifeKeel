/**
 * Connector Health Monitor — dead webhook detection and connector heartbeats.
 *
 * The silent killer of SMB automation: a connector stops sending data, no one
 * notices for days, and the business is flying blind. This module surfaces that.
 *
 * For each connected connector per tenant, the monitor:
 *   1. Queries the last event received from that connector
 *   2. Learns the expected inter-event interval from historical data (rolling median)
 *   3. Computes a health score: healthy / degraded / dead
 *   4. Returns heartbeat records for all connectors
 *
 * The monitor does NOT fire alerts itself — it returns `ConnectorHeartbeat[]` which
 * the caller (API or SAQ worker) can use to create engine insights or send notifications.
 *
 * Usage:
 *   const monitor = new ConnectorHealthMonitor(db)
 *   const heartbeats = await monitor.checkAll('tenant-123')
 *   const dead = heartbeats.filter(h => h.health === 'dead')
 *   // Create insights for dead connectors and push to SSE
 *
 * The `learnExpectedInterval()` method uses a 30-day rolling median to
 * avoid false alerts on connectors that are legitimately infrequent.
 */

// MongoDB types injected at runtime — pipeline package does not depend on mongodb directly
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MongoCollection = any
type Db = { collection: (name: string) => MongoCollection }

// ── Types ──────────────────────────────────────────────────────────────────────

export type ConnectorHealthStatus = 'healthy' | 'degraded' | 'dead' | 'unknown'

export interface ConnectorHeartbeat {
  tenant_id: string
  connector_id: string
  last_event_at: Date | null
  /** Minutes since last event (null if never received). */
  silent_for_minutes: number | null
  /** Learned expected inter-event interval in minutes. Null if < 5 historical events. */
  expected_interval_minutes: number | null
  health: ConnectorHealthStatus
  /**
   * Silent ratio: silent_for_minutes / expected_interval_minutes.
   * < 1.5 = healthy, 1.5–3 = degraded, > 3 = dead.
   * Null if expected_interval_minutes is unknown.
   */
  silent_ratio: number | null
  /** Human-readable summary for the Studio connector card. */
  summary: string
  checked_at: Date
}

/** Minimal shape of documents stored in the raw_events collection. */
interface RawEventDoc {
  tenant_id: string
  connector_id: string
  received_at: Date
}

// ── ConnectorHealthMonitor ─────────────────────────────────────────────────────

export class ConnectorHealthMonitor {
  private events: MongoCollection

  constructor(db: Db) {
    this.events = db.collection('raw_events')
  }

  /**
   * Check health of all connectors that have ever sent events to a tenant.
   * Returns one `ConnectorHeartbeat` per (tenant_id, connector_id) pair.
   */
  async checkAll(tenantId: string): Promise<ConnectorHeartbeat[]> {
    // Get all distinct connector_ids that have ever sent events to this tenant
    const connectorIds: string[] = await this.events.distinct('connector_id', { tenant_id: tenantId })
    if (connectorIds.length === 0) return []

    const now = new Date()
    const heartbeats = await Promise.all(
      connectorIds.map((id: string) => this.checkOne(tenantId, id, now)),
    )
    return heartbeats
  }

  /**
   * Check health of a single connector for a tenant.
   */
  async checkOne(
    tenantId: string,
    connectorId: string,
    now: Date = new Date(),
  ): Promise<ConnectorHeartbeat> {
    const [lastEvent, expectedInterval] = await Promise.all([
      this.getLastEvent(tenantId, connectorId),
      this.learnExpectedInterval(tenantId, connectorId),
    ])

    if (!lastEvent) {
      return {
        tenant_id: tenantId,
        connector_id: connectorId,
        last_event_at: null,
        silent_for_minutes: null,
        expected_interval_minutes: expectedInterval,
        health: 'unknown',
        silent_ratio: null,
        summary: 'No events received yet',
        checked_at: now,
      }
    }

    const silentMs = now.getTime() - lastEvent.received_at.getTime()
    const silentMinutes = Math.round(silentMs / 60_000)

    if (!expectedInterval) {
      // Too few historical events to determine expected interval
      return {
        tenant_id: tenantId,
        connector_id: connectorId,
        last_event_at: lastEvent.received_at,
        silent_for_minutes: silentMinutes,
        expected_interval_minutes: null,
        health: 'unknown',
        silent_ratio: null,
        summary: `Last event ${formatMinutes(silentMinutes)} ago (insufficient history to determine expected interval)`,
        checked_at: now,
      }
    }

    const silentRatio = silentMinutes / expectedInterval
    const health = this.classifyHealth(silentRatio)

    return {
      tenant_id: tenantId,
      connector_id: connectorId,
      last_event_at: lastEvent.received_at,
      silent_for_minutes: silentMinutes,
      expected_interval_minutes: expectedInterval,
      health,
      silent_ratio: Math.round(silentRatio * 100) / 100,
      summary: this.buildSummary(health, silentMinutes, expectedInterval),
      checked_at: now,
    }
  }

  /**
   * Learn the expected inter-event interval for a connector using the rolling
   * median of gaps between events over the last 30 days.
   *
   * Returns null if fewer than 5 events exist (insufficient data).
   */
  async learnExpectedInterval(
    tenantId: string,
    connectorId: string,
  ): Promise<number | null> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const recentEvents = await this.events
      .find({ tenant_id: tenantId, connector_id: connectorId, received_at: { $gte: since } })
      .sort({ received_at: 1 })
      .project({ received_at: 1 })
      .limit(500)
      .toArray()

    if (recentEvents.length < 5) return null

    // Compute gaps in minutes between consecutive events
    const gaps: number[] = []
    for (let i = 1; i < recentEvents.length; i++) {
      const prev = recentEvents[i - 1]!.received_at.getTime()
      const curr = recentEvents[i]!.received_at.getTime()
      const gapMinutes = (curr - prev) / 60_000
      if (gapMinutes > 0 && gapMinutes < 24 * 60) {
        // Only include gaps < 24h to exclude maintenance windows
        gaps.push(gapMinutes)
      }
    }

    if (gaps.length === 0) return null

    // Median gap (more robust than mean for skewed distributions)
    gaps.sort((a, b) => a - b)
    const mid = Math.floor(gaps.length / 2)
    const median = gaps.length % 2 === 0
      ? ((gaps[mid - 1]! + gaps[mid]!) / 2)
      : gaps[mid]!

    return Math.max(1, Math.round(median))
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async getLastEvent(
    tenantId: string,
    connectorId: string,
  ): Promise<{ received_at: Date } | null> {
    const doc = await this.events
      .findOne(
        { tenant_id: tenantId, connector_id: connectorId },
        { sort: { received_at: -1 }, projection: { received_at: 1 } },
      )
    return doc ? { received_at: doc.received_at } : null
  }

  private classifyHealth(silentRatio: number): ConnectorHealthStatus {
    if (silentRatio < 1.5) return 'healthy'
    if (silentRatio < 3.0) return 'degraded'
    return 'dead'
  }

  private buildSummary(
    health: ConnectorHealthStatus,
    silentMinutes: number,
    expectedMinutes: number,
  ): string {
    const silentStr = formatMinutes(silentMinutes)
    const expectedStr = formatMinutes(expectedMinutes)
    switch (health) {
      case 'healthy':
        return `Active — last event ${silentStr} ago (expected every ${expectedStr})`
      case 'degraded':
        return `Delayed — silent for ${silentStr}, expected every ${expectedStr}. Check connection.`
      case 'dead':
        return `No data — silent for ${silentStr}, expected every ${expectedStr}. Webhook may be broken.`
      default:
        return `Unknown status — last event ${silentStr} ago`
    }
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (mins === 0) return `${hours}h`
  if (hours < 24) return `${hours}h ${mins}m`
  const days = Math.floor(hours / 24)
  const remainHours = hours % 24
  return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`
}
