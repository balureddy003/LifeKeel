/**
 * LifeKeel LLM Router
 *
 * Provider-agnostic LLM abstraction.  Configure once, use everywhere.
 *
 * Supported providers (auto-detected from model name or explicit config):
 *   anthropic  — Claude 3 Haiku / Sonnet / Opus  (ANTHROPIC_API_KEY)
 *   openai     — GPT-4o, GPT-4o-mini, o1, o3     (OPENAI_API_KEY)
 *   azure      — Azure OpenAI deployments         (AZURE_OPENAI_*)
 *   vertex     — Google Cloud Vertex AI Gemini    (VERTEX_PROJECT/VERTEX_LOCATION,
 *                                                VERTEX_SERVICE_ACCOUNT_JSON or ADC)
 *   ollama     — local models via Ollama HTTP API  (OLLAMA_BASE_URL)
 *   groq       — Llama 3 / Mixtral via Groq        (GROQ_API_KEY)
 *   xai        — Grok via xAI                      (XAI_API_KEY)
 *
 * Usage:
 *   const llm = createLlmRouter()          // reads env vars automatically
 *   const text = await llm('system', 'user prompt', 'claude-haiku-4-5')
 *
 * Or explicit config:
 *   const llm = createLlmRouter({ provider: 'openai', apiKey: '...' })
 */

import { createLogger } from './logger.js'
import { ollamaNumCtx } from './ollama-options.js'
import { vertexAccessTokenProvider } from './vertex-auth.js'

const log = createLogger({ service: 'llm', version: '0.0.0' })

export type LlmProvider =
  'anthropic' | 'openai' | 'azure' | 'vertex' | 'ollama' | 'groq' | 'xai' | 'auto'

// ── Azure Endpoint Validation ─────────────────────────────────────────────────────

export function isValidAzureEndpoint(endpoint: string): boolean {
  // Remove trailing slash for validation
  const cleanEndpoint = endpoint.replace(/\/$/, '')

  // Azure OpenAI endpoints
  if (cleanEndpoint.endsWith('.openai.azure.com')) {
    return true
  }

  // Azure AI Foundry endpoints
  if (cleanEndpoint.includes('.services.ai.azure.com')) {
    return true
  }

  // Azure AI (newer format)
  if (cleanEndpoint.includes('.ai.azure.com')) {
    return true
  }

  return false
}

/**
 * Detect Azure AI Foundry endpoints that use the unified /openai/v1 API
 * surface (model name in the request body, not the URL path).
 *
 * Classic Azure OpenAI resources (`.openai.azure.com`) use the per-deployment
 * path `/openai/deployments/<name>/chat/completions?api-version=...`.
 *
 * AI Foundry resources (`.services.ai.azure.com` and other `.ai.azure.com`
 * subdomains that are NOT `.openai.azure.com`) use the OpenAI-compatible
 * path `/openai/v1/chat/completions` with the model/deployment name in the
 * request body — same as talking to OpenAI directly.
 *
 * Gap A6: callAzure only ever built the classic per-deployment path, which
 * 404s on AI Foundry resources because that path doesn't exist there.
 */
export function isAzureFoundryEndpoint(endpoint: string): boolean {
  const clean = endpoint.replace(/\/$/, '').replace(/\/openai.*$/, '')
  if (clean.endsWith('.openai.azure.com')) return false
  if (clean.includes('.services.ai.azure.com')) return true
  if (clean.includes('.ai.azure.com')) return true
  return false
}

// ── Reasoning tiers ───────────────────────────────────────────────────────────
//
//  fast      — Low-latency, cheap. For simple classification, sentiment,
//              translation, formatting. Response time < 1s typical.
//  balanced  — Good quality/speed trade-off. For extraction, generation,
//              scoring, routing. The default for most workflow nodes.
//  powerful  — Best reasoning quality. For decisions, plans, comparisons,
//              complex multi-step analysis. Slower + more expensive.

export type ReasoningTier = 'fast' | 'balanced' | 'powerful'

/**
 * Per-provider tier → model mapping.
 * Users can override these in Settings → AI Provider → Reasoning tiers.
 * Falls back to these defaults if not configured.
 */
