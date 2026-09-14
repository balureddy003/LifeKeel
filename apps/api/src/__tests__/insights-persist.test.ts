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
  const collection = { updateMany }
  return { db: { collection: () => collection } as any, updateMany }
}

const TENANT = 'tenant-1'

describe('resolveStaleInsights', () => {
  it('marks a previously-open insight resolved when its rule id is checked but did not fire this cycle', async () => {
    const docs = [
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

    await resolveStaleInsights(db, TENANT, 'family_protection_gap', ['no_income_protection'], ['no_income_protection'])

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

    await resolveStaleInsights(db, TENANT, 'family_protection_gap', ['no_income_protection'], ['no_income_protection'])

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
})
