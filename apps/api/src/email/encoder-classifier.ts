import { z } from 'zod'
import type { FetchedEmail } from './imap-client.js'

/**
 * Client for the policy-relevance encoder service (infra/encoder-service): a small
 * open encoder model that says whether an email is about a policy the household
 * holds, in ~0.5s on CPU instead of ~10-20s for an LLM. It classifies only; summary,
 * action and field extraction stay with the LLM (the encoder's extraction was partial).
 */

export interface EncoderVerdict {
  relevant: boolean
  label: string
  confidence: number
  latency_ms: number
}

export type EncoderClassifier = (email: Pick<FetchedEmail, 'from' | 'subject' | 'textSnippet'>) => Promise<EncoderVerdict>

export class EncoderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EncoderError'
  }
}

const ResponseSchema = z.object({
  relevant: z.boolean(),
  label: z.string(),
  confidence: z.number().min(0).max(1),
  latency_ms: z.number().nonnegative(),
})

export interface EncoderClientConfig {
  baseUrl: string
  /** Per-call timeout. The model answers in ~0.5s, but a cold instance loads it first. Default 20s. */
  timeoutMs?: number
  getHeaders?: () => Promise<Record<string, string>>
  /** Called once per call, for metrics. Must not throw. */
  onCall?: (e: { ok: boolean; latency_ms: number }) => void
  fetchImpl?: typeof fetch
}

export function createEncoderClassifier(cfg: EncoderClientConfig): EncoderClassifier {
  const baseUrl = cfg.baseUrl.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(baseUrl)) throw new EncoderError(`Invalid encoder base URL: ${cfg.baseUrl}`)
  const doFetch = cfg.fetchImpl ?? fetch
  const timeoutMs = cfg.timeoutMs ?? 20_000

  return async (email) => {
    const started = Date.now()
    let ok = false
    try {
      const headers = cfg.getHeaders ? await cfg.getHeaders() : {}
      const res = await doFetch(`${baseUrl}/v1/policy-relevance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ from: email.from, subject: email.subject, text: email.textSnippet }),
      })
      if (!res.ok) throw new EncoderError(`Encoder HTTP ${res.status}`)
      const parsed = ResponseSchema.safeParse(await res.json())
      if (!parsed.success) throw new EncoderError('Encoder returned an unexpected response shape')
      ok = true
      return parsed.data
    } finally {
      try { cfg.onCall?.({ ok, latency_ms: Date.now() - started }) } catch { /* metrics must never fail a call */ }
    }
  }
}
