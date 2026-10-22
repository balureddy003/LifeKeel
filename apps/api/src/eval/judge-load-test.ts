import { pathToFileURL } from 'node:url'
import { ollamaNumCtx } from '@lifekeel/platform'
import { evalAuthHeaders } from './local-model-eval.js'
import { LABELLED_EMAILS } from '../email/__fixtures__/labelled-emails.js'
import { EMAIL_CLASSIFY_JSON_SCHEMA, EMAIL_CLASSIFY_SYSTEM_PROMPT } from '../email/classify.js'
import { CLASSIFIER_MAX_TOKENS } from '../local-model.js'

/**
 * Load and context test for the self-hosted model service:
 *
 *   LOCAL_JUDGE_BASE_URL=https://... LOCAL_JUDGE_MODEL=qwen2.5:7b \
 *   LOAD_TEST_CONFIRM=yes node dist/eval/judge-load-test.js
 *
 * Two things the unit tests cannot show:
 *  1. Capacity: the same request mix at 1, 2 and 4 concurrent calls, reporting
 *     latency percentiles, throughput and errors. The service runs with
 *     `--concurrency 1`, so throughput should stay flat and latency should grow
 *     with concurrency; anything else is worth knowing before sizing.
 *  2. Context: a long prompt with a code at its start must be answered
 *     correctly. Ollama silently truncates prompts that exceed its context, so
 *     a wrong answer here means `num_ctx` is not taking effect on that server.
 *
 * Every request consumes instance time (and wakes a scaled-to-zero service),
 * so against anything other than localhost it refuses to run unless
 * LOAD_TEST_CONFIRM=yes. Knobs: LOAD_TEST_REQUESTS (per level, default 6),
 * LOAD_TEST_LEVELS (default "1,2,4"), LOAD_TEST_TIMEOUT_MS (default 300000),
 * LOAD_TEST_SKIP_CONTEXT=yes (capacity only; the long prompt can take minutes).
 * Auth is the same as local-model-eval (LOCAL_JUDGE_BEARER or
 * LOCAL_JUDGE_AUTH=cloudrun-iam). Results are only as representative as the
 * hardware you point it at: a laptop says nothing about Cloud Run CPU.
 */

export interface Sample {
  ok: boolean
  ms: number
  status: number | null
  error?: string
}

export interface LevelSummary {
  concurrency: number
  requests: number
  errors: number
  errorRate: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  throughputPerMin: number
  /** Failed calls grouped by cause, e.g. { 'HTTP 429': 1 }. */
  errorsByKind: Record<string, number>
}

/** Nearest-rank percentile of an unsorted list; 0 for an empty list. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!
}

/** Summarise one concurrency level. Latency stats use successful calls only. */
export function summarise(concurrency: number, samples: Sample[], wallMs: number): LevelSummary {
  const okMs = samples.filter((s) => s.ok).map((s) => s.ms)
  const errors = samples.length - okMs.length
  const errorsByKind: Record<string, number> = {}
  for (const x of samples.filter((y) => !y.ok)) {
    const kind = (x.error ?? 'error').slice(0, 40)
    errorsByKind[kind] = (errorsByKind[kind] ?? 0) + 1
  }
  return {
    concurrency,
    requests: samples.length,
    errors,
    errorRate: samples.length === 0 ? 0 : errors / samples.length,
    p50Ms: percentile(okMs, 50),
    p95Ms: percentile(okMs, 95),
    maxMs: okMs.length ? Math.max(...okMs) : 0,
    throughputPerMin: wallMs > 0 ? (okMs.length / wallMs) * 60_000 : 0,
    errorsByKind,
  }
}

/** Parse "1,2,4" into positive integers; falls back to the default on bad input. */
export function parseLevels(raw: string | undefined): number[] {
  const levels = (raw ?? '1,2,4')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 32)
  return levels.length ? levels : [1, 2, 4]
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** Spending guard: a non-local target needs an explicit LOAD_TEST_CONFIRM=yes. */
export function mayRun(
  baseUrl: string,
  confirm: string | undefined,
): { ok: boolean; why?: string } {
  let host: string
  try {
    host = new URL(baseUrl).hostname
  } catch {
    return { ok: false, why: `Not a valid URL: ${baseUrl}` }
  }
  if (LOCAL_HOSTS.has(host) || confirm === 'yes') return { ok: true }
  return {
    ok: false,
    why: `${host} is not local. This test consumes instance time and wakes a scaled-to-zero service; set LOAD_TEST_CONFIRM=yes to run it.`,
  }
}

