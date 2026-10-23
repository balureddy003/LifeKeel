import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLlmRouter, createLlmRouterFromEnv, detectActiveProvider } from '../llm.js'
import { vertexAccessTokenProvider } from '../vertex-auth.js'

const ENV_KEYS = [
  'VERTEX_PROJECT',
  'VERTEX_LOCATION',
  'VERTEX_SERVICE_ACCOUNT_JSON',
  'VERTEX_REASONING_EFFORT',
  'LIFEKEEL_LLM_PROVIDER',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GROQ_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'OLLAMA_BASE_URL',
]
const saved: Record<string, string | undefined> = {}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

const completion = (content: string) => ({
  choices: [{ message: { role: 'assistant', content } }],
  usage: { prompt_tokens: 12, completion_tokens: 7 },
})

describe('vertex provider routing', () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('detects vertex when VERTEX_PROJECT is set, after azure', () => {
    expect(detectActiveProvider()).toBeNull()
    process.env['AZURE_OPENAI_ENDPOINT'] = 'https://x.openai.azure.com'
    expect(detectActiveProvider()).toBe('azure')
    process.env['VERTEX_PROJECT'] = 'p'
    // Incumbent wins when both are configured — a rollout doesn't silently flip.
    expect(detectActiveProvider()).toBe('azure')
    delete process.env['AZURE_OPENAI_ENDPOINT']
    expect(detectActiveProvider()).toBe('vertex')
  })

  it('LIFEKEEL_LLM_PROVIDER overrides env-key detection', () => {
    process.env['OPENAI_API_KEY'] = 'k'
    process.env['LIFEKEEL_LLM_PROVIDER'] = 'vertex'
    expect(detectActiveProvider()).toBe('vertex')
    process.env['LIFEKEEL_LLM_PROVIDER'] = 'bogus'
    expect(detectActiveProvider()).toBe('openai') // invalid value ignored
  })

  it('a runtime providerOverride beats LIFEKEEL_LLM_PROVIDER, env keys and tier defaults', async () => {
    process.env['OPENAI_API_KEY'] = 'k'
    process.env['LIFEKEEL_LLM_PROVIDER'] = 'openai'
    const fetchMock = vi.fn().mockResolvedValue(okResponse(completion('hi')))
    vi.stubGlobal('fetch', fetchMock)
    const router = createLlmRouter({
      providerOverride: () => 'ollama',
      ollamaBaseUrl: 'http://ollama.test:11434',
    })
    // 'tier:fast' is the governed-task call shape — the override must win over
    // the default model name's own provider mapping.
    await router('s', 'p', 'tier:fast')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('ollama.test:11434')
    expect(JSON.parse(init.body as string).model).toBe('llama3.2:3b')
  })

  it('createLlmRouterFromEnv keeps resolution dynamic — the override survives env detection', async () => {
    // Regression: FromEnv used to bake detectActiveProvider() into
    // cfg.provider, which resolves before providerOverride — the operator
    // override never fired on the path the API actually uses.
    process.env['AZURE_OPENAI_ENDPOINT'] = 'https://example.openai.azure.com'
    process.env['AZURE_OPENAI_API_KEY'] = 'k'
    const fetchMock = vi.fn().mockResolvedValue(okResponse(completion('hi')))
    vi.stubGlobal('fetch', fetchMock)
    const router = createLlmRouterFromEnv({
      providerOverride: () => 'ollama',
      ollamaBaseUrl: 'http://ollama.test:11434',
    })
    await router('s', 'p', 'tier:fast')
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('ollama.test:11434')
  })

  it('calls the global openapi endpoint with the google/ model prefix and low effort', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(completion('hi')))
    vi.stubGlobal('fetch', fetchMock)
    const router = createLlmRouter({
      provider: 'vertex',
      vertexProject: 'proj',
      vertexHeaders: async () => ({ Authorization: 'Bearer tok' }),
    })
    const out = await router('sys', 'hello', 'gemini-3.5-flash')
    expect(out).toBe('hi')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/proj/locations/global/endpoints/openapi/chat/completions',
    )
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('google/gemini-3.5-flash')
    expect(body.reasoning_effort).toBe('low')
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ])
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
  })

  it('uses the regional host for a non-global location', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(completion('hi')))
    vi.stubGlobal('fetch', fetchMock)
    const router = createLlmRouter({
      provider: 'vertex',
      vertexProject: 'p',
      vertexLocation: 'europe-west1',
      vertexHeaders: async () => ({ Authorization: 'Bearer t' }),
    })
    await router('s', 'p', 'google/gemini-3.5-flash-lite')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('https://europe-west1-aiplatform.googleapis.com/')
    expect(url).toContain('/locations/europe-west1/')
    expect(JSON.parse(init.body as string).model).toBe('google/gemini-3.5-flash-lite')
  })

  it('reports usage with provider=vertex and throws on HTTP errors', async () => {
    const usages: { provider: string; input_tokens: number; output_tokens: number }[] = []
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(completion('ok')))
      .mockResolvedValueOnce(new Response('nope', { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    const router = createLlmRouter({
      provider: 'vertex',
      vertexProject: 'p',
      vertexHeaders: async () => ({}),
      onUsage: (u) => usages.push(u),
    })
    await router('s', 'p', 'gemini-3.5-flash-lite')
    expect(usages).toEqual(
      [{ provider: 'vertex', input_tokens: 12, output_tokens: 7 }].map((u) =>
        expect.objectContaining(u),
      ),
    )
    // 400 is not retryable — fails immediately.
    await expect(router('s', 'p', 'gemini-3.5-flash-lite')).rejects.toThrow('Vertex HTTP 400')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('vertexAccessTokenProvider', () => {
  it('mints a token from the metadata server and caches until near expiry', async () => {
    let now = 1_000_000
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ access_token: 'tok1', expires_in: 3600 }))
    const provider = vertexAccessTokenProvider({ fetchImpl: fetchMock, now: () => now })
    expect(await provider()).toEqual({ Authorization: 'Bearer tok1' })
    expect(await provider()).toEqual({ Authorization: 'Bearer tok1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // 56 minutes in: inside the 5-minute refresh margin → refresh.
    now += 56 * 60_000
    fetchMock.mockResolvedValue(okResponse({ access_token: 'tok2', expires_in: 3600 }))
    expect(await provider()).toEqual({ Authorization: 'Bearer tok2' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('metadata.google.internal/computeMetadata')
    expect((init.headers as Record<string, string>)['Metadata-Flavor']).toBe('Google')
  })

  it('exchanges a service-account JWT for an access token when configured', async () => {
    process.env['VERTEX_SERVICE_ACCOUNT_JSON'] = JSON.stringify({
      client_email: 'sa@p.iam.gserviceaccount.com',
      // A generated throwaway RSA key for the test — the signature only needs
      // to be well-formed, not valid against anything.
      private_key: `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7
-----END PRIVATE KEY-----`,
    })
    // Malformed key → the sign fails; assert the failure surfaces as an error,
    // not a silent empty token. (A happy-path JWT signing test would need a
    // real key; the exchange shape is covered by fcm-sender's tests.)
    const provider = vertexAccessTokenProvider({ fetchImpl: vi.fn() })
    await expect(provider()).rejects.toThrow()
    delete process.env['VERTEX_SERVICE_ACCOUNT_JSON']
  })

  it('shares one inflight refresh across concurrent callers', async () => {
    let resolve: (r: Response) => void = () => {}
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((r) => (resolve = r)))
    const provider = vertexAccessTokenProvider({ fetchImpl: fetchMock })
    const [a, b] = [provider(), provider()]
    resolve(okResponse({ access_token: 't', expires_in: 3600 }))
    expect(await a).toEqual({ Authorization: 'Bearer t' })
    expect(await b).toEqual({ Authorization: 'Bearer t' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
