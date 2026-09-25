import { describe, it, expect, vi } from 'vitest'
import { resolveStaleInsights } from '../insights-persist.js'

// Mongo-filter matcher just capable enough for what resolveStaleInsights
// actually sends (equality + $in) — not a general Mongo emulator.
function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && '$in' in (cond as Record<string, unknown>)) {
      return ((cond as { $in: unknown[] }).$in).includes(doc[key])
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
