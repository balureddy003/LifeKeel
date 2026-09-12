/**
 * QueueManager — lightweight Redis-backed job queue using LPUSH/BRPOP.
 * Falls back to inline execution when Redis is unavailable.
 * No bullmq dependency — uses ioredis directly (dynamic import for graceful fallback).
 */

import { createLogger } from '@agentoak/platform'

const log = createLogger({ service: 'queue-manager', version: '0.0.0' })

export interface PublishOpts {
  delay?: number
  priority?: number
}

export interface SubscribeOpts {
  concurrency?: number
}

interface QueueJob {
  id: string
  payload: unknown
  enqueuedAt: number
  priority?: number
}

type RedisClient = {
  lpush(key: string, ...values: string[]): Promise<number>
  brpop(key: string, timeout: number): Promise<[string, string] | null>
  zadd(key: string, score: number, value: string): Promise<number>
  quit(): Promise<string>
  duplicate(): RedisClient
  on(event: string, handler: (...args: unknown[]) => void): void
  connect(): Promise<void>
}

// ── Redis loader ──────────────────────────────────────────────────────────────

let redisClient: RedisClient | null = null
let redisAvailable = false
let redisLoadAttempted = false

async function loadRedis(): Promise<RedisClient | null> {
  if (redisLoadAttempted) return redisClient
  redisLoadAttempted = true

  const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379'

  try {
    // Dynamic import so the server boots even when ioredis is absent
    const mod = await import('ioredis' as string) as { default?: unknown }
    const Redis = (mod.default ?? mod) as new (url: string, opts?: Record<string, unknown>) => RedisClient

    const client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    })

    client.on('connect', () => {
      redisAvailable = true
      log.info({}, 'Redis connected')
    })
    client.on('error', (err: unknown) => {
      const e = err as Error
      if (redisAvailable) {
        log.warn({ err: e.message }, 'Redis error — falling back to inline execution')
      }
      redisAvailable = false
    })
    client.on('close', () => { redisAvailable = false })

    await client.connect()
    redisClient = client
    return client
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'ioredis not available or Redis unreachable — queue will run inline')
    return null
  }
}

// ── Inline fallback (runs handler synchronously when Redis is unavailable) ───

const inlineHandlers = new Map<string, (payload: unknown) => Promise<void>>()

// ── QueueManager ─────────────────────────────────────────────────────────────

export class QueueManager {
  private subscriptions = new Map<string, boolean>()
  private subscriberClients: RedisClient[] = []

  async connect(): Promise<void> {
    await loadRedis()
  }

  isAvailable(): boolean {
    return redisAvailable
  }

  /** Publish a job to the named queue */
  async publish(queueName: string, payload: unknown, opts?: PublishOpts): Promise<void> {
    const job: QueueJob = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      payload,
      enqueuedAt: Date.now(),
      ...(opts?.priority !== undefined ? { priority: opts.priority } : {}),
    }

    const client = redisClient
    if (!client || !redisAvailable) {
      // Inline fallback: run handler immediately if subscribed
      const handler = inlineHandlers.get(queueName)
      if (handler) {
        log.debug({ job_id: job.id, queue: queueName }, 'Inline execution')
        try {
          await handler(payload)
        } catch (err) {
          log.error({ queue: queueName, err }, 'Inline handler error')
        }
      } else {
        log.warn({ queue: queueName }, 'Redis unavailable and no inline handler — job dropped')
      }
      return
    }

    const serialized = JSON.stringify(job)

    if (opts?.delay && opts.delay > 0) {
      const score = Date.now() + opts.delay
      await client.zadd(`${queueName}:delayed`, score, serialized)
    } else {
      await client.lpush(queueName, serialized)
    }
  }

  /** Subscribe to a queue with a handler. Starts BRPOP polling loop. */
  subscribe(
    queueName: string,
    handler: (payload: unknown) => Promise<void>,
    opts?: SubscribeOpts,
  ): void {
    if (this.subscriptions.get(queueName)) return
    this.subscriptions.set(queueName, true)

    // Always register inline handler for fallback
    inlineHandlers.set(queueName, handler)

    const client = redisClient
    if (!client || !redisAvailable) {
      log.warn({ queue: queueName }, 'Redis unavailable — registered for inline execution')
      return
    }

    const concurrency = opts?.concurrency ?? 1
    for (let i = 0; i < concurrency; i++) {
      const sub = client.duplicate()
      this.subscriberClients.push(sub)
      void this.pollLoop(sub, queueName, handler)
    }

    log.info({ queue: queueName, concurrency }, 'Subscribed to queue')
  }

  private async pollLoop(
    client: RedisClient,
    queueName: string,
    handler: (payload: unknown) => Promise<void>,
  ): Promise<void> {
    while (this.subscriptions.get(queueName)) {
      try {
        const result = await client.brpop(queueName, 5)
        if (!result) continue

        const [, raw] = result
        let job: QueueJob
        try {
          job = JSON.parse(raw) as QueueJob
        } catch {
          log.error({ queue: queueName }, 'Malformed job')
          continue
        }

        try {
          await handler(job.payload)
        } catch (err) {
          log.error({ queue: queueName, job_id: job.id, err }, 'Handler error')
        }
      } catch {
        // Redis disconnected — wait and retry
        await new Promise(r => setTimeout(r, 1000))
      }
    }
  }

  /** Stop all subscriptions and close subscriber connections */
  async shutdown(): Promise<void> {
    for (const key of this.subscriptions.keys()) {
      this.subscriptions.set(key, false)
    }
    for (const sub of this.subscriberClients) {
      try { await sub.quit() } catch { /* ignore */ }
    }
    this.subscriberClients.length = 0
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const queueManager = new QueueManager()