export const DEFAULT_TIER_MODELS: Record<LlmProvider, Record<ReasoningTier, string>> = {
  anthropic: {
    fast: 'claude-haiku-4-5',
    balanced: 'claude-3-5-sonnet-20241022',
    powerful: 'claude-opus-4',
  },
  openai: {
    fast: 'gpt-4o-mini',
    balanced: 'gpt-4o',
    powerful: 'o3-mini',
  },
  groq: {
    fast: 'llama-3.1-8b-instant',
    balanced: 'llama-3.1-70b-versatile',
    powerful: 'llama-3.1-70b-versatile', // Groq doesn't have o-series yet
  },
  xai: {
    // grok-4.3 is the floor of the current lineup (the grok-4-fast-* slugs
    // retired May 2026 and now redirect to grok-4.3).
    fast: 'grok-4.3',
    balanced: 'grok-4.3',
    powerful: 'grok-4.7',
  },
  azure: {
    fast: 'gpt-4o-mini',
    balanced: 'gpt-4o',
    powerful: 'gpt-4o',
  },
  // Gemini 2.5 family retired Oct 2026 — 3.5/4 are the GA lines. Bare model
  // ids; callVertex adds the `google/` publisher prefix Vertex requires.
  vertex: {
    fast: 'gemini-3.5-flash-lite',
    balanced: 'gemini-3.5-flash',
    powerful: 'gemini-4-argon',
  },
  ollama: {
    fast: 'llama3.2:3b',
    balanced: 'qwen2.5:7b',
    powerful: 'qwen2.5:14b',
  },
  auto: {
    fast: 'claude-haiku-4-5',
    balanced: 'claude-3-5-sonnet-20241022',
    powerful: 'claude-opus-4',
  },
}

/**
 * Estimate the complexity of a task and suggest a reasoning tier.
 * Used when no explicit tier is set on a workflow node.
 */
export function estimateReasoningTier(prompt: string, systemHint?: string): ReasoningTier {
  const text = `${systemHint ?? ''} ${prompt}`.toLowerCase()
  const len = prompt.length

  // Signals of high complexity → powerful tier
  const powerfulSignals = [
    'reason through',
    'step by step',
    'analyze',
    'evaluate trade-offs',
    'compare',
    'pros and cons',
    'strategic',
    'plan',
    'decide',
    'recommend',
    'synthesize',
    'critique',
    'assess risk',
    'legal',
    'financial',
    'medical',
    'multi-step',
    'chain of thought',
    'justify',
    'argue',
  ]
  if (powerfulSignals.some((s) => text.includes(s)) || len > 2000) return 'powerful'

  // Signals of simple tasks → fast tier
  const fastSignals = [
    'classify',
    'label',
    'categorize',
    'translate',
    'sentiment',
    'positive or negative',
    'yes or no',
    'true or false',
    'format',
    'extract',
    'parse',
    'summarize in one',
  ]
  if (fastSignals.some((s) => text.includes(s)) && len < 500) return 'fast'

  return 'balanced'
}

/** Token usage reported by the provider after a call. */
export interface LlmTokenUsage {
  input_tokens: number
  output_tokens: number
  model: string
  provider: LlmProvider
  latency_ms: number
}

/** Callback invoked after each successful LLM call with token usage data. */
export type LlmUsageCallback = (usage: LlmTokenUsage) => void

export interface LlmConfig {
  /** Which provider to use. 'auto' picks from model name + available env vars. */
  provider?: LlmProvider
  apiKey?: string
  /** Azure OpenAI endpoint, e.g. https://<resource>.openai.azure.com */
  azureEndpoint?: string
  /** Azure deployment name (maps to model param) */
  azureDeployment?: string
  /** Azure API version */
  azureApiVersion?: string
  /** Google Cloud project for Vertex AI (OAuth mode). */
  vertexProject?: string
  /** Vertex location — 'global' (best availability) or a region like 'europe-west1' (data residency). */
  vertexLocation?: string
  /**
   * Per-call auth-header resolver — same pattern as ollamaHeaders. Vertex's
   * OpenAI-compatible surface accepts only OAuth2 access tokens (~1h TTL), so
   * a static key cannot work; defaults to vertexAccessTokenProvider() which
   * mints them from VERTEX_SERVICE_ACCOUNT_JSON or the metadata server.
   */
  vertexHeaders?: () => Promise<Record<string, string>>
  /**
   * Thinking floor sent as reasoning_effort. Gemini 3.x/4 cannot disable
   * thinking ('none' was 2.5-only); 'low' is the universal floor. Reasoning
   * tokens bill as output.
   */
  vertexReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  /** Ollama base URL (default: http://localhost:11434) */
  ollamaBaseUrl?: string
  /** Extra headers for Ollama calls, resolved per call (e.g. a Cloud Run identity token). */
  ollamaHeaders?: () => Promise<Record<string, string>>
  /**
   * Runtime provider override — a per-call sync accessor (e.g. the operator's
   * platform-config switch) consulted before model-name detection and env
   * fallback, so the pick can change without a redeploy and applies to
   * tier-string calls too. Returning null/undefined means "no override."
   */
  providerOverride?: () => LlmProvider | null | undefined
  /** Default model if caller doesn't specify */
  defaultModel?: string
  /** Max tokens to generate (default: 2048) */
  maxTokens?: number
  /** Temperature 0–1 (default: 0.3 for structured outputs) */
  temperature?: number
  /**
   * Custom tier → model overrides. If set, these take priority over
   * DEFAULT_TIER_MODELS when resolving a tier to a concrete model name.
   * Stored per-tenant in MongoDB and loaded by the API on each workflow run.
   */
  tierModels?: Partial<Record<ReasoningTier, string>>
  /**
   * Optional callback invoked after each successful LLM call with token usage.
   * Wire this to CostLedger.record() in the API layer for cost attribution.
   */
  onUsage?: LlmUsageCallback
}

