import { pathToFileURL } from 'node:url'
import { ollamaNumCtx } from '@lifekeel/platform'
import { evalAuthHeaders } from './local-model-eval.js'
import { LABELLED_EMAILS } from '../email/__fixtures__/labelled-emails.js'

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
 * LOAD_TEST_LEVELS (default "1,2,4"), LOAD_TEST_TIMEOUT_MS (default 300000).
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
  return {
    concurrency,
    requests: samples.length,
    errors,
    errorRate: samples.length === 0 ? 0 : errors / samples.length,
    p50Ms: percentile(okMs, 50),
    p95Ms: percentile(okMs, 95),
    maxMs: okMs.length ? Math.max(...okMs) : 0,
    throughputPerMin: wallMs > 0 ? (okMs.length / wallMs) * 60_000 : 0,
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

/** A production-shaped classification prompt: an email from the labelled set. */
export function classifyPrompt(i: number): { system: string; prompt: string } {
  const e = LABELLED_EMAILS[i % LABELLED_EMAILS.length]!
  return {
    system:
      'You triage email for a family protection app. Say whether the email is about an insurance, pension, mortgage or estate policy the household holds. Answer with one short sentence.',
    prompt: `<email_from>${e.from}</email_from>\n<email_subject>${e.subject}</email_subject>\n\n<email_body>\n${e.textSnippet}\n</email_body>`,
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
  const samples: Sample[] = []
  let next = 0
  const started = Date.now()
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const i = next++
        if (i >= requests) return
        const { system, prompt } = classifyPrompt(i)
        samples.push((await chat(t, system, prompt, 120)).sample)
      }
    }),
  )
  return summarise(concurrency, samples, Date.now() - started)
}

export function formatReport(
  model: string,
  levels: LevelSummary[],
  context: { ok: boolean; answer: string; ms: number } | null,
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
  if (context)
    lines.push(
      '',
      context.ok
        ? `Context check: PASS (long prompt answered correctly in ${(context.ms / 1000).toFixed(1)}s)`
        : `Context check: FAIL (answered ${JSON.stringify(context.answer.slice(0, 60))}); the prompt was likely truncated, so num_ctx is not taking effect on this server`,
    )
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
  await chat(target, classifyPrompt(0).system, classifyPrompt(0).prompt, 5)

  const levels: LevelSummary[] = []
  for (const c of parseLevels(process.env['LOAD_TEST_LEVELS'])) {
    console.error(`running concurrency ${c} (${requests} requests)...`)
    levels.push(await runLevel(target, c, requests))
  }

  const probe = contextProbe()
  const r = await chat(target, probe.system, probe.prompt, 30)
  const context = {
    ok: r.sample.ok && r.text.includes(probe.code),
    answer: r.text,
    ms: r.sample.ms,
  }

  console.log(formatReport(model, levels, context))
  process.exit(context.ok && levels.every((l) => l.errors === 0) ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main()
