import { describe, expect, it } from 'vitest'
import { LlmResponseCache, withCache, type LlmCacheEntry, type LlmCacheConfig } from '../llm-response-cache.js'
import { formatMoneyDisplay } from '../money.js'

describe('LlmResponseCache', () => {
  it('isolates cache keys by tenant and reuses a fresh result', async () => {
    const entries = new Map<string, LlmCacheEntry<unknown>>()
    const cache = new LlmResponseCache({
      get: async <T>(tenant: string, task: string, hash: string) => entries.get(`${tenant}:${task}:${hash}`) as LlmCacheEntry<T> | undefined ?? null,
      set: async <T>(entry: LlmCacheEntry<T>) => { entries.set(`${entry.tenant_id}:${entry.task}:${entry.input_hash}`, entry) },
    })
    let calls = 0
    expect((await cache.getOrCompute('a', 'score', { id: 1 }, async () => ++calls)).cache_hit).toBe(false)
    expect((await cache.getOrCompute('a', 'score', { id: 1 }, async () => ++calls)).cache_hit).toBe(true)
    expect((await cache.getOrCompute('b', 'score', { id: 1 }, async () => ++calls)).cache_hit).toBe(false)
  })

  it('respects per-task TTL overrides', async () => {
    const entries = new Map<string, LlmCacheEntry<unknown>>()
    const cache = new LlmResponseCache({
      get: async <T>(tenant: string, task: string, hash: string) => entries.get(`${tenant}:${task}:${hash}`) as LlmCacheEntry<T> | undefined ?? null,
      set: async <T>(entry: LlmCacheEntry<T>) => { entries.set(`${entry.tenant_id}:${entry.task}:${entry.input_hash}`, entry) },
    }, 3_600_000) // default 1h

    const config: LlmCacheConfig = {
      enabled: true,
      ttl_seconds: 7200, // default 2h
      tasks: { scorer: { ttl_seconds: 300 } }, // scorer 5min
    }

    let calls = 0
    await cache.getOrCompute('t1', 'scorer', { x: 1 }, async () => ++calls, config)
    await cache.getOrCompute('t1', 'scorer', { x: 1 }, async () => ++calls, config)
    expect(calls).toBe(1) // cached

    // Different task uses default TTL
    await cache.getOrCompute('t1', 'copilot', { x: 1 }, async () => ++calls, config)
    expect(calls).toBe(2)
  })

  it('skips cache when task is disabled in config', async () => {
    const entries = new Map<string, LlmCacheEntry<unknown>>()
    const cache = new LlmResponseCache({
      get: async <T>(tenant: string, task: string, hash: string) => entries.get(`${tenant}:${task}:${hash}`) as LlmCacheEntry<T> | undefined ?? null,
      set: async <T>(entry: LlmCacheEntry<T>) => { entries.set(`${entry.tenant_id}:${entry.task}:${entry.input_hash}`, entry) },
    })

    const config: LlmCacheConfig = {
      enabled: true,
      tasks: { scorer: { enabled: false } },
    }

    let calls = 0
    await cache.getOrCompute('t1', 'scorer', { x: 1 }, async () => ++calls, config)
    await cache.getOrCompute('t1', 'scorer', { x: 1 }, async () => ++calls, config)
    expect(calls).toBe(2) // not cached — task disabled
  })

  it('emits hit/miss via callback', async () => {
    const entries = new Map<string, LlmCacheEntry<unknown>>()
    const events: Array<{ tenant: string; task: string; hit: boolean }> = []
    const cache = new LlmResponseCache(
      {
        get: async <T>(tenant: string, task: string, hash: string) => entries.get(`${tenant}:${task}:${hash}`) as LlmCacheEntry<T> | undefined ?? null,
        set: async <T>(entry: LlmCacheEntry<T>) => { entries.set(`${entry.tenant_id}:${entry.task}:${entry.input_hash}`, entry) },
      },
      3_600_000,
      (tenant, task, hit) => events.push({ tenant, task, hit }),
    )

    let calls = 0
    await cache.getOrCompute('t1', 'scorer', { x: 1 }, async () => ++calls)
    await cache.getOrCompute('t1', 'scorer', { x: 1 }, async () => ++calls)
    expect(events).toEqual([
      { tenant: 't1', task: 'scorer', hit: false },
      { tenant: 't1', task: 'scorer', hit: true },
    ])
  })

  it('withCache wraps an LlmFn and returns cached responses', async () => {
    const entries = new Map<string, LlmCacheEntry<unknown>>()
    const cache = new LlmResponseCache({
      get: async <T>(tenant: string, task: string, hash: string) => entries.get(`${tenant}:${task}:${hash}`) as LlmCacheEntry<T> | undefined ?? null,
      set: async <T>(entry: LlmCacheEntry<T>) => { entries.set(`${entry.tenant_id}:${entry.task}:${entry.input_hash}`, entry) },
    })

    let llmCalls = 0
    const llm = async (_sys: string, _prompt: string, _model?: string) => {
      llmCalls++
      return `response-${llmCalls}`
    }

    const cachedLlm = withCache(llm, cache, 'tenant-1', 'scorer')
    expect(await cachedLlm('sys', 'prompt', 'gpt-4o')).toBe('response-1')
    expect(await cachedLlm('sys', 'prompt', 'gpt-4o')).toBe('response-1') // cache hit
    expect(llmCalls).toBe(1)

    // Different prompt = cache miss
    expect(await cachedLlm('sys', 'different', 'gpt-4o')).toBe('response-2')
    expect(llmCalls).toBe(2)
  })

  it('formats locale-aware money displays', () => {
    expect(formatMoneyDisplay(3_200_000, 'GBP', 'en-GB').formatted).toContain('32,000')
  })
})
