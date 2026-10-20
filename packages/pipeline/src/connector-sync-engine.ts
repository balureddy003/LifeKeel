/**
 * ConnectorSyncEngine
 *
 * Two jobs in one:
 *
 * 1. LIVE POLLING  — every N minutes, fetch the latest page of each resource
 *    for every connected connector per tenant, generate events, run detectors.
 *
 * 2. HISTORICAL BACKFILL — on first connect (or on-demand) walk ALL pages for
 *    a lookback window (default 180 days) and replay them through the engine.
 *    This answers "does this work on historical data?" — YES. Connect Xero today
 *    and LifeKeel will surface every overdue invoice from the last 6 months within
 *    minutes.
 *
 * Architecture
 * ────────────
 *  ConnectorSyncEngine
 *    ├── schedulePoll(db, engine, …)      — starts cron loop
 *    ├── runPoll(tenantId, connectorId)   — one poll cycle
 *    ├── backfill(tenantId, connectorId)  — full historical replay
 *    └── fetchAllPages(…)                — generic paginated HTTP fetcher
 *
 * Each connector resource is defined in its YAML with:
 *   resources:
 *     - name: Invoices
 *       path: /Invoices
 *       params: { Statuses: AUTHORISED,SUBMITTED }
 *       pagination: { type: page, param: page }
 *       date_filter_param: DateFrom     ← optional: enables incremental sync
 *
 * Token refresh is handled transparently — if a request returns 401,
 * refreshAccessToken() is called once and the request is retried.
 */

import type { ConnectorConfig } from './schemas.js'
import type { EventGenerator } from './event-generator.js'
import type { Engine, Insight } from '@lifekeel/engine'
import { safeFetch } from './safe-fetch.js'
import { createLogger, decryptIfNeeded } from '@lifekeel/platform'

const log = createLogger({ service: 'connector-sync', version: '0.0.0' })

// Injected MongoDB types (pipeline pkg has no direct mongodb dep)
 
type Db = { collection: (name: string) => any }

// Google connectors that can use shared credentials
const GOOGLE_CONNECTORS = ['google_calendar', 'gmail', 'google_drive', 'youtube', 'google_sheets', 'google_business']

function getGoogleClientId(connectorId: string): string {
  // Try connector-specific first for backward compatibility
  const specificId = process.env[`LIFEKEEL_${connectorId.toUpperCase()}_CLIENT_ID`]
  if (specificId) return specificId
  
  // Fall back to shared Google credentials for Google services
  if (GOOGLE_CONNECTORS.includes(connectorId)) {
    return process.env['GOOGLE_CLIENT_ID'] ?? ''
  }
  
  return ''
}

function getGoogleClientSecret(connectorId: string): string {
  // Try connector-specific first for backward compatibility
  const specificSecret = process.env[`LIFEKEEL_${connectorId.toUpperCase()}_CLIENT_SECRET`]
  if (specificSecret) return specificSecret
  
  // Fall back to shared Google credentials for Google services
  if (GOOGLE_CONNECTORS.includes(connectorId)) {
    return process.env['GOOGLE_CLIENT_SECRET'] ?? ''
  }
  
  return ''
}

export interface SyncCredentials {
  tenant_id: string
  connector_id: string
  auth_type: 'oauth2' | 'api_key' | 'basic' | 'http_basic'
  access_token?: string
  refresh_token?: string
  token_expires_at?: Date
  api_key?: string
  api_key_header?: string
  api_key_prefix?: string
  username?: string
  password?: string
  extra?: Record<string, string>
}

export interface SyncState {
  tenant_id: string
  connector_id: string
  resource: string
  last_synced_at: Date | null
  last_cursor: string | null
  backfill_complete: boolean
  total_records_synced: number
  /** Set when the most recent sync fetched 0 records because the HTTP request
   * failed (bad credentials, connector down), not because the account is
   * genuinely empty. Cleared (null) on the next successful sync. */
  last_error?: { status: number; status_text: string; at: Date } | null
}

