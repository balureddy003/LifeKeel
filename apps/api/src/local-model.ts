import { scanText } from '@lifekeel/engine'
import { recordLocalModelCall, recordOutputGuardBlock } from './routes/metrics.js'
import { createEncoderClassifier, type EncoderClassifier } from './email/encoder-classifier.js'
import { cloudRunIdTokenProvider } from './cloud-run-auth.js'
import {
  createLlmRouter,
  createLlmRouterFromEnv,
  createLocalDecisionFn,
  type DecisionFn,
  type LlmFn,
  type LlmUsageCallback,
} from '@lifekeel/platform'

/**
 * Default is the smallest size that did not pass unsafe copy in testing (see
 * infra/local-judge/README.md). This names the model inside our Ollama service;
 * the immutable artifact it resolves to is digest-pinned and verified at image
 * build (ai-bom.yaml, local-judge-model / infra/local-judge/Dockerfile).
 */
export const DEFAULT_LOCAL_MODEL = 'qwen2.5:7b'

/**
 * Self-hosted model client, or undefined when LOCAL_JUDGE_BASE_URL is unset
 * (callers then keep their existing cloud path). One Ollama server backs both
 * the move judge, the email classifier and document extraction; LOCAL_CLASSIFIER_MODEL
 * and LOCAL_OCR_MODEL optionally override the model for those tasks.
 */
/**
 * Auth headers for the model service. With LOCAL_JUDGE_AUTH=cloudrun-iam every call
 * carries a Google identity token (the service is deployed with
 * --no-allow-unauthenticated, so Cloud Run rejects anything else). Undefined = no auth.
 */
function authHeadersFromEnv(baseUrl: string): (() => Promise<Record<string, string>>) | undefined {
  return process.env['LOCAL_JUDGE_AUTH'] === 'cloudrun-iam'
    ? cloudRunIdTokenProvider(baseUrl)
    : undefined
}

/** USD per hour of one model instance (for the busy-time cost estimate); 0 disables the estimate. */
function costPerHourUsd(): number {
  const v = Number(process.env['LOCAL_MODEL_COST_PER_HOUR_USD'])
  return Number.isFinite(v) && v > 0 ? v : 0
}

/**
 * Output cap for the email classifier. Its answer is a short JSON object: the
 * longest seen on the labelled emails is 146 tokens, the median 111. Generation
 * is the slow part on the CPU judge (about 3 tokens/s), so an uncapped or
 * 256-token ceiling lets a runaway answer hold the single model slot for
 * ~85s. 200 leaves about a third of headroom over the longest answer seen.
 */
export const CLASSIFIER_MAX_TOKENS = 200

export function localDecisionFromEnv(
  purpose: 'judge' | 'classifier' | 'ocr',
): DecisionFn | undefined {
  const baseUrl = process.env['LOCAL_JUDGE_BASE_URL']
  if (!baseUrl) return undefined
  const judgeModel = process.env['LOCAL_JUDGE_MODEL'] || DEFAULT_LOCAL_MODEL
  const classifierModel = process.env['LOCAL_CLASSIFIER_MODEL'] || judgeModel
  const model =
    purpose === 'judge'
      ? judgeModel
      : purpose === 'classifier'
        ? classifierModel
        : process.env['LOCAL_OCR_MODEL'] || classifierModel
  return createLocalDecisionFn({
    baseUrl,
    model,
    timeoutMs: 120_000,
    ...(purpose === 'classifier' ? { maxTokens: CLASSIFIER_MAX_TOKENS } : {}),
    // Measured on 4 CPU cores (qwen2.5:3b): 1, 2 and 4 parallel calls all gave ~3.8
    // emails/min, while per-call time rose 16s -> 28s -> 47s. Parallel calls to one
    // CPU model add latency and timeout risk, not throughput, so default to 1. Raise
    // it only to match the number of model instances behind the URL.
    maxConcurrent: Number(process.env['LOCAL_MODEL_MAX_CONCURRENT']) || 1,
    getHeaders: authHeadersFromEnv(baseUrl),
    onCall: (e) =>
      recordLocalModelCall(
        purpose,
        e.ok,
        e.latency_ms / 1000,
        e.queued_ms / 1000,
        (e.latency_ms / 3_600_000) * costPerHourUsd(),
      ),
  })
}