/** Optional per-call controls. `signal` aborts the provider request — the
 * task gateway's deadline uses it so an expired call frees the model. */
export interface LlmCallOptions {
  signal?: AbortSignal
}

/** The canonical LLM function type used everywhere in LifeKeel */
export type LlmFn = (
  system: string,
  prompt: string,
  model?: string,
  opts?: LlmCallOptions,
) => Promise<string>

/**
 * Model → provider routing table.
 * If `provider` is 'auto', model name picks the right SDK.
 */
const MODEL_PROVIDER_MAP: Record<string, LlmProvider> = {
  // Anthropic
  'claude-3-haiku': 'anthropic',
  'claude-3-haiku-20240307': 'anthropic',
  'claude-haiku-4-5': 'anthropic',
  'claude-3-5-haiku': 'anthropic',
  'claude-3-5-haiku-20241022': 'anthropic',
  'claude-3-sonnet': 'anthropic',
  'claude-3-5-sonnet': 'anthropic',
  'claude-3-5-sonnet-20241022': 'anthropic',
  'claude-opus-4': 'anthropic',
  'claude-3-opus-20240229': 'anthropic',
  // OpenAI
  'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai',
  'gpt-4-turbo': 'openai',
  'gpt-4': 'openai',
  'gpt-3.5-turbo': 'openai',
  o1: 'openai',
  'o1-mini': 'openai',
  o3: 'openai',
  'o3-mini': 'openai',
  // Groq
  'llama-3.1-70b-versatile': 'groq',
  'llama-3.1-8b-instant': 'groq',
  'mixtral-8x7b-32768': 'groq',
  'gemma2-9b-it': 'groq',
  // Vertex AI Gemini
  'gemini-3.5-flash-lite': 'vertex',
  'gemini-3.5-flash': 'vertex',
  'gemini-3.8-flash': 'vertex',
  'gemini-4-argon': 'vertex',
  'gemini-3.1-pro': 'vertex',
  // xAI Grok — grok-4-fast-* retired May 2026 → redirect to grok-4.3
  'grok-4.3': 'xai',
  'grok-4.5': 'xai',
  'grok-4.6': 'xai',
  'grok-4.7': 'xai',
}

function detectProviderFromModel(model: string): LlmProvider | null {
  // Exact match
  if (MODEL_PROVIDER_MAP[model]) return MODEL_PROVIDER_MAP[model]!
  // Prefix match
  if (model.startsWith('claude')) return 'anthropic'
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) return 'openai'
  if (model.startsWith('llama') || model.startsWith('mixtral') || model.startsWith('gemma'))
    return 'groq'
  if (model.startsWith('gemini') || model.startsWith('google/gemini')) return 'vertex'
  if (model.startsWith('grok')) return 'xai'
  return null
}

/**
 * Operator override: when set, the named provider wins over env-key detection
 * for every call that didn't name a model belonging to another provider.
 * Fixes first-configured-key-wins ambiguity when several providers are
 * provisioned at once — the operator selects the active one deliberately.
 */
function envProviderOverride(): LlmProvider | null {
  const name = process.env['LIFEKEEL_LLM_PROVIDER']
  if (!name || name === 'auto') return null
  const providers: readonly string[] = [
    'anthropic',
    'openai',
    'azure',
    'vertex',
    'ollama',
    'groq',
    'xai',
  ]
  return providers.includes(name) ? (name as LlmProvider) : null
}

