/**
 * QueueManager — inline-path durability.
 *
 * The Redis path is covered by ml-tenant-isolation's real-Redis tests in
 * CI. What those never exercised (and what the review flagged as job
 * loss): the inline fallback used to drop a job silently when no handler
 * was registered yet, and a handler error was a log line, not a retry.
 *
 * The suite forces inline mode by pointing REDIS_URL at a dead port before
 * the first connect() — module-level redis state is loaded once.
 */

import { describe, expect, it, beforeAll, vi } from 'vitest'
import { QueueManager } from '../QueueManager.js'

// Dead port — connect() fails, so publish/subscribe take the inline path
// for the whole file.
process.env['REDIS_URL'] = 'redis://127.0.0.1:6399'

const q = (name: string) => `qm-inline-${name}`

beforeAll(async () => {
  const qm = new QueueManager()
  await qm.connect()
})

describe('inline fallback', () => {
  it('buffers a job published before subscribe instead of dropping it', async () => {
    const qm = new QueueManager()
    const received: unknown[] = []

    await qm.publish(q('early'), { hello: 'world' })
    qm.subscribe(q('early'), async (p) => { received.push(p) })

    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 3000 })
    expect(received[0]).toEqual({ hello: 'world' })
  })

  it('retries a failing handler up to the attempt cap, then stops', async () => {
    const qm = new QueueManager()
    const calls: unknown[] = []
    qm.subscribe(q('flaky'), async (p) => {
      calls.push(p)
      throw new Error('boom')
    })

    await qm.publish(q('flaky'), { x: 1 })
    // attempts 1→3: initial, +500ms, +1000ms backoff
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(3), { timeout: 5000 })
    // Give a would-be 4th attempt time to fire — it must not exist.
    await new Promise(r => setTimeout(r, 1600))
    expect(calls).toHaveLength(3)
  })

  it('delivers immediately when a handler is already subscribed', async () => {
    const qm = new QueueManager()
    const received: unknown[] = []
    qm.subscribe(q('ready'), async (p) => { received.push(p) })

    await qm.publish(q('ready'), { a: 1 })
    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 3000 })
  })
})
