import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveStaleInsights, persistAndDeliverInsights } from '../insights-persist.js'

const ensureVerifiedMomentsMock = vi.fn(async () => {})
vi.mock('../verified-moments.js', () => ({
  ensureVerifiedMoments: (...args: unknown[]) => ensureVerifiedMomentsMock(...args),
}))

// Mongo-filter matcher just capable enough for what resolveStaleInsights
// actually sends (equality + $in) — not a general Mongo emulator.
function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && '$in' in (cond as Record<string, unknown>)) {
      return ((cond as { $in: unknown[] }).$in).includes(doc[key])
    }
    if (cond && typeof cond === 'object' && '$nin' in (cond as Record<string, unknown>)) {
      return !((cond as { $nin: unknown[] }).$nin).includes(doc[key])
    }
    if (cond && typeof cond === 'object' && '$gte' in (cond as Record<string, unknown>)) {
      return (doc[key] as Date) >= (cond as { $gte: Date }).$gte
    }
    return doc[key] === cond
  })
}

function makeFakeDb(docs: Record<string, unknown>[]) {
  const updateMany = vi.fn(async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
    let modifiedCount = 0
    for (const doc of docs) {
      if (matchesFilter(doc, filter)) {
        Object.assign(doc, update.$set)
        modifiedCount++
      }
    }
    return { modifiedCount }
  })
  const collection = {
    updateMany,
    find: (filter: Record<string, unknown>) => ({
      toArray: async () => docs.filter((d) => matchesFilter(d, filter)),
    }),
  }
  return { db: { collection: () => collection } as any, updateMany }
}

const TENANT = 'tenant-1'
const fired = (rule_id: string, entity_key = '') => ({ rule_id, entity_key })

// A fuller fake for persistAndDeliverInsights: find().sort().toArray(),
// findOne(), and an upserting updateOne() alongside the updateMany() the
// suite above already exercises.
function makeInsightsDb(seed: Record<string, unknown>[] = []) {
  const docs: Record<string, unknown>[] = [...seed]
  const updateMany = vi.fn(async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
    let modifiedCount = 0
    for (const doc of docs) {
      if (matchesFilter(doc, filter)) {
        Object.assign(doc, update.$set)
        modifiedCount++
      }
    }
    return { modifiedCount }
  })
  const collection = {
    updateMany,
    findOne: async (filter: Record<string, unknown>) => docs.find((d) => matchesFilter(d, filter)) ?? null,
    find: (filter: Record<string, unknown>) => {
      let rows = docs.filter((d) => matchesFilter(d, filter))
      const cursor = {
        sort: (spec: Record<string, 1 | -1>) => {
          const [[key, dir]] = Object.entries(spec)
          rows = [...rows].sort((a, b) => {
            const av = a[key] as Date, bv = b[key] as Date
            return dir === -1 ? bv.getTime() - av.getTime() : av.getTime() - bv.getTime()
          })
          return cursor
        },
        toArray: async () => rows,
      }
      return cursor
    },
    updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $setOnInsert?: Record<string, unknown> }, opts?: { upsert?: boolean }) => {
      const existing = docs.find((d) => matchesFilter(d, filter))
      if (existing) return { matchedCount: 1, upsertedCount: 0 }
      if (opts?.upsert && update.$setOnInsert) {
        docs.push({ ...update.$setOnInsert })
        return { matchedCount: 0, upsertedCount: 1 }
      }
      return { matchedCount: 0, upsertedCount: 0 }
    }),
  }
  return { db: { collection: () => collection } as any, docs, updateMany }
}

function makeInsight(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: over['id'] ?? 'new-insight',
    tenant_id: TENANT,
    detector_id: 'family_protection_gap',
    rule_id: 'no_income_protection',
    entity_key: '',
    state: 'identified',
    created_at: new Date(),
    dedup_window_ms: 86_400_000,
    ...over,
  } as any
}

