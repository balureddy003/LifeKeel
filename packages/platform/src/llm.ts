/**
 * Kairos LLM Router
 *
 * Provider-agnostic LLM abstraction.  Configure once, use everywhere.
 *
 * Supported providers (auto-detected from model name or explicit config):
 *   anthropic  — Claude 3 Haiku / Sonnet / Opus  (ANTHROPIC_API_KEY)
 *   openai     — GPT-4o, GPT-4o-mini, o1, o3     (OPENAI_API_KEY)
 *   azure      — Azure OpenAI deployments         (AZURE_OPENAI_*)
 *   ollama     — local models via Ollama HTTP API  (OLLAMA_BASE_URL)
 *   groq       — Llama 3 / Mixtral via Groq        (GROQ_API_KEY)
 *
 * Usage:
 *   const llm = createLlmRouter()          // reads env vars automatically
 *   const text = await llm('system', 'user prompt', 'claude-haiku-4-5')
 *
 * Or explicit config:
 *   const llm = createLlmRouter({ provider: 'openai', apiKey: '...' })
 */

import { createLogger } from './logger.js'

const log = createLogger({ service: 'llm', version: '0.0.0' })

export type LlmProvider = 'anthropic' | 'openai' | 'azure' | 'ollama' | 'groq' | 'auto'

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
    fast:     'claude-haiku-4-5',
    balanced: 'claude-3-5-sonnet-20241022',
    powerful: 'claude-opus-4',
  },
  openai: {
    fast:     'gpt-4o-mini',
    balanced: 'gpt-4o',
    powerful: 'o3-mini',
  },
  groq: {
    fast:     'llama-3.1-8b-instant',
    balanced: 'llama-3.1-70b-versatile',
    powerful: 'llama-3.1-70b-versatile',   // Groq doesn't have o-series yet
  },
  azure: {
    fast:     'gpt-4o-mini',
    balanced: 'gpt-4o',
    powerful: 'gpt-4o',
  },
  ollama: {
    fast:     'llama3.2:3b',
    balanced: 'qwen2.5:7b',
    powerful: 'qwen2.5:14b',
  },
  auto: {
    fast:     'claude-haiku-4-5',
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
    'reason through', 'step by step', 'analyze', 'evaluate trade-offs',
    'compare', 'pros and cons', 'strategic', 'plan', 'decide', 'recommend',
    'synthesize', 'critique', 'assess risk', 'legal', 'financial', 'medical',
    'multi-step', 'chain of thought', 'justify', 'argue',
  ]
  if (powerfulSignals.some(s => text.includes(s)) || len > 2000) return 'powerful'

  // Signals of simple tasks → fast tier
  const fastSignals = [
    'classify', 'label', 'categorize', 'translate', 'sentiment',
    'positive or negative', 'yes or no', 'true or false',
    'format', 'extract', 'parse', 'summarize in one',
  ]
  if (fastSignals.some(s => text.includes(s)) && len < 500) return 'fast'

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
  /** Ollama base URL (default: http://localhost:11434) */
  ollamaBaseUrl?: string
  /** Extra headers for Ollama calls, resolved per call (e.g. a Cloud Run identity token). */
  ollamaHeaders?: () => Promise<Record<string, string>>
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

/** The canonical LLM function type used everywhere in Kairos */
export type LlmFn = (system: string, prompt: string, model?: string) => Promise<string>

/**
 * Model → provider routing table.
 * If `provider` is 'auto', model name picks the right SDK.
 */
