/**
 * LLM Circuit Breaker
 *
 * Wraps LLM calls with a circuit breaker to prevent cascading failures.
 *
 * States:
 *   closed    — normal operation; failures are tracked
 *   open      — circuit tripped; requests rejected immediately for 60s
 *   half-open — one probe request allowed after the 60s cooldown
 *
 * Retry policy (per call, before counting as a failure):
 *   Retries on HTTP 429 (rate limit) or 5xx errors.
 *   Max 3 retries with exponential backoff + ±20% jitter.
 *   Delays: ~1s, ~2s, ~4s.
 *
 * Failure counting:
 *   After 5 consecutive failures (each exhausting retries), circuit opens.
 *   A success resets the consecutive failure count and closes the circuit.
 */

import { createLogger } from './logger.js'

const log = createLogger({ service: 'llm-circuit-breaker', version: '0.0.0' })

type CircuitState = 'closed' | 'open' | 'half-open'

const FAILURE_THRESHOLD = 5
const OPEN_DURATION_MS = 60_000
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1_000

// Status codes / message patterns that trigger retry
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message
  // HTTP status in message (e.g. "HTTP 429" or "status 503")
  const statusMatch = msg.match(/\b(429|5\d\d)\b/)
  if (statusMatch && RETRYABLE_STATUS.has(Number(statusMatch[1]))) return true
  // Provider-level rate-limit / transient strings
  const lc = msg.toLowerCase()
  return (
    lc.includes('rate limit') ||
    lc.includes('overloaded') ||
    lc.includes('timeout') ||
    lc.includes('service unavailable') ||
    lc.includes('bad gateway') ||
    lc.includes('internal server error')
  )
}

function jitter(base: number): number {
  // ±20% jitter
  return base * (0.8 + Math.random() * 0.4)
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isRetryable(err) || attempt === MAX_RETRIES) break
      const delay = jitter(BASE_DELAY_MS * Math.pow(2, attempt))
      log.warn({ attempt: attempt + 1, max_retries: MAX_RETRIES, delay_ms: Math.round(delay), err: (err as Error).message }, 'Retrying LLM call')
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastErr
}

export interface CircuitBreakerOptions {
  failureThreshold?: number
  openDurationMs?: number
}

export class LlmCircuitBreaker {
  private state: CircuitState = 'closed'
  private consecutiveFailures = 0
  private openedAt: number | null = null

  private readonly failureThreshold: number
  private readonly openDurationMs: number

  constructor(private readonly key: string, options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? FAILURE_THRESHOLD
    this.openDurationMs = options.openDurationMs ?? OPEN_DURATION_MS
  }

  private transition(next: CircuitState): void {
    if (this.state === next) return
    log.info({ key: this.key, from: this.state, to: next }, 'Circuit state transition')
    this.state = next
  }

  private isOpen(): boolean {
    if (this.state === 'closed') return false

    const elapsed = Date.now() - (this.openedAt ?? 0)
    if (this.state === 'open') {
      if (elapsed >= this.openDurationMs) {
        this.transition('half-open')
        return false  // allow the probe
      }
      return true  // still locked out
    }

    // half-open: allow exactly one probe through
    return false
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      const remaining = Math.ceil((this.openDurationMs - (Date.now() - (this.openedAt ?? 0))) / 1000)
      throw new Error(`[LlmCircuitBreaker:${this.key}] Circuit open — retry in ~${remaining}s`)
    }

    try {
      const result = await withRetry(fn)
      // Success — reset failure count and close
      if (this.consecutiveFailures > 0 || this.state !== 'closed') {
        this.consecutiveFailures = 0
        this.openedAt = null
        this.transition('closed')
      }
      return result
    } catch (err) {
      this.consecutiveFailures++
      log.warn({ key: this.key, failure_count: this.consecutiveFailures, err: (err as Error).message }, 'Circuit breaker failure')

      if (this.state === 'half-open') {
        // Probe failed — reopen for another 60s
        this.openedAt = Date.now()
        this.transition('open')
      } else if (this.consecutiveFailures >= this.failureThreshold) {
        // Threshold reached — open circuit
        this.openedAt = Date.now()
        this.transition('open')
      }

      throw err
    }
  }

  /** Current state for observability/metrics. */
  getState(): CircuitState {
    // Side-effect: automatically transition to half-open if cooldown elapsed
    this.isOpen()
    return this.state
  }

  /** Numeric encoding of state for Prometheus gauges (0=closed, 1=open, 2=half-open). */
  getStateNumeric(): 0 | 1 | 2 {
    const s = this.getState()
    if (s === 'closed') return 0
    if (s === 'open') return 1
    return 2
  }
}

// ── Module-level singleton factory ────────────────────────────────────────────

const breakers = new Map<string, LlmCircuitBreaker>()

/**
 * Returns (or creates) a singleton `LlmCircuitBreaker` for the given provider key.
 * Safe to call multiple times — always returns the same instance per key.
 */
export function getCircuitBreaker(key: string, options: CircuitBreakerOptions = {}): LlmCircuitBreaker {
  if (!breakers.has(key)) {
    breakers.set(key, new LlmCircuitBreaker(key, options))
  }
  return breakers.get(key)!
}

/**
 * Returns all circuit breakers that have been created.
 * Used by the metrics endpoint to expose state gauges.
 */
export function getAllCircuitBreakers(): Map<string, LlmCircuitBreaker> {
  return breakers
}