function resolveProvider(cfg: LlmConfig, model: string): LlmProvider {
  if (cfg.provider && cfg.provider !== 'auto') return cfg.provider
  // Operator runtime override — a global routing decision, so it beats the
  // per-call model name as well as env detection. A model that doesn't exist
  // on the chosen provider fails at the provider rather than rerouting.
  const runtime = cfg.providerOverride?.()
  if (runtime) return runtime
  // Auto-detect from model name
  const fromModel = detectProviderFromModel(model)
  if (fromModel) return fromModel
  const override = envProviderOverride()
  if (override) return override
  // Fall back to whichever API key is available. Approved processors
  // (definitions/ai-processors.yaml) scan first — an unreviewed provider
  // is refused by policy in non-dev anyway, so letting it win over an
  // approved configured key just yields canned replies (prod QA
  // 2026-10-25: openai was configured, groq approved and bound — openai
  // won the scan and every interactive call refused). Within each tier
  // newer providers still scan last so a new key never silently flips a
  // live deployment; use the operator override or LIFEKEEL_LLM_PROVIDER
  // to promote one.
  if (process.env['AZURE_OPENAI_ENDPOINT']) return 'azure'
  if (process.env['VERTEX_PROJECT']) return 'vertex'
  if (process.env['GROQ_API_KEY']) return 'groq'
  if (process.env['XAI_API_KEY']) return 'xai'
  if (process.env['ANTHROPIC_API_KEY']) return 'anthropic'
  if (process.env['OPENAI_API_KEY']) return 'openai'
  if (
    process.env['OLLAMA_BASE_URL'] ||
    model.startsWith('llama') ||
    model.startsWith('phi') ||
    model.startsWith('mistral')
  )
    return 'ollama'
  // Hard default
  return 'anthropic'
}

// ── Retry with exponential backoff ────────────────────────────────────────────

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504])
const MAX_RETRIES = 3
const BASE_DELAY_MS = 500

