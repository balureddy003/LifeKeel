import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createLocalDecisionFn,
  LocalDecisionError,
  type LocalDecisionCallEvent,
} from '../local-decision.js'

const schema = z.object({ ok: z.boolean() })
const jsonSchema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }
const req = { system: 's', prompt: 'p', schema, jsonSchema }

function reply(content: string, status = 200): Response {
  return new Response(JSON.stringify({ message: { content } }), { status })
}

describe('createLocalDecisionFn', () => {
  it('returns a schema-validated value and sends the JSON schema as the decoding format', async () => {
    const fetchImpl = vi.fn(async () => reply('{"ok":true}'))
    const decide = createLocalDecisionFn({
      baseUrl: 'http://judge:11434/',
      model: 'qwen2.5:1.5b',
      fetchImpl,
    })
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
    const fetchImpl = vi
      .fn()
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
    expect(() => createLocalDecisionFn({ baseUrl: 'judge:11434', model: 'm' })).toThrow(
      LocalDecisionError,
    )
  })
})

describe('createLocalDecisionFn caller abort', () => {
  it('a pre-aborted caller signal fails without contacting the model', async () => {
    const fetchImpl = vi.fn(async () => reply('{"ok":true}'))
    const decide = createLocalDecisionFn({ baseUrl: 'http://judge:11434', model: 'm', fetchImpl })
    await expect(decide(req, { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(
      LocalDecisionError,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('forwards the caller signal into the fetch — an abort stops the transport and skips the retry', async () => {
    let seen: AbortSignal | undefined
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      seen = init.signal as AbortSignal
      return new Promise<Response>((_resolve, reject) => {
        seen!.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError')),
        )
      })
    })
    const controller = new AbortController()
    const decide = createLocalDecisionFn({
      baseUrl: 'http://judge:11434',
      model: 'm',
      fetchImpl: fetchImpl as never,
    })
    const p = decide(req, { signal: controller.signal })
    await new Promise((r) => setTimeout(r, 0)) // let the first attempt start
    controller.abort()
    await expect(p).rejects.toBeInstanceOf(LocalDecisionError)
    expect(seen?.aborted).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('createLocalDecisionFn concurrency and metrics hook', () => {
  const deferred = () => {
    let resolve!: (r: Response) => void
    const promise = new Promise<Response>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  it('never runs more calls at once than maxConcurrent, and later calls still complete in order', async () => {
    let inFlight = 0
    let peak = 0
    const gates = [deferred(), deferred(), deferred(), deferred()]
    let call = 0
    const fetchImpl = vi.fn(async () => {
      const mine = gates[call++]!
      inFlight += 1
      peak = Math.max(peak, inFlight)
      const res = await mine.promise
      inFlight -= 1
      return res
    })
    const decide = createLocalDecisionFn({
      baseUrl: 'http://judge:11434',
      model: 'm',
      fetchImpl,
      maxConcurrent: 2,
    })

    const results = [0, 1, 2, 3].map(() => decide(req))
    await new Promise((r) => setTimeout(r, 10))
    expect(inFlight).toBe(2) // two running, two waiting for a slot

    gates[0]!.resolve(reply('{"ok":true}'))
    await new Promise((r) => setTimeout(r, 10))
    expect(inFlight).toBe(2) // the slot went straight to the next waiter
    gates[1]!.resolve(reply('{"ok":true}'))
    gates[2]!.resolve(reply('{"ok":true}'))
    gates[3]!.resolve(reply('{"ok":true}'))

    expect((await Promise.all(results)).map((r) => r.value.ok)).toEqual([true, true, true, true])
    expect(peak).toBe(2)
  })

  it('releases the slot when a call fails so one failure cannot wedge the queue', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(reply('', 500))
      .mockResolvedValueOnce(reply('', 500)) // first decide: both attempts fail
      .mockResolvedValue(reply('{"ok":true}'))
    const decide = createLocalDecisionFn({
      baseUrl: 'http://judge:11434',
      model: 'm',
      fetchImpl,
      maxConcurrent: 1,
    })
    const first = decide(req)
    const second = decide(req)
    await expect(first).rejects.toBeInstanceOf(LocalDecisionError)
    expect((await second).value.ok).toBe(true)
  })

  it('reports each call with its outcome and queue wait, and survives a throwing hook', async () => {
    const events: LocalDecisionCallEvent[] = []
    const fetchImpl = vi.fn(async () => reply('{"ok":true}'))
    const decide = createLocalDecisionFn({
      baseUrl: 'http://judge:11434',
      model: 'qwen',
      fetchImpl,
      onCall: (e) => {
        events.push(e)
        throw new Error('metrics down')
      },
    })
    await expect(decide(req)).resolves.toBeDefined()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ model: 'qwen', ok: true })
    expect(events[0]!.queued_ms).toBeGreaterThanOrEqual(0)

    const failing = createLocalDecisionFn({
      baseUrl: 'http://judge:11434',
      model: 'qwen',
      fetchImpl: vi.fn(async () => reply('', 500)),
      onCall: (e) => events.push(e),
    })
    await expect(failing(req)).rejects.toBeInstanceOf(LocalDecisionError)
    expect(events.at(-1)).toMatchObject({ ok: false })
  })
})

describe('createLocalDecisionFn auth headers', () => {
  it('attaches headers resolved per call so a refreshed token is picked up', async () => {
    let n = 0
    const fetchImpl = vi.fn(async () => reply('{"ok":true}'))
    const decide = createLocalDecisionFn({
      baseUrl: 'http://judge:11434',
      model: 'm',
      fetchImpl,
      getHeaders: async () => ({ Authorization: `Bearer token-${++n}` }),
    })
    await decide(req)
    await decide(req)
    const auths = (fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>).map(
      (c) => (c[1].headers as Record<string, string>)['Authorization'],
    )
    expect(auths).toEqual(['Bearer token-1', 'Bearer token-2'])
  })

  it('counts a failing header provider as a failed attempt rather than crashing the caller', async () => {
    const fetchImpl = vi.fn(async () => reply('{"ok":true}'))
    const decide = createLocalDecisionFn({
      baseUrl: 'http://judge:11434',
      model: 'm',
      fetchImpl,
      getHeaders: async () => {
        throw new Error('metadata server unreachable')
      },
    })
    await expect(decide(req)).rejects.toBeInstanceOf(LocalDecisionError)
    expect(fetchImpl).not.toHaveBeenCalled() // never sent an unauthenticated request
  })
})
