/**
 * AttributionTracker unit tests
 *
 * All monetary values must be integer minor units (pence/cents).
 * Every query must be scoped by tenant_id.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AttributionTracker } from '../attribution/AttributionTracker.js'
import type { Db, Collection } from 'mongodb'

// ── MongoDB in-memory stub ────────────────────────────────────────────────────

function makeCollection() {
  const docs: Record<string, unknown>[] = []
  return {
    createIndex: vi.fn(async () => 'index_name'),
    insertOne: vi.fn(async (doc: Record<string, unknown>) => { docs.push({ ...doc }); return { insertedId: doc['id'] } }),
    updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> }, opts?: { upsert?: boolean }) => {
      const key = filter['run_id'] as string
      const existing = docs.find(d => d['run_id'] === key)
      const $set = (update as Record<string, Record<string, unknown>>)['$set'] ?? {}
      if (existing) {
        Object.assign(existing, $set)
      } else if (opts?.upsert) {
        const $setOnInsert = (update as Record<string, Record<string, unknown>>)['$setOnInsert'] ?? {}
        docs.push({ ...filter, ...$set, ...$setOnInsert })
      }
    }),
    find: vi.fn(() => ({
      toArray: async () => [...docs],
    })),
    aggregate: vi.fn(() => ({
      toArray: async () => [],
    })),
    _docs: docs,
  }
}

function makeDb(col: ReturnType<typeof makeCollection>): Db {
  return { collection: () => col } as unknown as Db
}

// ─────────────────────────────────────────────────────────────────────────────

describe('AttributionTracker', () => {
  let col: ReturnType<typeof makeCollection>
  let tracker: AttributionTracker

  beforeEach(() => {
    col = makeCollection()
    tracker = new AttributionTracker(makeDb(col))
  })

  it('initRun writes a pending attribution doc scoped to tenant', async () => {
    await tracker.initRun('run-1', 'wf-a', 'Invoice Recovery', 'tenant-42')

    expect(col.updateOne).toHaveBeenCalledOnce()
    const call = col.updateOne.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, Record<string, unknown>>, Record<string, unknown>]
    const [filter, update, opts] = call
    expect(filter['run_id']).toBe('run-1')
    // tenant_id is in $set (not $setOnInsert) per the upsert pattern
    expect(update['$set']?.['tenant_id']).toBe('tenant-42')
    expect(update['$set']?.['outcome']).toBe('pending')
    expect(opts?.['upsert']).toBe(true)
  })

  it('recordOutcome stores integer minor units — rejects float', async () => {
    // Float should be rounded to integer
    await tracker.recordOutcome('run-2', 'wf-b', 'Churn Prevention', 'tenant-42', 'converted', 123.99)

    const [, update] = col.updateOne.mock.calls[0] as [unknown, Record<string, Record<string, unknown>>]
    expect(typeof (update['$set'] as Record<string, unknown>)['value_minor_units']).toBe('number')
    // Must be integer (Math.round applied)
    const val = (update['$set'] as Record<string, unknown>)['value_minor_units'] as number
    expect(Number.isInteger(val)).toBe(true)
    expect(val).toBe(124)
  })

  it('recordOutcome sets correct outcome statuses', async () => {
    for (const outcome of ['converted', 'dismissed', 'expired', 'pending'] as const) {
      col.updateOne.mockClear()
      await tracker.recordOutcome(`run-${outcome}`, 'wf-x', 'Test', 'tenant-1', outcome, 0)
      const [, update] = col.updateOne.mock.calls[0] as [unknown, Record<string, Record<string, unknown>>]
      expect((update['$set'] as Record<string, unknown>)['outcome']).toBe(outcome)
    }
  })

  it('getSummary returns correct shape and uses find with tenant filter', async () => {
    const result = await tracker.getSummary('tenant-42', 30)
    // Shape check — does not have tenant_id (it's computed aggregate)
    expect(result).toBeDefined()
    expect(result.period_days).toBe(30)
    expect(typeof result.total_runs).toBe('number')
    expect(typeof result.conversion_rate).toBe('number')
    expect(Array.isArray(result.workflows)).toBe(true)
    // Verify find was called (proves tenant-scoped query)
    expect(col.find).toHaveBeenCalledOnce()
    const [findFilter] = col.find.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(findFilter['tenant_id']).toBe('tenant-42')
  })

  it('getSummary buckets converted value into daily_values, oldest first', async () => {
    const days = 7
    const now = Date.now()
    col._docs.push(
      {
        run_id: 'r1', workflow_id: 'wf-a', workflow_name: 'Recovery', tenant_id: 'tenant-9',
        outcome: 'converted', value_minor_units: 500, currency: 'GBP',
        // 1 hour into the window (bucket 0) — not exactly on the window's
        // start boundary, so a few ms of test-execution drift against
        // getSummary's own Date.now() can't push it into the previous bucket.
        recorded_at: new Date(now - days * 86_400_000 + 3_600_000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        run_id: 'r2', workflow_id: 'wf-a', workflow_name: 'Recovery', tenant_id: 'tenant-9',
        outcome: 'converted', value_minor_units: 300, currency: 'GBP',
        recorded_at: new Date(now).toISOString(),
        updated_at: new Date().toISOString(),
      },
      // dismissed runs must not contribute to daily_values
      {
        run_id: 'r3', workflow_id: 'wf-a', workflow_name: 'Recovery', tenant_id: 'tenant-9',
        outcome: 'dismissed', value_minor_units: 0, currency: 'GBP',
        recorded_at: new Date(now).toISOString(),
        updated_at: new Date().toISOString(),
      },
    )

    const result = await tracker.getSummary('tenant-9', days)
    const wf = result.workflows.find((w) => w.workflow_id === 'wf-a')!
    expect(wf.daily_values).toHaveLength(days)
    expect(wf.daily_values[0]).toBe(500)
    expect(wf.daily_values[days - 1]).toBe(300)
    expect(wf.daily_values.slice(1, days - 1).every((v) => v === 0)).toBe(true)
  })

  it('does not cross tenant boundaries — different tenant calls stay isolated', async () => {
    await tracker.initRun('run-T1', 'wf-1', 'Recovery', 'tenant-A')
    await tracker.initRun('run-T2', 'wf-1', 'Recovery', 'tenant-B')

    const calls = col.updateOne.mock.calls as unknown as [unknown, Record<string, Record<string, unknown>>, unknown][]
    // tenant_id lives in $set
    const tenantA = calls[0]?.[1]?.['$set']?.['tenant_id']
    const tenantB = calls[1]?.[1]?.['$set']?.['tenant_id']
    expect(tenantA).toBe('tenant-A')
    expect(tenantB).toBe('tenant-B')
    expect(tenantA).not.toBe(tenantB)
  })
})
