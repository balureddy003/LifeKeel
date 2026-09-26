/**
 * Connector credential management routes.
 *
 * GET  /connectors/connected              — list connected connectors for tenant
 * POST /connectors/:id/credentials        — save credentials (API key or OAuth tokens)
 * DELETE /connectors/:id/credentials      — disconnect a connector
 * GET  /connectors/:id/credentials/status — check if connected
 * POST /connectors/:id/backfill           — trigger historical backfill (180 days)
 * GET  /connectors/:id/sync/status        — sync state per resource
 *
 * OAuth callback:
 * GET  /connectors/:id/oauth/callback     — receive OAuth code, exchange for tokens
 *                                           → auto-triggers backfill after first connect
 *
 * Security: all routes require JWT auth. tenant_id always from JWT, never from body.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import crypto from 'node:crypto'
import { ConnectorActionExecutor } from '@agentoak/workflows'
import { connectorRegistry } from '@agentoak/workflows'
import { encryptIfNeeded, decryptIfNeeded, createLogger, getTenantCollection } from '@agentoak/platform'

const log = createLogger({ service: 'connector-credentials', version: '0.0.0' })
import { ConnectorSyncEngine } from '@agentoak/pipeline'
import type { ConnectorLoader, EventGenerator } from '@agentoak/pipeline'
import type { Engine } from '@agentoak/engine'
import { fetchGmailAddress } from '../email/gmail-oauth.js'
import { scanTenantInbox } from '../jobs/email-scan.js'

// OAK-002: this route accepted any connector id known to the shared,
// multi-vertical connectorRegistry/connectorLoader (30+ connectors,
// including stripe, sendgrid, twilio, linkedin, twitter_x) with no
// allowlist — only a quota count. The family app's UI only ever offers
// email and open banking (confirmed by grep of apps/web/src for connector
// id literals), so any authenticated tenant could otherwise attach a
// stripe/linkedin credential directly against the API and activate real
// execution the next time an insight's action text happened to match
// action-executor.ts's keyword patterns. Matches
// verticals/family/vertical.yaml's optional_connectors list plus what
// apps/web/src actually sends — hand-written rather than read from that
// YAML at runtime, since the loader that used to parse it (VerticalLoader)
// was already removed (see SECURITY.md).
const FAMILY_CONNECTOR_ALLOWLIST = new Set([
  'gmail',
  'email',
  'open-banking',
  'google_drive',
  'dropbox',
  'onedrive',
])

/** Which frontend initiated the OAuth flow — determines where the callback sends the user back. */
type ReturnTarget = 'studio' | 'kairos-web' | 'kairos-mobile' | 'family' | 'marketing'

function isReturnTarget(value: unknown): value is ReturnTarget {
  return value === 'studio' || value === 'kairos-web' || value === 'kairos-mobile' || value === 'family' || value === 'marketing'
}

function signOAuthState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const secret = process.env['JWT_SECRET'] ?? 'change-me-in-production'
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verifyOAuthState(
  state: string,
): { tenantId: string; connectorId: string; returnTo: ReturnTarget; codeVerifier?: string } {
  const [body, sig] = state.split('.')
  if (!body || !sig) throw new Error('Malformed OAuth state')
  const secret = process.env['JWT_SECRET'] ?? 'change-me-in-production'
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  if (sig.length !== expected.length) throw new Error('Invalid OAuth state signature')
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('Invalid OAuth state signature')
  }
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
    tenantId?: string
    connectorId?: string
    returnTo?: string
    codeVerifier?: string
    exp?: number
  }
  if (!parsed.tenantId || !parsed.connectorId) throw new Error('OAuth state missing tenant or connector')
  if (parsed.exp && Date.now() > parsed.exp) throw new Error('OAuth state expired')
  return {
    tenantId: parsed.tenantId,
    connectorId: parsed.connectorId,
    returnTo: isReturnTarget(parsed.returnTo) ? parsed.returnTo : 'studio',
    ...(parsed.codeVerifier ? { codeVerifier: parsed.codeVerifier } : {}),
  }
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/**
 * Where the OAuth callback sends the user back to, keyed by which frontend
 * initiated the flow (see `returnTo` in the signed state). Studio remains the
 * default for any state signed without an explicit `app` query param, so
 * existing Studio-initiated flows are unaffected by this generalization.
 */
