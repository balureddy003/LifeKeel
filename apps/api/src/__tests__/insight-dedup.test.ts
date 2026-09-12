/**
 * B4 (GOAL_PROGRESS_AND_UX_GAPS.md): tests for insight deduplication.
 *
 * The persistInsights() function in routes/events.ts was modified to
 * pre-check for recently dismissed or completed insights before inserting
 * new ones. This prevents the "21 historical near-duplicates" problem where
 * the same condition re-fired as a brand-new insight after the user
 * dismissed it.
 *
 * Since persistInsights is a private function, we test the dedup behavior
 * by mocking the DB collections and verifying the filter logic.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ── Mock DB ───────────────────────────────────────────────────────────────────

interface MockInsight {
  id: string
  tenant_id: string
  detector_id: string
  hypothesis: string
  state: string
  feature_snapshot?: { ticker?: string }
  dismissed_at?: Date
  approved_at?: Date
  created_at: Date
}

function makeMockCollection(docs: MockInsight[]) {
  return {
    findOne: vi.fn(async (filter: Record<string, unknown>) => {
      return docs.find(d => {
        for (const [key, value] of Object.entries(filter)) {
          if (key === 'state') {
            if (typeof value === 'string' && d.state !== value) return false
            if (typeof value === 'object' && value !== null && '$in' in value) {
              const arr = (value as { $in: string[] }).$in
              if (!arr.includes(d.state)) return false
            }
          } else if (key === 'dismissed_at') {
            if (typeof value === 'object' && value !== null && '$gte' in value) {
              const cutoff = (value as { $gte: Date }).$gte
              if (!d.dismissed_at || d.dismissed_at < cutoff) return false
            }
          } else if (key === 'feature_snapshot.ticker') {
            if (d.feature_snapshot?.ticker !== value) return false
          } else {
            if ((d as Record<string, unknown>)[key] !== value) return false
          }
        }
        return true
      }) ?? null
    }),
    bulkWrite: vi.fn(async () => ({ insertedCount: 0, modifiedCount: 0 })),
    find: vi.fn(() => ({
      sort: vi.fn(() => ({ limit: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
      toArray: vi.fn(async () => []),
      project: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
    })),
    countDocuments: vi.fn(async () => 0),
    createIndex: vi.fn(async () => 'idx'),
  }
}

// ── Dedup logic (extracted from persistInsights for testing) ──────────────────

const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

interface InsightInput {
  tenant_id: string
  detector_id: string
  hypothesis: string
  feature_snapshot?: { ticker?: string }
}

async function shouldSuppressInsight(
  col: ReturnType<typeof makeMockCollection>,
  insight: InsightInput,
  now: Date = new Date(),
): Promise<{ suppress: boolean; reason?: string }> {
  const ticker = insight.feature_snapshot?.ticker
  const identityFilter: Record<string, unknown> = {
    tenant_id: insight.tenant_id,
    detector_id: insight.detector_id,
    hypothesis: insight.hypothesis,
    ...(ticker !== undefined ? { 'feature_snapshot.ticker': ticker } : {}),
  }

  // Check for a completed insight — suppress permanently
  const completed = await col.findOne({
    ...identityFilter,
    state: 'completed',
  })
  if (completed) return { suppress: true, reason: 'completed' }

  // Check for a recently dismissed insight — suppress within cooldown
  const dismissCutoff = new Date(now.getTime() - DISMISS_COOLDOWN_MS)
  const recentlyDismissed = await col.findOne({
    ...identityFilter,
    state: 'dismissed',
    dismissed_at: { $gte: dismissCutoff },
  })
  if (recentlyDismissed) return { suppress: true, reason: 'recently_dismissed' }

  return { suppress: false }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('B4: insight deduplication pre-check', () => {
  const now = new Date('2026-07-18T12:00:00Z')
  const baseInsight: InsightInput = {
    tenant_id: 'tenant-test',
    detector_id: 'trading_concentration_risk',
    hypothesis: 'position_over_threshold',
    feature_snapshot: { ticker: 'LIME_US_EQ' },
  }

  it('suppresses when a completed insight exists for the same condition', async () => {
    const col = makeMockCollection([
      { ...baseInsight, id: 'insight-1', state: 'completed', approved_at: now, created_at: new Date('2026-06-01') },
    ])
    const result = await shouldSuppressInsight(col, baseInsight, now)
    expect(result.suppress).toBe(true)
    expect(result.reason).toBe('completed')
  })

  it('suppresses when an insight was dismissed within the 7-day cooldown', async () => {
    const dismissedRecently = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) // 3 days ago
    const col = makeMockCollection([
      { ...baseInsight, id: 'insight-2', state: 'dismissed', dismissed_at: dismissedRecently, created_at: new Date('2026-06-01') },
    ])
    const result = await shouldSuppressInsight(col, baseInsight, now)
    expect(result.suppress).toBe(true)
    expect(result.reason).toBe('recently_dismissed'
    )
  })

  it('does NOT suppress when an insight was dismissed more than 7 days ago', async () => {
    const dismissedLongAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) // 10 days ago
    const col = makeMockCollection([
      { ...baseInsight, id: 'insight-3', state: 'dismissed', dismissed_at: dismissedLongAgo, created_at: new Date('2026-06-01') },
    ])
    const result = await shouldSuppressInsight(col, baseInsight, now)
    expect(result.suppress).toBe(false)
  })

  it('does NOT suppress when no prior insight exists', async () => {
    const col = makeMockCollection([])
    const result = await shouldSuppressInsight(col, baseInsight, now)
    expect(result.suppress).toBe(false)
  })

  it('does NOT suppress when an open (identified) insight exists (handled by upsert, not pre-check)', async () => {
    const col = makeMockCollection([
      { ...baseInsight, id: 'insight-4', state: 'identified', created_at: new Date('2026-07-15') },
    ])
    const result = await shouldSuppressInsight(col, baseInsight, now)
    expect(result.suppress).toBe(false)
  })

  it('suppresses completed permanently even if dismissed_at is recent', async () => {
    // An insight that was completed (approved) should never re-fire
    const col = makeMockCollection([
      { ...baseInsight, id: 'insight-5', state: 'completed', approved_at: now, created_at: new Date('2026-07-01') },
    ])
    const result = await shouldSuppressInsight(col, baseInsight, now)
    expect(result.suppress).toBe(true)
    expect(result.reason).toBe('completed')
  })

  it('matches on ticker when present in feature_snapshot', async () => {
    const col = makeMockCollection([
      { ...baseInsight, id: 'insight-6', state: 'completed', approved_at: now, created_at: new Date('2026-07-01'),
        feature_snapshot: { ticker: 'DPW_US_EQ' } }, // different ticker
    ])
    // Same condition but different ticker → should NOT suppress
    const result = await shouldSuppressInsight(col, {
      ...baseInsight,
      feature_snapshot: { ticker: 'LIME_US_EQ' },
    }, now)
    expect(result.suppress).toBe(false)
  })

  it('works without ticker in feature_snapshot (non-trading detectors)', async () => {
    const noTickerInsight: InsightInput = {
      tenant_id: 'tenant-test',
      detector_id: 'overdue_invoice_recovery',
      hypothesis: 'invoice_overdue',
    }
    const col = makeMockCollection([
      { ...noTickerInsight, id: 'insight-7', state: 'dismissed',
        dismissed_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), created_at: new Date('2026-06-01') },
    ])
    const result = await shouldSuppressInsight(col, noTickerInsight, now)
    expect(result.suppress).toBe(true)
    expect(result.reason).toBe('recently_dismissed')
  })

  it('completed takes priority over recently dismissed', async () => {
    const col = makeMockCollection([
      { ...baseInsight, id: 'insight-8a', state: 'dismissed',
        dismissed_at: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), created_at: new Date('2026-06-01') },
      { ...baseInsight, id: 'insight-8b', state: 'completed', approved_at: now, created_at: new Date('2026-07-01') },
    ])
    const result = await shouldSuppressInsight(col, baseInsight, now)
    expect(result.suppress).toBe(true)
    expect(result.reason).toBe('completed')
  })
})
