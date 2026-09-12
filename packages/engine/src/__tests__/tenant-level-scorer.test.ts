/**
 * TenantLevelScorer — cross-signal online logistic regression tests.
 *
 * Verifies that the tenant-level scorer:
 *   1. Learns patterns across detectors/signal types for the same entity
 *   2. Builds cross-signal features (recent insights, detector diversity, etc.)
 *   3. Loads models lazily with LRU eviction
 *   4. Persists and restores weights across eviction cycles
 *   5. Isolates tenants (no cross-tenant learning)
 *   6. Supports resetModel for retraining from scratch
 *
 * All tests use in-memory stubs — no MongoDB required.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TenantLevelScorer } from '../tenant-level-scorer.js'
import type { RecentInsight, TenantLevelScorerMetrics } from '../tenant-level-scorer.js'

// ── MongoDB stub ─────────────────────────────────────────────────────────────

function makeDb() {
  const store = new Map<string, unknown>()
  const col = {
    createIndex: () => Promise.resolve(),
    replaceOne: (filter: unknown, doc: unknown) => {
      store.set(JSON.stringify(filter), doc)
      return Promise.resolve()
    },
    findOne: (filter: unknown) => Promise.resolve(store.get(JSON.stringify(filter)) ?? null),
    find: () => ({ sort: () => ({ limit: () => ({ toArray: () => Promise.resolve([...store.values()]) }) }) }),
    distinct: () => Promise.resolve([]),
  }
  return { collection: () => col, store }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRecentInsights(opts: {
  detectors?: string[]
  signalTypes?: string[]
  states?: string[]
  count?: number
  daysAgo?: number
}): RecentInsight[] {
  const count = opts.count ?? 3
  const detectors = opts.detectors ?? ['det_a', 'det_b', 'det_c']
  const signalTypes = opts.signalTypes ?? ['invoice.overdue', 'payment.failed', 'cart.abandoned']
  const states = opts.states ?? ['identified']
  const daysAgo = opts.daysAgo ?? 1
  const result: RecentInsight[] = []
  for (let i = 0; i < count; i++) {
    const insight: RecentInsight = {
      detector_id: detectors[i % detectors.length]!,
      created_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000 + i * 1000),
    }
    const st = signalTypes[i % signalTypes.length]
    if (st !== undefined) insight.signal_type = st
    const state = states[i % states.length]
    if (state !== undefined) insight.state = state
    result.push(insight)
  }
  return result
}

describe('TenantLevelScorer', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    db = makeDb()
  })

  // ── Basic scoring ──────────────────────────────────────────────────────────

  it('returns a score in [0, 1] range', async () => {
    const scorer = new TenantLevelScorer(db)
    const result = await scorer.score('t1', 'cust_123', 'invoice.overdue', 'det_a', [])
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
  })

  it('returns 0.5 for a fresh model (sigmoid(0))', async () => {
    const scorer = new TenantLevelScorer(db)
    const result = await scorer.score('t1', 'cust_123', 'invoice.overdue', 'det_a', [])
    expect(result.score).toBeCloseTo(0.5, 4)
  })

  it('builds cross-signal features from recent insights', async () => {
    const scorer = new TenantLevelScorer(db)
    const recent = makeRecentInsights({ count: 5, detectors: ['det_a', 'det_b', 'det_c'] })
    const result = await scorer.score('t1', 'cust_123', 'invoice.overdue', 'det_a', recent)
    // Should have unigrams + bigrams
    expect(result.feature_count).toBeGreaterThan(5)
    // Tokens should include entity, signal_type, detector, cross-signal flags
    expect(result.tokens.some(t => t.startsWith('entity='))).toBe(true)
    expect(result.tokens.some(t => t.startsWith('signal_type='))).toBe(true)
    expect(result.tokens.some(t => t.startsWith('detector='))).toBe(true)
    expect(result.tokens.some(t => t.startsWith('recent_insight_count_7d='))).toBe(true)
    expect(result.tokens.some(t => t.startsWith('recent_detector_diversity='))).toBe(true)
    expect(result.tokens.some(t => t.startsWith('has_overdue_invoice='))).toBe(true)
  })

  // ── Online learning ────────────────────────────────────────────────────────

  it('score increases toward 1 after positive updates', async () => {
    const scorer = new TenantLevelScorer(db)
    const recent = makeRecentInsights({ count: 3 })

    const before = (await scorer.score('t1', 'cust_123', 'invoice.overdue', 'det_a', recent)).score
    for (let i = 0; i < 20; i++) {
      await scorer.update('t1', 'cust_123', 'invoice.overdue', 'det_a', recent, 1)
    }
    const after = (await scorer.score('t1', 'cust_123', 'invoice.overdue', 'det_a', recent)).score
    expect(after).toBeGreaterThan(before)
  })

  it('score decreases toward 0 after negative updates', async () => {
    const scorer = new TenantLevelScorer(db)
    const recent = makeRecentInsights({ count: 3 })

    const before = (await scorer.score('t1', 'cust_123', 'invoice.overdue', 'det_a', recent)).score
    for (let i = 0; i < 20; i++) {
      await scorer.update('t1', 'cust_123', 'invoice.overdue', 'det_a', recent, 0)
    }
    const after = (await scorer.score('t1', 'cust_123', 'invoice.overdue', 'det_a', recent)).score
    expect(after).toBeLessThan(before)
  })

  it('learns different patterns for different entities', async () => {
    const scorer = new TenantLevelScorer(db)

    // Train entity A with positive signal, entity B with negative
    for (let i = 0; i < 20; i++) {
      await scorer.update('t1', 'entityA', 'invoice.overdue', 'det_a', [], 1)
      await scorer.update('t1', 'entityB', 'invoice.overdue', 'det_a', [], 0)
    }

    const scoreA = (await scorer.score('t1', 'entityA', 'invoice.overdue', 'det_a', [])).score
    const scoreB = (await scorer.score('t1', 'entityB', 'invoice.overdue', 'det_a', [])).score
    // Entity A should score higher than entity B (learned from training)
    // Note: with a fresh model and only entity-specific features, the
    // difference comes from the entity= token weight.
    expect(scoreA).toBeGreaterThan(scoreB)
  })

  // ── Cross-signal learning ──────────────────────────────────────────────────

  it('cross-signal features differ for entities with different signal histories', async () => {
    const scorer = new TenantLevelScorer(db)

    const overdueInsights = makeRecentInsights({
      count: 3, signalTypes: ['invoice.overdue'],
    })
    const cartInsights = makeRecentInsights({
      count: 3, signalTypes: ['cart.abandoned'],
    })

    const overdueResult = await scorer.score('t1', 'cust_1', 'invoice.overdue', 'det_a', overdueInsights)
    const cartResult = await scorer.score('t1', 'cust_1', 'cart.abandoned', 'det_b', cartInsights)

    // The feature sets should be different (different signal types → different tokens)
    const overdueTokens = new Set(overdueResult.tokens)
    const cartTokens = new Set(cartResult.tokens)
    expect(overdueTokens).not.toEqual(cartTokens)
  })

  it('detects when an entity has multiple active signal types', async () => {
    const scorer = new TenantLevelScorer(db)
    const multiSignal = makeRecentInsights({
      count: 5,
      signalTypes: ['invoice.overdue', 'payment.failed', 'cart.abandoned'],
    })

    const result = await scorer.score('t1', 'cust_1', 'invoice.overdue', 'det_a', multiSignal)
    // Should have cross-signal flags set
    expect(result.tokens).toContain('has_overdue_invoice=1')
    expect(result.tokens).toContain('has_payment_failure=1')
    expect(result.tokens).toContain('has_cart_abandonment=1')
  })

  // ── LRU eviction ───────────────────────────────────────────────────────────

  it('loads models lazily — loadedTenantCount is 0 before first access', () => {
    const scorer = new TenantLevelScorer(db)
    expect(scorer.loadedTenantCount).toBe(0)
  })

  it('evicts LRU tenant when at capacity', async () => {
    const metrics: TenantLevelScorerMetrics = {
      onEviction: vi.fn(),
      onCacheHit: vi.fn(),
      onCacheMiss: vi.fn(),
    }
    const scorer = new TenantLevelScorer(db, { maxLoadedTenants: 2 }, metrics)

    await scorer.score('t1', 'e1', 'sig', 'det', [])
    await scorer.score('t2', 'e1', 'sig', 'det', [])
    expect(scorer.loadedTenantCount).toBe(2)

    // Load t3 — should evict t1 (LRU)
    await scorer.score('t3', 'e1', 'sig', 'det', [])
    expect(scorer.loadedTenantCount).toBe(2)
    expect(metrics.onEviction).toHaveBeenCalledWith('t1')
  })

  it('preserves weights across eviction + reload', async () => {
    const scorer = new TenantLevelScorer(db, { maxLoadedTenants: 1 })

    // Train t1
    for (let i = 0; i < 20; i++) {
      await scorer.update('t1', 'e1', 'sig', 'det', [], 1)
    }
    const trained = (await scorer.score('t1', 'e1', 'sig', 'det', [])).score
    expect(trained).toBeGreaterThan(0.5)

    // Evict t1 by loading t2
    await scorer.score('t2', 'e1', 'sig', 'det', [])

    // Reload t1 — weights should be restored from DB
    const restored = (await scorer.score('t1', 'e1', 'sig', 'det', [])).score
    expect(restored).toBeCloseTo(trained, 4)
  })

  // ── Tenant isolation ───────────────────────────────────────────────────────

  it('isolates tenants — training t1 does not affect t2', async () => {
    const scorer = new TenantLevelScorer(db)

    // Train t1 heavily positive
    for (let i = 0; i < 20; i++) {
      await scorer.update('t1', 'e1', 'sig', 'det', [], 1)
    }
    const t1Score = (await scorer.score('t1', 'e1', 'sig', 'det', [])).score
    expect(t1Score).toBeGreaterThan(0.5)

    // t2 should be unaffected (fresh model, 0.5)
    const t2Score = (await scorer.score('t2', 'e1', 'sig', 'det', [])).score
    expect(t2Score).toBeCloseTo(0.5, 4)
  })

  // ── resetModel ─────────────────────────────────────────────────────────────

  it('resetModel zeros out weights', async () => {
    const scorer = new TenantLevelScorer(db)

    for (let i = 0; i < 20; i++) {
      await scorer.update('t1', 'e1', 'sig', 'det', [], 1)
    }
    const trained = (await scorer.score('t1', 'e1', 'sig', 'det', [])).score
    expect(trained).toBeGreaterThan(0.5)

    await scorer.resetModel('t1')
    const reset = (await scorer.score('t1', 'e1', 'sig', 'det', [])).score
    expect(reset).toBeCloseTo(0.5, 4)
  })

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it('handles empty entity key gracefully', async () => {
    const scorer = new TenantLevelScorer(db)
    const result = await scorer.score('t1', '', 'sig', 'det', [])
    // Should still return a valid score (just without entity token)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
  })

  it('handles no recent insights', async () => {
    const scorer = new TenantLevelScorer(db)
    const result = await scorer.score('t1', 'e1', 'sig', 'det', [])
    expect(result.feature_count).toBeGreaterThan(0) // still has unigrams
  })

  it('filters out insights older than 7 days', async () => {
    const scorer = new TenantLevelScorer(db)
    const oldInsights = makeRecentInsights({ count: 5, daysAgo: 10 })
    const result = await scorer.score('t1', 'e1', 'sig', 'det', oldInsights)
    // Old insights should not contribute to recent_insight_count
    expect(result.tokens).toContain('recent_insight_count_7d=0')
  })
})
