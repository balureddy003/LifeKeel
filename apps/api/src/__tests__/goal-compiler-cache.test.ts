/**
 * Goal compiler cache — P2 cost optimisation tests.
 *
 * Verifies the compiledGoalCacheKey hash function produces:
 *  - Different keys for different goal text
 *  - Different keys for different tenants
 *  - Different keys when signal types change (new data source connected)
 *  - Different keys when detector inventory changes
 *  - Different keys when connected connectors change
 *  - Same key for the same inputs regardless of array order
 *
 * The cache itself is an LRU with 1-hour TTL tested implicitly by lru-cache.
 * All tests are pure functions — no MongoDB or LLM required.
 */

import { describe, it, expect } from 'vitest'
import { compiledGoalCacheKey } from '../routes/goal-compiler.js'

const baseOpts = {
  tenantId: 't1',
  goal: 'Reduce overdue invoices to zero in 60 days',
  signalTypes: ['invoice.overdue', 'payment.received'],
  detectorInventory: [
    { id: 'det-1', name: 'Overdue detector', signal_types: ['invoice.overdue'] },
    { id: 'det-2', name: 'Payment detector', signal_types: ['payment.received'] },
  ],
  connectedConnectors: ['xero', 'stripe'],
}

describe('Goal compiler cache key (P2)', () => {
  it('produces the same key for the same inputs', () => {
    const k1 = compiledGoalCacheKey(baseOpts)
    const k2 = compiledGoalCacheKey(baseOpts)
    expect(k1).toBe(k2)
  })

  it('produces different keys for different goal text', () => {
    const k1 = compiledGoalCacheKey(baseOpts)
    const k2 = compiledGoalCacheKey({ ...baseOpts, goal: 'Increase revenue by 20%' })
    expect(k1).not.toBe(k2)
  })

  it('produces different keys for different tenants', () => {
    const k1 = compiledGoalCacheKey(baseOpts)
    const k2 = compiledGoalCacheKey({ ...baseOpts, tenantId: 't2' })
    expect(k1).not.toBe(k2)
  })

  it('produces different keys when signal types change', () => {
    const k1 = compiledGoalCacheKey(baseOpts)
    const k2 = compiledGoalCacheKey({ ...baseOpts, signalTypes: [...baseOpts.signalTypes, 'subscription.cancelled'] })
    expect(k1).not.toBe(k2)
  })

  it('produces different keys when detector inventory changes', () => {
    const k1 = compiledGoalCacheKey(baseOpts)
    const k2 = compiledGoalCacheKey({
      ...baseOpts,
      detectorInventory: [...baseOpts.detectorInventory, { id: 'det-3', name: 'New', signal_types: [] }],
    })
    expect(k1).not.toBe(k2)
  })

  it('produces different keys when connected connectors change', () => {
    const k1 = compiledGoalCacheKey(baseOpts)
    const k2 = compiledGoalCacheKey({ ...baseOpts, connectedConnectors: ['xero', 'stripe', 'twitter_x'] })
    expect(k1).not.toBe(k2)
  })

  it('is order-independent for signal types, detector IDs, and connectors', () => {
    const k1 = compiledGoalCacheKey(baseOpts)
    const k2 = compiledGoalCacheKey({
      ...baseOpts,
      signalTypes: [...baseOpts.signalTypes].reverse(),
      detectorInventory: [...baseOpts.detectorInventory].reverse(),
      connectedConnectors: [...baseOpts.connectedConnectors].reverse(),
    })
    expect(k1).toBe(k2) // sorted internally → same hash
  })

  it('produces different keys for different context objects', () => {
    const k1 = compiledGoalCacheKey(baseOpts)
    const k2 = compiledGoalCacheKey({ ...baseOpts, context: { timeline: 90 } })
    expect(k1).not.toBe(k2)
  })

  it('produces a 64-character hex string (SHA-256)', () => {
    const key = compiledGoalCacheKey(baseOpts)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })
})
