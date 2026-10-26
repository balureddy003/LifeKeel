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
    expect(store.insight_attribution[0]).toMatchObject({
      insight_id: 'a',
      action_type: 'profile_updated',
    })
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

  it('detectorIds scopes credit to the detectors the action can address', async () => {
    const store = {
      insights: [
        insight('protection', 5, 'family_protection_gap'),
        insight('education', 5, 'family_education_shortfall'),
        insight('debt', 5, 'family_debt_health'),
      ],
      insight_attribution: [] as Record<string, unknown>[],
    }
    // A bereavement playbook step credits protection + estate only —
    // never the unrelated education or debt flags (intent 48).
    const n = await recordInsightAction(makeDb(store) as never, 't1', 'step_completed', {
      detectorIds: ['family_protection_gap', 'family_estate_readiness'],
    })
    expect(n).toBe(1)
    expect(store.insight_attribution.map((r) => r['insight_id'])).toEqual(['protection'])
  })

  it('insightIds still wins over detectorIds when both are given', async () => {
    const store = {
      insights: [insight('a', 5), insight('b', 5, 'family_debt_health')],
      insight_attribution: [] as Record<string, unknown>[],
    }
    await recordInsightAction(makeDb(store) as never, 't1', 'insight_approved', {
      insightIds: ['b'],
      detectorIds: ['family_protection_gap'],
    })
    expect(store.insight_attribution.map((r) => r['insight_id'])).toEqual(['b'])
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
    const n = await recordInsightAction(makeDb(store) as never, 't1', 'insight_approved', {
      insightIds: ['a'],
    })
    expect(n).toBe(1)
    expect(store.insight_attribution[0]).toMatchObject({
      insight_id: 'a',
      action_type: 'insight_approved',
    })
  })
})

describe('listInsightAttributions', () => {
  it('returns only rows inside the read window', async () => {
    const store = {
      insights: [] as Record<string, unknown>[],
      insight_attribution: [
        {
          insight_id: 'a',
          action_type: 'profile_updated',
          action_at: new Date(Date.now() - 10 * DAY),
          tenant_id: 't1',
        },
        {
          insight_id: 'b',
          action_type: 'policy_added',
          action_at: new Date(Date.now() - 120 * DAY),
          tenant_id: 't1',
        },
      ],
    }
    const rows = await listInsightAttributions(makeDb(store) as never, 't1')
    expect(rows.map((r) => r.insight_id)).toEqual(['a'])
  })
})

describe('findStaleArtefacts (intent 67 — derivation closure)', () => {
  it('returns only insights whose closure names a stale version', async () => {
    const { findStaleArtefacts } = await import('../../insights-persist')
    const store = {
      insights: [
        {
          id: 'i1',
          tenant_id: 't1',
          detector_id: 'family-protection',
          rule_id: 'r1',
          state: 'identified',
          closure: { profile_version: 3, detector_version: 'd1' },
        },
        {
          id: 'i2',
          tenant_id: 't1',
          detector_id: 'family-protection',
          rule_id: 'r2',
          state: 'identified',
          closure: { profile_version: 4, detector_version: 'd1' },
        },
        // Pre-closure insight — no closure field, not invalidated by this pass
        {
          id: 'i3',
          tenant_id: 't1',
          detector_id: 'family-protection',
          rule_id: 'r3',
          state: 'identified',
        },
        {
          id: 'i4',
          tenant_id: 't1',
          detector_id: 'family-protection',
          rule_id: 'r4',
          state: 'resolved',
          closure: { profile_version: 3 },
        },
      ],
    }
    const { stale, total } = await findStaleArtefacts(makeDb(store) as never, 't1', {
      profile_version: 4,
      detector_version: 'd1',
    })
    expect(stale.map((i) => i.id)).toEqual(['i1'])
    expect(total).toBe(3)
  })
})
