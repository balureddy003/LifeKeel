import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { DEFAULT_OLLAMA_NUM_CTX, ollamaNumCtx } from '../ollama-options.js'
import { createLocalDecisionFn } from '../local-decision.js'
import { createLlmRouter } from '../llm.js'

describe('ollamaNumCtx', () => {
  it('covers the largest task budget (8000 input + 1500 output tokens)', () => {
    expect(DEFAULT_OLLAMA_NUM_CTX).toBeGreaterThanOrEqual(8000 + 1500)
    expect(ollamaNumCtx(undefined)).toBe(DEFAULT_OLLAMA_NUM_CTX)
    expect(ollamaNumCtx('')).toBe(DEFAULT_OLLAMA_NUM_CTX)
  })

  it('accepts a valid override', () => {
    expect(ollamaNumCtx('16384')).toBe(16384)
  })

  it.each(['abc', '0', '-5', '1000', '4096.5', '999999999'])(
    'falls back to the default for the invalid value %s',
    (raw) => {
      expect(ollamaNumCtx(raw)).toBe(DEFAULT_OLLAMA_NUM_CTX)
    },
  )
})

describe('Ollama requests pin the context window', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('the decision path sends num_ctx, so a long prompt is never silently truncated', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ message: { content: '{"ok":true}' } })),
    )
    const decide = createLocalDecisionFn({ baseUrl: 'http://judge:11434', model: 'm', fetchImpl })
    await decide({
      system: 's',
      prompt: 'p',
      schema: z.object({ ok: z.boolean() }),
      jsonSchema: { type: 'object' },
    })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string).options.num_ctx).toBe(DEFAULT_OLLAMA_NUM_CTX)
  })

  it('the text-generation path sends it too', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ message: { content: 'hi' } }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const llm = createLlmRouter({
      provider: 'ollama',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      tierModels: { fast: 'm' },
    })
    await llm('s', 'p', 'tier:fast')
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(init.body as string).options.num_ctx).toBe(DEFAULT_OLLAMA_NUM_CTX)
  })
})
