/**
 * Redis Cache Client with TTL Management
 * 
 * Provides a wrapper around Redis with automatic TTL policies
 * and cache invalidation support.
 */

import { createClient } from 'redis'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'redis-cache', version: '0.0.0' })

export interface CacheConfig {
  url?: string
  password?: string
  ttl?: Record<string, number> // TTL policies per data type
}

export interface CacheEntry<T> {
  value: T
  expiresAt: number
}

export class RedisCache {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any
  private defaultTTL: Record<string, number> = {
    'goal': 300, // 5 minutes
    'kpi_snapshot': 60, // 1 minute
    'detector': 600, // 10 minutes
    'calibration': 1800, // 30 minutes
    'default': 300, // 5 minutes
  }

  constructor(config: CacheConfig = {}) {
    const clientConfig: {
      url: string
      password?: string
    } = {
      url: config.url || process.env.REDIS_URL || 'redis://localhost:6379',
    }
    
    const password = config.password || process.env.REDIS_PASSWORD
    if (password) {
      clientConfig.password = password
    }
    
    this.client = createClient(clientConfig)

    if (config.ttl) {
      this.defaultTTL = { ...this.defaultTTL, ...config.ttl }
    }

    this.client.on('error', (err: Error) => {
      log.error({ err }, 'Redis Client Error')
    })
  }

  async connect(): Promise<void> {
    await this.client.connect()
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect()
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.client.get(key)
      if (!data) return null
      return JSON.parse(data) as T
    } catch (err) {
      log.error({ err }, 'Cache get error')
      return null
    }
  }

  /**
   * Set a value in cache with automatic TTL
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const ttlSeconds = ttl ?? this.getTTL(key)
      await this.client.setEx(key, ttlSeconds, JSON.stringify(value))
    } catch (err) {
      log.error({ err }, 'Cache set error')
    }
  }

  /**
   * Delete a value from cache
   */
  async delete(key: string): Promise<void> {
    try {
      await this.client.del(key)
    } catch (err) {
      log.error({ err }, 'Cache delete error')
    }
  }

  /**
   * Delete multiple keys matching a pattern
   */
  async deletePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.client.keys(pattern)
      if (keys.length > 0) {
        await this.client.del(keys)
      }
    } catch (err) {
      log.error({ err }, 'Cache delete pattern error')
    }
  }

  /**
   * Get TTL for a key based on its type
   */
  private getTTL(key: string): number {
    for (const [type, ttl] of Object.entries(this.defaultTTL)) {
      if (key.includes(type)) return ttl
    }
    return this.defaultTTL.default ?? 300
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    hitRate: number
    missRate: number
    memoryUsage: number
    keyCount: number
  }> {
    try {
      const info = await this.client.info('stats')
      const memory = await this.client.info('memory')
      const dbsize = await this.client.dbSize()

      // Parse info string to extract stats
      const keyspaceHits = this.parseInfo(info, 'keyspace_hits')
      const keyspaceMisses = this.parseInfo(info, 'keyspace_misses')
      const usedMemory = this.parseInfo(memory, 'used_memory')

      const total = keyspaceHits + keyspaceMisses
      const hitRate = total > 0 ? keyspaceHits / total : 0
      const missRate = total > 0 ? keyspaceMisses / total : 0

      return {
        hitRate,
        missRate,
        memoryUsage: usedMemory,
        keyCount: dbsize,
      }
    } catch (err) {
      log.error({ err }, 'Cache stats error')
      return {
        hitRate: 0,
        missRate: 0,
        memoryUsage: 0,
        keyCount: 0,
      }
    }
  }

  private parseInfo(info: string, key: string): number {
    const match = info.match(new RegExp(`${key}:(\\d+)`))
    return match ? parseInt(match[1]!, 10) : 0
  }

  /**
   * Warm cache with frequently accessed data
   */
  async warmCache(keys: Array<{ key: string; value: unknown }>): Promise<void> {
    const pipeline = this.client.multi()
    for (const { key, value } of keys) {
      const ttl = this.getTTL(key)
      pipeline.setEx(key, ttl, JSON.stringify(value))
    }
    await pipeline.exec()
  }
}

// Export singleton instance
let cacheInstance: RedisCache | null = null

export function getCache(): RedisCache {
  if (!cacheInstance) {
    cacheInstance = new RedisCache()
    cacheInstance.connect().catch(err => {
      log.error({ err }, 'Failed to connect to Redis')
    })
  }
  return cacheInstance
}

export async function closeCache(): Promise<void> {
  if (cacheInstance) {
    await cacheInstance.disconnect()
    cacheInstance = null
  }
}