const MODEL_PROVIDER_MAP: Record<string, LlmProvider> = {
  // Anthropic
  'claude-3-haiku':        'anthropic',
  'claude-3-haiku-20240307': 'anthropic',
  'claude-haiku-4-5':      'anthropic',
  'claude-3-5-haiku':      'anthropic',
  'claude-3-5-haiku-20241022': 'anthropic',
  'claude-3-sonnet':       'anthropic',
  'claude-3-5-sonnet':     'anthropic',
  'claude-3-5-sonnet-20241022': 'anthropic',
  'claude-opus-4':         'anthropic',
  'claude-3-opus-20240229':'anthropic',
  // OpenAI
  'gpt-4o':                'openai',
  'gpt-4o-mini':           'openai',
  'gpt-4-turbo':           'openai',
  'gpt-4':                 'openai',
  'gpt-3.5-turbo':         'openai',
  'o1':                    'openai',
  'o1-mini':               'openai',
  'o3':                    'openai',
  'o3-mini':               'openai',
  // Groq
  'llama-3.1-70b-versatile': 'groq',
  'llama-3.1-8b-instant':    'groq',
  'mixtral-8x7b-32768':      'groq',
  'gemma2-9b-it':            'groq',
}

function detectProviderFromModel(model: string): LlmProvider | null {
  // Exact match
  if (MODEL_PROVIDER_MAP[model]) return MODEL_PROVIDER_MAP[model]!
  // Prefix match
  if (model.startsWith('claude')) return 'anthropic'
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) return 'openai'
  if (model.startsWith('llama') || model.startsWith('mixtral') || model.startsWith('gemma')) return 'groq'
  return null
}

function resolveProvider(cfg: LlmConfig, model: string): LlmProvider {
  if (cfg.provider && cfg.provider !== 'auto') return cfg.provider
  // Auto-detect from model name
  const fromModel = detectProviderFromModel(model)
  if (fromModel) return fromModel
  // Fall back to whichever API key is available
  if (process.env['ANTHROPIC_API_KEY']) return 'anthropic'
  if (process.env['OPENAI_API_KEY']) return 'openai'
  if (process.env['GROQ_API_KEY']) return 'groq'
  if (process.env['AZURE_OPENAI_ENDPOINT']) return 'azure'
  if (process.env['OLLAMA_BASE_URL'] || model.startsWith('llama') || model.startsWith('phi') || model.startsWith('mistral')) return 'ollama'
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
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = MAX_RETRIES,
  delayMs = BASE_DELAY_MS,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const isRetryable =
        // Rate limit or server error from HTTP status in message
        (err instanceof Error && RETRYABLE_STATUS_CODES.has(Number(
          err.message.match(/\b(429|5\d\d)\b/)?.[1] ?? 0
        ))) ||
        // Network / connection error (no HTTP status)
        (err instanceof TypeError && err.message.includes('fetch')) ||
        // Provider SDK rate-limit error shape
        (err instanceof Error && (
          err.message.toLowerCase().includes('rate limit') ||
          err.message.toLowerCase().includes('overloaded') ||
          err.message.toLowerCase().includes('timeout')
        ))

      if (!isRetryable || attempt === retries) break

      const jitter = Math.random() * delayMs * 0.3
      const wait = delayMs * Math.pow(2, attempt) + jitter
      log.warn({ attempt: attempt + 1, retries: retries + 1, delay_ms: Math.round(wait), err: (err as Error).message }, 'LLM attempt failed — retrying')
      await new Promise(r => setTimeout(r, wait))
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
): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  // Singleton client — reuse across calls to avoid connection pool exhaustion
  const client = getCachedClient(`anthropic:${apiKey}`, () => new Anthropic({ apiKey }))
  return withRetry(async () => {
    const t0 = Date.now()
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: prompt }],
    })
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
  })
}