/** Output that the guard rejected; callers' existing failure paths turn this into their safe fallback. */
export class BlockedLocalOutputError extends Error {
  constructor(readonly reasons: string[]) {
    super(`Local model output blocked: ${reasons.join(', ')}`)
    this.name = 'BlockedLocalOutputError'
  }
}

const NUMBER = /\d[\d,]*\.?\d*/g

function significantNumbers(text: string): string[] {
  // 3+ digits only: "3 months" / "5 years" are wording, "800 GBP" is a claim.
  return (text.match(NUMBER) ?? [])
    .map((n) => n.replace(/,/g, '').replace(/\.$/, ''))
    .filter((n) => n.replace('.', '').length >= 3)
}

/** A bare calendar year is wording, not a financial claim. */
const isYear = (n: string): boolean => /^(19|20)\d{2}$/.test(n)

// Pair sums/differences grow quadratically (150 numbers = ~11k pairs, trivial).
const MAX_PAIR_SOURCES = 150

/** Figures the source states, plus the sum or difference of any two (a shortfall is not an invention). */
function allowedValues(source: string): number[] {
  const base = [...new Set(significantNumbers(source).map(Number))]
    .filter(Number.isFinite)
    .slice(0, MAX_PAIR_SOURCES)
  const allowed = [...base]
  for (let i = 0; i < base.length; i++) {
    for (let j = i + 1; j < base.length; j++)
      allowed.push(base[i]! + base[j]!, Math.abs(base[i]! - base[j]!))
  }
  return allowed
}

// Well-known providers a small model may reach for unprompted. Heuristic, not
// exhaustive: it catches the common failure (volunteering a big brand) but not
// an obscure one, so the prompt rules and human review remain the real controls.
const KNOWN_PROVIDERS = [
  'aviva',
  'axa',
  'allianz',
  'zurich',
  'prudential',
  'legal & general',
  'legal and general',
  'bupa',
  'scottish widows',
  'royal london',
  'standard life',
  'aegon',
  'direct line',
  'vanguard',
  'hargreaves lansdown',
  'blackrock',
  'metlife',
  'state farm',
  'geico',
  'allstate',
  'new york life',
  'northwestern mutual',
]

/** Known provider names in `output` that the prompt never mentioned (so the model volunteered them). */
export function volunteeredProviders(output: string, source: string): string[] {
  const out = output.toLowerCase()
  const src = source.toLowerCase()
  return KNOWN_PROVIDERS.filter(
    (p) =>
      new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(out) && !src.includes(p),
  )
}

/**
 * Figures in `output` that are neither stated in `source` nor the sum or
 * difference of two figures it states. Products, percentages and divisions are
 * deliberately not allowed: those are the projections the assistant is told
 * never to make, and what small models got wrong or invented in testing.
 */
export function ungroundedNumbers(output: string, source: string): string[] {
  const allowed = allowedValues(source)
  return [
    ...new Set(
      significantNumbers(output).filter(
        (n) => !isYear(n) && !allowed.some((a) => Math.abs(a - Number(n)) < 0.01),
      ),
    ),
  ]
}

/**
 * Wraps a text LlmFn so output is rejected instead of shown when it contains
 * regulated advice, provider steering, PII or credentials (CLAUDE.md rule 2), or
 * a figure that is not in the prompt. Generated text is less predictable than
 * YAML templates, so the same deterministic guard that screens insights screens
 * it, plus a grounding check: measured on 3b and 7b, small models invent
 * figures (a prep note made up rent/utilities amounts) and compute projections
 * the assistant is told never to make.
 */
