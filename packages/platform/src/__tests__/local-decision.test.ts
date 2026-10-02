import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createLocalDecisionFn, LocalDecisionError } from '../local-decision.js'

const schema = z.object({ ok: z.boolean() })
const jsonSchema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }
const req = { system: 's', prompt: 'p', schema, jsonSchema }

function reply(content: string, status = 200): Response {
  return new Response(JSON.stringify({ message: { content } }), { status })
}

describe('createLocalDecisionFn', () => {
  it('returns a schema-validated value and sends the JSON schema as the decoding format', async () => {
    const fetchImpl = vi.fn(async () => reply('{"ok":true}'))
    const decide = createLocalDecisionFn({ baseUrl: 'http://judge:11434/', model: 'qwen2.5:1.5b', fetchImpl })
    const result = await decide(req)

    expect(result.value).toEqual({ ok: true })
    expect(result.model).toBe('qwen2.5:1.5b')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://judge:11434/api/chat')
    const body = JSON.parse(init.body as string)
    expect(body.format).toEqual(jsonSchema)
    expect(body.options).toMatchObject({ temperature: 0, seed: 0 })
    expect(body.stream).toBe(false)
  })

  it('retries once on invalid output, then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(reply('not json'))
      .mockResolvedValueOnce(reply('{"ok":false}'))
    const decide = createLocalDecisionFn({ baseUrl: 'http://judge:11434', model: 'm', fetchImpl })
    expect((await decide(req)).value).toEqual({ ok: false })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('throws LocalDecisionError when the output never matches the schema', async () => {
    const fetchImpl = vi.fn(async () => reply('{"ok":"yes"}'))
    const decide = createLocalDecisionFn({ baseUrl: 'http://judge:11434', model: 'm', fetchImpl })
    await expect(decide(req)).rejects.toBeInstanceOf(LocalDecisionError)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('throws on HTTP errors and never contacts anything but the configured host', async () => {
    const fetchImpl = vi.fn(async () => reply('', 500))
    const decide = createLocalDecisionFn({ baseUrl: 'http://judge:11434', model: 'm', fetchImpl })
    await expect(decide(req)).rejects.toThrow(/HTTP 500/)
    for (const call of fetchImpl.mock.calls as unknown as [string][]) {
      expect(new URL(call[0]).host).toBe('judge:11434')
    }
  })

  it('rejects a non-http base URL up front', () => {
    expect(() => createLocalDecisionFn({ baseUrl: 'judge:11434', model: 'm' })).toThrow(LocalDecisionError)
  })
})
