import { describe, expect, it, vi } from 'vitest'
import { listInsightAttributions, recordInsightAction } from '../insight-attribution.js'

const DAY = 86_400_000

// A just-capable-enough in-memory Mongo: equality + $in/$gte/$regex on
// find filters, $set/$setOnInsert upserts on updateOne — exactly the
// operators insight-attribution.ts actually issues.
function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === 'object') {
      const c = cond as Record<string, unknown>
      if ('$in' in c) return (c.$in as unknown[]).includes(doc[key])
      if ('$gte' in c) return (doc[key] as Date) >= (c.$gte as Date)
      if ('$regex' in c) return new RegExp(c.$regex as string).test(String(doc[key]))
    }
    return doc[key] === cond
  })
}

function makeDb(store: Record<string, Record<string, unknown>[]>) {
  return {
    collection: (name: string) => {
      const rows = (store[name] ??= [])
      return {
        find: (filter: Record<string, unknown>) => {
          const matched = () => rows.filter((d) => matches(d, { ...filter, tenant_id: 't1' }))
          return {
            project: () => ({ limit: () => ({ toArray: async () => matched() }) }),
            limit: () => ({ toArray: async () => matched() }),
            sort: () => ({ limit: () => ({ toArray: async () => matched() }) }),
            toArray: async () => matched(),
          }
        },
        updateOne: vi.fn(
          async (
            filter: Record<string, unknown>,
            update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
            opts?: { upsert?: boolean },
          ) => {
            const existing = rows.find((d) => matches(d, { ...filter, tenant_id: 't1' }))
            if (existing) {
              Object.assign(existing, update.$set)
              return { modifiedCount: 1 }
            }
            if (opts?.upsert) rows.push({ ...update.$setOnInsert, ...update.$set, tenant_id: 't1' })
            return { upsertedCount: opts?.upsert ? 1 : 0 }
          },
        ),
      }
    },
  } as never
}

const insight = (id: string, ageDays: number, detector = 'family_protection_gap') => ({
  id,
  tenant_id: 't1',
  detector_id: detector,
  rule_id: 'no_income_protection',
  entity_key: 'm_1',
  created_at: new Date(Date.now() - ageDays * DAY),
})

describe('recordInsightAction', () => {
  it('attributes the action to every family insight inside the window', async () => {
    const store = {
      insights: [insight('a', 5), insight('b', 29)],
      insight_attribution: [] as Record<string, unknown>[],
    }
    const db = makeDb(store)
    const n = await recordInsightAction(db as never, 't1', 'profile_updated')
    expect(n).toBe(2)
    expect(store.insight_attribution).toHaveLength(2)
    expect(store.insight_attribution[0]).toMatchObject({ insight_id: 'a', action_type: 'profile_updated' })
  })

  it('ignores insights fired outside the 30-day window', async () => {
    const store = {
      insights: [insight('old', 45), insight('fresh', 10)],
      insight_attribution: [] as Record<string, unknown>[],
    }
    const n = await recordInsightAction(makeDb(store) as never, 't1', 'profile_updated')
    expect(n).toBe(1)
    expect(store.insight_attribution).toHaveLength(1)
    expect(store.insight_attribution[0]!.insight_id).toBe('fresh')
  })

  it('ignores non-family detectors entirely', async () => {
    const store = {
      insights: [insight('x', 5, 'trading_momentum')],
      insight_attribution: [] as Record<string, unknown>[],
    }
    expect(await recordInsightAction(makeDb(store) as never, 't1', 'profile_updated')).toBe(0)
    expect(store.insight_attribution).toHaveLength(0)
  })

  it('dedupes repeat actions: a second save refreshes, not duplicates', async () => {
    const store = {
      insights: [insight('a', 5)],
      insight_attribution: [] as Record<string, unknown>[],
    }
    const db = makeDb(store)
    await recordInsightAction(db as never, 't1', 'profile_updated')
    await recordInsightAction(db as never, 't1', 'profile_updated')
    expect(store.insight_attribution).toHaveLength(1)
  })

  it('insightIds narrows the attribution to the named insight only', async () => {
    const store = {
      insights: [insight('a', 5), insight('b', 5)],
      insight_attribution: [] as Record<string, unknown>[],
    }
    const n = await recordInsightAction(makeDb(store) as never, 't1', 'insight_approved', { insightIds: ['a'] })
    expect(n).toBe(1)
    expect(store.insight_attribution[0]).toMatchObject({ insight_id: 'a', action_type: 'insight_approved' })
  })
})

describe('listInsightAttributions', () => {
  it('returns only rows inside the read window', async () => {
    const store = {
      insights: [] as Record<string, unknown>[],
      insight_attribution: [
        { insight_id: 'a', action_type: 'profile_updated', action_at: new Date(Date.now() - 10 * DAY), tenant_id: 't1' },
        { insight_id: 'b', action_type: 'policy_added', action_at: new Date(Date.now() - 120 * DAY), tenant_id: 't1' },
      ],
    }
    const rows = await listInsightAttributions(makeDb(store) as never, 't1')
    expect(rows.map((r) => r.insight_id)).toEqual(['a'])
  })
})
