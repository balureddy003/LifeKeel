/**
 * Connector health alerting.
 *
 * Scans two sources for recent credential failures (401/403):
 *
 *   1. `connector_sync_state.last_error` — background data sync failures.
 *   2. `pending_trades.receipt.reason` — broker trade execution failures.
 *
 * The second source is critical for the trading-investment vertical: a bad
 * Trading 212 API key will reject every auto-placed order with HTTP 401, but
 * those failures land in `pending_trades`, not in sync state. Without scanning
 * both, a tenant with auto-trading enabled would silently accumulate rejected
 * trades and never be notified that their broker credentials are broken.
 *
 * Creates a user-facing insight so tenants are notified when an API key expires
 * or is revoked. The generated insight uses a synthetic detector/rule ID so it
 * never collides with real detector output, and it deduplicates within a 24-hour
 * window per tenant+connector so it doesn't spam.
 */

import type { Db } from 'mongodb'
import type { Insight } from '@kairos/engine'
import { randomUUID } from 'node:crypto'

const DETECTOR_ID = 'system_connector_health'
const RULE_ID = 'expired_credentials'
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000

export interface ConnectorHealthAlertOptions {
  db: Db
  tenantId?: string
  lookbackMs?: number
  now?: Date
}

export async function createCredentialExpiryInsights(
  opts: ConnectorHealthAlertOptions,
): Promise<{ created: number; skipped: number }> {
  const { db, tenantId, lookbackMs = 30 * 60 * 1000, now = new Date() } = opts
  const stateCol = db.collection('connector_sync_state')
  const tradesCol = db.collection('pending_trades')
  const credCol = db.collection('connector_credentials')
  const insightsCol = db.collection('insights')

  const cutoff = new Date(now.getTime() - lookbackMs)

  // ── Source 1: sync state 401/403 failures ──────────────────────────────
  const syncQuery: Record<string, unknown> = {
    'last_error.status': { $in: [401, 403] },
    'last_error.at': { $gte: cutoff },
  }
  if (tenantId) syncQuery['tenant_id'] = tenantId

  const failingSync = await stateCol.find(syncQuery).toArray()

  // ── Source 2: broker trade execution 401/403 failures ──────────────────
  // A bad broker API key rejects every order with HTTP 401, but those failures
  // land in pending_trades.receipt.reason, not in sync state. Without this
  // scan, auto-trading tenants silently accumulate rejected trades.
  const tradeQuery: Record<string, unknown> = {
    status: 'rejected',
    'receipt.reason': /HTTP 40[13]/,
    updated_at: { $gte: cutoff },
  }
  if (tenantId) tradeQuery['tenant_id'] = tenantId

  const rejectedTrades = await tradesCol.find(tradeQuery).toArray()

  // Build a unified list of (tenant, connector, errorStatus, errorText) tuples.
  // Trading 212 is the only broker connector for now, so rejected trades map to
  // 'trading-212'. When more brokers are added, the trade doc should carry an
  // explicit connector_id — until then this fallback is correct.
  type Failure = {
    tenantId: string
    connectorId: string
    status: number
    statusText: string
    source: 'sync' | 'trade_execution'
  }

  const failures: Failure[] = []
  for (const s of failingSync) {
    failures.push({
      tenantId: s['tenant_id'] as string,
      connectorId: s['connector_id'] as string,
      status: s['last_error']?.['status'] as number,
      statusText: (s['last_error']?.['status_text'] as string) ?? '',
      source: 'sync',
    })
  }
  for (const t of rejectedTrades) {
    failures.push({
      tenantId: t['tenant_id'] as string,
      connectorId: 'trading-212',
      status: /HTTP 401/.test(t['receipt']?.['reason'] ?? '') ? 401 : 403,
      statusText: 'Unauthorized',
      source: 'trade_execution',
    })
  }

  let created = 0
  let skipped = 0

  for (const failure of failures) {
    const { tenantId: tid, connectorId } = failure

    // Look up the connector name from the stored credentials (or fallback).
    const cred = await credCol.findOne({ tenant_id: tid, connector_id: connectorId })
    const connectorName = (cred?.['name'] as string) ?? connectorId

    // Dedupe: don't create another alert for the same tenant+connector in the
    // last 24 hours.
    const existing = await insightsCol.findOne({
      tenant_id: tid,
      detector_id: DETECTOR_ID,
      rule_id: RULE_ID,
      entity_key: connectorId,
      state: 'identified',
      created_at: { $gte: new Date(now.getTime() - DEDUP_WINDOW_MS) },
    })
    if (existing) {
      skipped++
      continue
    }

    const { status: errorStatus, statusText: errorText, source } = failure
    const sourceLabel = source === 'trade_execution'
      ? 'Auto-placed trade'
      : 'The last sync'

    const insight: Insight = {
      id: randomUUID(),
      tenant_id: tid,
      hypothesis: `${connectorName} credentials expired or were revoked`,
      category: 'risk',
      urgency: 'high',
      estimated_impact_low: 0,
      estimated_impact_high: 0,
      reasoning: `${sourceLabel} for ${connectorName} failed with HTTP ${errorStatus}${errorText ? ` (${errorText})` : ''}. This usually means the API key expired, was revoked, or lacks the required permissions. Auto-trading and data sync are paused until the credentials are updated. Go to Connectors → ${connectorName} to reconnect.`,
      actions: ['Go to Connectors and reconnect the integration'],
      confidence_breakdown: {
        or_score: 0.95,
        combined_score: 0.95,
        model_version: 'system@1',
        evidence_refs: [source === 'trade_execution' ? 'pending_trades:receipt.reason' : 'connector_sync_state:last_error'],
      },
      detector_id: DETECTOR_ID,
      rule_id: RULE_ID,
      state: 'identified',
      created_at: now,
      derived_from_signals: [],
      entity_key: connectorId,
      feature_snapshot: {
        connector_id: connectorId,
        status: errorStatus,
        source,
      },
    }

    await insightsCol.insertOne(insight)
    created++
  }

  return { created, skipped }
}
