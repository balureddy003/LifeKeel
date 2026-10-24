/**
 * Google service-account access tokens, shared by every caller that signs in as a service account:
 * Vertex AI (vertex-auth.ts) and the read-only Search Console and GA4 clients in apps/api.
 *
 * A service-account JWT is signed locally (RS256) and exchanged at oauth2.googleapis.com/token, the same
 * exchange apps/api's fcm-sender uses; no google-auth dependency. The scope is a parameter, so a key
 * issued for read-only access can only ever mint tokens for the read-only scope a caller asks for.
 * A credential failure throws; callers treat it as a failed call and never send unauthenticated.
 */

import crypto from 'node:crypto'

export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
/** Refresh this long before expiry so an in-flight call never carries a stale token. */
export const GOOGLE_REFRESH_MARGIN_MS = 5 * 60_000

export interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri?: string
}

export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw) return null
  try {
    const sa = JSON.parse(raw) as Partial<ServiceAccount>
    if (typeof sa.client_email === 'string' && typeof sa.private_key === 'string') {
      const acct: ServiceAccount = {
        client_email: sa.client_email,
        private_key: sa.private_key,
      }
      if (typeof sa.token_uri === 'string') acct.token_uri = sa.token_uri
      return acct
    }
  } catch {
    // fall through
  }
  return null
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

/** One token exchange for `scope`. `label` only names the caller in error messages. */
export function serviceAccountTokenSource(
  account: ServiceAccount,
  doFetch: typeof fetch,
  scope: string,
  label = 'Google',
): () => Promise<{ token: string; expiresInMs: number }> {
  return async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const tokenUri = account.token_uri ?? GOOGLE_OAUTH_TOKEN_URL
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = b64url(
      JSON.stringify({
        iss: account.client_email,
        scope,
        aud: tokenUri,
        iat: nowSec,
        exp: nowSec + 3600,
      }),
    )
    const signature = crypto
      .createSign('RSA-SHA256')
      .update(`${header}.${claims}`)
      .sign(account.private_key)
    const res = await doFetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claims}.${b64url(signature)}`,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`${label} token exchange failed: HTTP ${res.status}`)
    const json = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!json.access_token) throw new Error(`${label} token exchange returned no access token`)
    return { token: json.access_token, expiresInMs: (json.expires_in ?? 3600) * 1000 }
  }
}

export interface GoogleTokenOptions {
  /** The service-account key JSON. */
  credentialsJson: string | undefined
  scope: string
  label?: string
  fetchImpl?: typeof fetch
  now?: () => number
}

/**
 * A cached bearer-token provider for one scope. Returns null when no usable key is configured, so a
 * caller can report "not configured" instead of failing; otherwise the returned function throws on a
 * failed exchange. Concurrent refreshes share one request.
 */
export function googleAccessTokenProvider(
  opts: GoogleTokenOptions,
): (() => Promise<string>) | null {
  const account = parseServiceAccount(opts.credentialsJson)
  if (!account) return null
  const source = serviceAccountTokenSource(account, opts.fetchImpl ?? fetch, opts.scope, opts.label)
  const now = opts.now ?? Date.now
  let cached: { token: string; refreshAt: number } | undefined
  let inflight: Promise<string> | undefined

  async function refresh(): Promise<string> {
    const { token, expiresInMs } = await source()
    cached = { token, refreshAt: now() + expiresInMs - GOOGLE_REFRESH_MARGIN_MS }
    return token
  }

  return async () => {
    if (cached && now() < cached.refreshAt) return cached.token
    inflight ??= refresh().finally(() => {
      inflight = undefined
    })
    return inflight
  }
}