describe('resolveStaleInsights', () => {
  it('marks a previously-open insight resolved when its rule id is checked but did not fire this cycle', async () => {
    const docs: Record<string, unknown>[] = [
      { id: 'i1', tenant_id: TENANT, detector_id: 'family_protection_gap', rule_id: 'no_income_protection', state: 'identified' },
    ]
    const { db } = makeFakeDb(docs)

    await resolveStaleInsights(db, TENANT, 'family_protection_gap', ['no_income_protection', 'policy_renewal_window'], [])

    expect(docs[0]?.['state']).toBe('resolved')
    expect(docs[0]?.['resolved_at']).toBeInstanceOf(Date)
  })

  it('leaves a rule that fired this cycle untouched — no spurious resolve', async () => {
    const docs = [
      { id: 'i1', tenant_id: TENANT, detector_id: 'family_protection_gap', rule_id: 'no_income_protection', state: 'identified' },
    ]
    const { db } = makeFakeDb(docs)

    await resolveStaleInsights(db, TENANT, 'family_protection_gap', ['no_income_protection'], [fired('no_income_protection')])

    expect(docs[0]?.['state']).toBe('identified')
  })

  it('leaves already-terminal insights (dismissed/completed/archived/resolved) alone', async () => {
    const docs = [
      { id: 'i1', tenant_id: TENANT, detector_id: 'family_protection_gap', rule_id: 'no_income_protection', state: 'dismissed' },
    ]
    const { db } = makeFakeDb(docs)

    await resolveStaleInsights(db, TENANT, 'family_protection_gap', ['no_income_protection'], [])

    expect(docs[0]?.['state']).toBe('dismissed')
  })

  it('no-ops (does not touch the collection) when every checked rule id fired this cycle', async () => {
    const docs = [
      { id: 'i1', tenant_id: TENANT, detector_id: 'family_protection_gap', rule_id: 'no_income_protection', state: 'identified' },
    ]
    const { db, updateMany } = makeFakeDb(docs)

    await resolveStaleInsights(db, TENANT, 'family_protection_gap', ['no_income_protection'], [fired('no_income_protection')])

    expect(updateMany).not.toHaveBeenCalled()
  })

  it('does not resolve an insight belonging to a different detector even with a matching rule id', async () => {
    const docs = [
      { id: 'i1', tenant_id: TENANT, detector_id: 'family_retirement_gap', rule_id: 'no_income_protection', state: 'identified' },
    ]
    const { db } = makeFakeDb(docs)

    await resolveStaleInsights(db, TENANT, 'family_protection_gap', ['no_income_protection'], [])

    expect(docs[0]?.['state']).toBe('identified')
  })

  it('resolves only the entity whose insight stopped reproducing — sibling entities stay open', async () => {
    // Child A's fund recovered (rule stops firing for member-a); child
    // B's is still behind (fires for member-b). Rule-granular resolution
    // would keep BOTH insights open because the rule id fired at all —
    // entity-aware resolution closes only A's.
    const docs = [
      { id: 'i-a', tenant_id: TENANT, detector_id: 'family_education_shortfall', rule_id: 'education_fund_behind_target', entity_key: 'member-a', state: 'identified' },
      { id: 'i-b', tenant_id: TENANT, detector_id: 'family_education_shortfall', rule_id: 'education_fund_behind_target', entity_key: 'member-b', state: 'identified' },
    ]
    const { db } = makeFakeDb(docs)

    await resolveStaleInsights(db, TENANT, 'family_education_shortfall', ['education_fund_behind_target'], [fired('education_fund_behind_target', 'member-b')])

    expect(docs[0]?.['state']).toBe('resolved')
    expect(docs[1]?.['state']).toBe('identified')
  })

  it('an unkeyed insight resolves once the rule only fires for keyed entities', async () => {
    // Legacy insight written before entity keys existed — the same rule
    // now fires for a specific member, so the anonymous open one is stale.
    const docs = [
      { id: 'i-old', tenant_id: TENANT, detector_id: 'family_protection_gap', rule_id: 'no_income_protection', state: 'identified' },
    ]
    const { db } = makeFakeDb(docs)

    await resolveStaleInsights(db, TENANT, 'family_protection_gap', ['no_income_protection'], [fired('no_income_protection', 'member-1')])

    expect(docs[0]?.['state']).toBe('resolved')
  })
})

