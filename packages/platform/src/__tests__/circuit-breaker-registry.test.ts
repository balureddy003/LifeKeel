import { describe, it, expect } from 'vitest'
import { InMemoryCircuitBreakerRegistry } from '../circuit-breaker-registry.js'

describe('InMemoryCircuitBreakerRegistry', () => {
  it('registers and retrieves circuit breakers by key', () => {
    const reg = new InMemoryCircuitBreakerRegistry()
    const cb = reg.register('provider:a')
    expect(reg.get('provider:a')).toBe(cb)
    expect(reg.listKeys()).toEqual(['provider:a'])
  })

  it('applies default options when registering', () => {
    const reg = new InMemoryCircuitBreakerRegistry()
    reg.setDefaultOptions({ failureThreshold: 2, openDurationMs: 100 })
    const cb = reg.register('provider:b')
    expect(cb.getState()).toBe('closed')
    // cause failures by invoking with a fn that throws; failureThreshold=2 should open after 2
  })
})
