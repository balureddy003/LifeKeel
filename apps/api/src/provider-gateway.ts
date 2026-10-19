/**
 * Provider gateway — the shared deadline/retry/breaker/idempotency policy
 * for outbound calls to external services that can create PUBLIC or
 * irreversible effects (social publishers today; the shape generalises).
 *
 * Why it exists (ARCHITECTURE.md §14.7): channel adapters used to call
 * `fetch` directly — no deadline, no retry policy, no breaker, and a hung
 * or flaky provider could silently double-post because a retry after a
 * lost response is indistinguishable from a first attempt.
 *
 * Policy:
 * - **Deadline**: every call runs under AbortSignal.timeout; the default
 *   suits interactive-ish dispatches and callers can narrow it.
 * - **Retry**: bounded attempts, exponential backoff + jitter. Retried:
 *   connection-level failures (no response received), HTTP 429 and 5xx.
 *   NOT retried: other 4xx, and timeouts UNLESS an idempotency key was
 *   attached — a timed-out request may have landed, and only a provider
 *   that honours the key can dedupe the retry.
 * - **Breaker**: per `breakerKey` (channel+account). `FAILURES_TO_OPEN`
 *   consecutive failures open the circuit for `OPEN_MS`; the next call
 *   after cooldown is a single half-open probe.
 * - **Idempotency**: callers pass a stable `idempotencyKey` (the marketing
 *   post id). Providers that support a dedupe primitive get it — Mastodon
 *   via the Idempotency-Key header, Bluesky via a deterministic record
 *   key; others receive it for observability only, and the post-claim
 *   state machine stays the dedupe control.
 *
 * The breaker map is process-local — on a multi-instance deploy each
 * instance has its own, which is the correct conservative behaviour for
 * public-effect calls.
 */

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'network' | 'rate_limited' | 'server' | 'client' | 'circuit_open',
    /** True when retrying the SAME call is safe (idempotency attached or
     *  the failure provably happened before dispatch). */
    readonly retriable: boolean,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export interface GatewayRequestOptions {
  /** Call label used in error messages, e.g. 'x /2/tweets' — keeps the
   *  operation context the raw fetch errors used to carry. */
  label?: string
  /** Per-attempt deadline. Default 15s. */
  timeoutMs?: number
  /** Extra attempts after the first (default 2 = 3 total tries). */
  retries?: number
  /** Stable dedupe key — forwarded as Idempotency-Key when set. */
  idempotencyKey?: string
  /** True when a retry after timeout cannot create a duplicate effect —
   *  either the provider dedupes on our idempotency key (Mastodon's
   *  Idempotency-Key, Bluesky's record-key semantics) or the call itself
   *  is idempotent (session creates). Without it a timed-out call is NOT
   *  retried — the write may have landed. */
  timeoutRetriable?: boolean
  /** Breaker identity, e.g. `mastodon:mastodon.social` — failures share a
   *  circuit per key so one sick provider can't stall the whole pipeline. */
  breakerKey: string
}

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRIES = 2
const FAILURES_TO_OPEN = 5
const OPEN_MS = 60_000

interface BreakerState {
  failures: number
  openUntil: number
}

const breakers = new Map<string, BreakerState>()

/** Test seam — clear all breaker state between runs. */
export function resetProviderBreakers(): void {
  breakers.clear()
}

function breakerAllows(key: string): void {
  const b = breakers.get(key)
  if (!b) return
  if (b.openUntil > Date.now()) {
    throw new ProviderError(
      `provider circuit open for ${key} — retry after ${new Date(b.openUntil).toISOString()}`,
      'circuit_open',
      false,
    )
  }
  // Cooldown elapsed: this call is the half-open probe.
}

function breakerResult(key: string, ok: boolean): void {
  if (ok) {
    breakers.delete(key)
    return
  }
  const b = breakers.get(key) ?? { failures: 0, openUntil: 0 }
  b.failures += 1
  if (b.failures >= FAILURES_TO_OPEN) b.openUntil = Date.now() + OPEN_MS
  breakers.set(key, b)
}

function classifyHttp(status: number, detail: string, label: string): ProviderError {
  const msg = `${label} ${status}: ${detail}`
  if (status === 429) return new ProviderError(msg, 'rate_limited', true, status)
  if (status >= 500) return new ProviderError(msg, 'server', true, status)
  return new ProviderError(msg, 'client', false, status)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * fetch() with deadline, retry budget, breaker and idempotency forwarding.
 * Returns the Response on success (caller reads the body); throws
 * ProviderError — never a bare fetch TypeError or DOMException.
 */
export async function providerFetch(
  url: string,
  init: RequestInit,
  opts: GatewayRequestOptions,
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxAttempts = 1 + (opts.retries ?? DEFAULT_RETRIES)
  // Only rebuild headers when we need to attach the key — callers pass
  // plain objects and tests introspect them as records.
  const headers = opts.idempotencyKey
    ? (() => {
        const h = new Headers(init.headers)
        if (!h.has('Idempotency-Key')) h.set('Idempotency-Key', opts.idempotencyKey)
        return h
      })()
    : init.headers

  let lastError: ProviderError | null = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    breakerAllows(opts.breakerKey) // throws circuit_open — not retried
    try {
      const res = await fetch(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.ok) {
        breakerResult(opts.breakerKey, true)
        return res
      }
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      const err = classifyHttp(res.status, detail, opts.label ?? 'provider')
      // Only provider-health failures count toward the breaker — a 401 is
      // our credential's problem, not the provider's availability.
      if (err.kind === 'server' || err.kind === 'rate_limited') {
        breakerResult(opts.breakerKey, false)
      }
      if (!err.retriable) throw err
      lastError = err
    } catch (err) {
      if (err instanceof ProviderError) throw err
      const name = err instanceof Error ? err.name : ''
      const isTimeout = name === 'TimeoutError' || name === 'AbortError'
      // A timeout may mean the provider committed the write but the
      // response was lost — retrying would risk a duplicate public post
      // unless the provider provably dedupes on our idempotency key.
      const retriable = !isTimeout || opts.timeoutRetriable === true
      lastError = new ProviderError(
        `${isTimeout ? 'timeout' : 'network'} calling ${new URL(url).host}: ${String(err).slice(0, 200)}`,
        isTimeout ? 'timeout' : 'network',
        retriable,
      )
      breakerResult(opts.breakerKey, false)
      if (!retriable) throw lastError
    }
    if (attempt < maxAttempts - 1) {
      await sleep(Math.min(2 ** attempt * 500, 4_000) * (0.5 + Math.random()))
    }
  }
  throw lastError ?? new ProviderError('provider call failed', 'network', false)
}