/**
 * A production-shaped classification prompt: the real classifier system prompt
 * and an email from the labelled set.
 *
 * Ollama reuses the cached key/value state of any identical prompt prefix.
 * In production every call shares the same long system prompt and differs only
 * in the email, so that prefix is cached while the email is not. `salt` goes at
 * the START OF THE USER MESSAGE (after the shared system prompt) so each call
 * pays for its own email but still shares the system-prompt prefix, exactly as
 * new mail does. Salting the system prompt instead would defeat the shared
 * prefix and make the server look slower than it is; omitting the salt would
 * let later concurrency levels reuse earlier emails and look faster.
 */
export function classifyPrompt(i: number, salt = ''): { system: string; prompt: string } {
  const e = LABELLED_EMAILS[i % LABELLED_EMAILS.length]!
  return {
    system: EMAIL_CLASSIFY_SYSTEM_PROMPT,
    prompt: `${salt ? `Ref ${salt}\n` : ''}<email_from>${e.from}</email_from>\n<email_subject>${e.subject}</email_subject>\n\n<email_body>\n${e.textSnippet}\n</email_body>`,
  }
}

/** A long prompt with a code at its start and the question at the end. */
export function contextProbe(code = 'PELICAN-7731'): {
  system: string
  prompt: string
  code: string
} {
  const filler = 'The quarterly report covers routine matters of no particular interest. '.repeat(
    420,
  )
  return {
    system: 'You answer briefly.',
    prompt: `The access code is ${code}. Remember it.\n\n${filler}\n\nWhat is the access code? Reply with the code only.`,
    code,
  }
}

/** The output cap the classifier request uses in production. */
export const CLASSIFY_NUM_PREDICT = CLASSIFIER_MAX_TOKENS

interface Target {
  baseUrl: string
  model: string
  timeoutMs: number
  getHeaders?: () => Promise<Record<string, string>>
}