function frontendRedirect(returnTo: ReturnTarget, params: Record<string, string>): string {
  if (returnTo === 'kairos-mobile') {
    // expo-web-browser's openAuthSessionAsync watches for a redirect to the
    // app's registered custom scheme (see apps/kairos-mobile/app.config.js's
    // `scheme: 'kairos'`) and hands control back to the app with this URL.
    const url = new URL('kairos://oauth-callback')
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return url.toString()
  }
  if (returnTo === 'family') {
    // The family app's own Connect Email page, not the generic /connectors
    // dashboard Studio and kairos-web use — it's the one screen a family
    // member would recognize the result on.
    const url = new URL('/connect/email', process.env['AGENT_OAK_URL'] ?? 'http://localhost:3002')
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return url.toString()
  }
  if (returnTo === 'marketing') {
    // Operator marketing composer — X connect returns here so the
    // Channels card can show the connected/error state inline.
    const url = new URL('/operator/marketing', process.env['AGENT_OAK_URL'] ?? 'http://localhost:3002')
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return url.toString()
  }
  const base = returnTo === 'kairos-web'
    ? (process.env['KAIROS_URL'] ?? 'http://localhost:3003')
    : (process.env['STUDIO_URL'] ?? 'http://localhost:3000')
  const url = new URL('/connectors', base)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

/**
 * Best-effort `returnTo` extraction for the provider-error redirect path,
 * which fires before the state is otherwise parsed/verified. Not a trust
 * boundary — `frontendRedirect` only ever picks from the fixed 3-value enum
 * above, so a forged/garbled state can at worst mis-route to the wrong
 * (still trusted) frontend, never to an attacker-controlled URL.
 */
function peekReturnTo(state: string | undefined): ReturnTarget {
  if (!state) return 'studio'
  try {
    const [body] = state.split('.')
    if (!body) return 'studio'
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString()) as { returnTo?: string }
    return isReturnTarget(parsed.returnTo) ? parsed.returnTo : 'studio'
  } catch {
    return 'studio'
  }
}

// Google connectors that can use shared credentials
const GOOGLE_CONNECTORS = ['google_calendar', 'gmail', 'google_drive', 'youtube', 'google_sheets', 'google_business']

function getGoogleClientId(connectorId: string): string | undefined {
  // Try connector-specific first for backward compatibility
  const specificId = process.env[`KAIROS_${connectorId.toUpperCase()}_CLIENT_ID`]
  if (specificId) return specificId

  // X's OAuth app reads the shorter, purpose-named pair (what
  // .env.example documents for the marketing connect flow).
  if (connectorId === 'twitter_x') return process.env['X_CLIENT_ID']

  // Fall back to shared Google credentials for Google services
  if (GOOGLE_CONNECTORS.includes(connectorId)) {
    return process.env['GOOGLE_CLIENT_ID']
  }

  return undefined
}

function getGoogleClientSecret(connectorId: string): string {
  // Try connector-specific first for backward compatibility
  const specificSecret = process.env[`KAIROS_${connectorId.toUpperCase()}_CLIENT_SECRET`]
  if (specificSecret) return specificSecret

  if (connectorId === 'twitter_x') return process.env['X_CLIENT_SECRET'] ?? ''

  // Fall back to shared Google credentials for Google services
  if (GOOGLE_CONNECTORS.includes(connectorId)) {
    return process.env['GOOGLE_CLIENT_SECRET'] ?? ''
  }

  return ''
}

