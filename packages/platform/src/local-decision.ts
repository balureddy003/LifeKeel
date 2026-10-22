import type { z } from 'zod'
import { ollamaNumCtx } from './ollama-options.js'
import { currentDeadlineSignal } from './call-context.js'

/**
 * Typed decisions from a small open-source model served in our own
 * infrastructure (Ollama on CPU). Nothing is sent to a third party.
 *
 * Unlike `LlmFn` (string in, string out) this returns a validated value:
 * Ollama's `format` parameter constrains decoding to a JSON Schema, and the
 * result is validated again with Zod. Use it for classification and checklist
 * decisions, never for free-text generation.
 */

export interface LocalDecisionConfig {
  /** Base URL of the Ollama server, e.g. http://local-judge:11434 */
  baseUrl: string
  /** Model tag served by that Ollama instance, e.g. qwen2.5:7b (do not go below 3b: 1.5b passed unsafe copy in testing) */
  model: string
  /** Per-attempt timeout. CPU inference is slow; default 60s. */
  timeoutMs?: number
  /** Cap on generated tokens. Decisions are short; default 256. */
  maxTokens?: number
  /**
   * Max calls in flight from this process. A CPU-served model handles roughly one
   * call at a time, so unbounded concurrency only turns queueing into client-side
   * timeouts. Further calls wait their turn (the wait counts toward `queued_ms`,
   * not the per-attempt timeout). Default: unlimited.
   */
  maxConcurrent?: number
  /**
   * Extra request headers, resolved per call (so short-lived tokens can refresh).
   * Used for service-to-service auth, e.g. a Cloud Run identity token.
   */
  getHeaders?: () => Promise<Record<string, string>>
  /** Called once per decide() with the outcome, for metrics. Must not throw. */
  onCall?: (event: LocalDecisionCallEvent) => void
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

export interface LocalDecisionCallEvent {
  model: string
  ok: boolean
  /** Time spent waiting for a concurrency slot. */
  queued_ms: number
  /** Time spent in the model call itself, including retries. */
  latency_ms: number
}

/** Minimal FIFO semaphore. */
class Semaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []
  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
  }

  release(): void {
    const next = this.waiters.shift()
    if (next)
      next() // hand the slot straight to the next waiter
    else this.active -= 1
  }
}

export interface LocalDecisionRequest<T> {
  system: string
  prompt: string
  /** Validates the model output. */
  schema: z.ZodType<T>
  /** JSON Schema handed to Ollama to constrain decoding. Keep in sync with `schema`. */
  jsonSchema: Record<string, unknown>
}

export interface LocalDecisionResult<T> {
  value: T
  model: string
  latency_ms: number
}

export type DecisionFn = <T>(req: LocalDecisionRequest<T>) => Promise<LocalDecisionResult<T>>

export class LocalDecisionError extends Error {
  constructor(
    message: string,
    readonly cause_?: unknown,
  ) {
    super(message)
    this.name = 'LocalDecisionError'
  }
}

const MAX_ATTEMPTS = 2

export function createLocalDecisionFn(cfg: LocalDecisionConfig): DecisionFn {
  const baseUrl = cfg.baseUrl.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new LocalDecisionError(`Invalid local model base URL: ${cfg.baseUrl}`)
  }
  const timeoutMs = cfg.timeoutMs ?? 60_000
  const maxTokens = cfg.maxTokens ?? 256
  const doFetch = cfg.fetchImpl ?? fetch
  const gate =
    cfg.maxConcurrent && cfg.maxConcurrent > 0 ? new Semaphore(cfg.maxConcurrent) : undefined

  return async function decide<T>(req: LocalDecisionRequest<T>): Promise<LocalDecisionResult<T>> {
    const queuedAt = Date.now()
    await gate?.acquire()
    const started = Date.now()
    let ok = false
    try {
      const result = await callModel(req, started)
      ok = true
      return result
    } finally {
      gate?.release()
      try {
        cfg.onCall?.({
          model: cfg.model,
          ok,
          queued_ms: started - queuedAt,
          latency_ms: Date.now() - started,
        })
      } catch {
        /* metrics must never fail a call */
      }
    }
  }

  async function callModel<T>(
    req: LocalDecisionRequest<T>,
    started: number,
  ): Promise<LocalDecisionResult<T>> {
    let lastError: unknown
    // The task deadline's signal (see call-context.ts): when it fires, cancel the request to the
    // model and stop retrying, so the server is not left working on an answer nobody awaits.
    const deadline = currentDeadlineSignal()

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (deadline?.aborted) {
        lastError = new Error('cancelled at the task deadline')
        break
      }
      try {
        const extraHeaders = cfg.getHeaders ? await cfg.getHeaders() : {}
        const res = await doFetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...extraHeaders },
          signal: deadline
            ? AbortSignal.any([AbortSignal.timeout(timeoutMs), deadline])
            : AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            model: cfg.model,
            stream: false,
            format: req.jsonSchema,
            // temperature 0 + fixed seed: the same input gives the same decision,
            // which keeps verdict caching and audits meaningful.
            options: { temperature: 0, seed: 0, num_predict: maxTokens, num_ctx: ollamaNumCtx() },
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.prompt },
            ],
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { message?: { content?: string } }
        const parsed = req.schema.parse(JSON.parse(data.message?.content ?? ''))
        return { value: parsed, model: cfg.model, latency_ms: Date.now() - started }
      } catch (err) {
        lastError = err
      }
    }
    throw new LocalDecisionError(
      `Local model decision failed after ${MAX_ATTEMPTS} attempts: ${(lastError as Error)?.message ?? 'unknown error'}`,
      lastError,
    )
  }
}
