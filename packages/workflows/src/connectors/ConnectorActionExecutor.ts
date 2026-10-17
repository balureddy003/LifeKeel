/**
 * ConnectorActionExecutor — executes real connector actions.
 *
 * Flow:
 *   1. Look up stored OAuth credentials / API key for (tenantId, connectorId)
 *   2. Resolve the connector definition from ConnectorRegistry
 *   3. Build the target URL + headers using the action's path template
 *   4. Execute the HTTP call with the tenant's credentials
 *   5. Map the response back to workflow state keys
 *
 * Credential storage schema (MongoDB `connector_credentials` collection):
 *   {
 *     tenant_id, connector_id,
 *     auth_type: 'oauth2' | 'api_key' | 'basic',
 *     access_token?,           // oauth2
 *     refresh_token?,          // oauth2
 *     token_expires_at?,       // oauth2
 *     api_key?,                // api_key auth
 *     username?, password?,    // basic auth
 *     extra?: Record<string, string>  // connector-specific (page_id, account_id, etc.)
 *   }
 *
 * OAuth token refresh is handled automatically if token_expires_at is past.
 * Refresh endpoint must be registered in the connector def (future: connectorDef.oauth.refresh_url)
 */

import type { Collection, Db } from 'mongodb'
import crypto from 'node:crypto'
import { connectorRegistry } from './ConnectorRegistry.js'
import type { ConnectorAction, ConnectorDef } from './ConnectorRegistry.js'
import { decryptIfNeeded, encryptIfNeeded, createLogger } from '@lifekeel/platform'

const log = createLogger({ service: 'connector-action-executor', version: '0.0.0' })

function assertExternalUrlAllowed(url: string, context: string): void {
  if (process.env['LIFEKEEL_DEPLOYMENT_MODE'] !== 'airgap') return
  const parsed = new URL(url, 'http://localhost')
  const host = parsed.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return
  throw new Error(`External network access blocked in airgap mode for ${context}: ${url.slice(0, 80)}`)
}

// Google connectors that can use shared credentials
const GOOGLE_CONNECTORS = ['google_calendar', 'gmail', 'google_drive', 'youtube', 'google_sheets', 'google_business']

// Meta app credentials cover Facebook Login, Instagram Graph, and Threads —
// one Meta app can hold all three products.
const META_CONNECTORS = ['facebook_pages', 'instagram_business', 'instagram']

function getGoogleClientId(connectorId: string): string {
  // Try connector-specific first for backward compatibility
  const specificId = process.env[`LIFEKEEL_${connectorId.toUpperCase()}_CLIENT_ID`]
  if (specificId) return specificId

  // Purpose-named pairs — what .env.example documents for the marketing
  // connect flows.
  if (connectorId === 'twitter_x') return process.env['X_CLIENT_ID'] ?? ''
  if (connectorId === 'linkedin') return process.env['LINKEDIN_CLIENT_ID'] ?? ''
  if (connectorId === 'threads') return process.env['THREADS_CLIENT_ID'] ?? process.env['META_CLIENT_ID'] ?? ''
  if (META_CONNECTORS.includes(connectorId)) return process.env['META_CLIENT_ID'] ?? ''

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

  if (connectorId === 'twitter_x') return process.env['X_CLIENT_SECRET'] ?? ''
  if (connectorId === 'linkedin') return process.env['LINKEDIN_CLIENT_SECRET'] ?? ''
  if (connectorId === 'threads') return process.env['THREADS_CLIENT_SECRET'] ?? process.env['META_CLIENT_SECRET'] ?? ''
  if (META_CONNECTORS.includes(connectorId)) return process.env['META_CLIENT_SECRET'] ?? ''

  // Fall back to shared Google credentials for Google services
  if (GOOGLE_CONNECTORS.includes(connectorId)) {
    return process.env['GOOGLE_CLIENT_SECRET'] ?? ''
  }

  return ''
}

