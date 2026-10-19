/**
 * QueueManager — QUEUE_MODE=required (intent 07).
 *
 * When Redis is down, durable publishes must refuse honestly instead of
 * silently buffering in memory (lost on crash, no durable DLQ). Only
 * explicitly inline-safe jobs proceed. Covered too: the lease-aware
 * recovery sweep that replaces the old blind reclaim — a live worker's
 * in-flight job must survive a replica's recovery pass.
 */

import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest'
import {
  QueueManager,
  QueueUnavailableError,
  recoverStrandedJobs,
  queueMode,
} from '../QueueManager.js'

// Dead port — connect() fails, so the manager takes the no-Redis path for
// the whole file.
process.env['REDIS_URL'] = 'redis://127.0.0.1:6398'

const q = (name: string) => `qm-required-${name}`

beforeAll(async () => {
  const qm = new QueueManager()
  await qm.connect()
})

afterEach(() => {
  delete process.env['QUEUE_MODE']
})

describe('QUEUE_MODE=required', () => {
  it('publish throws QueueUnavailableError when Redis is down', async () => {
    process.env['QUEUE_MODE'] = 'required'
    const qm = new QueueManager()
    await expect(qm.publish(q('durable'), { x: 1 })).rejects.toThrow(QueueUnavailableError)
  })

  it('explicitly inline-safe publishes still proceed', async () => {
    process.env['QUEUE_MODE'] = 'required'
    const qm = new QueueManager()
    const received: unknown[] = []
    qm.subscribe(q('scan'), async (p) => {
      received.push(p)
    })

    await qm.publish(q('scan'), { ok: true }, { allowInline: true })
    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 3000 })
  })

  it('auto mode keeps the inline fallback', async () => {
    process.env['QUEUE_MODE'] = 'auto'
    const qm = new QueueManager()
    const received: unknown[] = []
    qm.subscribe(q('auto'), async (p) => {
      received.push(p)
    })

    await qm.publish(q('auto'), { ok: true })
    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 3000 })
  })

  it('defaults to auto in dev deployment mode', () => {
    // Test env runs dev — no QUEUE_MODE env means the inline fallback stays.
    expect(queueMode()).toBe('auto')
  })
})

describe('recoverStrandedJobs (visibility lease)', () => {
  function mockClient(lists: Record<string, string[]>, kvs: Record<string, string>) {
    return {
      lrange: async (key: string) => [...(lists[key] ?? [])],
      lrem: async (key: string, _count: number, value: string) => {
        const list = lists[key] ?? []
        const i = list.indexOf(value)
        if (i === -1) return 0
        list.splice(i, 1)
        return 1
      },
      lpush: async (key: string, ...values: string[]) => {
        lists[key] = [...values, ...(lists[key] ?? [])]
        return lists[key]!.length
      },
      get: async (key: string) => kvs[key] ?? null,
      del: async (...keys: string[]) => {
        let n = 0
        for (const k of keys) if (delete kvs[k]) n++
        return n
      },
    }
  }

  const job = (id: string, attempts = 0) =>
    JSON.stringify({ id, payload: { p: id }, enqueuedAt: 1, attempts })

  it("leaves a live worker's job alone and reclaims only expired/missing leases", async () => {
    const processing = [job('live-job'), job('stale-job'), job('no-lease-job')]
    const lists: Record<string, string[]> = { 'q1:processing': processing }
    const kvs: Record<string, string> = {
      'lease:q1:live-job': String(Date.now() + 30_000), // still valid
      'lease:q1:stale-job': String(Date.now() - 1), // expired
      // no-lease-job: key absent — crashed between claim and lease write
    }
    const client = mockClient(lists, kvs)

    await recoverStrandedJobs(client as never, 'q1')

    // Live job untouched; stale and lease-less reclaimed to the live list.
    expect(lists['q1:processing']).toHaveLength(1)
    expect(lists['q1:processing']![0]).toContain('live-job')
    expect(lists['q1']).toHaveLength(2)
    expect(lists['q1']!.every((raw) => JSON.parse(raw).attempts === 1)).toBe(true)
    // Reclaimed leases are deleted so a later claim starts clean.
    expect(kvs['lease:q1:stale-job']).toBeUndefined()
    expect(kvs['lease:q1:live-job']).toBeDefined()
  })

  it('dead-letters a stranded job at the attempt cap', async () => {
    const lists: Record<string, string[]> = { 'q1:processing': [job('old-job', 2)] }
    const client = mockClient(lists, {})

    await recoverStrandedJobs(client as never, 'q1')

    expect(lists['q1:processing']).toHaveLength(0)
    expect(lists['q1:dead']).toHaveLength(1)
    expect(lists['q1']).toBeUndefined()
  })
})
