/**
 * Copilot tenant context cache — P1 cost optimisation tests.
 *
 * Verifies the LRU cache around buildTenantContext:
 *  - Second call within TTL returns cached result (no MongoDB query)
 *  - invalidateTenantContext() clears the cache entry
 *  - Different tenants have separate cache entries
 *
 * All tests use in-memory stubs — no MongoDB required.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { buildTenantContext, invalidateTenantContext } from '../routes/copilot.js'

// ── Minimal MongoDB stub ─────────────────────────────────────────────────────

function makeMockCollection(docs: Record<string, unknown>[]) {
  const findCalls = { count: 0 }
  const col = {
    find: () => {
      findCalls.count++
      const c = {
        sort: () => c,
        limit: () => c,
        toArray: async () => [...docs],
      }
      return c
    },
    distinct: async () => [],
  }
  return { col, findCalls }
}

function makeDb() {
  const insights = makeMockCollection([
    { tenant_id: 't1', state: 'identified', hypothesis: 'Test insight', estimated_impact_low: 1000, estimated_impact_high: 5000 },
  ])
  const goals = makeMockCollection([
    { tenant_id: 't1', name: 'Test goal', status: 'active' },
  ])
  const portfolio = makeMockCollection([
    { tenant_id: 't1', ticker: 'AAPL', quantity: 10, current_price: 150 },
  ])

  const db = {
    collection: (name: string) => {
      if (name === 'insights') return insights.col
      if (name === 'goals') return goals.col
      if (name === 'signals') return portfolio.col
      return makeMockCollection([]).col
    },
  }
  return { db, insights, goals, portfolio }
}

describe('Copilot tenant context cache (P1)', () => {
  beforeEach(() => {
    // Clear cache between tests by invalidating known tenant IDs
    invalidateTenantContext('t1')
    invalidateTenantContext('t2')
  })

  it('caches buildTenantContext — second call does not hit MongoDB', async () => {
    const { db, insights, goals, portfolio } = makeDb()

    await buildTenantContext(db, 't1')
    const insightsCallsAfterFirst = insights.findCalls.count
    const goalsCallsAfterFirst = goals.findCalls.count
    const portfolioCallsAfterFirst = portfolio.findCalls.count

    await buildTenantContext(db, 't1') // should be cached
    await buildTenantContext(db, 't1') // still cached

    expect(insights.findCalls.count).toBe(insightsCallsAfterFirst)
    expect(goals.findCalls.count).toBe(goalsCallsAfterFirst)
    expect(portfolio.findCalls.count).toBe(portfolioCallsAfterFirst)
  })

  it('invalidateTenantContext() forces the next call to hit MongoDB', async () => {
    const { db, insights } = makeDb()

    await buildTenantContext(db, 't1')
    const callsBefore = insights.findCalls.count

    invalidateTenantContext('t1')
    await buildTenantContext(db, 't1') // should miss cache

    expect(insights.findCalls.count).toBeGreaterThan(callsBefore)
  })

  it('invalidating one tenant does not affect another tenant\'s cache', async () => {
    const { db, insights } = makeDb()

    await buildTenantContext(db, 't1')
    await buildTenantContext(db, 't2')
    const callsBefore = insights.findCalls.count

    invalidateTenantContext('t1')
    await buildTenantContext(db, 't1') // miss
    await buildTenantContext(db, 't2') // hit (still cached)

    // Only t1 should have caused a new query (insights find is called once per uncached build)
    expect(insights.findCalls.count - callsBefore).toBe(1)
  })

  it('returns a non-empty context string with tenant data', async () => {
    const { db } = makeDb()
    const context = await buildTenantContext(db, 't1')
    expect(context).toContain('Test insight')
  })
})