export function withOutputGuard(llm: LlmFn): LlmFn {
  return async (system, prompt, model) => {
    const text = await llm(system, prompt, model)
    const reasons: string[] = scanText(text, { generated: true })
    const volunteered = volunteeredProviders(text, `${system}\n${prompt}`)
    if (volunteered.length > 0) reasons.push(`provider_steering(${volunteered.join(',')})`)
    const invented = ungroundedNumbers(text, `${prompt}\n${system}`)
    if (invented.length > 0) reasons.push(`ungrounded_numbers(${invented.slice(0, 3).join(',')})`)
    if (reasons.length > 0) {
      // Reason codes only (strip the "(figures)" detail) so labels stay low-cardinality.
      for (const r of new Set(reasons.map((x) => x.replace(/\(.*$/, '')))) recordOutputGuardBlock(r)
      throw new BlockedLocalOutputError(reasons)
    }
    return text
  }
}

/**
 * Text LlmFn for calls that carry family data (Ask Keel, support, drafts, prep
 * notes). With LOCAL_TEXT_ENABLED=true (and LOCAL_JUDGE_BASE_URL set) it runs on
 * the self-hosted model with an output guard and never falls back to a cloud
 * provider; otherwise it is the normal cloud router.
 *
 * Explicit opt-in, unlike the judge/classifier/OCR paths: those are background
 * jobs where CPU latency is irrelevant, but these are interactive. Measured on 4
 * CPU cores a 7b answer takes 16-59s and a 3b answer 6-47s, and small models are
 * weaker at following the "no projections / no invented figures" rules, so the
 * guard rejects more answers and the route shows its safe fallback instead.
 * LOCAL_TEXT_MODEL overrides the model for these calls.
 */
export function familyDataLlmFromEnv(opts: { onUsage?: LlmUsageCallback } = {}): LlmFn {
  const baseUrl = process.env['LOCAL_JUDGE_BASE_URL']
  if (!baseUrl || process.env['LOCAL_TEXT_ENABLED'] !== 'true')
    return createLlmRouterFromEnv({ onUsage: opts.onUsage })
  const model =
    process.env['LOCAL_TEXT_MODEL'] || process.env['LOCAL_JUDGE_MODEL'] || DEFAULT_LOCAL_MODEL
  return withOutputGuard(
    createLlmRouter({
      provider: 'ollama',
      ollamaBaseUrl: baseUrl,
      ollamaHeaders: authHeadersFromEnv(baseUrl),
      tierModels: { fast: model, balanced: model, powerful: model },
      maxTokens: 700,
      temperature: 0.2,
      onUsage: opts.onUsage,
    }),
  )
}

/**
 * The email encoder (infra/encoder-service), or undefined when EMAIL_ENCODER_URL is unset or the mode is
 * off. EMAIL_ENCODER_MODE: 'shadow' measures it against the LLM with no effect on results; 'gate' lets it
 * skip the LLM for emails it judges irrelevant. Run shadow first and move to gate only when
 * lifekeel_email_encoder_total{outcome="encoder_missed"} stays at zero over real volume.
 * Reuses LOCAL_JUDGE_AUTH for service-to-service auth.
 */
export function emailEncoderFromEnv():
  { classify: EncoderClassifier; mode: 'gate' | 'shadow' } | undefined {
  const baseUrl = process.env['EMAIL_ENCODER_URL']
  const mode = process.env['EMAIL_ENCODER_MODE']
  if (!baseUrl || (mode !== 'gate' && mode !== 'shadow')) return undefined
  return {
    mode,
    classify: createEncoderClassifier({
      baseUrl,
      getHeaders: authHeadersFromEnv(baseUrl),
      onCall: (e) =>
        recordLocalModelCall(
          'encoder',
          e.ok,
          e.latency_ms / 1000,
          0,
          (e.latency_ms / 3_600_000) * costPerHourUsd(),
        ),
    }),
  }
}
