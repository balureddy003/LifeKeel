import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLlmRouter } from '../llm.js'

describe('Ollama call timeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fails fast instead of retrying a call that already used its whole budget', async () => {
    const fetchMock = vi.fn(async () => {
      const e = new Error('The operation was aborted due to timeout')
      e.name = 'TimeoutError'
      throw e
    })
    vi.stubGlobal('fetch', fetchMock)
    const llm = createLlmRouter({
      provider: 'ollama',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      tierModels: { fast: 'm' },
    })
    await expect(llm('s', 'p', 'tier:fast')).rejects.toThrow(/exceeded 180s/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('aborts the retry backoff — a caller signal mid-backoff stops the wait, not just the transport', async () => {
    const fetchMock = vi.fn(async () => new Response('down', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const llm = createLlmRouter({
      provider: 'ollama',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      tierModels: { fast: 'm' },
    })
    const controller = new AbortController()
    const p = llm('s', 'p', 'tier:fast', { signal: controller.signal })
    await new Promise((r) => setTimeout(r, 30)) // first attempt fails, backoff begins
    controller.abort()
    const t0 = Date.now()
    await expect(p).rejects.toBeDefined()
    // The backoff was seconds long; an abort-aware wait returns immediately.
    expect(Date.now() - t0).toBeLessThan(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends resolved auth headers on text-generation calls too', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ message: { content: 'hi' } }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const llm = createLlmRouter({
      provider: 'ollama',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      tierModels: { fast: 'm' },
      ollamaHeaders: async () => ({ Authorization: 'Bearer abc' }),
    })
    await llm('s', 'p', 'tier:fast')
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer abc')
  })
})
