import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from 'mongodb'
import { watchEngineMetrics } from '../engine-metrics-watch.js'

const sendOpsAlert = vi.fn()
vi.mock('../../operator/ops-alerts.js', () => ({
  sendOpsAlert: (...args: unknown[]) => sendOpsAlert(...args),
}))

/** Minimal in-memory stand-in for the two aggregations the watch runs. */
function fakeDb(rows: { event: string; at: Date }[]): Db {
  const col = {
    aggregate: (pipeline: Record<string, unknown>[]) => {
      const match = (
        pipeline[0] as {
          $match: {
            event?: { $in: string[] }
            at?: { $gte?: Date; $lt?: Date }
          }
        }
      ).$match
      const filtered = rows.filter(
        (r) =>
          (!match.event || match.event.$in.includes(r.event)) &&
          (!match.at ||
            ((!match.at.$gte || r.at >= match.at.$gte) && (!match.at.$lt || r.at < match.at.$lt))),
      )
      const counts = new Map<string, number>()
      for (const r of filtered) counts.set(r.event, (counts.get(r.event) ?? 0) + 1)
      return {
        toArray: async () => [...counts.entries()].map(([event, count]) => ({ _id: event, count })),
      }
    },
  }
  return { collection: () => col } as unknown as Db
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)
const NOW = new Date()

function seed(current: number, prior: number) {
  const rows: { event: string; at: Date }[] = []
  // enough suggestions to clear the volume floor in both windows
  for (let i = 0; i < 30; i++) rows.push({ event: 'extraction_suggested', at: daysAgo(1) })
  for (let i = 0; i < 30; i++) rows.push({ event: 'extraction_suggested', at: daysAgo(10) })
  for (let i = 0; i < current; i++) rows.push({ event: 'extraction_check_failed', at: daysAgo(1) })
  for (let i = 0; i < prior; i++) rows.push({ event: 'extraction_check_failed', at: daysAgo(10) })
  return fakeDb(rows)
}

describe('watchEngineMetrics (intent 97, slice 9)', () => {
  beforeEach(() => sendOpsAlert.mockClear())

  it('alerts when the check-failure rate doubles week over week', async () => {
    // prior 1/30 ≈ 3.3%, current 10/30 ≈ 33% — well over 2×.
    await watchEngineMetrics(seed(10, 1), NOW)
    expect(sendOpsAlert).toHaveBeenCalledTimes(1)
    const alert = sendOpsAlert.mock.calls[0]![0] as {
      severity: string
      fingerprint?: string
      message: string
    }
    expect(alert.severity).toBe('warning')
    expect(alert.fingerprint).toContain('engine-metrics')
    expect(alert.message).not.toMatch(/tenant/)
  })

  it('stays quiet when the rate is flat', async () => {
    await watchEngineMetrics(seed(1, 1), NOW)
    expect(sendOpsAlert).not.toHaveBeenCalled()
  })

  it('stays quiet below the volume floors', async () => {
    // 2 failures but only a handful of suggestions — noise, not signal.
    const rows = [
      ...Array.from({ length: 5 }, () => ({
        event: 'extraction_suggested',
        at: daysAgo(1),
      })),
      ...Array.from({ length: 5 }, () => ({
        event: 'extraction_suggested',
        at: daysAgo(10),
      })),
      ...Array.from({ length: 4 }, () => ({
        event: 'extraction_check_failed',
        at: daysAgo(1),
      })),
    ]
    await watchEngineMetrics(fakeDb(rows), NOW)
    expect(sendOpsAlert).not.toHaveBeenCalled()
  })

  it('stays quiet when there is no prior baseline', async () => {
    const rows = Array.from({ length: 40 }, () => ({
      event: 'extraction_check_failed',
      at: daysAgo(1),
    }))
    await watchEngineMetrics(fakeDb(rows), NOW)
    expect(sendOpsAlert).not.toHaveBeenCalled()
  })
})