export interface SyncResult {
  tenant_id: string
  connector_id: string
  resource: string
  records_fetched: number
  events_generated: number
  insights_triggered: number
  backfill: boolean
  duration_ms: number
  error?: { status: number; status_text: string }
}

// Token exchange URLs per connector
const TOKEN_REFRESH_URLS: Record<string, string> = {
  xero: 'https://identity.xero.com/connect/token',
  hubspot: 'https://api.hubapi.com/oauth/v1/token',
  google_calendar: 'https://oauth2.googleapis.com/token',
  gmail: 'https://oauth2.googleapis.com/token',
  google_drive: 'https://oauth2.googleapis.com/token',
  youtube: 'https://oauth2.googleapis.com/token',
  google_sheets: 'https://oauth2.googleapis.com/token',
  shopify: '', // uses per-shop URL — handled separately
}

function assertExternalUrlAllowed(url: string, context: string): void {
  if (process.env['LIFEKEEL_DEPLOYMENT_MODE'] !== 'airgap') return
  const parsed = new URL(url, 'http://localhost')
  const host = parsed.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return
  throw new Error(`External network access blocked in airgap mode for ${context}: ${url.slice(0, 80)}`)
}

export class ConnectorSyncEngine {
  private readonly db: Db
  private readonly eventGenerator: EventGenerator
  private readonly engine: Engine
  private readonly onInsightsGenerated: ((insights: Insight[], tenantId: string) => Promise<void>) | undefined
  private running = false
  // Set when fetchResourcePages hits a non-ok HTTP response — lets syncResource
  // distinguish "0 records because the request actually failed" (bad API key,
  // connector down) from "0 records because the account genuinely has none",
  // which previously looked identical in connector_sync_state.
  private lastFetchError: { status: number; statusText: string } | null = null

  /**
   * @param onInsightsGenerated Optional hook called after each batch of
   *   insights is persisted during a connector sync — e.g. wired to
   *   DeliveryRouter.deliver() in apps/api/src/server.ts so an insight
   *   reaches the tenant (WhatsApp/
   *   SMS/email, with a signed approve/dismiss link) without them having to
   *   poll the app. Deliberately a callback, not a direct dependency, so this
   *   package doesn't need to import apps/api's DeliveryRouter.
   */
  constructor(
    db: Db,
    eventGenerator: EventGenerator,
    engine: Engine,
    onInsightsGenerated?: (insights: Insight[], tenantId: string) => Promise<void>,
  ) {
    this.db = db
    this.eventGenerator = eventGenerator
    this.engine = engine
    this.onInsightsGenerated = onInsightsGenerated
  }

  // ─── Token Management ──────────────────────────────────────────────────────