/**
 * Wraps an LLM call with exponential backoff retry on transient errors.
 * Retries on: rate limits (429), server errors (5xx), network errors.
 * Does NOT retry on auth errors (401/403) or bad requests (400/422).
 *
 * PRD-215: the backoff sleep is abort-aware — a caller signal that fires
 * mid-backoff stops the wait and the retry loop instead of sleeping out the
 * full delay on a request that is already dead.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal,
  retries = MAX_RETRIES,
  delayMs = BASE_DELAY_MS,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw signal.reason ?? lastErr ?? new Error('aborted')
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      // A caller-aborted call (task deadline, client disconnect) must not be
      // retried — the request it served is already gone.
      if ((err as Error).name === 'AbortError') break

      const isRetryable =
        // Rate limit or server error from HTTP status in message
        (err instanceof Error &&
          RETRYABLE_STATUS_CODES.has(Number(err.message.match(/\b(429|5\d\d)\b/)?.[1] ?? 0))) ||
        // Network / connection error (no HTTP status)
        (err instanceof TypeError && err.message.includes('fetch')) ||
        // Provider SDK rate-limit error shape
        (err instanceof Error &&
          (err.message.toLowerCase().includes('rate limit') ||
            err.message.toLowerCase().includes('overloaded') ||
            err.message.toLowerCase().includes('timeout')))

      if (!isRetryable || attempt === retries) break

      const jitter = Math.random() * delayMs * 0.3
      const wait = delayMs * Math.pow(2, attempt) + jitter
      log.warn(
        {
          attempt: attempt + 1,
          retries: retries + 1,
          delay_ms: Math.round(wait),
          err: (err as Error).message,
        },
        'LLM attempt failed — retrying',
      )
      // Sleep capped by the caller's deadline: an abort during backoff breaks
      // the loop immediately rather than burning the remaining delay.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup()
          resolve()
        }, wait)
        const onAbort = () => {
          clearTimeout(timer)
          cleanup()
          reject(signal?.reason ?? lastErr)
        }
        const cleanup = () => signal?.removeEventListener('abort', onAbort)
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    }
  }
  throw lastErr
}

// ── Singleton client cache ─────────────────────────────────────────────────────
// Avoids creating a new SDK client per LLM call, preventing connection pool exhaustion.

const clientCache = new Map<string, unknown>()

function getCachedClient<T>(key: string, factory: () => T): T {
  if (!clientCache.has(key)) {
    clientCache.set(key, factory())
  }
  return clientCache.get(key) as T
}

// ── Provider implementations ──────────────────────────────────────────────────

async function callAnthropic(
  system: string,
  prompt: string,
  model: string,
  apiKey: string,
  maxTokens: number,
  temperature: number,
  onUsage?: LlmUsageCallback,
  signal?: AbortSignal,
): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  // Singleton client — reuse across calls to avoid connection pool exhaustion
  const client = getCachedClient(`anthropic:${apiKey}`, () => new Anthropic({ apiKey }))
  return withRetry(async () => {
    const t0 = Date.now()
    const response = await client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal },
    )
    onUsage?.({
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      model,
      provider: 'anthropic',
      latency_ms: Date.now() - t0,
    })
    const block = response.content[0]
    if (!block || block.type !== 'text') throw new Error('Anthropic: no text block in response')
    return block.text
  }, signal)
}

async function callOpenAI(
  system: string,
  prompt: string,
  model: string,
  apiKey: string,
  maxTokens: number,
  temperature: number,
  onUsage?: LlmUsageCallback,
  signal?: AbortSignal,
): Promise<string> {
  const { default: OpenAI } = await import('openai')
  // Singleton client — reuse across calls to avoid connection pool exhaustion
  const client = getCachedClient(`openai:${apiKey}`, () => new OpenAI({ apiKey }))
  // o1/o3 reasoning models don't support system message or temperature
  const isReasoningModel = model.startsWith('o1') || model.startsWith('o3')
  return withRetry(async () => {
    const t0 = Date.now()
    const response = await client.chat.completions.create(
      {
        model,
        max_tokens: isReasoningModel ? null : (maxTokens as number | null),
        temperature: isReasoningModel ? null : (temperature as number | null),
        messages: isReasoningModel
          ? [{ role: 'user', content: `${system}\n\n${prompt}` }]
          : [
              { role: 'system', content: system },
              { role: 'user', content: prompt },
            ],
      },
      { signal },
    )
    if (response.usage) {
      onUsage?.({
        input_tokens: response.usage.prompt_tokens,
        output_tokens: response.usage.completion_tokens,
        model,
        provider: 'openai',
        latency_ms: Date.now() - t0,
      })
    }
    return response.choices[0]?.message.content ?? ''
  }, signal)
}

async function callAzure(
  system: string,
  prompt: string,
  deployment: string,
  azureBaseUrl: string,
  apiKey: string,
  apiVersion: string,
  maxTokens: number,
  temperature: number,
  foundry = false,
  onUsage?: LlmUsageCallback,
  signal?: AbortSignal,
): Promise<string> {
  const { default: OpenAI } = await import('openai')
  // Singleton client — reuse across calls to avoid connection pool exhaustion.
  //
  // Classic Azure OpenAI: azureBaseUrl = https://<resource>/openai/deployments/<deployment>
  //   - needs api-version query param and api-key header
  //
  // AI Foundry (Gap A6): azureBaseUrl = https://<resource>/openai/v1
  //   - OpenAI-compatible; api-key header still required, but no api-version
  //     query param (the SDK will POST to {baseURL}/chat/completions with
  //     the model name in the body)
  const clientOpts: ConstructorParameters<typeof OpenAI>[0] = {
    apiKey,
    baseURL: azureBaseUrl,
    defaultHeaders: { 'api-key': apiKey },
  }
  if (!foundry) {
    clientOpts.defaultQuery = { 'api-version': apiVersion }
  }
  const client = getCachedClient(
    `azure:${azureBaseUrl}:${apiKey}:${foundry}`,
    () => new OpenAI(clientOpts),
  )
  return withRetry(async () => {
    const t0 = Date.now()
    const response = await client.chat.completions.create(
      {
        model: deployment,
        max_tokens: maxTokens as number | null,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      },
      { signal },
    )
    if (response.usage) {
      onUsage?.({
        input_tokens: response.usage.prompt_tokens,
        output_tokens: response.usage.completion_tokens,
        model: deployment,
        provider: 'azure',
        latency_ms: Date.now() - t0,
      })
    }
    return response.choices[0]?.message.content ?? ''
  }, signal)
}

async function callGroq(
  system: string,
  prompt: string,
  model: string,
  apiKey: string,
  maxTokens: number,
  temperature: number,
  onUsage?: LlmUsageCallback,
  signal?: AbortSignal,
): Promise<string> {
  // Groq uses OpenAI-compatible API — singleton client
  const { default: OpenAI } = await import('openai')
  const client = getCachedClient(
    `groq:${apiKey}`,
    () => new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' }),
  )
  return withRetry(async () => {
    const t0 = Date.now()
    const response = await client.chat.completions.create(
      {
        model,
        max_tokens: maxTokens as number | null,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      },
      { signal },
    )
    if (response.usage) {
      onUsage?.({
        input_tokens: response.usage.prompt_tokens,
        output_tokens: response.usage.completion_tokens,
        model,
        provider: 'groq',
        latency_ms: Date.now() - t0,
      })
    }
    return response.choices[0]?.message.content ?? ''
  }, signal)
}

/**
 * xAI Grok — OpenAI-compatible at api.x.ai/v1. The DPA requires Personal
 * Data to be processed only via the ZDR-enabled API: the team's Zero Data
 * Retention toggle must be on in the xAI Console before any governed task
 * routes here (response header x-zero-data-retention confirms it).
 */
