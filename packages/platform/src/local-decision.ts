import type { z } from 'zod'

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
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
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
  constructor(message: string, readonly cause_?: unknown) {
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

  return async function decide<T>(req: LocalDecisionRequest<T>): Promise<LocalDecisionResult<T>> {
    const started = Date.now()
    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await doFetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            model: cfg.model,
            stream: false,
            format: req.jsonSchema,
            // temperature 0 + fixed seed: the same input gives the same decision,
            // which keeps verdict caching and audits meaningful.
            options: { temperature: 0, seed: 0, num_predict: maxTokens },
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.prompt },
            ],
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as { message?: { content?: string } }
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