// ── Credential types ──────────────────────────────────────────────────────────

export interface ConnectorCredential {
  tenant_id: string
  connector_id: string
  auth_type: 'oauth2' | 'oauth2_kite' | 'oauth1a' | 'api_key' | 'basic' | 'http_basic' | 'none'
  // OAuth2
  access_token?: string
  refresh_token?: string
  token_expires_at?: Date
  token_type?: string          // 'Bearer' | 'Basic' | connector-specific
  // OAuth 1.0a (twitter free tier)
  oauth1_consumer_key?: string
  oauth1_consumer_secret?: string
  oauth1_access_token?: string
  oauth1_token_secret?: string
  // API key
  api_key?: string
  api_key_header?: string      // header name, default 'Authorization'
  api_key_prefix?: string      // prefix before key, default 'Bearer '
  // Basic auth
  username?: string
  password?: string
  // Connector-specific extra fields (page_id, workspace_id, blog_id, etc.)
  extra?: Record<string, string>
  created_at: Date
  updated_at: Date
}

// ── Action result ─────────────────────────────────────────────────────────────

export interface ActionResult {
  ok: boolean
  status: number
  body: unknown
  error?: string
  /**
   * Error classification for downstream retry/reconciliation logic.
   * Only set when ok=false; undefined on success.
   * - '4xx': client error (bad request, insufficient funds, market closed) —
   *   the request was definitely not processed, safe to retry with corrections.
   * - '5xx': server error — the broker may or may not have processed the
   *   request; ambiguous, requires reconciliation before retrying.
   * - 'timeout': request timed out (AbortController fired) — same ambiguity
   *   as 5xx; the order may have been placed before the timeout fired.
   * - 'network_error': connection refused, DNS failure, etc. — same
   *   ambiguity as 5xx; the request never reached the broker, but a
   *   previous retry may have.
   * See TRADING_ENGINE_GAPS.md gap #18.
   */
  errorClass?: '4xx' | '5xx' | 'timeout' | 'network_error'
  /** State key updates derived from action output_schema */
  state_updates: Record<string, unknown>
}

// ── Executor ──────────────────────────────────────────────────────────────────

export class ConnectorActionExecutor {
  private credentials: Collection<ConnectorCredential>

  constructor(
    private readonly db: Db,
    private readonly fetchFn: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  ) {
    this.credentials = db.collection<ConnectorCredential>('connector_credentials')
  }

  // ── Execute a connector action ─────────────────────────────────────────────