describe('persistAndDeliverInsights', () => {
  beforeEach(() => ensureVerifiedMomentsMock.mockClear())

  it('persists a genuinely new insight when nothing matching is open', async () => {
    const { db, docs } = makeInsightsDb()
    await persistAndDeliverInsights(db, [makeInsight({ id: 'i1' })], TENANT)
    expect(docs).toHaveLength(1)
    expect((docs[0] as any).id).toBe('i1')
  })

  it('regression: does not spawn a duplicate of a still-open insight, no matter how old it is', async () => {
    // The exact bug found live: an insight open for far longer than its
    // 24h dedup_window_ms must still be deduped against, not treated as
    // "old enough to not count".
    const old = makeInsight({ id: 'old', created_at: new Date(Date.now() - 5 * 86_400_000) })
    const { db, docs } = makeInsightsDb([old])

    await persistAndDeliverInsights(db, [makeInsight({ id: 'new' })], TENANT)

    expect(docs).toHaveLength(1)
    expect((docs[0] as any).id).toBe('old')
    expect((docs[0] as any).state).toBe('identified')
  })

  it('self-heals pre-existing duplicate opens down to the single newest one', async () => {
    const older = makeInsight({ id: 'older', created_at: new Date(Date.now() - 5 * 86_400_000) })
    const newer = makeInsight({ id: 'newer', created_at: new Date(Date.now() - 86_400_000) })
    const { db, docs } = makeInsightsDb([older, newer])

    await persistAndDeliverInsights(db, [makeInsight({ id: 'incoming' })], TENANT)

    const older_ = docs.find((d) => (d as any).id === 'older') as any
    const newer_ = docs.find((d) => (d as any).id === 'newer') as any
    expect(older_.state).toBe('resolved')
    expect(older_.resolved_reason).toBe('duplicate')
    expect(newer_.state).toBe('identified')
    // The incoming one was still a duplicate of the (now-surviving) open
    // insight — never persisted as a third row.
    expect(docs).toHaveLength(2)
  })

  it('suppresses a re-fire within the dedup window of a recently closed insight', async () => {
    const dismissed = makeInsight({ id: 'dismissed', state: 'dismissed', created_at: new Date(Date.now() - 60_000) })
    const { db, docs } = makeInsightsDb([dismissed])

    await persistAndDeliverInsights(db, [makeInsight({ id: 'new' })], TENANT)

    expect(docs).toHaveLength(1)
  })

  it('allows a fresh firing once the dedup window has elapsed on a closed insight — a genuinely new occurrence', async () => {
    const dismissed = makeInsight({ id: 'dismissed', state: 'dismissed', created_at: new Date(Date.now() - 2 * 86_400_000) })
    const { db, docs } = makeInsightsDb([dismissed])

    await persistAndDeliverInsights(db, [makeInsight({ id: 'new' })], TENANT)

    expect(docs).toHaveLength(2)
    expect(docs.some((d) => (d as any).id === 'new')).toBe(true)
  })

  it('treats a different entity_key on the same rule as independent — no cross-entity dedup', async () => {
    const openForA = makeInsight({ id: 'a', entity_key: 'member-a' })
    const { db, docs } = makeInsightsDb([openForA])

    await persistAndDeliverInsights(db, [makeInsight({ id: 'b', entity_key: 'member-b' })], TENANT)

    expect(docs).toHaveLength(2)
  })

  it('calls ensureVerifiedMoments only for the insights actually persisted', async () => {
    const old = makeInsight({ id: 'old' })
    const { db } = makeInsightsDb([old])

    await persistAndDeliverInsights(db, [makeInsight({ id: 'dup' }), makeInsight({ id: 'genuinely-new', rule_id: 'life_insurance_below_household_needs' })], TENANT)

    expect(ensureVerifiedMomentsMock).toHaveBeenCalledTimes(1)
    const persisted = ensureVerifiedMomentsMock.mock.calls[0]![1] as Array<{ id: string }>
    expect(persisted.map((i) => i.id)).toEqual(['genuinely-new'])
  })
})
