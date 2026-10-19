/**
 * QueueManager — lightweight Redis-backed job queue.
 * Falls back to inline execution when Redis is unavailable.
 * No bullmq dependency — uses ioredis directly (dynamic import for graceful fallback).
 *
 * Delivery semantics (what changed and why):
 *  - BRPOPLPUSH moves a job into `${queue}:processing` before the handler
 *    runs — a crash mid-handler leaves the job visible, not lost. On
 *    subscribe, any leftovers in the processing list are recovered
 *    (re-queued with attempts+1, or dead-lettered past MAX_ATTEMPTS).
 *  - Handler failure no longer drops the job: it is re-queued with
 *    attempts+1 up to MAX_ATTEMPTS, then pushed to `${queue}:dead` —
 *    a durable failure list an operator can inspect, not a silent log line.
 *  - `publish(queue, payload, { delay })` writes to a `${queue}:delayed`
 *    zset; a per-manager mover timer promotes due entries to the live
 *    list. Previously delayed jobs were written and never delivered.
 *  - Inline fallback (no Redis): publish-before-subscribe buffers in
 *    memory instead of dropping; handler failure retries inline with
 *    the same attempt cap.
 *
 * Exactly-once is NOT claimed: a handler that crashes after producing an
 * external side effect can run again on recovery. Handlers must be
 * idempotent (webhook ingest is, via signal/insight dedupe).
 */

import { createLogger } from '@lifekeel/platform'
import { deploymentConfig } from '../config/deployment.js'

const log = createLogger({ service: 'queue-manager', version: '0.0.0' })

const MAX_ATTEMPTS = 3
const DELAYED_POLL_MS = 1000
const INLINE_RETRY_MS = 500
// Visibility lease on :processing entries — a worker crash leaves a job
// reclaimable only after its lease expires, and a live worker's long job
// can't be double-claimed by a replica's recovery sweep.
const LEASE_TTL_MS = 60_000
const LEASE_RENEW_MS = 20_000
const RECOVERY_POLL_MS = 30_000

export class QueueUnavailableError extends Error {
  constructor(queueName: string) {
    super(`Queue '${queueName}' requires Redis (QUEUE_MODE=required) and Redis is unavailable`)
    this.name = 'QueueUnavailableError'
  }
}

/**
 * QUEUE_MODE env: 'auto' (Redis down → inline fallback) or 'required'
 * (Redis down → durable publishes refuse honestly). Default follows the
 * deployment mode: cloud/accountant get 'required' — an in-memory fallback
 * there is a silent job-loss machine; dev and airgap legitimately run
 * without Redis.
 */
export function queueMode(): 'auto' | 'required' {
  const v = (process.env['QUEUE_MODE'] ?? '').toLowerCase()
  if (v === 'required') return 'required'
  if (v === 'auto' || v === 'inline') return 'auto'
  return deploymentConfig.mode === 'dev' || deploymentConfig.mode === 'airgap' ? 'auto' : 'required'
}

export interface PublishOpts {
  delay?: number
  priority?: number
  /**
   * In QUEUE_MODE=required, publishing while Redis is down throws
   * QueueUnavailableError — unless the job is explicitly marked
   * inline-safe: re-runnable and idempotent, so losing it on a crash is
   * acceptable (e.g. the email-scan fan-out — a missed scan re-triggers).
   */
  allowInline?: boolean
}

export interface SubscribeOpts {
  concurrency?: number
}

interface QueueJob {
  id: string
  payload: unknown
  enqueuedAt: number
  priority?: number
  attempts?: number
}

export type RedisClient = {
  lpush(key: string, ...values: string[]): Promise<number>
  llen(key: string): Promise<number>
  brpop(key: string, timeout: number): Promise<[string, string] | null>
  brpoplpush(source: string, dest: string, timeout: number): Promise<string | null>
  lrem(key: string, count: number, value: string): Promise<number>
  lrange(key: string, start: number, stop: number): Promise<string[]>
  zadd(key: string, score: number, value: string): Promise<number>
  zcard(key: string): Promise<number>
  zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    ...rest: string[]
  ): Promise<string[]>
  zrem(key: string, ...values: string[]): Promise<number>
  set(key: string, value: string, ...args: string[]): Promise<string | null>
  get(key: string): Promise<string | null>
  del(...keys: string[]): Promise<number>
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
    const mod = (await import('ioredis' as string)) as { default?: unknown }
    const Redis = (mod.default ?? mod) as new (
      url: string,
      opts?: Record<string, unknown>,
    ) => RedisClient

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
    client.on('close', () => {
      redisAvailable = false
    })

    await client.connect()
    redisClient = client
    return client
  } catch (err) {
    log.warn(
      { err: (err as Error).message },
      'ioredis not available or Redis unreachable — queue will run inline',
    )
    return null
  }
}