  async execute(
    tenantId: string,
    connectorId: string,
    actionId: string,
    params: Record<string, unknown>,
    /**
     * Extra HTTP headers to add to the request (e.g. an idempotency key).
     * Used by broker-execution.ts to send X-LifeKeel-Trade-Id for audit trail
     * — see TRADING_ENGINE_GAPS.md gap #22.
     */
    extraHeaders?: Record<string, string>,
  ): Promise<ActionResult> {
    const resolvedActionId = this.normalizeActionId(connectorId, actionId)
    // 1. Look up connector definition
    const connDef = connectorRegistry.get(connectorId)
    if (!connDef) {
      return { ok: false, status: 0, body: null, error: `Unknown connector: ${connectorId}`, state_updates: {} }
    }

    const action = connDef.actions.find(a => a.id === resolvedActionId)
    if (!action) {
      return { ok: false, status: 0, body: null, error: `Unknown action: ${actionId} on ${connectorId}`, state_updates: {} }
    }

    // 2. Load credentials
    const cred = await this.credentials.findOne({ tenant_id: tenantId, connector_id: connectorId })

    // If no creds stored and auth is none, proceed without auth
    if (!cred && connDef.auth !== 'none' && connDef.auth !== 'webhook_only') {
      return {
        ok: false, status: 401, body: null,
        error: `No credentials found for ${connectorId}. Connect this app in Settings → Connectors.`,
        state_updates: {},
      }
    }

    // 3. Auto-refresh OAuth token if needed
    if (cred?.auth_type === 'oauth2' && cred.token_expires_at) {
      const expiresAt = new Date(cred.token_expires_at)
      if (expiresAt < new Date(Date.now() + 60_000)) {
        // Token expires within 1 minute — try to refresh
        await this.tryRefreshToken(cred)
        // Re-read after refresh
        const refreshed = await this.credentials.findOne({ tenant_id: tenantId, connector_id: connectorId })
        if (refreshed?.access_token) {
          Object.assign(cred, refreshed)
        }
      }
    }

    // 4. Build URL — substitute {path_params} and extra fields.
    // ConnectorRegistry may declare a live_base_url (e.g. Trading 212). When
    // the stored credential opts into live mode via extra.live_mode='true',
    // use live_base_url instead of the sandbox/demo base_url. This matches the
    // sync engine's behavior (connector-sync-engine.ts) and prevents live
    // credentials from being sent to the demo endpoint (which rejects them
    // with HTTP 401).
    const allParams = { ...params, ...(cred?.extra ?? {}) }
    const isLive = cred?.extra?.['live_mode'] === 'true'
    const selectedBaseUrl = isLive && connDef.live_base_url
      ? connDef.live_base_url
      : connDef.base_url
    const url = this.buildUrl(selectedBaseUrl, action.path, allParams)
    assertExternalUrlAllowed(url, `${connectorId}/${resolvedActionId}`)

    // 5. Build headers
    const headers = this.buildHeaders(cred ?? null, action.method, url)

    // 6. Build request body (for non-GET requests)
    const bodyParams = this.buildBodyParams(action, params)
    if (connectorId === 'twitter_x' && resolvedActionId === 'createThread') {
      return this.executeTwitterThread(selectedBaseUrl, headers, params)
    }
    const requestBody = this.buildRequestBody(connectorId, resolvedActionId, bodyParams)

    // 7. Execute HTTP call
    // Gap #20 (TRADING_ENGINE_GAPS.md): no request timeout anywhere in the
    // fetch chain — a hung broker call leaves a trade claimed at
    // status: 'executing' for an unbounded time. A 30s AbortController
    // deadline bounds the orphan window for every connector action,
    // including the broker path (which creates its own executor in
    // broker-execution.ts, bypassing ConnectorSandbox's timeout).
    const timeoutMs = 30_000
    try {
      const init: RequestInit = {
        method: action.method,
        headers: { 'Content-Type': 'application/json', ...headers, ...extraHeaders },
      }
      if (action.method !== 'GET' && Object.keys(requestBody).length > 0) {
        init.body = JSON.stringify(requestBody)
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
      let res: Response
      try {
        res = await this.fetchFn(url, { ...init, signal: controller.signal })
      } finally {
        clearTimeout(timeoutId)
      }
      // Read the raw body once as text — res.json() throws on non-JSON bodies
      // (plain text, empty, HTML error pages) and the previous `.catch(() =>
      // ({}))` silently swallowed that raw text, so a failed order's actual
      // explanation from the broker was lost and every unrecognized error
      // shape collapsed into a bare "HTTP <status>" (see humanizeApiError).
      // Keeping the raw text lets us log/surface it even when it isn't JSON.
      const rawBody = await res.text().catch(() => '')
      let responseBody: Record<string, unknown> = {}
      if (rawBody) {
        try {
          responseBody = JSON.parse(rawBody) as Record<string, unknown>
        } catch {
          // Non-JSON body — leave responseBody empty; rawBody still carries
          // the text through to humanizeApiError and the failure log below.
        }
      }

      if (!res.ok) {
        const errMsg = this.humanizeApiError(connectorId, res.status, responseBody, rawBody)
        const errorClass: ActionResult['errorClass'] = res.status >= 400 && res.status < 500 ? '4xx' : '5xx'
        // Log the full broker response on failure — never log request headers
        // (would leak the Authorization value), only the response the broker
        // sent back. This is what lets a "HTTP 401" surface its real cause
        // (bad key vs missing scope vs account restriction) instead of a
        // generic status code.
        log.warn(
          { connector_id: connectorId, action_id: resolvedActionId, status: res.status, response_body: rawBody.slice(0, 2000) },
          'Connector action failed',
        )
        return {
          ok: false,
          status: res.status,
          body: responseBody,
          error: errMsg,
          errorClass,
          state_updates: {},
        }
      }

      // 8. Map response fields to state updates using output_schema
      const state_updates = this.mapOutputs(action, responseBody)

      return { ok: true, status: res.status, body: responseBody, state_updates }
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      return {
        ok: false,
        status: 0,
        body: null,
        error: isTimeout
          ? `Request timed out after ${timeoutMs}ms`
          : `Network error: ${String(err)}`,
        errorClass: isTimeout ? 'timeout' : 'network_error',
        state_updates: {},
      }
    }
  }

  // ── Save credentials for a tenant+connector ────────────────────────────────

  async saveCredentials(tenantId: string, cred: Omit<ConnectorCredential, 'created_at' | 'updated_at'>): Promise<void> {
    const now = new Date()
    await this.credentials.replaceOne(
      { tenant_id: tenantId, connector_id: cred.connector_id },
      { ...cred, created_at: now, updated_at: now },
      { upsert: true },
    )
  }

  // ── Check if credentials exist ─────────────────────────────────────────────

  async hasCredentials(tenantId: string, connectorId: string): Promise<boolean> {
    const cred = await this.credentials.findOne({ tenant_id: tenantId, connector_id: connectorId })
    return !!cred
  }

  // ── List connected connectors for a tenant ─────────────────────────────────

  async listConnected(tenantId: string): Promise<Array<{ connector_id: string; auth_type: string; updated_at: Date }>> {
    const creds = await this.credentials
      .find({ tenant_id: tenantId })
      .project({ connector_id: 1, auth_type: 1, updated_at: 1 })
      .toArray() as unknown as Array<{ connector_id: string; auth_type: string; updated_at: Date }>
    return creds
  }

  // ── Delete credentials (disconnect) ───────────────────────────────────────

  async deleteCredentials(tenantId: string, connectorId: string): Promise<void> {
    await this.credentials.deleteOne({ tenant_id: tenantId, connector_id: connectorId })
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private normalizeActionId(connectorId: string, actionId: string): string {
    if (connectorId !== 'twitter_x') return actionId
    const aliases: Record<string, string> = {
      create_tweet: 'createPosts',
      create_thread: 'createThread',
      reply_tweet: 'replyPost',
    }
    return aliases[actionId] ?? actionId
  }

  private selectBaseUrl(connDef: ConnectorDef, cred: ConnectorCredential | null): string {
    const isLive = cred?.extra?.['live_mode'] === 'true'
    if (isLive && connDef.live_base_url) return connDef.live_base_url
    return connDef.base_url
  }

  private buildUrl(baseUrl: string, path: string, params: Record<string, unknown>): string {
    // Replace {var} placeholders in base_url and path
    const resolve = (template: string) =>
      template.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(String(params[key] ?? '')))

    const base = resolve(baseUrl).replace(/\/$/, '')
    const resolvedPath = resolve(path).replace(/^\//, '')
    return `${base}/${resolvedPath}`
  }

  private buildHeaders(cred: ConnectorCredential | null, method?: string, url?: string): Record<string, string> {
    if (!cred) return {}

    if (cred.auth_type === 'oauth1a') {
      return this.buildOAuth1Header(cred, method ?? 'POST', url ?? '')
    }

    if (cred.auth_type === 'oauth2' && cred.access_token) {
      const tokenType = cred.token_type ?? 'Bearer'
      return { Authorization: `${tokenType} ${decryptIfNeeded(cred.access_token)}` }
    }

    // Kite Connect v3 — requests are signed as `token api_key:access_token`
    // with X-Kite-Version: 3. The api_key is stored in extra.api_key.
    if (cred.auth_type === 'oauth2_kite' && cred.access_token) {
      const apiKey = cred.extra?.api_key ?? ''
      const accessToken = decryptIfNeeded(cred.access_token) ?? ''
      return {
        Authorization: `token ${apiKey}:${accessToken}`,
        'X-Kite-Version': '3',
      }
    }

    if (cred.auth_type === 'api_key' && cred.api_key) {
      const header = cred.api_key_header ?? 'Authorization'
      const prefix = cred.api_key_prefix ?? 'Bearer '
      return { [header]: `${prefix}${decryptIfNeeded(cred.api_key)}` }
    }

    if ((cred.auth_type === 'basic' || cred.auth_type === 'http_basic') && cred.username && cred.password) {
      const encoded = Buffer.from(`${cred.username}:${decryptIfNeeded(cred.password)}`).toString('base64')
      return { Authorization: `Basic ${encoded}` }
    }

    return {}
  }

  private buildOAuth1Header(cred: ConnectorCredential, method: string, url: string): Record<string, string> {
    const consumerKey    = decryptIfNeeded(cred.oauth1_consumer_key ?? '') ?? ''
    const consumerSecret = decryptIfNeeded(cred.oauth1_consumer_secret ?? '') ?? ''
    const accessToken    = decryptIfNeeded(cred.oauth1_access_token ?? '') ?? ''
    const tokenSecret    = decryptIfNeeded(cred.oauth1_token_secret ?? '') ?? ''

    if (!consumerKey || !accessToken) return {}

    // Strip query string — OAuth 1.0a base string uses only the base URL
    const baseUrl = url.split('?')[0] ?? url

    const oauthParams: Record<string, string> = {
      oauth_consumer_key:     consumerKey,
      oauth_nonce:            crypto.randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp:        String(Math.floor(Date.now() / 1000)),
      oauth_token:            accessToken,
      oauth_version:          '1.0',
    }

    // Build signature base string
    const paramStr = Object.entries(oauthParams)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')

    const baseString = [
      method.toUpperCase(),
      encodeURIComponent(baseUrl),
      encodeURIComponent(paramStr),
    ].join('&')

    const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`
    const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64')

    oauthParams['oauth_signature'] = signature

    const authHeader = 'OAuth ' + Object.entries(oauthParams)
      .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
      .join(', ')

    return { Authorization: authHeader }
  }

  private buildBodyParams(action: ConnectorAction, params: Record<string, unknown>): Record<string, unknown> {
    // Only include params that are declared as required or present in the call
    const body: Record<string, unknown> = {}
    for (const p of action.params) {
      if (params[p.name] !== undefined) {
        body[p.name] = params[p.name]
      } else if (p.default !== undefined) {
        body[p.name] = p.default
      }
    }
    return body
  }

  private buildRequestBody(
    connectorId: string,
    actionId: string,
    bodyParams: Record<string, unknown>,
  ): Record<string, unknown> {
    if (connectorId === 'twitter_x' && (actionId === 'reply_tweet' || actionId === 'replyPost')) {
      return {
        text: bodyParams['text'],
        reply: { in_reply_to_tweet_id: bodyParams['reply_to_id'] },
      }
    }
    if (connectorId === 'twitter_x' && (actionId === 'likePost' || actionId === 'repostPost')) {
      return { tweet_id: bodyParams['post_id'] }
    }
    return bodyParams
  }

  private async executeTwitterThread(
    baseUrl: string,
    headers: Record<string, string>,
    params: Record<string, unknown>,
  ): Promise<ActionResult> {
    const rawTweets = params['tweets']
    let tweets: string[] = []
    try {
      tweets = Array.isArray(rawTweets)
        ? rawTweets.map(String)
        : typeof rawTweets === 'string'
          ? (JSON.parse(rawTweets) as unknown[]).map(String)
          : []
    } catch {
      return { ok: false, status: 400, body: null, error: 'tweets must be a JSON array of strings', state_updates: {} }
    }

    if (!Array.isArray(tweets) || tweets.length === 0) {
      return { ok: false, status: 400, body: null, error: 'tweets must be a non-empty array', state_updates: {} }
    }

    const url = `${baseUrl.replace(/\/$/, '')}/tweets`
    assertExternalUrlAllowed(url, 'twitter_x/create_thread')

    const posted: Array<Record<string, unknown>> = []
    let replyTo: string | undefined

    try {
      for (const text of tweets) {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({
            text: String(text).slice(0, 280),
            ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}),
          }),
        })
        const body = await res.json().catch(() => ({})) as Record<string, unknown>
        if (!res.ok) {
          return {
            ok: false,
            status: res.status,
            body,
            error: String(body['error'] ?? body['message'] ?? `HTTP ${res.status}`),
            state_updates: { posted },
          }
        }
        posted.push(body)
        const data = body['data'] as Record<string, unknown> | undefined
        replyTo = typeof data?.['id'] === 'string' ? data['id'] : undefined
      }

      return {
        ok: true,
        status: 200,
        body: { tweets: posted },
        state_updates: {
          tweets: posted,
          id: replyTo,
          __connector_response: { tweets: posted },
        },
      }
    } catch (err) {
      return { ok: false, status: 0, body: null, error: `Network error: ${String(err)}`, state_updates: { posted } }
    }
  }

  private mapOutputs(action: ConnectorAction, body: Record<string, unknown>): Record<string, unknown> {
    if (!action.output_schema) return { [`__connector_response`]: body }
    const updates: Record<string, unknown> = {}
    for (const key of Object.keys(action.output_schema)) {
      // Try to extract the field from the response body
      const value = this.extractField(body, key)
      if (value !== undefined) updates[key] = value
    }
    // Always store the raw response
    updates['__connector_response'] = body
    return updates
  }

  private humanizeApiError(connectorId: string, status: number, body: Record<string, unknown>, rawBody?: string): string {
    if ((status === 402 || status === 403) && connectorId === 'twitter_x') {
      // X v2 puts the real cause in `detail` / `errors[].message` —
      // duplicate content, daily cap, tier restrictions. Collapsing every
      // 4xx into the permissions hint misdiagnoses retries, so surface the
      // provider text verbatim unless it actually IS a scope problem —
      // scope fixes need a reconnect anyway (tokens keep the permissions
      // they were issued with; flipping the app to Read+Write does not
      // retro-grant them to existing tokens).
      const detail =
        String(body['detail'] ?? '').trim() ||
        String((body['errors'] as { message?: string }[] | undefined)?.[0]?.['message'] ?? '').trim()
      const looksPermissions = /permission|not permitted|scope|forbidden/i.test(detail)
      if (detail && !looksPermissions) return `X refused to post: ${detail}`
      return `X refused to post${detail ? `: ${detail}.` : ' (HTTP 403).'} Check developer.x.com → your app → User authentication settings shows "Read and Write", then disconnect and reconnect X on the Marketing page — the token only gets new permissions when it's re-issued.`
    }
    if (status === 402) {
      return `${connectorId}: API access denied (HTTP 402) — check your developer plan or app permissions`
    }
    const msg = body['error'] || body['message'] || body['detail']
    if (msg) return String(msg)
    // No recognized JSON error field — fall back to whatever text the broker
    // actually sent (plain-text error, HTML error page, or an empty body)
    // instead of a bare status code that hides the real cause.
    const trimmed = rawBody?.trim()
    return trimmed ? `HTTP ${status}: ${trimmed.slice(0, 300)}` : `HTTP ${status}`
  }

  private extractField(body: Record<string, unknown>, key: string): unknown {
    // Direct match
    if (body[key] !== undefined) return body[key]
    // Nested: check common wrappers like { data: { id: ... } }
    const data = body['data'] as Record<string, unknown> | undefined
    if (data && data[key] !== undefined) return data[key]
    // id/url are common top-level fields
    if (key === 'id' && body['id']) return body['id']
    if (key === 'url' && body['url']) return body['url']
    if (key === 'post_id' && (body['id'] || body['post_id'])) return body['post_id'] ?? body['id']
    return undefined
  }

  // ── OAuth token refresh ────────────────────────────────────────────────────

  private async tryRefreshToken(cred: ConnectorCredential): Promise<void> {
    // Threads doesn't do refresh_token grants — its 60-day tokens extend via
    // GET th_refresh_token passing the CURRENT access token. Handled before
    // the refresh_token early-return since Threads creds never store one.
    if (cred.connector_id === 'threads' && cred.access_token) {
      const current = decryptIfNeeded(cred.access_token)
      if (!current) return
      try {
        const res = await this.fetchFn(
          `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(current)}`,
        )
        if (res.ok) {
          const data = await res.json() as { access_token?: string; expires_in?: number }
          if (data.access_token) {
            await this.credentials.updateOne(
              { tenant_id: cred.tenant_id, connector_id: 'threads' },
              {
                $set: {
                  access_token: encryptIfNeeded(data.access_token)!,
                  ...(data.expires_in ? { token_expires_at: new Date(Date.now() + data.expires_in * 1000) } : {}),
                  updated_at: new Date(),
                },
              },
            )
          }
        }
      } catch {
        // Refresh failed — the actual call will surface the real error.
      }
      return
    }

    if (!cred.refresh_token) return

    // Connector-specific refresh endpoints
    const refreshUrls: Record<string, string> = {
      xero:        'https://identity.xero.com/connect/token',
      hubspot:     'https://api.hubapi.com/oauth/v1/token',
      google_calendar: 'https://oauth2.googleapis.com/token',
      gmail:       'https://oauth2.googleapis.com/token',
      google_drive: 'https://oauth2.googleapis.com/token',
      youtube:     'https://oauth2.googleapis.com/token',
      google_sheets: 'https://oauth2.googleapis.com/token',
      shopify:     '', // Shopify tokens don't expire — skip
      twitter_x:   'https://api.x.com/2/oauth2/token',
    }

    const refreshUrl = refreshUrls[cred.connector_id]
    if (!refreshUrl) return // Unknown refresh endpoint — skip
    const refreshToken = decryptIfNeeded(cred.refresh_token)
    if (!refreshToken) return

    try {
      const clientId = getGoogleClientId(cred.connector_id)
      const clientSecret = getGoogleClientSecret(cred.connector_id)
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      })
      const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
      if (cred.connector_id === 'twitter_x' && clientSecret) {
        headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      } else if (clientSecret) {
        body.set('client_secret', clientSecret)
      }

      const res = await this.fetchFn(refreshUrl, {
        method: 'POST',
        headers,
        body: body.toString(),
      })

      if (res.ok) {
        const data = await res.json() as { access_token: string; expires_in?: number; refresh_token?: string }
        await this.credentials.updateOne(
          { tenant_id: cred.tenant_id, connector_id: cred.connector_id },
          {
            $set: {
              access_token: encryptIfNeeded(data.access_token)!,
              ...(data.refresh_token ? { refresh_token: encryptIfNeeded(data.refresh_token)! } : {}),
              ...(data.expires_in ? { token_expires_at: new Date(Date.now() + data.expires_in * 1000) } : {}),
              updated_at: new Date(),
            },
          },
        )
      }
    } catch {
      // Refresh failed — continue with existing token and let the actual call fail
    }
  }
}
