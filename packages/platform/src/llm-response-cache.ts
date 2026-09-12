/**
 * LLM Response Cache — exact-match hash cache for LLM responses.
 *
 * NOTE: This is NOT a semantic (embedding-based) cache. It is an exact-match
 * cache keyed on SHA-256(system + prompt + model). The name "LlmResponseCache"
 * is intentionally honest about this. A true semantic cache adds embedding
 * cost to every lookup; this cache has zero marginal cost on a hit.
 *
 * Design:
 *   - Pluggable store interface (LlmCacheStore) — MongoDB, Redis, in-memory
 *   - Per-tenant isolation (tenant_id is part of every cache key)
 *   - Per-task TTL overrides (scorer: 1h, copilot: 5min, compiler: 24h)
 *   - Cache hit/miss callback for Prometheus metrics
 *
 * Usage with the router (non-breaking — wraps any LlmFn):
 *   const cache = new LlmResponseCache(new MongoLlmCacheStore(db))
 *   const cachedLlm = withCache(llm, cache, tenantId, 'scorer', { ttl_seconds: 3600 })
 *   const result = await cachedLlm(system, prompt, model)
 *
 * Per-tenant config (via tenant_settings key 'llm_cache_config'):
 *   { enabled: true, ttl_seconds: 3600, tasks: { scorer: { ttl_seconds: 3600 } } }
 */

import { createHash } from 'node:crypto'
import type { Db } from 'mongodb'
import type { LlmFn } from './llm.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LlmCacheEntry<T> {
  tenant_id: string
  task: string
  input_hash: string
  value: T
  created_at: Date
  expires_at: Date
}

export interface LlmCacheStore {
  get<T>(tenantId: string, task: string, inputHash: string): Promise<LlmCacheEntry<T> | null>
  set<T>(entry: LlmCacheEntry<T>): Promise<void>
}

/** Per-tenant cache configuration, stored in tenant_settings. */
export interface LlmCacheConfig {
  enabled: boolean
  /** Default TTL in seconds for all tasks. Default: 3600 (1h). */
  ttl_seconds?: number
  /** Per-task overrides. Keys are task names (e.g. 'scorer', 'copilot'). */
  tasks?: Record<string, { ttl_seconds?: number; enabled?: boolean }>
}

export interface LlmCacheMetrics {
  hits: number
  misses: number
}

export type LlmCacheHitCallback = (tenantId: string, task: string, hit: boolean) => void

// ── LlmResponseCache ──────────────────────────────────────────────────────────

export class LlmResponseCache {
  constructor(
    private readonly store: LlmCacheStore,
    private readonly defaultTtlMs = 3_600_000,
    private readonly onHitMiss?: LlmCacheHitCallback,
  ) {}

  /** SHA-256 hash of the input object. Stable across calls with same content. */
  hash(input: unknown): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex')
  }

  /**
   * Return the cached value if present and fresh, otherwise call `compute`
   * and store the result. Emits hit/miss via the callback if configured.
   *
   * Per-task TTL override is read from `config.tasks[task].ttl_seconds` if
   * present, falling back to `config.ttl_seconds`, then `defaultTtlMs`.
   */
  async getOrCompute<T>(
    tenantId: string,
    task: string,
    input: unknown,
    compute: () => Promise<T>,
    config?: LlmCacheConfig,
  ): Promise<{ value: T; cache_hit: boolean }> {
    // Per-task opt-out
    if (config?.tasks?.[task]?.enabled === false) {
      const value = await compute()
      this.onHitMiss?.(tenantId, task, false)
      return { value, cache_hit: false }
    }
    if (config?.enabled === false) {
      const value = await compute()
      this.onHitMiss?.(tenantId, task, false)
      return { value, cache_hit: false }
    }

    const ttlMs = this.resolveTtlMs(task, config)
    const inputHash = this.hash(input)
    const cached = await this.store.get<T>(tenantId, task, inputHash)
    if (cached && cached.expires_at > new Date()) {
      this.onHitMiss?.(tenantId, task, true)
      return { value: cached.value, cache_hit: true }
    }

    const value = await compute()
    const now = new Date()
    await this.store.set({
      tenant_id: tenantId,
      task,
      input_hash: inputHash,
      value,
      created_at: now,
      expires_at: new Date(now.getTime() + ttlMs),
    })
    this.onHitMiss?.(tenantId, task, false)
    return { value, cache_hit: false }
  }

  private resolveTtlMs(task: string, config?: LlmCacheConfig): number {
    const taskTtl = config?.tasks?.[task]?.ttl_seconds
    if (taskTtl !== undefined) return taskTtl * 1000
    if (config?.ttl_seconds !== undefined) return config.ttl_seconds * 1000
    return this.defaultTtlMs
  }
}

