import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createEmbedFn } from '../memory/AgentMemory.js'
import { getAllCircuitBreakers } from '@kairos/platform'

let originalFetch: any

beforeEach(() => {
  originalFetch = global.fetch
})
afterEach(() => {
  global.fetch = originalFetch
})

describe('createEmbedFn with circuit breaker', () => {
  it('uses fetch and registers a circuit breaker', async () => {
    global.fetch = async () => ({ json: async () => ({ data: [{ embedding: [1,2,3] }] }) }) as any
    const fn = createEmbedFn('fake-key', 'openai')
    expect(fn).toBeDefined()
    const emb = await fn!('hello world')
    expect(emb).toEqual([1,2,3])

    // circuit breaker should have an entry for 'openai'
    const breakers = getAllCircuitBreakers()
    expect([...breakers.keys()]).toContain('openai')
  })
})