async function callXai(
  system: string,
  prompt: string,
  model: string,
  apiKey: string,
  maxTokens: number,
  temperature: number,
  onUsage?: LlmUsageCallback,
  signal?: AbortSignal,
): Promise<string> {
  const { default: OpenAI } = await import('openai')
  const client = getCachedClient(
    `xai:${apiKey}`,
    () => new OpenAI({ apiKey, baseURL: 'https://api.x.ai/v1' }),
  )
  return withRetry(async () => {
    const t0 = Date.now()
    const response = await client.chat.completions.create(
      {
        model,
        max_tokens: maxTokens as number | null,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      },
      { signal },
    )
    if (response.usage) {
      onUsage?.({
        input_tokens: response.usage.prompt_tokens,
        output_tokens: response.usage.completion_tokens,
        model,
        provider: 'xai',
        latency_ms: Date.now() - t0,
      })
    }
    return response.choices[0]?.message.content ?? ''
  }, signal)
}

const VERTEX_TIMEOUT_MS = 120_000

/**
 * Vertex AI Gemini on the OpenAI-compatible surface — fetch-based, not the
 * OpenAI SDK, because auth is a per-call header resolver (OAuth tokens expire
 * hourly; a static SDK apiKey cannot refresh).
 *
 * Endpoint shape:
 *   global   → https://aiplatform.googleapis.com/v1/projects/P/locations/global/endpoints/openapi/chat/completions
 *   regional → https://{loc}-aiplatform.googleapis.com/v1/projects/P/locations/{loc}/endpoints/openapi/chat/completions
 *
 * The model name in the request body needs the `google/` publisher prefix.
 * `reasoning_effort` maps to thinking levels — 'none' is invalid on Gemini
 * 3.x/4 (thinking floor is 'minimal'/'low'), and reasoning tokens bill as
 * output, so 'low' is the default.
 */
async function callVertex(
  system: string,
  prompt: string,
  model: string,
  project: string,
  location: string,
  getHeaders: () => Promise<Record<string, string>>,
  reasoningEffort: string,
  maxTokens: number,
  temperature: number,
  onUsage?: LlmUsageCallback,
  signal?: AbortSignal,
): Promise<string> {
  const host =
    location === 'global'
      ? 'https://aiplatform.googleapis.com'
      : `https://${location}-aiplatform.googleapis.com`
  const url = `${host}/v1/projects/${project}/locations/${location}/endpoints/openapi/chat/completions`
  const body = {
    model: model.startsWith('google/') ? model : `google/${model}`,
    stream: false,
    max_tokens: maxTokens,
    temperature,
    reasoning_effort: reasoningEffort,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
  }
  return withRetry(async () => {
    const t0 = Date.now()
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getHeaders()) },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(VERTEX_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Vertex HTTP ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    if (data.usage) {
      onUsage?.({
        input_tokens: data.usage.prompt_tokens ?? 0,
        output_tokens: data.usage.completion_tokens ?? 0,
        model,
        provider: 'vertex',
        latency_ms: Date.now() - t0,
      })
    }
    return data.choices?.[0]?.message?.content ?? ''
  }, signal)
}

const OLLAMA_TIMEOUT_MS = 180_000

