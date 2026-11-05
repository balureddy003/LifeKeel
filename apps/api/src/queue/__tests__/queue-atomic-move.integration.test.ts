/**
 * Review F05 against a real Redis: every queue transfer is one atomic
 * script, so concurrent movers produce exactly one copy and a job is never
 * in neither place. CI provides Redis; the suite skips when none is
 * reachable locally.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { moveJob, recoverStrandedJobs, requeueDeadJob, type RedisClient } from '../QueueManager.js'

const URL = 'redis://localhost:6379'
let client: RedisClient | null = null

beforeAll(async () => {
  try {
    const mod = (await import('ioredis' as string)) as {
      default: new (u: string, o: object) => RedisClient
    }
    const c = new mod.default(URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
    })
    c.on('error', () => {})
    await c.connect()
    client = c
  } catch {
    client = null
  }
})

afterAll(async () => {
  await client?.quit()
})

const q = `qm-atomic-${process.pid}-${Date.now()}`
const job = (id: string, attempts = 0) =>
  JSON.stringify({ id, payload: {}, enqueuedAt: 1, attempts })

describe('atomic queue transfers (real Redis)', () => {
  it('concurrent movers of the same entry produce exactly one copy', async (ctx) => {
    if (!client) return ctx.skip()
    const c = client
    const raw = job('a')
    await c.lpush(`${q}:dead`, raw)
    const results = await Promise.all(
      Array.from({ length: 8 }, () => moveJob(c, `${q}:dead`, q, raw)),
    )
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await c.llen(q)).toBe(1)
    expect(await c.llen(`${q}:dead`)).toBe(0)
    await c.del(q, `${q}:dead`)
  })

  it('promotes a delayed zset entry exactly once', async (ctx) => {
    if (!client) return ctx.skip()
    const c = client
    const raw = job('d')
    await c.zadd(`${q}:delayed`, 1, raw)
    const results = await Promise.all([
      moveJob(c, `${q}:delayed`, q, raw, raw, 'zset'),
      moveJob(c, `${q}:delayed`, q, raw, raw, 'zset'),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await c.lrange(q, 0, -1)).toEqual([raw])
    expect(await c.zcard(`${q}:delayed`)).toBe(0)
    await c.del(q, `${q}:delayed`)
  })

  it('parallel recovery sweeps requeue a stranded job once, with attempts+1', async (ctx) => {
    if (!client) return ctx.skip()
    const c = client
    await c.lpush(`${q}:processing`, job('s', 1))
    await Promise.all([recoverStrandedJobs(c, q), recoverStrandedJobs(c, q)])
    const live = await c.lrange(q, 0, -1)
    expect(live).toHaveLength(1)
    expect(JSON.parse(live[0]!).attempts).toBe(2)
    expect(await c.llen(`${q}:processing`)).toBe(0)
    await c.del(q)
  })

  it('dead-letter replay resets attempts and moves once', async (ctx) => {
    if (!client) return ctx.skip()
    const c = client
    await c.lpush(`${q}:dead`, job('r', 3))
    const [first, second] = await Promise.all([
      requeueDeadJob(c, q, 'r'),
      requeueDeadJob(c, q, 'r'),
    ])
    expect([first, second].filter(Boolean)).toHaveLength(1)
    const live = await c.lrange(q, 0, -1)
    expect(live).toHaveLength(1)
    expect(JSON.parse(live[0]!).attempts).toBe(0)
    await c.del(q, `${q}:dead`)
  })
})
