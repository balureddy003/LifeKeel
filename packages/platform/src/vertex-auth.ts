/**
 * Vertex AI auth for the LLM router.
 *
 * Vertex's OpenAI-compatible surface (`/endpoints/openapi/chat/completions`)
 * accepts ONLY Google Cloud OAuth2 access tokens — express-mode API keys are
 * rejected there (they only work on the native `:generateContent` API, which
 * is a different request/response shape and deliberately not wired).
 *
 * Access tokens expire in ~1 hour, so they cannot be a static env var: the
 * caller supplies a per-call header resolver — the same seam as
 * `LlmConfig.ollamaHeaders`. Two credential sources, in order:
 *
 *   1. VERTEX_SERVICE_ACCOUNT_JSON — off-GCP deployments (dev machines,
 *      non-GCP hosts). A service-account JWT is signed locally (RS256) and
 *      exchanged at oauth2.googleapis.com/token — the same exchange
 *      apps/api's fcm-sender uses for FCM; no google-auth dependency.
 *   2. The Cloud Run/GCE metadata server — the API's real home. The service's
 *      own service account needs `roles/aiplatform.user` and the deployment
 *      carries no secret at all.
 *
 * Tokens are cached until shortly before expiry; concurrent refreshes share
 * one inflight request. A credential failure throws — callers treat it as a
 * failed call and never send unauthenticated.
 */

import crypto from 'node:crypto'

const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

/** Refresh this long before expiry so an in-flight call never carries a stale token. */
const REFRESH_MARGIN_MS = 5 * 60_000
export interface VertexAuthOptions {
  fetchImpl?: typeof fetch
  now?: () => number
}

interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri?: string
}

function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
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

function serviceAccountTokenSource(
  account: ServiceAccount,
  doFetch: typeof fetch,
): () => Promise<{ token: string; expiresInMs: number }> {
  return async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const tokenUri = account.token_uri ?? OAUTH_TOKEN_URL
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = b64url(
      JSON.stringify({
        iss: account.client_email,
        scope: CLOUD_PLATFORM_SCOPE,
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
    if (!res.ok) throw new Error(`Vertex token exchange failed: HTTP ${res.status}`)
    const json = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!json.access_token) throw new Error('Vertex token exchange returned no access token')
    return { token: json.access_token, expiresInMs: (json.expires_in ?? 3600) * 1000 }
  }
}

function metadataTokenSource(doFetch: typeof fetch): () => Promise<{
  token: string
  expiresInMs: number
}> {
  return async () => {
    const res = await doFetch(METADATA_TOKEN_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) throw new Error(`Vertex metadata token request failed: HTTP ${res.status}`)
    const json = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!json.access_token)
      throw new Error('Vertex metadata token request returned no access token')
    return { token: json.access_token, expiresInMs: (json.expires_in ?? 3600) * 1000 }
  }
}

/**
 * Returns a headers provider for `LlmConfig.vertexHeaders`. Source order:
 * service-account JSON env → metadata server. Throws at call time (not
 * construction) when neither source can produce a token, so constructing the
 * router on a machine without GCP credentials is not itself an error.
 */
export function vertexAccessTokenProvider(
  opts: VertexAuthOptions = {},
): () => Promise<Record<string, string>> {
  const doFetch = opts.fetchImpl ?? fetch
  const now = opts.now ?? Date.now
  const account = parseServiceAccount(process.env['VERTEX_SERVICE_ACCOUNT_JSON'])
  const source = account
    ? serviceAccountTokenSource(account, doFetch)
    : metadataTokenSource(doFetch)

  let cached: { token: string; refreshAt: number } | undefined
  let inflight: Promise<string> | undefined

  async function refresh(): Promise<string> {
    const { token, expiresInMs } = await source()
    cached = { token, refreshAt: now() + expiresInMs - REFRESH_MARGIN_MS }
    return token
  }

  return async () => {
    if (cached && now() < cached.refreshAt) return { Authorization: `Bearer ${cached.token}` }
    inflight ??= refresh().finally(() => {
      inflight = undefined
    })
    return { Authorization: `Bearer ${await inflight}` }
  }
}
