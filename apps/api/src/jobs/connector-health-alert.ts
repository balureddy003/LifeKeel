/**
 * Connector health alerting.
 *
 * Scans `connector_sync_state.last_error` for recent credential failures
 * (401/403) during background data syncs.
 *
 * Creates a user-facing insight so tenants are notified when an API key expires
 * or is revoked. The generated insight uses a synthetic detector/rule ID so it
 * never collides with real detector output, and it deduplicates within a 24-hour
 * window per tenant+connector so it doesn't spam.
 */

import type { Db } from 'mongodb'
import type { Insight } from '@lifekeel/engine'
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
  const credCol = db.collection('connector_credentials')
  const insightsCol = db.collection('insights')
  const dedupCol = db.collection('connector_health_dedup')
  await dedupCol.createIndex({ tenant_id: 1, connector_id: 1 }, { unique: true }).catch(() => {})

  const cutoff = new Date(now.getTime() - lookbackMs)

  // ── Sync state 401/403 failures ───────────────────────────────────────
  const syncQuery: Record<string, unknown> = {
    'last_error.status': { $in: [401, 403] },
    'last_error.at': { $gte: cutoff },
  }
  if (tenantId) syncQuery['tenant_id'] = tenantId

  const failingSync = await stateCol.find(syncQuery).toArray()

  type Failure = {
    tenantId: string
    connectorId: string
    status: number
    statusText: string
  }

  const failures: Failure[] = []
  for (const s of failingSync) {
    failures.push({
      tenantId: s['tenant_id'] as string,
      connectorId: s['connector_id'] as string,
      status: s['last_error']?.['status'] as number,
      statusText: (s['last_error']?.['status_text'] as string) ?? '',
    })
  }

  let created = 0
  let skipped = 0

  for (const failure of failures) {
    const { tenantId: tid, connectorId } = failure

    // Look up the connector name from the stored credentials (or fallback).
    const cred = await credCol.findOne({ tenant_id: tid, connector_id: connectorId })
    const connectorName = (cred?.['name'] as string) ?? connectorId

    // KEEL-003: dedupe (don't alert for the same tenant+connector within the
    // 24h window) used to be a findOne-then-insertOne pair — two replicas
    // of this */15-minute cron could both find no existing alert before
    // either inserted one, producing duplicate health-alert insights for
    // the same connector. This atomically "claims" the dedup window first
    // (findOneAndUpdate against a dedicated marker collection, unique
    // index on tenant_id+connector_id) and only proceeds to insert the
    // insight if this call actually won the claim.
    const dedupWindowStart = new Date(now.getTime() - DEDUP_WINDOW_MS)
    let claim: Record<string, unknown> | null
    try {
      claim = await dedupCol.findOneAndUpdate(
        { tenant_id: tid, connector_id: connectorId, alerted_at: { $lt: dedupWindowStart } },
        { $set: { tenant_id: tid, connector_id: connectorId, alerted_at: now } },
        { upsert: true, returnDocument: 'after' },
      )
    } catch (err) {
      // Duplicate-key error (Mongo code 11000): another concurrent call
      // won the upsert race on a brand-new marker doc for this
      // tenant+connector pair (only possible the very first time this
      // pair is ever alerted on, before the unique index has a document
      // to enforce uniqueness against) — that other call is the one
      // proceeding, this one skips.
      if ((err as { code?: number }).code === 11000) {
        skipped++
        continue
      }
      throw err
    }
    if (!claim || (claim['alerted_at'] as Date)?.getTime() !== now.getTime()) {
      skipped++
      continue
    }

    const { status: errorStatus, statusText: errorText } = failure

    const insight: Insight = {
      id: randomUUID(),
      tenant_id: tid,
      hypothesis: `${connectorName} credentials expired or were revoked`,
      category: 'risk',
      urgency: 'high',
      estimated_impact_low: 0,
      estimated_impact_high: 0,
      reasoning: `The last sync for ${connectorName} failed with HTTP ${errorStatus}${errorText ? ` (${errorText})` : ''}. This usually means the API key expired, was revoked, or lacks the required permissions. Data sync is paused until the credentials are updated. Go to Connectors → ${connectorName} to reconnect.`,
      actions: ['Go to Connectors and reconnect the integration'],
      confidence_breakdown: {
        or_score: 0.95,
        combined_score: 0.95,
        model_version: 'system@1',
        evidence_refs: ['connector_sync_state:last_error'],
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
      },
    }

    await insightsCol.insertOne(insight)
    created++
  }

  return { created, skipped }
}
