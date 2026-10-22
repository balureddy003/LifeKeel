import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  governedDecide,
  governedLlm,
  TaskDeadlineError,
  type AiTaskPolicy,
} from '../task-gateway.js'
import { currentDeadlineSignal, llmCallContext } from '../call-context.js'
import { createLlmRouter } from '../llm.js'
import { createLocalDecisionFn } from '../local-decision.js'
import { getAllCircuitBreakers } from '../llm-circuit-breaker.js'

const policy: AiTaskPolicy = {
  task_id: 'test.task.v1',
  purpose: 'test',
  data_boundary: 'lifekeel_infra',
  processor_terms_ref: 'test',
  provider_retention_class: 'none',
  allowed_models: ['tier:fast'],
  primary_model: 'tier:fast',
  deadline_ms: 40,
  max_input_tokens: 400,
  max_output_tokens: 200,
}
const deps = { registry: new Map([[policy.task_id, policy]]), failClosed: true }

/** A fetch that never answers and rejects only when its signal aborts, like a real hung request. */
function hungFetch() {
  const signals: AbortSignal[] = []
  const impl = vi.fn(
    (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal
        signals.push(signal)
        signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')))
      }),
  )
  return { impl, signals }
}

beforeEach(() => {
  getAllCircuitBreakers().clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the task deadline cancels the upstream request', () => {
  it('exposes the deadline signal to the call, and aborts it when the deadline passes', async () => {
    let seen: AbortSignal | undefined
    const base = () =>
      new Promise<string>(() => {
        seen = currentDeadlineSignal()
      })
    await expect(governedLlm(base, deps, policy.task_id, 't1')('s', 'p')).rejects.toThrow(
      TaskDeadlineError,
    )
    expect(seen).toBeDefined()
    expect(seen!.aborted).toBe(true)
    expect(seen!.reason).toBeInstanceOf(TaskDeadlineError)
  })

  it('does not abort a call that finishes in time', async () => {
    let seen: AbortSignal | undefined
    const base = async () => {
      seen = currentDeadlineSignal()
      return 'fine'
    }
    await expect(
      governedLlm(
        base,
        { ...deps, registry: new Map([[policy.task_id, { ...policy, deadline_ms: 5000 }]]) },
        policy.task_id,
        't1',
      )('s', 'p'),
    ).resolves.toBe('fine')
    expect(seen!.aborted).toBe(false)
  })

  it('there is no deadline signal outside a governed call', () => {
    expect(currentDeadlineSignal()).toBeUndefined()
    expect(llmCallContext.getStore()).toBeUndefined()
  })

  it('the Ollama text client aborts its HTTP request at the deadline and does not retry', async () => {
    const { impl, signals } = hungFetch()
    vi.stubGlobal('fetch', impl)
    const raw = createLlmRouter({
      provider: 'ollama',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      tierModels: { fast: 'm' },
    })
    await expect(governedLlm(raw, deps, policy.task_id, 't1')('s', 'p')).rejects.toThrow(
      TaskDeadlineError,
    )
    // Give the abort a tick to propagate, then check the request really was cancelled.
    await new Promise((r) => setTimeout(r, 20))
    expect(impl).toHaveBeenCalledTimes(1)
    expect(signals[0]!.aborted).toBe(true)
  })

  it('the local decision client aborts its HTTP request at the deadline and does not retry', async () => {
    const { impl, signals } = hungFetch()
    const decide = createLocalDecisionFn({
      baseUrl: 'http://judge:11434',
      model: 'm',
      fetchImpl: impl as unknown as typeof fetch,
    })
    const governed = governedDecide(decide, deps, policy.task_id, 't1')
    await expect(
      governed({
        system: 's',
        prompt: 'p',
        schema: z.object({ ok: z.boolean() }),
        jsonSchema: { type: 'object' },
      }),
    ).rejects.toThrow(TaskDeadlineError)
    await new Promise((r) => setTimeout(r, 20))
    expect(impl).toHaveBeenCalledTimes(1)
    expect(signals[0]!.aborted).toBe(true)
  })

  it('without a deadline context the clients behave as before (timeout only)', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ message: { content: 'hi' } }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const raw = createLlmRouter({
      provider: 'ollama',
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      tierModels: { fast: 'm' },
    })
    await expect(raw('s', 'p', 'tier:fast')).resolves.toBe('hi')
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.signal).toBeDefined()
    expect((init.signal as AbortSignal).aborted).toBe(false)
  })
})