async function callOpenAI(
  system: string,
  prompt: string,
  model: string,
  apiKey: string,
  maxTokens: number,
  temperature: number,
  onUsage?: LlmUsageCallback,
): Promise<string> {
  const { default: OpenAI } = await import('openai')
  // Singleton client — reuse across calls to avoid connection pool exhaustion
  const client = getCachedClient(`openai:${apiKey}`, () => new OpenAI({ apiKey }))
  // o1/o3 reasoning models don't support system message or temperature
  const isReasoningModel = model.startsWith('o1') || model.startsWith('o3')
  return withRetry(async () => {
    const t0 = Date.now()
    const response = await client.chat.completions.create({
      model,
      max_tokens: isReasoningModel ? null : maxTokens as number | null,
      temperature: isReasoningModel ? null : temperature as number | null,
      messages: isReasoningModel
        ? [{ role: 'user', content: `${system}\n\n${prompt}` }]
        : [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
    })
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
  })
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
  const client = getCachedClient(`azure:${azureBaseUrl}:${apiKey}:${foundry}`, () => new OpenAI(clientOpts))
  return withRetry(async () => {
    console.log('Making Azure OpenAI request:', {
      baseURL: client.baseURL,
      model: deployment,
      apiVersion,
      foundry,
    })
    const response = await client.chat.completions.create({
      model: deployment,
      max_tokens: maxTokens as number | null,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    })
    console.log('Azure response successful:', response.choices[0]?.message.content?.substring(0, 50))
    return response.choices[0]?.message.content ?? ''
  })
}

async function callGroq(
  system: string,
  prompt: string,
  model: string,
  apiKey: string,
  maxTokens: number,
  temperature: number,
  onUsage?: LlmUsageCallback,
): Promise<string> {
  // Groq uses OpenAI-compatible API — singleton client
  const { default: OpenAI } = await import('openai')
  const client = getCachedClient(`groq:${apiKey}`, () => new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' }))
  return withRetry(async () => {
    const t0 = Date.now()
    const response = await client.chat.completions.create({
      model,
      max_tokens: maxTokens as number | null,
      temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    })
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
  })
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
): Promise<string> {
  const url = `${baseUrl}/api/chat`
  const body = {
    model,
    stream: false,
    options: { num_predict: maxTokens, temperature },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
  }
  return withRetry(async () => {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(getHeaders ? await getHeaders() : {}) },
        body: JSON.stringify(body),
        // CPU-served models are slow but must not hang a request forever.
        signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
      })
    } catch (err) {
      // withRetry retries anything whose message contains "timeout"; a call that
      // already burned the whole budget must fail fast, not retry 3x (~12 min).
      if ((err as Error).name === 'TimeoutError') throw new Error(`Ollama call exceeded ${OLLAMA_TIMEOUT_MS / 1000}s and was abandoned`)
      throw err
    }
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`)
    const data = await res.json() as { message?: { content?: string } }
    return data.message?.content ?? ''
  })
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

  return async function llmRouter(system: string, prompt: string, model?: string): Promise<string> {
    // Support tier strings: 'tier:fast' | 'tier:balanced' | 'tier:powerful'
    let resolvedModel = model ?? defaultModel
    if (resolvedModel.startsWith('tier:')) {
      const tier = resolvedModel.slice(5) as ReasoningTier
      const provider = resolveProvider(cfg, defaultModel)
      resolvedModel = resolveTierModel(tier, provider, cfg.tierModels)
    }
    const provider = resolveProvider(cfg, resolvedModel)

    try {
      switch (provider) {
        case 'anthropic': {
          const apiKey = cfg.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? ''
          if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')
          return await callAnthropic(system, prompt, resolvedModel, apiKey, maxTokens, temperature, cfg.onUsage)
        }

        case 'openai': {
          const apiKey = cfg.apiKey ?? process.env['OPENAI_API_KEY'] ?? ''
          if (!apiKey) throw new Error('OPENAI_API_KEY not set')
          return await callOpenAI(system, prompt, resolvedModel, apiKey, maxTokens, temperature, cfg.onUsage)
        }

        case 'azure': {
          const apiKey = cfg.apiKey ?? process.env['AZURE_OPENAI_API_KEY'] ?? ''
          const endpoint = cfg.azureEndpoint ?? process.env['AZURE_OPENAI_ENDPOINT'] ?? ''
          const deployment = cfg.azureDeployment ?? process.env['AZURE_OPENAI_DEPLOYMENT'] ?? resolvedModel
          const apiVersion = cfg.azureApiVersion ?? process.env['AZURE_OPENAI_API_VERSION'] ?? '2024-10-21'
          
          // Enhanced validation with specific error messages
          if (!apiKey) {
            throw new Error('AZURE_OPENAI_API_KEY not set')
          }
          if (!endpoint) {
            throw new Error('AZURE_OPENAI_ENDPOINT not set')
          }
          
          // Validate endpoint format
          const normalizedEndpoint = endpoint.replace(/\/$/, '').replace(/\/openai.*$/, '')
          console.log('Azure endpoint processing:', { original: endpoint, normalized: normalizedEndpoint })

          if (!isValidAzureEndpoint(normalizedEndpoint)) {
            throw new Error(`Invalid Azure endpoint: ${endpoint}. Expected format: https://<resource>.openai.azure.com or https://<resource>.services.ai.azure.com`)
          }

          // Gap A6: AI Foundry resources (.services.ai.azure.com) use the
          // unified /openai/v1 API — model name goes in the request body,
          // not the URL path. Classic Azure OpenAI (.openai.azure.com) uses
          // the per-deployment path /openai/deployments/<name>.
          const foundry = isAzureFoundryEndpoint(normalizedEndpoint)
          const azureBaseUrl = foundry
            ? `${normalizedEndpoint}/openai/v1`
            : `${normalizedEndpoint}/openai/deployments/${deployment}`
          
          console.log('Azure call details:', {
            normalizedEndpoint,
            deployment,
            apiVersion,
            azureBaseUrl,
            foundry,
            hasApiKey: !!apiKey
          })

  return await callAzure(system, prompt, deployment, azureBaseUrl, apiKey, apiVersion, maxTokens, temperature, foundry)
        }

        case 'groq': {
          const apiKey = cfg.apiKey ?? process.env['GROQ_API_KEY'] ?? ''
          if (!apiKey) throw new Error('GROQ_API_KEY not set')
          return await callGroq(system, prompt, resolvedModel, apiKey, maxTokens, temperature, cfg.onUsage)
        }

        case 'ollama': {
          const baseUrl = cfg.ollamaBaseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434'
          return await callOllama(system, prompt, resolvedModel, baseUrl, maxTokens, temperature, cfg.ollamaHeaders)
        }

        default:
          throw new Error(`Unknown LLM provider: ${provider}`)
      }
    } catch (err) {
      // Structured fallback — never crash the workflow
      log.error({ provider, model: resolvedModel, err: (err as Error).message }, 'LLM call failed')
      throw err  // let caller decide whether to use fallback
    }
  }
}

/**
 * Convenience: returns a router pre-configured from environment variables.
 * Logs which provider is active at startup.
 */
let loggedEnvProvider = false

export function createLlmRouterFromEnv(): LlmFn {
  const provider = detectActiveProvider()
  if (!loggedEnvProvider) {
    log.info({ provider: provider ?? 'none' }, 'Active LLM provider')
    loggedEnvProvider = true
  }
  return createLlmRouter({ provider: provider ?? 'anthropic' })
}

function detectActiveProvider(): LlmProvider | null {
  if (process.env['ANTHROPIC_API_KEY']) return 'anthropic'
  if (process.env['OPENAI_API_KEY']) return 'openai'
  if (process.env['GROQ_API_KEY']) return 'groq'
  if (process.env['AZURE_OPENAI_ENDPOINT']) return 'azure'
  if (process.env['OLLAMA_BASE_URL']) return 'ollama'
  return null
}

/** Default model to use when none specified, per provider */
export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  anthropic: 'claude-haiku-4-5',
  openai:    'gpt-4o-mini',
  azure:     'gpt-4o',
  groq:      'llama-3.1-70b-versatile',
  ollama:    'llama3.1',
  auto:      'claude-haiku-4-5',
}
