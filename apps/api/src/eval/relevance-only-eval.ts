import { pathToFileURL } from 'node:url'
import { createLocalDecisionFn } from '@lifekeel/platform'
import { askRelevance } from '../email/classify.js'
import type { FetchedEmail } from '../email/imap-client.js'
import { LABELLED_EMAILS, type LabelledEmail } from '../email/__fixtures__/labelled-emails.js'
import { willOrPowerOfAttorneyReminder } from '../email/rules.js'
import { MIN_EMAIL_RECALL, evalAuthHeaders, type GateResult } from './local-model-eval.js'
import { mayRun, percentile } from './judge-load-test.js'

/**
 * Relevance-only email call: `node dist/eval/relevance-only-eval.js` with
 * LOCAL_JUDGE_BASE_URL (and LOCAL_JUDGE_MODEL, auth as in local-model-eval).
 *
 * Measured on the deployed CPU judge, the full classification spends ~12.6s
 * reading the prompt and ~56s writing a ~150-token JSON answer (~3 tokens/s).
 * The relevance verdict does not need the JSON, so this asks for one word and
 * writes about one token. This eval answers whether accuracy holds and what the
 * call costs in time. Like production, the will / lasting power of attorney rule
 * runs first; the model sees every other email (no prefilter, as in local-model-eval).
 *
 * Against a non-local URL it needs LOAD_TEST_CONFIRM=yes: every call is instance time.
 */

export type Verdict = 'yes' | 'no' | 'error'

export interface AskResult {
  verdict: Verdict
  ms: number
  error?: string
}

export type AskFn = (email: LabelledEmail) => Promise<AskResult>

/** The fetched-email shape the production call takes, from a labelled fixture. */
export function toFetchedEmail(e: LabelledEmail): FetchedEmail {
  return {
    uid: 1,
    messageId: e.name,
    from: e.from,
    subject: e.subject,
    date: new Date('2026-10-01'),
    textSnippet: e.textSnippet,
    attachments: [],
  }
}

export interface RelevanceReport {
  model: string
  total: number
  settledByRule: string[]
  modelCalls: number
  falsePositives: string[]
  missed: string[]
  errors: string[]
  recall: number
  positives: number
  latencyMs: { p50: number; p95: number; max: number }
  gates: GateResult[]
  passed: boolean
}

export async function runRelevanceOnlyEval(ask: AskFn, model: string): Promise<RelevanceReport> {
  const settledByRule: string[] = []
  const falsePositives: string[] = []
  const missed: string[] = []
  const errors: string[] = []
  const times: number[] = []
  let truePositives = 0

  for (const e of LABELLED_EMAILS) {
    let relevant: boolean
    if (willOrPowerOfAttorneyReminder(e)) {
      settledByRule.push(e.name)
      relevant = true
    } else {
      const r = await ask(e)
      times.push(r.ms)
      if (r.verdict === 'error') {
        errors.push(e.name)
        continue
      }
      relevant = r.verdict === 'yes'
    }
    if (e.isFinancial && relevant) truePositives += 1
    if (e.isFinancial && !relevant) missed.push(e.name)
    if (!e.isFinancial && relevant) falsePositives.push(e.name)
  }

  const positives = LABELLED_EMAILS.filter((e) => e.isFinancial).length
  const recall = positives === 0 ? 1 : truePositives / positives
  const gates: GateResult[] = [
    {
      name: 'relevance-only: no false positives (incl. the prompt-injection email)',
      passed: falsePositives.length === 0,
      detail: falsePositives.length ? falsePositives.join(', ') : 'none',
    },
    {
      name: `relevance-only: recall at least ${MIN_EMAIL_RECALL.toFixed(3)}`,
      passed: recall >= MIN_EMAIL_RECALL,
      detail: `${truePositives}/${positives}${missed.length ? ` (missed: ${missed.join(', ')})` : ''}`,
    },
    {
      name: 'relevance-only: the model answered every email',
      passed: errors.length === 0,
      detail: errors.length ? errors.join(', ') : 'all answered',
    },
  ]
  return {
    model,
    total: LABELLED_EMAILS.length,
    settledByRule,
    modelCalls: times.length,
    falsePositives,
    missed,
    errors,
    recall,
    positives,
    latencyMs: {
      p50: times.length ? percentile(times, 50) : 0,
      p95: times.length ? percentile(times, 95) : 0,
      max: times.length ? Math.max(...times) : 0,
    },
    gates,
    passed: gates.every((g) => g.passed),
  }
}

export function formatRelevanceReport(r: RelevanceReport): string {
  const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`
  const lines = [`Relevance-only eval: ${r.model}`, '']
  for (const g of r.gates) lines.push(`${g.passed ? 'PASS' : 'FAIL'}  ${g.name}  (${g.detail})`)
  lines.push(
    '',
    `Settled by the will/LPA rule (no model call): ${r.settledByRule.length ? r.settledByRule.join(', ') : 'none'}`,
    `Model calls: ${r.modelCalls}   latency p50 ${s(r.latencyMs.p50)}  p95 ${s(r.latencyMs.p95)}  max ${s(r.latencyMs.max)}`,
    '',
    r.passed ? 'RESULT: relevance-only meets the gates' : 'RESULT: relevance-only FAILS the gates',
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
  // The same client the scan job builds for the classifier (one call at a time, 200-token cap),
  // so this measures the production call, constrained "yes" | "no" decoding included.
  const decide = createLocalDecisionFn({
    baseUrl,
    model,
    timeoutMs: Number(process.env['LOAD_TEST_TIMEOUT_MS']) || 300_000,
    maxConcurrent: 1,
    maxTokens: 200,
    ...(getHeaders ? { getHeaders } : {}),
  })

  const ask: AskFn = async (e) => {
    const started = Date.now()
    try {
      const verdict = await askRelevance(decide, toFetchedEmail(e))
      return { verdict, ms: Date.now() - started }
    } catch (err) {
      return { verdict: 'error', ms: Date.now() - started, error: String(err).slice(0, 120) }
    }
  }

  // Warm the model so the first email does not include a cold load.
  await ask(LABELLED_EMAILS[0]!)
  const report = await runRelevanceOnlyEval(ask, model)
  console.log(formatRelevanceReport(report))
  process.exit(report.passed ? 0 : 1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main()
