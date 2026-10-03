/**
 * Service-to-service auth for the self-hosted model service on Cloud Run.
 *
 * The model service is deployed with --no-allow-unauthenticated, so Cloud Run
 * itself rejects any request without a valid Google identity token whose audience
 * is the service URL (and whose caller holds roles/run.invoker). That replaces an
 * auth proxy in front of Ollama, which has none of its own. The API fetches a
 * token for its own service account from the metadata server and refreshes it
 * shortly before expiry.
 */

const METADATA_IDENTITY_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity'
/** Refresh this long before the token's own expiry so an in-flight call never carries a stale one. */
const REFRESH_MARGIN_MS = 5 * 60_000
/** Used only if the token's exp claim cannot be read; identity tokens last an hour. */
const FALLBACK_TTL_MS = 30 * 60_000

export interface IdTokenProviderOptions {
  fetchImpl?: typeof fetch
  now?: () => number
}

function expiryMs(jwt: string): number | undefined {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : undefined
  } catch {
    return undefined
  }
}

/** Cloud Run authenticates on the service URL, so the audience is the origin of the configured base URL. */
export function audienceFor(baseUrl: string): string {
  return new URL(baseUrl).origin
}

/**
 * Returns a headers provider for createLocalDecisionFn / createLlmRouter. Tokens are cached
 * until shortly before expiry and concurrent refreshes share one metadata request.
 * A metadata failure throws: callers treat it as a failed call and never send unauthenticated.
 */
export function cloudRunIdTokenProvider(baseUrl: string, opts: IdTokenProviderOptions = {}): () => Promise<Record<string, string>> {
  const doFetch = opts.fetchImpl ?? fetch
  const now = opts.now ?? Date.now
  const audience = audienceFor(baseUrl)
  let cached: { token: string; refreshAt: number } | undefined
  let inflight: Promise<string> | undefined

  async function refresh(): Promise<string> {
    const res = await doFetch(`${METADATA_IDENTITY_URL}?audience=${encodeURIComponent(audience)}`, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) throw new Error(`Identity token request failed: HTTP ${res.status}`)
    const token = (await res.text()).trim()
    if (!token) throw new Error('Identity token request returned an empty token')
    const exp = expiryMs(token)
    cached = { token, refreshAt: (exp ?? now() + FALLBACK_TTL_MS) - REFRESH_MARGIN_MS }
    return token
  }

  return async () => {
    if (cached && now() < cached.refreshAt) return { Authorization: `Bearer ${cached.token}` }
    inflight ??= refresh().finally(() => { inflight = undefined })
    return { Authorization: `Bearer ${await inflight}` }
  }
}