// ── MongoLlmCacheStore ────────────────────────────────────────────────────────

/**
 * MongoDB-backed LlmCacheStore. Uses a TTL index on `expires_at` so expired
 * entries are automatically purged by MongoDB's TTL monitor (runs every 60s).
 *
 * Collection: `llm_cache`
 * Index: `{ expires_at: 1 }` with expireAfterSeconds=0 (TTL index)
 */
export class MongoLlmCacheStore implements LlmCacheStore {
  private initialized = false

  constructor(private readonly db: Db) {}

  private async ensureIndex(): Promise<void> {
    if (this.initialized) return
    try {
      await this.db.collection('llm_cache').createIndex(
        { expires_at: 1 },
        { expireAfterSeconds: 0 },
      )
      await this.db.collection('llm_cache').createIndex(
        { tenant_id: 1, task: 1, input_hash: 1 },
        { unique: true },
      )
    } catch {
      // Index creation may fail if already exists or in test env — non-fatal
    }
    this.initialized = true
  }

  async get<T>(tenantId: string, task: string, inputHash: string): Promise<LlmCacheEntry<T> | null> {
    await this.ensureIndex()
    const doc = await this.db.collection('llm_cache').findOne({
      tenant_id: tenantId,
      task,
      input_hash: inputHash,
    })
    if (!doc) return null
    return {
      tenant_id: doc.tenant_id,
      task: doc.task,
      input_hash: doc.input_hash,
      value: doc.value as T,
      created_at: doc.created_at,
      expires_at: doc.expires_at,
    }
  }

  async set<T>(entry: LlmCacheEntry<T>): Promise<void> {
    await this.ensureIndex()
    await this.db.collection('llm_cache').replaceOne(
      { tenant_id: entry.tenant_id, task: entry.task, input_hash: entry.input_hash },
      { ...entry },
      { upsert: true },
    )
  }
}

// ── withCache wrapper ─────────────────────────────────────────────────────────

/**
 * Wrap any LlmFn with response caching. Non-breaking — the returned function
 * has the same `(system, prompt, model?) => Promise<string>` signature.
 *
 * The cache key is `hash({ system, prompt, model })` so identical prompts to
 * the same model return cached responses without hitting the provider.
 *
 * @param llm       The underlying LlmFn (e.g. createLlmRouter(...))
 * @param cache     The LlmResponseCache instance
 * @param tenantId  Tenant ID for cache isolation
 * @param task      Task name for per-task TTL config (e.g. 'scorer', 'copilot')
 * @param config    Optional per-tenant cache config
 * @returns A cached LlmFn with the same signature
 */
export function withCache(
  llm: LlmFn,
  cache: LlmResponseCache,
  tenantId: string,
  task: string,
  config?: LlmCacheConfig,
): LlmFn {
  return async function cachedLlm(system: string, prompt: string, model?: string): Promise<string> {
    const { value } = await cache.getOrCompute(
      tenantId,
      task,
      { system, prompt, model: model ?? 'default' },
      () => llm(system, prompt, model),
      config,
    )
    return value
  }
}
