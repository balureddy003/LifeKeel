import { LlmCircuitBreaker, getCircuitBreaker } from './llm-circuit-breaker.js'
import type { CircuitBreakerOptions } from './llm-circuit-breaker.js'

export interface CircuitBreakerRegistry {
  register(key: string, options?: CircuitBreakerOptions): LlmCircuitBreaker
  get(key: string): LlmCircuitBreaker | undefined
  listKeys(): string[]
  setDefaultOptions(options: CircuitBreakerOptions): void
}

/** In-memory registry mapping keys to circuit breaker instances and options. */
export class InMemoryCircuitBreakerRegistry implements CircuitBreakerRegistry {
  private readonly map = new Map<string, LlmCircuitBreaker>()
  private defaultOptions: CircuitBreakerOptions = {}

  register(key: string, options: CircuitBreakerOptions = {}): LlmCircuitBreaker {
    const merged = { ...this.defaultOptions, ...options }
    const cb = getCircuitBreaker(key, merged)
    this.map.set(key, cb)
    return cb
  }

  get(key: string): LlmCircuitBreaker | undefined {
    if (this.map.has(key)) return this.map.get(key)
    return undefined
  }

  listKeys(): string[] {
    return Array.from(this.map.keys()).sort()
  }

  setDefaultOptions(options: CircuitBreakerOptions): void {
    this.defaultOptions = options
  }
}

export const defaultCircuitBreakerRegistry = new InMemoryCircuitBreakerRegistry()
