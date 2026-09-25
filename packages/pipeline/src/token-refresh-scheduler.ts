/**
 * TokenRefreshScheduler
 *
 * Proactively refreshes OAuth access tokens before they expire.
 * Runs on a background interval (default: every 10 minutes).
 *
 * For each credential record where token_expires_at is within the
 * refresh window (default: 30 minutes), it calls the provider's
 * token endpoint and updates the stored tokens.
 *
 * This ensures the ConnectorSyncEngine always has a valid token
 * and eliminates 401 errors during scheduled syncs.
 */
import { safeFetch } from './safe-fetch.js'
import { createLogger } from '@agentoak/platform'

const log = createLogger({ service: 'token-refresh', version: '0.0.0' })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { collection: (name: string) => any }

// Google connectors that can use shared credentials
const GOOGLE_CONNECTORS = ['google_calendar', 'gmail', 'google_drive', 'youtube', 'google_sheets', 'google_business']

function getGoogleClientId(connectorId: string): string {
  // Try connector-specific first for backward compatibility
  const specificId = process.env[`KAIROS_${connectorId.toUpperCase()}_CLIENT_ID`]
  if (specificId) return specificId
  
  // Fall back to shared Google credentials for Google services
  if (GOOGLE_CONNECTORS.includes(connectorId)) {
    return process.env['GOOGLE_CLIENT_ID'] ?? ''
  }
  
  return ''
}

function getGoogleClientSecret(connectorId: string): string {
  // Try connector-specific first for backward compatibility
  const specificSecret = process.env[`KAIROS_${connectorId.toUpperCase()}_CLIENT_SECRET`]
  if (specificSecret) return specificSecret
  
  // Fall back to shared Google credentials for Google services
  if (GOOGLE_CONNECTORS.includes(connectorId)) {
    return process.env['GOOGLE_CLIENT_SECRET'] ?? ''
  }
  
  return ''
}

/** Refresh window: refresh tokens expiring within this many milliseconds */
const REFRESH_WINDOW_MS = 30 * 60 * 1000 // 30 minutes

const TOKEN_URLS: Record<string, string> = {
  xero: 'https://identity.xero.com/connect/token',
  hubspot: 'https://api.hubapi.com/oauth/v1/token',
  google_calendar: 'https://oauth2.googleapis.com/token',
  gmail: 'https://oauth2.googleapis.com/token',
  google_drive: 'https://oauth2.googleapis.com/token',
  youtube: 'https://oauth2.googleapis.com/token',
  google_sheets: 'https://oauth2.googleapis.com/token',
  shopify: '', // per-shop, not handled here
}

export class TokenRefreshScheduler {
  private readonly db: Db
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(db: Db) {
    this.db = db
  }

  /** Start the background refresh loop. */
  start(intervalMs = 10 * 60 * 1000): void {
    this.timer = setInterval(() => {
      this.refreshExpiring().catch(err =>
        log.error({ err }, 'Token refresh cycle failed'),
      )
    }, intervalMs)

    // Run once immediately on startup
    this.refreshExpiring().catch(() => {})
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Find and refresh all tokens expiring within REFRESH_WINDOW_MS. */
  async refreshExpiring(): Promise<number> {
    const col = this.db.collection('connector_credentials')
    const windowCutoff = new Date(Date.now() + REFRESH_WINDOW_MS)

    const expiring = await col.find({
      auth_type: 'oauth2',
      refresh_token: { $exists: true, $ne: null },
      token_expires_at: { $lt: windowCutoff },
    }).toArray() as Array<{
      tenant_id: string
      connector_id: string
      refresh_token: string
      token_expires_at: Date
    }>

    let refreshed = 0
    for (const cred of expiring) {
      try {
        await this.refreshOne(cred.tenant_id, cred.connector_id, cred.refresh_token)
        refreshed++
      } catch (err) {
        log.warn({ tenant_id: cred.tenant_id, connector_id: cred.connector_id, err }, 'Token refresh failed')
        // invalid_grant means the refresh token itself is dead (revoked or
        // expired) — retrying never helps, only the user re-consenting does.
        // Record it so the app can offer "Reconnect" instead of silently
        // showing a connection that will never sync again.
        if (err instanceof Error && err.message === 'invalid_grant') {
          await this.db.collection('connector_credentials').updateOne(
            { tenant_id: cred.tenant_id, connector_id: cred.connector_id },
            { $set: { needs_reauth: true, needs_reauth_at: new Date() } },
          )
        }
      }
    }

    if (refreshed > 0) {
      log.info({ count: refreshed }, 'Tokens refreshed')
    }
    return refreshed
  }

  private async refreshOne(
    tenantId: string,
    connectorId: string,
    refreshToken: string,
  ): Promise<void> {
    const tokenUrl = TOKEN_URLS[connectorId]
    if (!tokenUrl) return // not supported for this connector

    const clientId = getGoogleClientId(connectorId)
    const clientSecret = getGoogleClientSecret(connectorId)
    if (!clientId) return // not configured

    const res = await safeFetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    })

    const data = await res.json() as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      error?: string
    }

    if (!res.ok || !data.access_token) {
      throw new Error(data.error ?? 'token refresh failed')
    }

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
  }
}