  /** Refresh an OAuth access token using the stored refresh_token. */
  async refreshAccessToken(
    tenantId: string,
    connectorId: string,
    creds: SyncCredentials,
  ): Promise<string> {
    const tokenUrl = TOKEN_REFRESH_URLS[connectorId]
    if (!tokenUrl || !creds.refresh_token) {
      throw new Error(`Cannot refresh token for ${connectorId}: no refresh_token or URL`)
    }
    assertExternalUrlAllowed(tokenUrl, `${connectorId} token refresh`)

    const clientId = getGoogleClientId(connectorId)
    const clientSecret = getGoogleClientSecret(connectorId)

    const res = await safeFetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    })

    const data = await res.json() as {
      access_token: string
      refresh_token?: string
      expires_in?: number
      error?: string
    }

    if (!res.ok || data.error) {
      throw new Error(`Token refresh failed for ${connectorId}: ${data.error}`)
    }

    // Persist updated tokens
    const col = this.db.collection('connector_credentials')
    await col.updateOne(
      { tenant_id: tenantId, connector_id: connectorId },
      {
        $set: {
          access_token: data.access_token,
          ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
          ...(data.expires_in
            ? { token_expires_at: new Date(Date.now() + data.expires_in * 1000) }
            : {}),
          updated_at: new Date(),
        },
      },
    )

    return data.access_token
  }

  /** Check if a token is close to expiry (within 5 minutes). */
  isTokenExpiringSoon(creds: SyncCredentials): boolean {
    if (!creds.token_expires_at) return false
    return creds.token_expires_at.getTime() - Date.now() < 5 * 60 * 1000
  }

  // ─── HTTP Fetch with auto-retry on 401 / 429 ──────────────────────────────

  /** Parses a `Retry-After` header (seconds, or an HTTP-date) into a millisecond delay. */
  private parseRetryAfterMs(res: Response): number {
    const header = res.headers.get('retry-after')
    if (!header) return 2000
    const seconds = Number(header)
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
    const dateMs = Date.parse(header)
    return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 2000
  }

  private async fetchWithAuth(
    url: string,
    creds: SyncCredentials,
    tenantId: string,
    connectorId: string,
    auth?: ConnectorConfig['auth'],
  ): Promise<Response> {
    // Proactively refresh if near expiry
    if (creds.auth_type === 'oauth2' && this.isTokenExpiringSoon(creds)) {
      try {
        creds.access_token = await this.refreshAccessToken(tenantId, connectorId, creds)
      } catch {
        // continue with stale token — will 401 and retry below
      }
    }

    const headers = this.buildAuthHeaders(creds, auth)
    assertExternalUrlAllowed(url, `${connectorId} sync`)
    let res = await safeFetch(url, { headers })

    // If 401, refresh once and retry
    if (res.status === 401 && creds.auth_type === 'oauth2' && creds.refresh_token) {
      try {
        creds.access_token = await this.refreshAccessToken(tenantId, connectorId, creds)
        res = await safeFetch(url, { headers: this.buildAuthHeaders(creds, auth) })
      } catch {
        // token refresh failed — return original 401
      }
    }

    // Rate limited — most providers send Retry-After. Wait it out and retry
    // once. The cap is 60s, not the earlier 15s: some providers' tightest
    // per-endpoint windows sit at ~1 req/50s, so a shorter cap meant the
    // retry fired before the window actually cleared and just collected a
    // second 429. Only one retry (not two) since at this cap a single retry
    // can already block a sync for up to a minute.
    if (res.status === 429) {
      const waitMs = Math.min(this.parseRetryAfterMs(res), 60_000)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      res = await safeFetch(url, { headers: this.buildAuthHeaders(creds, auth) })
    }

    return res
  }

  private buildAuthHeaders(creds: SyncCredentials, auth?: ConnectorConfig['auth']): Record<string, string> {
    // When the connector declares an api_key query parameter, do not also send
    // it as an Authorization header.
    if (auth?.param && creds.auth_type === 'api_key') {
      return {}
    }
    if (creds.auth_type === 'oauth2') {
      return { Authorization: `Bearer ${creds.access_token ?? ''}` }
    }
    if (creds.auth_type === 'api_key') {
      const header = creds.api_key_header ?? 'Authorization'
      const prefix = creds.api_key_prefix ? `${creds.api_key_prefix} ` : ''
      return { [header]: `${prefix}${creds.api_key ?? ''}` }
    }
    if (creds.auth_type === 'basic' || creds.auth_type === 'http_basic') {
      const encoded = Buffer.from(`${creds.username}:${creds.password}`).toString('base64')
      return { Authorization: `Basic ${encoded}` }
    }
    return {}
  }

  // ─── Paginated Resource Fetcher ────────────────────────────────────────────

  /**
   * Fetch all records from a connector resource, walking pagination.
   *
   * @param connector  Connector definition (from YAML)
   * @param resource   Resource config (name, path, pagination config)
   * @param creds      Decrypted credentials
   * @param tenantId   Tenant ID
   * @param options    dateFrom for incremental sync; maxPages safety limit
   */
  async fetchAllPages(
    connector: ConnectorConfig,
    resource: NonNullable<ConnectorConfig['resources']>[number],
    creds: SyncCredentials,
    tenantId: string,
    options: {
      dateFrom?: Date
      maxPages?: number
    } = {},
  ): Promise<unknown[]> {
    return this.fetchResourcePages(connector, resource, creds, tenantId, options)
  }

  private async fetchResourcePages(
    connector: ConnectorConfig,
    resource: NonNullable<ConnectorConfig['resources']>[number],
    creds: SyncCredentials,
    tenantId: string,
    options: {
      dateFrom?: Date
      maxPages?: number
    } = {},
  ): Promise<unknown[]> {
    const maxPages = options.maxPages ?? 100
    const allRecords: unknown[] = []
    this.lastFetchError = null

    // Build base URL + static params from YAML
    // Per-tenant live mode is opt-in via credential extra.live_mode. When set,
    // use the connector's live_base_url if provided; otherwise fall back to base_url.
    const isLive = creds.extra?.['live_mode'] === 'true'
    const configuredBaseUrl = isLive && connector.live_base_url
      ? connector.live_base_url
      : connector.base_url
    const baseUrl = configuredBaseUrl.replace(/\/$/, '')
    const params = new URLSearchParams(resource.params ?? {})

    // Inject date filter for incremental sync if connector supports it
    const dateFilterParam = resource.date_filter_param
    if (options.dateFrom && dateFilterParam) {
      const dateStr = options.dateFrom.toISOString().substring(0, 10)
      params.set(dateFilterParam, dateStr)
    }

    // Inject api_key as a query parameter when the connector declares one
    if (connector.auth.param && creds.auth_type === 'api_key' && creds.api_key) {
      params.set(connector.auth.param, creds.api_key)
    }

    let page = 1
    let cursor: string | null = null
    let nextUrl: string | null = null
    let hasMore = true

    while (hasMore && page <= maxPages) {
      let url: URL
      if (nextUrl) {
        url = new URL(nextUrl)
        nextUrl = null
      } else {
        url = new URL(`${baseUrl}${resource.path ?? ''}`)
        // Copy static params
        params.forEach((v, k) => url.searchParams.set(k, v))

        // Pagination params
        if (resource.pagination) {
          const pg = resource.pagination
          if (pg.type === 'page' && pg.param) {
            url.searchParams.set(pg.param, String(page))
          } else if (pg.type === 'cursor' && cursor && pg.param) {
            url.searchParams.set(pg.param, cursor)
          } else if (pg.type === 'offset' && pg.param) {
            url.searchParams.set(pg.param, String((page - 1) * 100))
          }
        }
      }

      // Add Xero-specific tenant header if needed
      if (connector.id === 'xero' && creds.extra?.['xero_tenant_id']) {
        const res = await this.fetchWithAuth(url.toString(), creds, tenantId, connector.id, connector.auth)
        // Hack: Xero needs Xero-tenant-id header
        const headers = {
          ...this.buildAuthHeaders(creds, connector.auth),
          'Xero-tenant-id': creds.extra['xero_tenant_id'],
        }
        const xeroRes = await safeFetch(url.toString(), { headers })
        if (!xeroRes.ok) {
          this.lastFetchError = { status: xeroRes.status, statusText: xeroRes.statusText }
          break
        }
        const body = await xeroRes.json() as Record<string, unknown>
        const key = resource.pagination?.response_key ?? resource.name
        const records = (body[key] as unknown[]) ?? []
        allRecords.push(...records)
        hasMore = records.length >= 100
        page++
        continue
      }

      const res = await this.fetchWithAuth(url.toString(), creds, tenantId, connector.id, connector.auth)
      if (!res.ok) {
        this.lastFetchError = { status: res.status, statusText: res.statusText }
        break
      }

      const body = await res.json() as Record<string, unknown>

      // Extract records from response
      const responseKey = resource.pagination?.response_key ?? resource.name
      let records: unknown[] = []

      if (resource.response_shape === 'object' && body && typeof body === 'object' && !Array.isArray(body)) {
        // Single-object endpoint (e.g., an account-summary resource)
        records = [body]
      } else if (Array.isArray(body)) {
        records = body
      } else if (responseKey && Array.isArray(body[responseKey])) {
        records = body[responseKey] as unknown[]
      } else {
        // Try common envelope patterns: data, items, results, records
        for (const key of ['data', 'items', 'results', 'records']) {
          if (Array.isArray(body[key])) {
            records = body[key] as unknown[]
            break
          }
        }
      }

      allRecords.push(...records)

      // Determine if there are more pages
      if (resource.pagination) {
        const pg = resource.pagination
        if (pg.type === 'page') {
          hasMore = records.length >= 100 // assume page size 100
        } else if (pg.type === 'cursor') {
          cursor = (body['next_cursor'] as string) ?? (body['cursor'] as string) ?? null
          hasMore = cursor !== null
        } else if (pg.type === 'link') {
          const nextLink = (body['nextPagePath'] as string) ?? (body['next'] as string) ?? null
          if (nextLink) {
            nextUrl = new URL(nextLink, url).toString()
          }
          hasMore = !!nextUrl
        } else {
          hasMore = records.length >= 100
        }
      } else {
        hasMore = false // single page
      }

      page++
    }

    return allRecords
  }

  // ─── Single Resource Sync ──────────────────────────────────────────────────

  /** Sync one resource for one tenant+connector. */
  async syncResource(
    connector: ConnectorConfig,
    resource: NonNullable<ConnectorConfig['resources']>[number],
    creds: SyncCredentials,
    tenantId: string,
    backfill: boolean,
  ): Promise<SyncResult> {
    const start = Date.now()
    const stateCol = this.db.collection('connector_sync_state')

    const state = await stateCol.findOne({
      tenant_id: tenantId,
      connector_id: connector.id,
      resource: resource.name,
    }) as SyncState | null

    // For incremental sync: use last sync time; for backfill: go back 180 days
    const dateFrom = backfill
      ? new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
      : state?.last_synced_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000)

    const records = await this.fetchAllPages(connector, resource, creds, tenantId, {
      dateFrom,
      maxPages: backfill ? 500 : 10, // backfill walks more pages
    })

    let eventsGenerated = 0
    let insightsTriggered = 0

    // Map each raw record to a LifeKeel event and run detectors
    for (const record of records) {
      try {
        const event = this.eventGenerator.generateFromWebhook({
          connector,
          tenant_id: tenantId,
          payload: record as Record<string, unknown>,
          source_event_type: resource.name.toLowerCase(),
        })

        if (!event) continue // deduplication skipped it
        eventsGenerated++

        const signalsCol = this.db.collection('signals')
        await Promise.all([
          signalsCol.createIndex({ tenant_id: 1, signal_type: 1, created_at: -1 }),
          signalsCol.createIndex({ signal_hash: 1 }, { unique: true }),
        ]).catch(() => {})
        await signalsCol.updateOne(
          { signal_hash: event.event_hash },
          {
            $setOnInsert: {
              id: event.id,
              tenant_id: event.tenant_id,
              signal_type: event.event_type,
              source: connector.id,
              connector_id: connector.id,
              external_id: event.id,
              data: event.raw_data,
              signal_hash: event.event_hash,
              occurred_at: event.received_at,
              created_at: event.received_at,
              ingested_at: new Date(),
            },
          },
          { upsert: true },
        )

        // Map RawEvent → EvaluateInput (engine expects event_id + data)
        const evalInput = {
          event_type: event.event_type,
          tenant_id: event.tenant_id,
          event_id: event.id,
          data: event.raw_data,
          derived_from_signals: [event.id],
        }
        const result = await this.engine.evaluate(evalInput)
        insightsTriggered += result.insights.length

        // Persist insights
        if (result.insights.length > 0) {
          const insightsCol = this.db.collection('insights')
          // Detector.detectAll() mints a fresh id on every call, so upserting on
          // `{ id: insight.id }` can never match a prior doc — every backfill or
          // poll cycle re-firing the same still-open condition created a fresh
          // duplicate insight instead of refreshing the existing one. Dedupe on
          // the natural identity — same tenant + detector + rule + ticker, still
          // open — the same fix applied in apps/api/src/routes/events.ts.
          const ops = result.insights.map(insight => {
            const ticker = (insight.feature_snapshot as Record<string, unknown> | undefined)?.['ticker']
            const dedupeFilter: Record<string, unknown> = {
              tenant_id: insight.tenant_id,
              detector_id: insight.detector_id,
              hypothesis: insight.hypothesis,
              ...(ticker !== undefined ? { 'feature_snapshot.ticker': ticker } : {}),
              state: { $nin: ['dismissed', 'completed', 'archived'] },
            }
            const { feature_snapshot, confidence_breakdown, evidence_trail, derived_from_signals, reasoning, estimated_impact_low, estimated_impact_high, ...firstSeenFields } = insight
            return {
              updateOne: {
                filter: dedupeFilter,
                update: {
                  $set: { feature_snapshot, confidence_breakdown, evidence_trail, derived_from_signals, reasoning, estimated_impact_low, estimated_impact_high },
                  $setOnInsert: { ...firstSeenFields, source: 'sync', backfill },
                },
                upsert: true,
              },
            }
          })
          const bulkResult = await insightsCol.bulkWrite(ops, { ordered: false })
          try {
            await this.ensureVerifiedMoments(result.insights)
          } catch (err) {
            // Verified-moments bookkeeping is best-effort — it must never take
            // down insight delivery / workflow-triggering below, which sit in
            // the same outer try/catch and were silently getting lost whenever
            // this failed (e.g. on a duplicate-key race under concurrent syncs).
            log.error({ tenant_id: tenantId, connector_id: connector.id, err }, 'ensureVerifiedMoments failed')
          }

          // Only genuinely new insights, not ones matched (and just
          // refreshed) by the dedupe filter above — otherwise a still-open
          // condition re-notifies and re-triggers workflows on every single
          // poll cycle forever, instead of once when it first appears.
          const newlyInsertedIndexes = new Set(Object.keys(bulkResult.upsertedIds).map(Number))
          const newInsights = result.insights.filter((_, i) => newlyInsertedIndexes.has(i))

          // Notify the tenant for live syncs only — a 180-day backfill would
          // otherwise fire a flood of historical notifications on first connect.
          if (!backfill && newInsights.length > 0 && this.onInsightsGenerated) {
            try {
              await this.onInsightsGenerated(newInsights, tenantId)
            } catch (err) {
              log.error({ tenant_id: tenantId, connector_id: connector.id, err }, 'Insight delivery failed')
            }
          }
        }
      } catch {
        // skip malformed records
      }
    }

    // Update sync state. A resource that fetched 0 records because the HTTP
    // request itself failed (bad API key, connector down) looks identical to
    // one that fetched 0 records because the account genuinely has none —
    // record last_error so the UI can tell those apart instead of showing
    // "0 records" either way.
    const hadError = records.length === 0 && this.lastFetchError !== null
    await stateCol.updateOne(
      { tenant_id: tenantId, connector_id: connector.id, resource: resource.name },
      {
        $set: {
          last_synced_at: new Date(),
          backfill_complete: backfill || (state?.backfill_complete ?? false),
          ...(hadError
            ? { last_error: { status: this.lastFetchError!.status, status_text: this.lastFetchError!.statusText, at: new Date() } }
            : { last_error: null }),
        },
        $inc: { total_records_synced: records.length },
        $setOnInsert: { last_cursor: null },
      },
      { upsert: true },
    )

    return {
      tenant_id: tenantId,
      connector_id: connector.id,
      resource: resource.name,
      records_fetched: records.length,
      events_generated: eventsGenerated,
      insights_triggered: insightsTriggered,
      backfill,
      duration_ms: Date.now() - start,
      ...(hadError ? { error: { status: this.lastFetchError!.status, status_text: this.lastFetchError!.statusText } } : {}),
    }
  }

  private async ensureVerifiedMoments(insights: Insight[]): Promise<void> {
    if (insights.length === 0) return
    const col = this.db.collection('verified_moments')
    await Promise.all([
      col.createIndex({ tenant_id: 1, created_at: -1 }),
      col.createIndex({ tenant_id: 1, insight_id: 1 }, { unique: true }),
      col.createIndex({ tenant_id: 1, goal_id: 1, created_at: -1 }),
      col.createIndex({ tenant_id: 1, status: 1 }),
    ]).catch(() => {})

    const crypto = await import('node:crypto')
    const ops = insights.map((insight) => {
      const record = insight as unknown as Record<string, unknown>
      const features = (record['feature_snapshot'] as Record<string, unknown> | undefined) ?? {}
      const goalId = features['goal_id'] ?? record['goal_id']
      const metric = features['metric'] ?? record['metric']
      const signalIds = [...new Set([...(insight.derived_from_signals ?? []), ...insight.confidence_breakdown.evidence_refs])]
      const id = `vm_${crypto.createHash('sha256').update(`${insight.tenant_id}:${insight.id}`).digest('hex').slice(0, 24)}`
      return {
        updateOne: {
          filter: { tenant_id: insight.tenant_id, insight_id: insight.id },
          update: {
            $setOnInsert: {
              id,
              tenant_id: insight.tenant_id,
              insight_id: insight.id,
              detector_id: insight.detector_id,
              rule_id: insight.rule_id,
              status: 'verified',
              verification_method: 'deterministic_rule',
              confidence: insight.confidence_breakdown.or_score,
              hypothesis: insight.hypothesis,
              reasoning: insight.reasoning,
              actions: insight.actions,
              created_at: insight.created_at,
              ...(typeof goalId === 'string' ? { goal_id: goalId } : {}),
              ...(typeof metric === 'string' ? { kpi_metric: metric } : {}),
            },
            $set: {
              updated_at: new Date(),
              signal_ids: signalIds,
              evidence_refs: insight.confidence_breakdown.evidence_refs,
            },
          },
          upsert: true,
        },
      }
    })
    await col.bulkWrite(ops, { ordered: false })
  }

  // ─── Full Connector Sync ───────────────────────────────────────────────────

  /** Run a full sync (poll or backfill) for a tenant+connector across all resources. */
  // Credentials are stored encrypted at rest (connector-credentials.ts encrypts
  // api_key/access_token/refresh_token/password on save) — decrypt here, once,
  // so every downstream use (buildAuthHeaders, refreshAccessToken, query params)
  // gets plaintext. Previously this loaded the raw encrypted doc straight from
  // Mongo despite the comment claiming otherwise, so every basic/api_key/oauth2
  // sync sent ciphertext as the credential and failed with 401.
  private async loadDecryptedCredentials(
    connectorId: string,
    tenantId: string,
  ): Promise<SyncCredentials | null> {
    const credCol = this.db.collection('connector_credentials')
    const rawCreds = await credCol.findOne({
      tenant_id: tenantId,
      connector_id: connectorId,
    }) as SyncCredentials | null

    if (!rawCreds) return null

    if (rawCreds.api_key !== undefined) rawCreds.api_key = decryptIfNeeded(rawCreds.api_key) as string
    if (rawCreds.access_token !== undefined) rawCreds.access_token = decryptIfNeeded(rawCreds.access_token) as string
    if (rawCreds.refresh_token !== undefined) rawCreds.refresh_token = decryptIfNeeded(rawCreds.refresh_token) as string
    if (rawCreds.password !== undefined) rawCreds.password = decryptIfNeeded(rawCreds.password) as string

    return rawCreds
  }

  /**
   * Make one real, lightweight request against the connector's first resource
   * to verify stored credentials actually work — used by POST /connectors/:id/test.
   * Does not persist anything; purely a read-only probe.
   */
  async testConnection(
    connector: ConnectorConfig,
    tenantId: string,
  ): Promise<{ success: boolean; status?: number; message: string }> {
    const resource = connector.resources?.[0]
    if (!resource) {
      return { success: false, message: 'This connector has no readable resources to test.' }
    }

    const creds = await this.loadDecryptedCredentials(connector.id, tenantId)
    if (!creds) {
      return { success: false, message: 'No credentials stored for this connector yet.' }
    }

    this.lastFetchError = null
    try {
      await this.fetchAllPages(connector, resource, creds, tenantId, { maxPages: 1 })
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }

    if (this.lastFetchError) {
      const { status, statusText } = this.lastFetchError
      const hint = status === 401
        ? 'Credentials were rejected — check the API key/secret and that they match the environment (demo vs live).'
        : status === 429
          ? 'Rate limited by the provider — wait a moment and try again.'
          : statusText
      return { success: false, status, message: `Request to ${connector.name} failed (${status}${hint ? `: ${hint}` : ''})` }
    }

    return { success: true, message: `Connection to ${connector.name} verified successfully` }
  }

  async syncConnector(
    connector: ConnectorConfig,
    tenantId: string,
    backfill = false,
  ): Promise<SyncResult[]> {
    const resources = connector.resources ?? []
    if (resources.length === 0) return []

    const rawCreds = await this.loadDecryptedCredentials(connector.id, tenantId)
    if (!rawCreds) return []

    const results: SyncResult[] = []
    for (const [i, resource] of resources.entries()) {
      // Small gap between resources so a 5-resource connector doesn't burst
      // requests back-to-back into a provider's per-endpoint rate limit —
      // 429s themselves still get retried in fetchWithAuth, but spacing the
      // first attempt out means we usually don't hit the limit at all.
      if (i > 0) await new Promise(resolve => setTimeout(resolve, 400))
      try {
        const result = await this.syncResource(connector, resource, rawCreds, tenantId, backfill)
        results.push(result)
      } catch (err) {
        log.error({ tenant_id: tenantId, connector_id: connector.id, resource: resource.name, err }, 'Resource sync failed')
      }
    }

    return results
  }

  // ─── Historical Backfill (public API) ─────────────────────────────────────

  /**
   * Trigger a full historical backfill for a connector.
   *
   * Called automatically after OAuth callback completes.
   * Can also be triggered manually via POST /connectors/:id/backfill
   *
   * Processes up to 180 days of historical data, page by page.
   * All historical records flow through the engine — insights are tagged
   * with { source: 'sync', backfill: true } so the UI can distinguish them.
   */
  async backfill(
    connector: ConnectorConfig,
    tenantId: string,
  ): Promise<{ total_records: number; total_insights: number; duration_ms: number }> {
    const start = Date.now()
    const results = await this.syncConnector(connector, tenantId, true)
    return {
      total_records: results.reduce((s, r) => s + r.records_fetched, 0),
      total_insights: results.reduce((s, r) => s + r.insights_triggered, 0),
      duration_ms: Date.now() - start,
    }
  }

  // ─── Scheduled Polling ────────────────────────────────────────────────────

  /**
   * Poll all connected connectors for all tenants.
   * Called by the cron scheduler every 15 minutes.
   */
  async pollAll(connectors: ConnectorConfig[]): Promise<void> {
    if (this.running) return // skip if previous run still going
    this.running = true

    try {
      const credCol = this.db.collection('connector_credentials')
      // Find all unique tenant+connector pairs that have credentials
      const connected = await credCol.find({}).toArray() as SyncCredentials[]

      for (const cred of connected) {
        const connector = connectors.find(c => c.id === cred.connector_id)
        if (!connector || !connector.resources?.length) continue
        // Review fix PR #220: skip connectors that are not yet live.
        // 'planned' connectors have no working endpoint contract yet and
        // would burn credentials on 404s. 'beta' and 'ga' connectors are
        // synced normally.
        if (connector.status === 'planned') continue

        try {
          await this.syncConnector(connector, cred.tenant_id, false)
        } catch (err) {
          log.error({ tenant_id: cred.tenant_id, connector_id: cred.connector_id, err }, 'Poll cycle failed')
        }
      }
    } finally {
      this.running = false
    }
  }
}