async function chat(
  t: Target,
  system: string,
  prompt: string,
  numPredict: number,
  format?: unknown,
): Promise<{ sample: Sample; text: string }> {
  const started = Date.now()
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(t.getHeaders ? await t.getHeaders() : {}),
    }
    const res = await fetch(`${t.baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(t.timeoutMs),
      body: JSON.stringify({
        model: t.model,
        stream: false,
        // Same decoding constraint production uses for the classifier, when given.
        ...(format ? { format } : {}),
        // Same options the API sends, so the server is exercised the way production exercises it.
        options: { temperature: 0, seed: 0, num_predict: numPredict, num_ctx: ollamaNumCtx() },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    })
    const ms = Date.now() - started
    if (!res.ok)
      return {
        sample: { ok: false, ms, status: res.status, error: `HTTP ${res.status}` },
        text: '',
      }
    const data = (await res.json()) as { message?: { content?: string } }
    return { sample: { ok: true, ms, status: res.status }, text: data.message?.content ?? '' }
  } catch (err) {
    return {
      sample: {
        ok: false,
        ms: Date.now() - started,
        status: null,
        error: String(err).slice(0, 120),
      },
      text: '',
    }
  }
}

async function runLevel(t: Target, concurrency: number, requests: number): Promise<LevelSummary> {
  const runId = Math.random().toString(36).slice(2, 8)
  const samples: Sample[] = []
  let next = 0
  const started = Date.now()
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const i = next++
        if (i >= requests) return
        const { system, prompt } = classifyPrompt(i, `${runId}-${concurrency}-${i}`)
        samples.push(
          (await chat(t, system, prompt, CLASSIFY_NUM_PREDICT, EMAIL_CLASSIFY_JSON_SCHEMA)).sample,
        )
      }
    }),
  )
  return summarise(concurrency, samples, Date.now() - started)
}

export interface ContextResult {
  /** pass: answered correctly. wrong_answer: a response without the code (truncation).
   *  request_failed: no response (timeout, HTTP error): says nothing about truncation. */
  outcome: 'pass' | 'wrong_answer' | 'request_failed'
  answer: string
  ms: number
  error?: string
}

export function judgeContext(sample: Sample, text: string, code: string): ContextResult {
  if (!sample.ok)
    return { outcome: 'request_failed', answer: '', ms: sample.ms, error: sample.error }
  return { outcome: text.includes(code) ? 'pass' : 'wrong_answer', answer: text, ms: sample.ms }
}

export function formatReport(
  model: string,
  levels: LevelSummary[],
  context: ContextResult | null,
): string {
  const lines = [`Load test: ${model}`, '']
  lines.push('concurrency  requests  errors  p50      p95      max      per-min')
  for (const l of levels)
    lines.push(
      [
        String(l.concurrency).padEnd(12),
        String(l.requests).padEnd(9),
        `${l.errors}`.padEnd(7),
        `${(l.p50Ms / 1000).toFixed(1)}s`.padEnd(8),
        `${(l.p95Ms / 1000).toFixed(1)}s`.padEnd(8),
        `${(l.maxMs / 1000).toFixed(1)}s`.padEnd(8),
        l.throughputPerMin.toFixed(1),
      ].join(' '),
    )
  if (levels.length > 1) {
    const base = levels[0]!
    const flat = levels.every(
      (l) => base.throughputPerMin === 0 || l.throughputPerMin <= base.throughputPerMin * 1.5,
    )
    lines.push(
      '',
      flat
        ? 'Throughput stays near the single-call rate: extra concurrency only adds latency (expected with --concurrency 1).'
        : 'Throughput rose with concurrency: the service is serving calls in parallel, so check instance count and memory.',
    )
  }
  for (const l of levels) {
    const kinds = Object.entries(l.errorsByKind)
    if (kinds.length)
      lines.push(
        `concurrency ${l.concurrency} errors: ${kinds.map(([k, n]) => `${n}x ${k}`).join(', ')}`,
      )
  }
  if (context) {
    lines.push('')
    if (context.outcome === 'pass')
      lines.push(
        `Context check: PASS (long prompt answered correctly in ${(context.ms / 1000).toFixed(1)}s)`,
      )
    else if (context.outcome === 'wrong_answer')
      lines.push(
        `Context check: FAIL (answered ${JSON.stringify(context.answer.slice(0, 60))}); the prompt was likely truncated, so num_ctx is not taking effect on this server`,
      )
    else
      lines.push(
        `Context check: INCONCLUSIVE (request failed after ${(context.ms / 1000).toFixed(1)}s: ${context.error ?? 'error'}). A failed request says nothing about truncation; a ~4,700-token prompt may simply take longer than the service timeout on this hardware.`,
      )
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  const baseUrl = (process.env['LOCAL_JUDGE_BASE_URL'] ?? '').replace(/\/+$/, '')
  if (!baseUrl) {
    console.error('Set LOCAL_JUDGE_BASE_URL to the Ollama service.')
    process.exit(2)
  }
  const allowed = mayRun(baseUrl, process.env['LOAD_TEST_CONFIRM'])
  if (!allowed.ok) {
    console.error(allowed.why)
    process.exit(2)
  }
  const model = process.env['LOCAL_JUDGE_MODEL'] || 'qwen2.5:7b'
  const getHeaders = await evalAuthHeaders(baseUrl)
  const target: Target = {
    baseUrl,
    model,
    timeoutMs: Number(process.env['LOAD_TEST_TIMEOUT_MS']) || 300_000,
    ...(getHeaders ? { getHeaders } : {}),
  }
  const requests = Math.max(1, Number(process.env['LOAD_TEST_REQUESTS']) || 6)

  // Warm the model first so the first level does not include a cold load.
  await chat(target, classifyPrompt(0, 'warm').system, classifyPrompt(0, 'warm').prompt, 5)

  const levels: LevelSummary[] = []
  for (const c of parseLevels(process.env['LOAD_TEST_LEVELS'])) {
    console.error(`running concurrency ${c} (${requests} requests)...`)
    levels.push(await runLevel(target, c, requests))
  }

  // LOAD_TEST_SKIP_CONTEXT=yes measures capacity alone: the long prompt can take minutes.
  let context: ContextResult | null = null
  if (process.env['LOAD_TEST_SKIP_CONTEXT'] !== 'yes') {
    const probe = contextProbe()
    const r = await chat(target, probe.system, probe.prompt, 30)
    context = judgeContext(r.sample, r.text, probe.code)
  }

  console.log(formatReport(model, levels, context))
  const contextOk = context === null || context.outcome === 'pass'
  process.exit(contextOk && levels.every((l) => l.errors === 0) ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main()