// ── Inline fallback (runs handler synchronously when Redis is unavailable) ───

const inlineHandlers = new Map<string, (payload: unknown) => Promise<void>>()
const pendingInline = new Map<string, QueueJob[]>()

// ── QueueManager ─────────────────────────────────────────────────────────────

export class QueueManager {
  private subscriptions = new Map<string, boolean>()
  private subscriberClients: RedisClient[] = []
  private delayedTimer: ReturnType<typeof setInterval> | null = null
  private recoveryTimer: ReturnType<typeof setInterval> | null = null

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
      attempts: 0,
      ...(opts?.priority !== undefined ? { priority: opts.priority } : {}),
    }

    const client = redisClient
    if (!client || !redisAvailable) {
      if (queueMode() === 'required' && opts?.allowInline !== true) {
        throw new QueueUnavailableError(queueName)
      }
      this.publishInline(queueName, job)
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

    // Always register inline handler for fallback, then flush anything that
    // was published while Redis was down (or before this subscribe ran).
    inlineHandlers.set(queueName, handler)
    const buffered = pendingInline.get(queueName)
    if (buffered && buffered.length > 0) {
      pendingInline.delete(queueName)
      for (const job of buffered) this.runInline(queueName, job)
    }

    const client = redisClient
    if (!client || !redisAvailable) {
      log.warn({ queue: queueName }, 'Redis unavailable — registered for inline execution')
      return
    }

    // Recover jobs a previous process left in :processing (crash
    // mid-handler), then keep sweeping — a crash later in this process's
    // lifetime should not need a subscribe() to be noticed.
    void this.recoverProcessing(client, queueName)
    this.startDelayedMover(client)
    this.startRecoverySweeper(client)

    const concurrency = opts?.concurrency ?? 1
    for (let i = 0; i < concurrency; i++) {
      const sub = client.duplicate()
      this.subscriberClients.push(sub)
      void this.pollLoop(sub, queueName, handler)
    }

    log.info({ queue: queueName }, 'Subscribed to queue')
  }

  private async recoverProcessing(client: RedisClient, queueName: string): Promise<void> {
    try {
      await recoverStrandedJobs(client, queueName)
    } catch (err) {
      log.warn({ queue: queueName, err }, 'Processing-list recovery failed')
    }
  }

  /** Periodic lease-aware sweep so a mid-life worker crash is recovered
   *  without waiting for a subscribe/restart. */
  private startRecoverySweeper(client: RedisClient): void {
    if (this.recoveryTimer) return
    this.recoveryTimer = setInterval(() => {
      for (const queueName of this.subscriptions.keys()) {
        if (this.subscriptions.get(queueName)) void this.recoverProcessing(client, queueName)
      }
    }, RECOVERY_POLL_MS)
    this.recoveryTimer.unref()
  }

  /** Promote due entries from `${queue}:delayed` zsets to their live lists. */
  private startDelayedMover(client: RedisClient): void {
    if (this.delayedTimer) return
    this.delayedTimer = setInterval(() => {
      void (async () => {
        for (const queueName of this.subscriptions.keys()) {
          if (!this.subscriptions.get(queueName)) continue
          const delayedKey = `${queueName}:delayed`
          try {
            const due = await client.zrangebyscore(delayedKey, 0, Date.now(), 'LIMIT', '0', '100')
            for (const raw of due) {
              // zrem is the claim — only the mover that removed the entry
              // pushes it, so parallel replicas can't double-promote.
              if ((await client.zrem(delayedKey, raw)) === 1) {
                await client.lpush(queueName, raw)
              }
            }
          } catch {
            // Redis hiccup — next tick retries
          }
        }
      })()
    }, DELAYED_POLL_MS)
    this.delayedTimer.unref()
  }

  private async pollLoop(
    client: RedisClient,
    queueName: string,
    handler: (payload: unknown) => Promise<void>,
  ): Promise<void> {
    const processingKey = `${queueName}:processing`
    while (this.subscriptions.get(queueName)) {
      try {
        const raw = await client.brpoplpush(queueName, processingKey, 5)
        if (!raw) continue

        let job: QueueJob
        try {
          job = JSON.parse(raw) as QueueJob
        } catch {
          await client.lrem(processingKey, 1, raw)
          log.error({ queue: queueName }, 'Malformed job')
          continue
        }

        // Visibility lease: recovery leaves this entry alone while a live
        // worker renews it. The key value is the expiry timestamp (a plain
        // TTL would make "expired" and "finished cleanly" indistinguishable
        // to the sweeper). XX on renewal so a deleted lease isn't resurrected.
        const leaseKey = `lease:${queueName}:${job.id}`
        await client
          .set(leaseKey, String(Date.now() + LEASE_TTL_MS), 'PX', String(LEASE_TTL_MS * 10))
          .catch(() => {})
        const renew = setInterval(() => {
          client
            .set(leaseKey, String(Date.now() + LEASE_TTL_MS), 'XX', 'PX', String(LEASE_TTL_MS * 10))
            .catch(() => {})
        }, LEASE_RENEW_MS)
        renew.unref()

        try {
          await handler(job.payload)
          await client.lrem(processingKey, 1, raw)
        } catch (err) {
          await client.lrem(processingKey, 1, raw)
          const attempts = (job.attempts ?? 0) + 1
          if (attempts >= MAX_ATTEMPTS) {
            await client.lpush(`${queueName}:dead`, raw)
            log.error(
              { queue: queueName, job_id: job.id, attempts, err },
              'Job dead-lettered after max attempts',
            )
          } else {
            job.attempts = attempts
            await client.lpush(queueName, JSON.stringify(job))
            log.warn(
              { queue: queueName, job_id: job.id, attempts, err },
              'Handler error — job re-queued',
            )
          }
        } finally {
          clearInterval(renew)
          await client.del(leaseKey).catch(() => 0)
        }
      } catch {
        // Redis disconnected — wait and retry
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
  }

  // ── Inline path (no Redis) ──────────────────────────────────────────────────

  private publishInline(queueName: string, job: QueueJob): void {
    const handler = inlineHandlers.get(queueName)
    if (!handler) {
      // Buffer rather than drop — a later subscribe() drains these.
      const list = pendingInline.get(queueName) ?? []
      list.push(job)
      pendingInline.set(queueName, list)
      log.warn({ queue: queueName, job_id: job.id }, 'No inline handler yet — job buffered')
      return
    }
    this.runInline(queueName, job)
  }

  private runInline(queueName: string, job: QueueJob): void {
    const handler = inlineHandlers.get(queueName)
    if (!handler) return
    log.debug({ job_id: job.id, queue: queueName }, 'Inline execution')
    void (async () => {
      try {
        await handler(job.payload)
      } catch (err) {
        const attempts = (job.attempts ?? 0) + 1
        if (attempts >= MAX_ATTEMPTS) {
          log.error(
            { queue: queueName, job_id: job.id, attempts, err },
            'Inline job failed permanently',
          )
          return
        }
        job.attempts = attempts
        log.warn(
          { queue: queueName, job_id: job.id, attempts, err },
          'Inline handler error — retrying',
        )
        const timer = setTimeout(() => this.runInline(queueName, job), INLINE_RETRY_MS * attempts)
        timer.unref()
      }
    })()
  }

  /**
   * Read-only queue introspection for the operator console — depth,
   * in-flight count, delayed count, and a bounded sample of dead-lettered
   * jobs. Returns null when Redis is unavailable (inline mode leaves no
   * durable queue state to inspect).
   */
  async inspect(queueName: string): Promise<{
    pending: number
    processing: number
    delayed: number
    dead: number
    dead_jobs: Array<{ id: string; attempts?: number; enqueuedAt: number }>
  } | null> {
    const client = redisClient
    if (!client || !redisAvailable) return null
    try {
      const [pending, processing, delayed, dead, deadRaw] = await Promise.all([
        client.llen(queueName),
        client.llen(`${queueName}:processing`),
        client.zcard(`${queueName}:delayed`),
        client.llen(`${queueName}:dead`),
        client.lrange(`${queueName}:dead`, 0, 19),
      ])
      const dead_jobs = deadRaw.map((raw) => {
        try {
          const job = JSON.parse(raw) as QueueJob
          return { id: job.id, attempts: job.attempts, enqueuedAt: job.enqueuedAt }
        } catch {
          return { id: 'malformed', enqueuedAt: 0 }
        }
      })
      return { pending, processing, delayed, dead, dead_jobs }
    } catch (err) {
      log.warn({ queue: queueName, err }, 'Queue inspect failed')
      return null
    }
  }

  /**
   * Operator-initiated retry of a dead-lettered job: removes it from
   * `${queue}:dead` and pushes it back to the live list with attempts
   * reset to 0. Returns false when the job isn't found or Redis is down.
   */
  async requeueDead(queueName: string, jobId: string): Promise<boolean> {
    const client = redisClient
    if (!client || !redisAvailable) return false
    return requeueDeadJob(client, queueName, jobId)
  }

  /** Stop all subscriptions and close subscriber connections */
  async shutdown(): Promise<void> {
    for (const key of this.subscriptions.keys()) {
      this.subscriptions.set(key, false)
    }
    if (this.delayedTimer) {
      clearInterval(this.delayedTimer)
      this.delayedTimer = null
    }
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer)
      this.recoveryTimer = null
    }
    for (const sub of this.subscriberClients) {
      try {
        // quit() on a half-dead connection can wait on a socket timeout —
        // bound it so shutdown always completes.
        await Promise.race([sub.quit(), new Promise((r) => setTimeout(r, 3000))])
      } catch {
        /* ignore */
      }
    }
    this.subscriberClients.length = 0
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const queueManager = new QueueManager()

/**
 * Lease-aware stranded-job recovery, exported separately so it can be
 * unit-tested with a mock client. A processing entry is reclaimed only
 * when its visibility lease is missing or expired — a live worker's job
 * is left alone. The lrem-by-value claim is atomic, so parallel sweepers
 * can't double-recover the same entry.
 */
export async function recoverStrandedJobs(
  client: RedisClient,
  queueName: string,
  now = Date.now(),
): Promise<void> {
  const processingKey = `${queueName}:processing`
  const stranded = await client.lrange(processingKey, 0, -1)
  for (const raw of stranded) {
    let job: QueueJob | null = null
    try {
      job = JSON.parse(raw) as QueueJob
    } catch {
      /* fallthrough */
    }
    const leaseKey = job === null ? null : `lease:${queueName}:${job.id}`
    if (leaseKey) {
      const leaseUntil = Number((await client.get(leaseKey)) ?? 0)
      if (leaseUntil > now) continue // a live worker still holds this job
    }
    const removed = await client.lrem(processingKey, 1, raw)
    if (removed !== 1) continue // another recoverer claimed it
    if (leaseKey) await client.del(leaseKey).catch(() => 0)
    if (job === null) {
      log.error({ queue: queueName }, 'Dropping malformed stranded job')
      continue
    }
    const attempts = (job.attempts ?? 0) + 1
    if (attempts >= MAX_ATTEMPTS) {
      await client.lpush(`${queueName}:dead`, raw)
      log.error({ queue: queueName, job_id: job.id, attempts }, 'Stranded job dead-lettered')
    } else {
      job.attempts = attempts
      await client.lpush(queueName, JSON.stringify(job))
      log.warn({ queue: queueName, job_id: job.id, attempts }, 'Recovered stranded job')
    }
  }
}

/**
 * Pure requeue operation, exported separately so it can be unit-tested
 * with a mock client. The lrem-by-value claim means only one caller can
 * move a given dead entry — safe under concurrent operators.
 */
export async function requeueDeadJob(
  client: RedisClient,
  queueName: string,
  jobId: string,
): Promise<boolean> {
  const deadKey = `${queueName}:dead`
  const entries = await client.lrange(deadKey, 0, -1)
  for (const raw of entries) {
    let job: QueueJob
    try {
      job = JSON.parse(raw) as QueueJob
    } catch {
      continue
    }
    if (job.id !== jobId) continue
    if ((await client.lrem(deadKey, 1, raw)) !== 1) return false // another operator claimed it
    job.attempts = 0
    await client.lpush(queueName, JSON.stringify(job))
    return true
  }
  return false
}