async function callOllama(
  system: string,
  prompt: string,
  model: string,
  baseUrl: string,
  maxTokens: number,
  temperature: number,
  getHeaders?: () => Promise<Record<string, string>>,
  onUsage?: LlmUsageCallback,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${baseUrl}/api/chat`
  const body = {
    model,
    stream: false,
    options: { num_predict: maxTokens, temperature, num_ctx: ollamaNumCtx() },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
  }
  return withRetry(async () => {
    const t0 = Date.now()
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(getHeaders ? await getHeaders() : {}) },
        body: JSON.stringify(body),
        // CPU-served models are slow but must not hang a request forever, and a
        // caller abort (task deadline) must stop the in-flight generation.
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(OLLAMA_TIMEOUT_MS)])
          : AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
      })
    } catch (err) {
      // withRetry retries anything whose message contains "timeout"; a call that
      // already burned the whole budget must fail fast, not retry 3x (~12 min).
      if ((err as Error).name === 'TimeoutError')
        throw new Error(`Ollama call exceeded ${OLLAMA_TIMEOUT_MS / 1000}s and was abandoned`)
      throw err
    }
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as {
      message?: { content?: string }
      prompt_eval_count?: number
      eval_count?: number
    }
    if (data.prompt_eval_count !== undefined || data.eval_count !== undefined) {
      onUsage?.({
        input_tokens: data.prompt_eval_count ?? 0,
        output_tokens: data.eval_count ?? 0,
        model,
        provider: 'ollama',
        latency_ms: Date.now() - t0,
      })
    }
    return data.message?.content ?? ''
  }, signal)
}

// ── Public factory ─────────────────────────────────────────────────────────────

/**
 * Create a provider-agnostic LLM function.
 * Reads API keys from environment variables unless overridden in `cfg`.
 *
 * @example
 * // auto-detect from env
 * const llm = createLlmRouter()
 * await llm('You are helpful', 'Summarise this...', 'claude-haiku-4-5')
 *
 * @example
 * // explicit OpenAI
 * const llm = createLlmRouter({ provider: 'openai', apiKey: process.env.OPENAI_API_KEY })
 * await llm('System', 'User', 'gpt-4o-mini')
 */
/**
 * Resolve a reasoning tier to a concrete model name.
 * Priority: caller's tierModels override → DEFAULT_TIER_MODELS → defaultModel
 */
export function resolveTierModel(
  tier: ReasoningTier,
  provider: LlmProvider,
  tierModels?: Partial<Record<ReasoningTier, string>>,
): string {
  if (tierModels?.[tier]) return tierModels[tier]!
  return DEFAULT_TIER_MODELS[provider]?.[tier] ?? DEFAULT_TIER_MODELS['anthropic'][tier]
}

export function createLlmRouter(cfg: LlmConfig = {}): LlmFn {
  const defaultModel = cfg.defaultModel ?? 'claude-haiku-4-5'
  const maxTokens = cfg.maxTokens ?? 2048
  const temperature = cfg.temperature ?? 0.3

  return async function llmRouter(
    system: string,
    prompt: string,
    model?: string,
    opts?: LlmCallOptions,
  ): Promise<string> {
    const signal = opts?.signal
    // Support tier strings: 'tier:fast' | 'tier:balanced' | 'tier:powerful'
    let resolvedModel = model ?? defaultModel
    let tierProvider: LlmProvider | null = null
    if (resolvedModel.startsWith('tier:')) {
      const tier = resolvedModel.slice(5) as ReasoningTier
      // '' defeats model-name detection — a tier has no model of its own, so
      // the provider must come from explicit config → operator/env override
      // → first configured credential. Passing defaultModel here routes every
      // tier call to anthropic regardless of which keys are set.
      tierProvider = resolveProvider(cfg, '')
      resolvedModel = resolveTierModel(tier, tierProvider, cfg.tierModels)
    }
    // A tier model stays on the provider that picked it: re-detecting from the
    // name sends azure's 'gpt-4o-mini' to openai and ollama's 'llama3.2:3b' to
    // groq, which fail when only the picked provider is configured.
    const provider = tierProvider ?? resolveProvider(cfg, resolvedModel)

    try {
      switch (provider) {
        case 'anthropic': {
          const apiKey = cfg.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? ''
          if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')
          return await callAnthropic(
            system,
            prompt,
            resolvedModel,
            apiKey,
            maxTokens,
            temperature,
            cfg.onUsage,
            signal,
          )
        }

        case 'openai': {
          const apiKey = cfg.apiKey ?? process.env['OPENAI_API_KEY'] ?? ''
          if (!apiKey) throw new Error('OPENAI_API_KEY not set')
          return await callOpenAI(
            system,
            prompt,
            resolvedModel,
            apiKey,
            maxTokens,
            temperature,
            cfg.onUsage,
            signal,
          )
        }

        case 'azure': {
          const apiKey = cfg.apiKey ?? process.env['AZURE_OPENAI_API_KEY'] ?? ''
          const endpoint = cfg.azureEndpoint ?? process.env['AZURE_OPENAI_ENDPOINT'] ?? ''
          const deployment =
            cfg.azureDeployment ?? process.env['AZURE_OPENAI_DEPLOYMENT'] ?? resolvedModel
          const apiVersion =
            cfg.azureApiVersion ?? process.env['AZURE_OPENAI_API_VERSION'] ?? '2024-10-21'

          // Enhanced validation with specific error messages
          if (!apiKey) {
            throw new Error('AZURE_OPENAI_API_KEY not set')
          }
          if (!endpoint) {
            throw new Error('AZURE_OPENAI_ENDPOINT not set')
          }

          // Validate endpoint format
          const normalizedEndpoint = endpoint.replace(/\/$/, '').replace(/\/openai.*$/, '')

          if (!isValidAzureEndpoint(normalizedEndpoint)) {
            throw new Error(
              `Invalid Azure endpoint: ${endpoint}. Expected format: https://<resource>.openai.azure.com or https://<resource>.services.ai.azure.com`,
            )
          }

          // Gap A6: AI Foundry resources (.services.ai.azure.com) use the
          // unified /openai/v1 API — model name goes in the request body,
          // not the URL path. Classic Azure OpenAI (.openai.azure.com) uses
          // the per-deployment path /openai/deployments/<name>.
          const foundry = isAzureFoundryEndpoint(normalizedEndpoint)
          const azureBaseUrl = foundry
            ? `${normalizedEndpoint}/openai/v1`
            : `${normalizedEndpoint}/openai/deployments/${deployment}`

          return await callAzure(
            system,
            prompt,
            deployment,
            azureBaseUrl,
            apiKey,
            apiVersion,
            maxTokens,
            temperature,
            foundry,
            cfg.onUsage,
            signal,
          )
        }

        case 'vertex': {
          const project = cfg.vertexProject ?? process.env['VERTEX_PROJECT'] ?? ''
          const location = cfg.vertexLocation ?? process.env['VERTEX_LOCATION'] ?? 'global'
          if (!project) throw new Error('VERTEX_PROJECT not set')
          // Lazily construct the default token provider only when a vertex
          // call actually runs — building it eagerly would read
          // VERTEX_SERVICE_ACCOUNT_JSON / hit the metadata server for
          // deployments that never route here. Cached: the provider's token
          // cache lives in its closure, so a fresh one per call would defeat
          // it (and hit the token endpoint every request).
          const getHeaders =
            cfg.vertexHeaders ??
            getCachedClient('vertex:default-headers', () => vertexAccessTokenProvider())
          const effort =
            cfg.vertexReasoningEffort ?? process.env['VERTEX_REASONING_EFFORT'] ?? 'low'
          return await callVertex(
            system,
            prompt,
            resolvedModel,
            project,
            location,
            getHeaders,
            effort,
            maxTokens,
            temperature,
            cfg.onUsage,
            signal,
          )
        }

        case 'groq': {
          const apiKey = cfg.apiKey ?? process.env['GROQ_API_KEY'] ?? ''
          if (!apiKey) throw new Error('GROQ_API_KEY not set')
          return await callGroq(
            system,
            prompt,
            resolvedModel,
            apiKey,
            maxTokens,
            temperature,
            cfg.onUsage,
            signal,
          )
        }

        case 'xai': {
          const apiKey = cfg.apiKey ?? process.env['XAI_API_KEY'] ?? ''
          if (!apiKey) throw new Error('XAI_API_KEY not set')
          return await callXai(
            system,
            prompt,
            resolvedModel,
            apiKey,
            maxTokens,
            temperature,
            cfg.onUsage,
            signal,
          )
        }

        case 'ollama': {
          const baseUrl =
            cfg.ollamaBaseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434'
          return await callOllama(
            system,
            prompt,
            resolvedModel,
            baseUrl,
            maxTokens,
            temperature,
            cfg.ollamaHeaders,
            cfg.onUsage,
            signal,
          )
        }

        default:
          throw new Error(`Unknown LLM provider: ${provider}`)
      }
    } catch (err) {
      // Structured fallback — never crash the workflow
      log.error({ provider, model: resolvedModel, err: (err as Error).message }, 'LLM call failed')
      throw err // let caller decide whether to use fallback
    }
  }
}

