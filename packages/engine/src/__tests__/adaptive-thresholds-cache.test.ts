/**
 * AdaptiveThresholdStore — in-memory cache + invalidation tests.
 *
 * Verifies the P1 cost optimisation: buildContextMap caches its result
 * so the hottest API path (event evaluation) doesn't hit MongoDB on
 * every call. Cache is invalidated on recompute() and via invalidateCache().
 *
 * All tests use in-memory stubs — no MongoDB required.
 */

import { describe, it, expect, vi } from 'vitest'
import { AdaptiveThresholdStore } from '../adaptive-thresholds.js'

// ── Minimal MongoDB collection stub ──────────────────────────────────────────

function makeDb() {
  const thresholdStore = new Map<string, unknown>()
  const signalDocs: Record<string, unknown>[] = []
  let findCallCount = 0

  const thresholdCol = {
    createIndex: () => Promise.resolve(),
    replaceOne: (filter: unknown, doc: unknown) => {
      const key = JSON.stringify(filter)
      thresholdStore.set(key, doc)
      return Promise.resolve()
    },
    findOne: (filter: unknown) => {
      const key = JSON.stringify(filter)
      return Promise.resolve(thresholdStore.get(key) ?? null)
    },
    find: () => {
      findCallCount++
      return { toArray: () => Promise.resolve([...thresholdStore.values()]) }
    },
  }

  const signalCol = {
    distinct: () => Promise.resolve(['tenant-a']),
    aggregate: () => ({
      toArray: async () => [{
        _id: null,
        mean: 100,
        std: 20,
        count: 50,
        values: [100],
        p25: 80, p50: 100, p75: 120, p90: 140,
      }],
    }),
  }

  const smootherCol = {
    createIndex: () => Promise.resolve(),
    findOne: () => Promise.resolve(null),
    replaceOne: () => Promise.resolve(),
    updateOne: () => Promise.resolve(),
  }

  const db = {
    collection: (name: string) => {
      if (name === 'adaptive_thresholds') return thresholdCol
      if (name === 'signals') return signalCol
      if (name === 'exp_smoother_states') return smootherCol
      throw new Error(`unknown collection: ${name}`)
    },
  }

  return { db, findCallCount: () => findCallCount, thresholdStore }
}

describe('AdaptiveThresholdStore cache (P1)', () => {
  it('caches buildContextMap results — second call does not hit MongoDB', async () => {
    const { db, findCallCount } = makeDb()
    const store = new AdaptiveThresholdStore(db)

    // Prime the cache by inserting a threshold doc directly
    await store.recompute('tenant-a', 'invoice_overdue', 'amount_minor')

    const callsBefore = findCallCount()
    await store.buildContextMap('tenant-a', 'invoice_overdue')
    await store.buildContextMap('tenant-a', 'invoice_overdue') // should be cached
    await store.buildContextMap('tenant-a', 'invoice_overdue') // still cached

    const callsAfter = findCallCount()
    expect(callsAfter - callsBefore).toBe(1) // only one MongoDB find call
  })

  it('invalidates cache on recompute — next buildContextMap hits MongoDB', async () => {
    const { db, findCallCount } = makeDb()
    const store = new AdaptiveThresholdStore(db)

    await store.recompute('tenant-a', 'invoice_overdue', 'amount_minor')
    await store.buildContextMap('tenant-a', 'invoice_overdue') // prime cache

    const callsBefore = findCallCount()
    await store.recompute('tenant-a', 'invoice_overdue', 'amount_minor') // invalidates
    await store.buildContextMap('tenant-a', 'invoice_overdue') // cache miss

    const callsAfter = findCallCount()
    expect(callsAfter - callsBefore).toBeGreaterThanOrEqual(1)
  })

  it('invalidateCache(tenantId) clears only that tenant\'s entries', async () => {
    const { db, findCallCount } = makeDb()
    const store = new AdaptiveThresholdStore(db)

    await store.recompute('tenant-a', 'invoice_overdue', 'amount_minor')
    await store.recompute('tenant-b', 'invoice_overdue', 'amount_minor')
    await store.buildContextMap('tenant-a', 'invoice_overdue')
    await store.buildContextMap('tenant-b', 'invoice_overdue')

    const callsBefore = findCallCount()
    store.invalidateCache('tenant-a')
    await store.buildContextMap('tenant-a', 'invoice_overdue') // miss (invalidated)
    await store.buildContextMap('tenant-b', 'invoice_overdue') // hit (still cached)

    const callsAfter = findCallCount()
    expect(callsAfter - callsBefore).toBe(1) // only tenant-a missed
  })

  it('invalidateCache() with no arg clears all entries', async () => {
    const { db, findCallCount } = makeDb()
    const store = new AdaptiveThresholdStore(db)

    await store.recompute('tenant-a', 'invoice_overdue', 'amount_minor')
    await store.buildContextMap('tenant-a', 'invoice_overdue')

    const callsBefore = findCallCount()
    store.invalidateCache()
    await store.buildContextMap('tenant-a', 'invoice_overdue') // miss

    const callsAfter = findCallCount()
    expect(callsAfter - callsBefore).toBe(1)
  })

  it('returns a flat threshold map with correct key format', async () => {
    const { db } = makeDb()
    const store = new AdaptiveThresholdStore(db)

    await store.recompute('tenant-a', 'invoice_overdue', 'amount_minor')
    const map = await store.buildContextMap('tenant-a', 'invoice_overdue')

    // The aggregation stub returns mean=100, std=20, count=50, values=[100].
    // count=50 >= MIN_SAMPLES(20) so the stats path is used:
    //   mean = 100, upper_2sigma = round(100 + 2*20) = 140
    //   p90 = percentile(0.90) on values=[100] → 100 (only one value)
    //   lower_2sigma = round(max(0, 100 - 2*20)) = 60
    expect(map['invoice_overdue.amount_minor.mean']).toBe(100)
    expect(map['invoice_overdue.amount_minor.2sigma']).toBe(140)
    expect(map['invoice_overdue.amount_minor.p90']).toBe(100)
    expect(map['invoice_overdue.amount_minor.lower2sigma']).toBe(60)
  })
})