export function registerConnectorCredentialRoutes(
  fastify: FastifyInstance,
  db: Db,
  connectorLoader?: ConnectorLoader,
  eventGenerator?: EventGenerator,
  engine?: Engine,
): void {
  const executor = new ConnectorActionExecutor(db)
  // Sync engine is optional — only wired when full pipeline deps are available
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const syncEngine = (connectorLoader && eventGenerator && engine)
    ? new ConnectorSyncEngine(db as any, eventGenerator, engine)
    : null

  // GET /connectors/connected — list all connected connectors for tenant
  fastify.get('/connectors/connected', async (req) => {
    const tenantId = req.authContext.tenant_id
    const connected = await executor.listConnected(tenantId)
    return {
      connected: connected.map(c => ({
        connector_id: c.connector_id,
        auth_type: c.auth_type,
        updated_at: c.updated_at,
        name: connectorRegistry.get(c.connector_id)?.name ?? c.connector_id,
        icon: connectorRegistry.get(c.connector_id)?.icon ?? '🔌',
      })),
    }
  })

  // GET /connectors/:id/credentials/status — is this connector connected?
  fastify.get<{ Params: { id: string } }>('/connectors/:id/credentials/status', async (req) => {
    const tenantId = req.authContext.tenant_id
    const connected = await executor.hasCredentials(tenantId, req.params.id)
    const def = connectorRegistry.get(req.params.id)
    return { connected, connector_id: req.params.id, auth_type: def?.auth ?? 'unknown' }
  })

  // POST /connectors/:id/test — verify stored credentials with one real, read-only request
  fastify.post<{ Params: { id: string } }>('/connectors/:id/test', async (req, reply) => {
    const tenantId = req.authContext.tenant_id
    const actionDef = connectorRegistry.get(req.params.id)
    // `connectorRegistry` (write actions) has no `resources` field — the sync
    // pipeline's YAML-parsed config (via connectorLoader) is what actually
    // declares readable resources, so use that for the real connectivity test.
    const syncDef = connectorLoader?.get(req.params.id)
    if (!actionDef && !syncDef) return reply.status(404).send({ error: 'Connector not found' })

    if (!syncEngine || !syncDef?.resources?.length) {
      // No sync pipeline wired (e.g. write-only action connectors) — fall back
      // to a credentials-exist check rather than claiming a real test ran.
      const name = actionDef?.name ?? syncDef?.name ?? req.params.id
      const connected = await executor.hasCredentials(tenantId, req.params.id)
      return connected
        ? { success: true, message: `${name} has stored credentials (no readable resources to verify against).` }
        : { success: false, error: 'No credentials stored for this connector yet.' }
    }

    const result = await syncEngine.testConnection(syncDef, tenantId)
    if (!result.success) return { success: false, error: result.message }
    return { success: true, message: result.message }
  })

  // POST /connectors/:id/credentials — save API key or OAuth tokens
  fastify.post<{
    Params: { id: string }
    Body: {
      auth_type: 'oauth2' | 'oauth2_kite' | 'oauth1a' | 'api_key' | 'basic'
      api_key?: string
      api_key_header?: string
      api_key_prefix?: string
      access_token?: string
      refresh_token?: string
      token_expires_at?: string
      username?: string
      password?: string
      extra?: Record<string, string>
      // OAuth 1.0a
      oauth1_consumer_key?: string
      oauth1_consumer_secret?: string
      oauth1_access_token?: string
      oauth1_token_secret?: string
    }
  }>('/connectors/:id/credentials', async (req, reply) => {
    const tenantId = req.authContext.tenant_id
    const { auth_type, token_expires_at, ...rest } = req.body

    if (!FAMILY_CONNECTOR_ALLOWLIST.has(req.params.id)) {
      return reply.status(403).send({ error: `Connector '${req.params.id}' is not available in this app` })
    }

    if (!auth_type) return reply.status(400).send({ error: 'auth_type required' })

    // M1: Enforce connectors_max quota — but only for new connections,
    // not re-saving credentials for an already-connected connector.
    const existing = await db.collection('connector_credentials').findOne({
      tenant_id: tenantId,
      connector_id: req.params.id,
    })
    if (!existing) {
      const tenant = await db.collection('tenants').findOne({ tenant_id: tenantId })
      const limit = tenant?.['quotas']?.['connectors_max'] as number | undefined
      if (limit !== undefined && limit !== -1) {
        const count = await db.collection('connector_credentials').countDocuments({ tenant_id: tenantId })
        if (count >= limit) {
          return reply.status(429).send({
            error: 'Connector quota exceeded',
            resource: 'connectors_max',
            limit,
            used: count,
            upgrade_url: '/billing/checkout',
          })
        }
      }
    }

    // SECURITY: encrypt sensitive fields at rest before storing in MongoDB
    const cred: Record<string, unknown> = {
      tenant_id: tenantId,
      connector_id: req.params.id,
      auth_type,
    }
    if (rest.api_key)                cred['api_key']                = encryptIfNeeded(rest.api_key as string)
    if (rest.access_token)           cred['access_token']           = encryptIfNeeded(rest.access_token as string)
    if (rest.refresh_token)          cred['refresh_token']          = encryptIfNeeded(rest.refresh_token as string)
    if (rest.password)               cred['password']               = encryptIfNeeded(rest.password as string)
    if (rest.username)               cred['username']               = rest.username
    if (rest.extra) {
      // For oauth2_kite (Zerodha), the tenant's api_secret is sensitive —
      // encrypt it before storing. The api_key is not secret (it appears in
      // the login URL), so it stays in plaintext within extra.
      const extra = { ...rest.extra }
      if (auth_type === 'oauth2_kite' && extra.api_secret) {
        extra.api_secret = encryptIfNeeded(extra.api_secret as string) as string
      }
      cred['extra'] = extra
    }
    if (token_expires_at)            cred['token_expires_at']       = new Date(token_expires_at)
    if (rest.oauth1_consumer_key)    cred['oauth1_consumer_key']    = encryptIfNeeded(rest.oauth1_consumer_key as string)
    if (rest.oauth1_consumer_secret) cred['oauth1_consumer_secret'] = encryptIfNeeded(rest.oauth1_consumer_secret as string)
    if (rest.oauth1_access_token)    cred['oauth1_access_token']    = encryptIfNeeded(rest.oauth1_access_token as string)
    if (rest.oauth1_token_secret)    cred['oauth1_token_secret']    = encryptIfNeeded(rest.oauth1_token_secret as string)
    await executor.saveCredentials(tenantId, cred as Parameters<typeof executor.saveCredentials>[1])

    // ── Validate credentials with a real, read-only request before success ─
    // Catches expired/revoked API keys immediately instead of the user finding
    // out later from failed backfills or silent data staleness.
    if (syncEngine && connectorLoader) {
      const connector = connectorLoader.get(req.params.id)
      // Only test credentials for connectors with readable resources.
      // Action-only connectors (e.g. Slack) have no resources to probe, so a
      // test would falsely fail and we'd delete valid credentials.
      if (connector && connector.resources && connector.resources.length > 0) {
        const testResult = await syncEngine.testConnection(connector, tenantId)
        if (!testResult.success) {
          // Clean up the just-saved invalid credentials so the connector isn't
          // left in a broken state.
          await executor.deleteCredentials(tenantId, req.params.id)
          return reply.status(422).send({
            error: 'Invalid credentials — the provider rejected the API key.',
            detail: testResult.message,
            code: 'CREDENTIALS_REJECTED',
          })
        }

        // Credentials verified — trigger backfill in background.
        syncEngine.backfill(connector, tenantId).then(result => {
          fastify.log.info(
            { connector_id: req.params.id, tenant_id: tenantId, ...result },
            'Backfill complete',
          )
        }).catch(err => {
          fastify.log.error({ err, connector_id: req.params.id }, 'Backfill failed')
        })
      }
    }

    return { ok: true, connector_id: req.params.id, connected: true }
  })

  // DELETE /connectors/:id/credentials — disconnect
  fastify.delete<{ Params: { id: string } }>('/connectors/:id/credentials', async (req) => {
    const tenantId = req.authContext.tenant_id
    await executor.deleteCredentials(tenantId, req.params.id)
    return { ok: true, disconnected: req.params.id }
  })

  // POST /connectors/:id/actions/:action — execute a real connector action
  // (This is what connector_action workflow nodes call via ConnectorActionExecutor)
  fastify.post<{
    Params: { id: string; action: string }
    Body: Record<string, unknown>
  }>('/connectors/:id/actions/:action', async (req, reply) => {
    const tenantId = req.authContext.tenant_id
    const result = await executor.execute(
      tenantId,
      req.params.id,
      req.params.action,
      req.body ?? {},
    )
    if (!result.ok) {
      return reply.status(result.status || 400).send({ ok: false, error: result.error })
    }
    return { ok: true, status: result.status, ...result.state_updates, body: result.body }
  })

  // GET /connectors/:id/oauth/start — redirect to OAuth provider
  fastify.get<{
    Params: { id: string }
    Querystring: { redirect_uri?: string; mode?: string; app?: string }
  }>('/connectors/:id/oauth/start', async (req, reply) => {
    const connDef = connectorRegistry.get(req.params.id)
    if (!connDef) return reply.status(404).send({ error: 'Connector not found' })
    if (connDef.auth !== 'oauth2' && connDef.auth !== 'oauth2_kite') {
      return reply.status(400).send({ error: 'Connector does not use OAuth2' })
    }
    // Which frontend to send the user back to once the callback completes —
    // carried through the signed state so the callback (a separate request,
    // possibly minutes later) still knows. Defaults to Studio.
    const returnTo: ReturnTarget = isReturnTarget(req.query.app) ? req.query.app : 'studio'

    // Defense-in-depth follow-up to OAK-002: the allowlist above only ever
    // gated POST /connectors/:id/credentials — this route could still walk
    // the full OAuth handshake for any of the 30+ registered connectors
    // (twitter_x included) with zero gating. Scoped to `family` only —
    // Studio and the other frontends legitimately use connectors (like
    // twitter_x) this app never offers.
    if (returnTo === 'family' && !FAMILY_CONNECTOR_ALLOWLIST.has(req.params.id)) {
      return reply.status(403).send({ error: `Connector '${req.params.id}' is not available in this app` })
    }

    // Kite Connect v3 — each tenant brings their own api_key (registered at
    // developers.kite.trade). The api_key is stored in extra.api_key via
    // POST /connectors/zerodha/credentials before starting the OAuth flow.
    // Unlike standard OAuth2 where the app has one client_id, Kite requires
    // each user to register their own app.
    if (connDef.auth === 'oauth2_kite') {
      const tenantId = req.authContext.tenant_id
      const storedCred = await executor['credentials'].findOne(
        { tenant_id: tenantId, connector_id: req.params.id },
      ) as { extra?: { api_key?: string } } | null
      const apiKey = storedCred?.extra?.api_key
      if (!apiKey) {
        return reply.status(400).send({
          error: `Kite api_key not found. Save your Kite Connect api_key and api_secret first via POST /connectors/${req.params.id}/credentials.`,
        })
      }
      const state = signOAuthState({
        tenantId,
        connectorId: req.params.id,
        returnTo,
        exp: Date.now() + 10 * 60 * 1000,
      })
      const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(apiKey)}&state=${encodeURIComponent(state)}`
      if (req.query.mode === 'json' || req.headers.accept?.includes('application/json')) {
        return { auth_url: loginUrl, connector_id: req.params.id }
      }
      return reply.redirect(loginUrl)
    }

    const clientId = getGoogleClientId(req.params.id)
    if (!clientId) {
      const envVar = GOOGLE_CONNECTORS.includes(req.params.id)
        ? 'GOOGLE_CLIENT_ID'
        : `KAIROS_${req.params.id.toUpperCase()}_CLIENT_ID`
      return reply.status(400).send({ error: `OAuth client not configured for ${req.params.id}. Set ${envVar} env var.` })
    }

    const tenantId = req.authContext.tenant_id
    const redirectUri = req.query.redirect_uri
      ?? `${process.env['API_BASE_URL'] ?? 'http://localhost:3001'}/connectors/${req.params.id}/oauth/callback`

    // Signed state binds the provider callback to this tenant+connector.
    const pkce = createPkcePair()
    const state = signOAuthState({
      tenantId,
      connectorId: req.params.id,
      returnTo,
      codeVerifier: pkce.verifier,
      exp: Date.now() + 10 * 60 * 1000,
    })

    // Connector-specific OAuth URLs
    const authUrls: Record<string, string> = {
      xero: `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid+profile+email+accounting.transactions+accounting.contacts&state=${state}`,
      hubspot: `https://app.hubspot.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=contacts+crm.objects.contacts.write&state=${state}`,
      google_calendar: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/calendar&access_type=offline&state=${state}`,
      // prompt=consent (same as google_drive below) — without it, Google only
      // issues a refresh_token on the very first authorization for a given
      // account+scope; any reconnect after that returns none, silently
      // breaking token refresh once the access token expires (~1hr). Found
      // by testing the family app's Gmail connector end to end: a reconnect
      // came back with no refresh_token at all.
      //
      // https://mail.google.com/ is required in addition to the two Gmail
      // API scopes below — found the hard way too: the family connector's
      // IMAP session (jobs/email-scan.ts, XOAUTH2) was rejected with
      // "AUTHENTICATIONFAILED" and an oauthError naming this exact scope.
      // gmail.readonly/gmail.send authorize calls to the Gmail *REST* API;
      // IMAP/SMTP access is a separate, broader scope Google doesn't infer
      // from the API ones. Both are requested together so the one token
      // covers Studio's REST-API use of this connector and the family app's
      // IMAP use of it.
      gmail: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/gmail.send+https://www.googleapis.com/auth/gmail.readonly+https://mail.google.com/&access_type=offline&prompt=consent&state=${state}`,
      shopify: `https://{shop}.myshopify.com/admin/oauth/authorize?client_id=${clientId}&scope=read_orders,write_orders&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
      // Cloud storage
      google_drive: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/drive.readonly+https://www.googleapis.com/auth/drive.metadata.readonly&access_type=offline&prompt=consent&state=${state}`,
      onedrive: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=Files.Read+Files.Read.All+offline_access&state=${state}`,
      dropbox: `https://www.dropbox.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&token_access_type=offline&state=${state}`,
      twitter_x: `https://x.com/i/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('tweet.read tweet.write users.read offline.access')}&state=${state}&code_challenge=${pkce.challenge}&code_challenge_method=S256`,
      // Social media
      facebook_pages: `https://www.facebook.com/v19.0/dialog/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('pages_show_list')}&response_type=code&state=${state}`,
      instagram_business: `https://www.facebook.com/v19.0/dialog/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('pages_show_list')}&response_type=code&state=${state}`,
      instagram: `https://www.facebook.com/v19.0/dialog/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('pages_show_list')}&response_type=code&state=${state}`,
      youtube: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube')}&access_type=offline&state=${state}`,
    }

    // Add token exchange URLs for cloud storage
    // Merge into TOKEN_URLS used in callback (via closure reference — handled below)

    const authUrl = authUrls[req.params.id]
    if (!authUrl) {
      return reply.status(400).send({ error: `OAuth flow not configured for ${req.params.id}` })
    }

    if (req.query.mode === 'json' || req.headers.accept?.includes('application/json')) {
      return { auth_url: authUrl, connector_id: req.params.id }
    }

    return reply.redirect(authUrl)
  })

  // GET /connectors/:id/oauth/callback — exchange code for tokens
  fastify.get<{
    Params: { id: string }
    Querystring: { code?: string; request_token?: string; state: string; error?: string; error_description?: string }
  }>('/connectors/:id/oauth/callback', async (req, reply) => {
    if (req.query.error) {
      return reply.redirect(frontendRedirect(peekReturnTo(req.query.state), {
        connect: req.params.id,
        error: req.query.error,
        ...(req.query.error_description ? { detail: req.query.error_description } : {}),
      }))
    }

    let tenantId: string
    let returnTo: ReturnTarget
    let codeVerifier: string | undefined
    try {
      const stateData = verifyOAuthState(req.query.state)
      if (stateData.connectorId !== req.params.id) {
        return reply.redirect(frontendRedirect(stateData.returnTo, { connect: req.params.id, error: 'oauth_state_connector_mismatch' }))
      }
      tenantId = stateData.tenantId
      returnTo = stateData.returnTo
      codeVerifier = stateData.codeVerifier
    } catch {
      return reply.redirect(frontendRedirect(peekReturnTo(req.query.state), { connect: req.params.id, error: 'invalid_oauth_state' }))
    }

    // Defense-in-depth mirror of the same check on oauth/start — a
    // correctly gated /start should make this unreachable going forward,
    // but a signed state from before this fix deploys stays valid for up
    // to its 10-minute expiry, so this closes that window too.
    if (returnTo === 'family' && !FAMILY_CONNECTOR_ALLOWLIST.has(req.params.id)) {
      return reply.redirect(frontendRedirect(returnTo, { connect: req.params.id, error: 'connector_not_available' }))
    }

    // ── Kite Connect v3 — non-standard per-tenant token exchange ──────────
    // Kite redirects back with `request_token` (not `code`) and expects a
    // checksum = SHA-256(api_key + request_token + api_secret) posted to
    // /session/token. Both api_key and api_secret are per-tenant — stored
    // via POST /connectors/zerodha/credentials before the OAuth flow starts.
    // The api_secret is encrypted at rest; decrypt it here for the checksum.
    if (req.params.id === 'zerodha' && req.query.request_token) {
      const storedCred = await executor['credentials'].findOne(
        { tenant_id: tenantId, connector_id: req.params.id },
      ) as { extra?: { api_key?: string; api_secret?: string } } | null
      const apiKey = storedCred?.extra?.api_key ?? ''
      const apiSecret = decryptIfNeeded(storedCred?.extra?.api_secret ?? '') ?? ''
      if (!apiKey || !apiSecret) {
        return reply.redirect(frontendRedirect(returnTo, { connect: req.params.id, error: 'kite_credentials_missing' }))
      }
      const requestToken = req.query.request_token
      const checksum = crypto.createHash('sha256')
        .update(apiKey + requestToken + apiSecret)
        .digest('hex')

      try {
        const res = await fetch('https://api.kite.trade/session/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Kite-Version': '3',
          },
          body: new URLSearchParams({
            api_key: apiKey,
            request_token: requestToken,
            checksum,
          }).toString(),
        })

        const data = await res.json() as {
          status: string
          data?: { access_token?: string; user_id?: string }
          error_type?: string
          message?: string
        }

        if (!res.ok || data.status !== 'success' || !data.data?.access_token) {
          const errorMessage = data.message || data.error_type || 'kite_token_exchange_failed'
          log.error({ status: res.status, data }, 'Kite token exchange failed')
          return reply.redirect(frontendRedirect(returnTo, { connect: req.params.id, error: errorMessage }))
        }

        // Update the existing credential record with the access_token,
        // preserving the already-stored extra.api_key and extra.api_secret.
        await executor.saveCredentials(tenantId, {
          tenant_id: tenantId,
          connector_id: req.params.id,
          auth_type: 'oauth2_kite',
          access_token: encryptIfNeeded(data.data.access_token)!,
          // Kite access tokens are session-scoped (valid until logout or
          // expiry); there is no refresh_token in the standard flow. The
          // user re-auths via /connectors/zerodha/oauth/start when the
          // session lapses.
          token_type: 'token',
          extra: { api_key: apiKey, api_secret: storedCred!.extra!.api_secret! },
        })

        // ── Auto-trigger historical backfill in background ────────────────
        if (syncEngine && connectorLoader) {
          const connector = connectorLoader.get(req.params.id)
          if (connector) {
            syncEngine.backfill(connector, tenantId).then(result => {
              fastify.log.info(
                { connector_id: req.params.id, tenant_id: tenantId, ...result },
                'Backfill complete',
              )
            }).catch(err => {
              fastify.log.error({ err, connector_id: req.params.id }, 'Backfill failed')
            })
          }
        }

        return reply.redirect(frontendRedirect(returnTo, { connected: req.params.id }))
      } catch (err) {
        return reply.redirect(frontendRedirect(returnTo, { connect: req.params.id, error: String(err) }))
      }
    }

    const clientId = getGoogleClientId(req.params.id) ?? ''
    const clientSecret = getGoogleClientSecret(req.params.id)
    const redirectUri = `${process.env['API_BASE_URL'] ?? 'http://localhost:3001'}/connectors/${req.params.id}/oauth/callback`

    // Token exchange endpoints
    const tokenUrls: Record<string, string> = {
      xero: 'https://identity.xero.com/connect/token',
      hubspot: 'https://api.hubapi.com/oauth/v1/token',
      google_calendar: 'https://oauth2.googleapis.com/token',
      gmail: 'https://oauth2.googleapis.com/token',
      google_drive: 'https://oauth2.googleapis.com/token',
      onedrive: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      dropbox: 'https://api.dropboxapi.com/oauth2/token',
      twitter_x: 'https://api.x.com/2/oauth2/token',
      stripe: '', // Stripe uses API keys, not OAuth code flow
      // Social media
      facebook_pages: 'https://graph.facebook.com/v19.0/oauth/access_token',
      instagram_business: 'https://graph.facebook.com/v19.0/oauth/access_token',
      instagram: 'https://graph.facebook.com/v19.0/oauth/access_token',
      youtube: 'https://oauth2.googleapis.com/token',
    }

    const tokenUrl = tokenUrls[req.params.id]
    if (!tokenUrl) {
      return reply.redirect(frontendRedirect(returnTo, { connect: req.params.id, error: 'oauth_not_configured' }))
    }

    if (!req.query.code) {
      return reply.redirect(frontendRedirect(returnTo, { connect: req.params.id, error: 'missing_code' }))
    }

    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: req.query.code,
        redirect_uri: redirectUri,
        client_id: clientId,
      })
      if (req.params.id === 'twitter_x' && codeVerifier) body.set('code_verifier', codeVerifier)

      const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
      if (req.params.id === 'twitter_x' && clientSecret) {
        headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      } else if (clientSecret) {
        body.set('client_secret', clientSecret)
      }

      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers,
        body: body.toString(),
      })

      const data = await res.json() as {
        access_token: string
        refresh_token?: string
        expires_in?: number
        error?: string | {
          message?: string
          type?: string
          code?: number
        }
        error_description?: string
      }

      if (!res.ok || data.error) {
        // Handle both flat error structure and nested error object (Facebook style)
        const errorMessage = typeof data.error === 'object'
          ? data.error.message || data.error_description || 'token_exchange_failed'
          : data.error_description || data.error || 'token_exchange_failed'
        log.error({ connector_id: req.params.id, status: res.status, data }, 'OAuth token exchange failed')
        return reply.redirect(frontendRedirect(returnTo, { connect: req.params.id, error: errorMessage }))
      }

      await executor.saveCredentials(tenantId, {
        tenant_id: tenantId,
        connector_id: req.params.id,
        auth_type: 'oauth2',
        access_token: encryptIfNeeded(data.access_token)!,
        ...(data.refresh_token ? { refresh_token: encryptIfNeeded(data.refresh_token)! } : {}),
        ...(data.expires_in ? { token_expires_at: new Date(Date.now() + data.expires_in * 1000) } : {}),
        token_type: 'Bearer',
      })
      // A fresh grant clears any earlier dead-refresh-token flag.
      await getTenantCollection<Record<string, unknown>>(db, 'connector_credentials', tenantId)
        .updateOne({ connector_id: req.params.id }, { $set: { needs_reauth: false } })

      // X: resolve the account handle once so /marketing/connections can
      // show "X (@handle)" instead of a bare channel name. Best-effort —
      // a failed lookup never fails the connect flow.
      if (req.params.id === 'twitter_x') {
        try {
          const meRes = await fetch('https://api.x.com/2/users/me', {
            headers: { Authorization: `Bearer ${data.access_token}` },
          })
          const me = (await meRes.json()) as { data?: { id?: string; username?: string } }
          if (meRes.ok && me.data?.username) {
            await getTenantCollection<Record<string, unknown>>(db, 'connector_credentials', tenantId)
              .updateOne(
                { connector_id: 'twitter_x' },
                { $set: { 'extra.username': me.data.username, ...(me.data.id ? { 'extra.user_id': me.data.id } : {}) } },
              )
          }
        } catch {
          // display nicety only
        }
      }

      // ── Family app: mirror into its own connector_id: 'email' shape ─────
      // The family app's inbox scanner (jobs/email-scan.ts) reads IMAP
      // credentials under connector_id 'email', not the platform's own
      // connector_id 'gmail' record saved above — same OAuth grant, two
      // different consumers. IMAP over Gmail supports XOAUTH2 (an access
      // token in place of a password), so this reuses the exact same scan/
      // classify pipeline the manual App-Password flow already goes through
      // instead of adding a second, Gmail-API-specific path.
      if (req.params.id === 'gmail' && returnTo === 'family') {
        const emailAddress = await fetchGmailAddress(data.access_token)
        if (!emailAddress) {
          return reply.redirect(frontendRedirect(returnTo, { connect: req.params.id, error: 'Could not read the connected Gmail address' }))
        }

        const familyCreds = getTenantCollection<Record<string, unknown>>(db, 'connector_credentials', tenantId)
        const existing = await familyCreds.findOne({ connector_id: 'email' }) as { extra?: { refresh_token?: string } } | null
        // Google only reissues a refresh_token on the first consent for a
        // given scope — a reconnect often comes back without one, so keep
        // the previously stored one rather than overwriting it with nothing.
        const refreshToken = data.refresh_token ? encryptIfNeeded(data.refresh_token) : existing?.extra?.refresh_token

        const credentialDoc = {
          tenant_id: tenantId,
          connector_id: 'email',
          auth_type: 'oauth',
          username: emailAddress,
          extra: {
            host: 'imap.gmail.com',
            port: 993,
            use_tls: true,
            provider: 'gmail',
            access_token: encryptIfNeeded(data.access_token),
            ...(refreshToken ? { refresh_token: refreshToken } : {}),
            ...(data.expires_in ? { token_expires_at: new Date(Date.now() + data.expires_in * 1000) } : {}),
          },
          updated_at: new Date(),
          needs_reauth: false,
        }
        await familyCreds.updateOne({ connector_id: 'email' }, { $set: credentialDoc }, { upsert: true })

        log.info({ tenant_id: tenantId, email: emailAddress }, 'Gmail connected via OAuth for family email connector')

        scanTenantInbox(db, tenantId, credentialDoc as Parameters<typeof scanTenantInbox>[2]).catch((err) => {
          log.error({ err, tenant_id: tenantId }, 'Initial email scan failed (OAuth connect)')
        })

        return reply.redirect(frontendRedirect(returnTo, { connected: 'email', email: emailAddress }))
      }

      // ── Auto-trigger historical backfill in background ──────────────────
      // Run async so the OAuth redirect completes immediately.
      // The backfill will replay up to 180 days of historical data.
      if (syncEngine && connectorLoader) {
        const connector = connectorLoader.get(req.params.id)
        if (connector) {
          syncEngine.backfill(connector, tenantId).then(result => {
            fastify.log.info(
              { connector_id: req.params.id, tenant_id: tenantId, ...result },
              'Backfill complete',
            )
          }).catch(err => {
            fastify.log.error({ err, connector_id: req.params.id }, 'Backfill failed')
          })
        }
      }

      return reply.redirect(frontendRedirect(returnTo, { connected: req.params.id }))
    } catch (err) {
      return reply.redirect(frontendRedirect(returnTo, { connect: req.params.id, error: String(err) }))
    }
  })

  // POST /connectors/:id/backfill — manually trigger (or re-trigger) historical backfill
  fastify.post<{ Params: { id: string } }>('/connectors/:id/backfill', async (req, reply) => {
    const tenantId = req.authContext.tenant_id
    if (!syncEngine || !connectorLoader) {
      return reply.status(503).send({ error: 'Sync engine not available' })
    }
    const connector = connectorLoader.get(req.params.id)
    if (!connector) return reply.status(404).send({ error: 'Connector not found' })
    const connected = await executor.hasCredentials(tenantId, req.params.id)
    if (!connected) return reply.status(400).send({ error: 'Connector not connected' })

    // Fire and forget — returns immediately, runs in background
    syncEngine.backfill(connector, tenantId)
      .then(r => fastify.log.info({ ...r }, 'Manual backfill complete'))
      .catch(err => fastify.log.error({ err }, 'Manual backfill failed'))

    return reply.status(202).send({
      status: 'backfill_started',
      connector_id: req.params.id,
      lookback_days: 180,
      message: 'Backfill running in background. Check /connectors/:id/sync/status for progress.',
    })
  })

  // GET /connectors/:id/sync/status — sync state per resource
  fastify.get<{ Params: { id: string } }>('/connectors/:id/sync/status', async (req) => {
    const tenantId = req.authContext.tenant_id
    const stateCol = db.collection('connector_sync_state')
    const states = await stateCol.find({
      tenant_id: tenantId,
      connector_id: req.params.id,
    }).toArray()
    return {
      connector_id: req.params.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resources: (states as any[]).map((s) => ({
        resource: s.resource as string,
        last_synced_at: s.last_synced_at as Date | null,
        backfill_complete: s.backfill_complete as boolean,
        total_records_synced: s.total_records_synced as number,
        last_error: (s.last_error ?? null) as { status: number; status_text: string; at: Date } | null,
      })),
    }
  })

  // GET /memory/:workflowId — list agent memory entries for a workflow
  fastify.get<{ Params: { workflowId: string } }>('/memory/:workflowId', async (req) => {
    const tenantId = req.authContext.tenant_id
    const col = db.collection('agent_memory')
    const entries = await col
      .find({ tenant_id: tenantId, workflow_id: req.params.workflowId })
      .sort({ created_at: -1 })
      .limit(50)
      .toArray()
    return { entries, total: entries.length }
  })

  // DELETE /memory/:workflowId/:key — forget a specific memory
  fastify.delete<{ Params: { workflowId: string; key: string } }>('/memory/:workflowId/:key', async (req) => {
    const tenantId = req.authContext.tenant_id
    const col = db.collection('agent_memory')
    await col.deleteOne({ tenant_id: tenantId, workflow_id: req.params.workflowId, key: req.params.key })
    return { ok: true }
  })
}