/**
 * Convenience: returns a router pre-configured from environment variables.
 * Logs which provider is active at startup.
 */
let loggedEnvProvider = false

export function createLlmRouterFromEnv(cfg: LlmConfig = {}): LlmFn {
  const provider = detectActiveProvider()
  if (!loggedEnvProvider) {
    log.info({ provider: provider ?? 'none' }, 'Active LLM provider')
    loggedEnvProvider = true
  }
  // 'auto' leaves resolution dynamic per call — providerOverride → model
  // name → LIFEKEEL_LLM_PROVIDER → env scan. Baking the detected provider in
  // here would shadow the runtime override for every call on this router.
  return createLlmRouter({ ...cfg, provider: cfg.provider ?? 'auto' })
}

/** The provider createLlmRouterFromEnv would pick right now, from the environment. */
export function detectActiveProvider(): LlmProvider | null {
  const override = envProviderOverride()
  if (override) return override
  // Approved processors scan first (intent 61) — mirrors resolveProvider:
  // an unreviewed provider is refused in non-dev, so letting it win over an
  // approved configured key only yields canned replies.
  if (process.env['AZURE_OPENAI_ENDPOINT']) return 'azure'
  if (process.env['VERTEX_PROJECT']) return 'vertex'
  if (process.env['GROQ_API_KEY']) return 'groq'
  if (process.env['XAI_API_KEY']) return 'xai'
  if (process.env['ANTHROPIC_API_KEY']) return 'anthropic'
  if (process.env['OPENAI_API_KEY']) return 'openai'
  if (process.env['OLLAMA_BASE_URL']) return 'ollama'
  return null
}

/** Default model to use when none specified, per provider */
export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
  azure: 'gpt-4o',
  vertex: 'gemini-3.5-flash',
  groq: 'llama-3.1-70b-versatile',
  xai: 'grok-4.3',
  ollama: 'llama3.1',
  auto: 'claude-haiku-4-5',
}
