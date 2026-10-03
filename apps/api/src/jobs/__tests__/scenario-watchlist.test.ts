import { beforeEach, describe, expect, it } from 'vitest'
import { runScenarioWatchlist } from '../scenario-watchlist.js'

// Real projectScenario + real calculateScenario — the deltas under test
// are driven by changing the fake profile's savings between runs:
//   income 400_000 − delta 400_000 → projected income 0
//   shortfall = expenses 300_000 → runway = savings / 300_000
//   1_140_000 → 3.8 · 1_230_000 → 4.1 · 1_380_000 → 4.6
const profile = {
  tenant_id: 't1',
  household: { monthly_salary_minor: 400_000 },
  emergency_fund: { emergency_savings_minor: 1_140_000, monthly_expenses_minor: 300_000 },
}

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === 'object') {
      const c = cond as Record<string, unknown>
      if ('$ne' in c) return doc[key] !== c.$ne
      if ('$in' in c) return (c.$in as unknown[]).includes(doc[key])
    }
    return doc[key] === cond
  })
}

function makeDb(scenarios: Record<string, unknown>[]) {
  const events: Record<string, unknown>[] = []
  const collections: Record<string, unknown> = {
    family_scenarios: {
      distinct: async (_field: string, filter: Record<string, unknown>) => [
        ...new Set(scenarios.filter((d) => matches(d, filter)).map((d) => d['tenant_id'])),
      ],
      find: (filter: Record<string, unknown>) => ({
        toArray: async () => scenarios.filter((d) => matches(d, filter)),
      }),
      updateOne: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
        const doc = scenarios.find((d) => matches(d, filter))
        if (doc) Object.assign(doc, update.$set)
        return { modifiedCount: doc ? 1 : 0 }
      },
    },
    family_financial_profile: { findOne: async () => profile },
    family_groups: { findOne: async () => null },
    readiness_events: {
      updateOne: async (
        _f: unknown,
        update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
      ) => {
        events.push({ ...update.$setOnInsert, ...update.$set })
        return { upsertedCount: 1 }
      },
    },
  }
  return { events, db: { collection: (n: string) => collections[n] } as never }
}

const flush = () => new Promise((r) => setTimeout(r, 10))

beforeEach(() => {
  profile.emergency_fund.emergency_savings_minor = 1_140_000
})

const scenario = (id: string, watch?: boolean): Record<string, unknown> => ({
  id,
  tenant_id: 't1',
  name: 'One income',
  inputs: { monthlyIncomeDeltaMinor: -400_000 },
  created_by: 'u1',
  created_at: '2026-10-01T00:00:00Z',
  ...(watch === undefined ? {} : { watch }),
})

describe('runScenarioWatchlist', () => {
  it('first run writes the last_projection baseline and emits nothing', async () => {
    const s1 = scenario('s1')
    const { db, events } = makeDb([s1])
    const summary = await runScenarioWatchlist(db)
    await flush()
    expect(summary).toMatchObject({ tenants: 1, scenarios: 1, moved: 0 })
    expect(events).toHaveLength(0)
    expect(s1['last_projection']).toMatchObject({ runway_months: 3.8, depletion_month: null })
  })

  it('3.8 → 4.6 emits scenario_moved direction up', async () => {
    const s1 = scenario('s1')
    const { db, events } = makeDb([s1])
    await runScenarioWatchlist(db)
    profile.emergency_fund.emergency_savings_minor = 1_380_000
    const summary = await runScenarioWatchlist(db)
    await flush()
    expect(summary.moved).toBe(1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'scenario_moved',
      direction: 'up',
      severity: 'notice',
      domain: 'scenarios',
    })
    expect(events[0]!['title']).toContain('3.8 → 4.6')
    expect(s1['last_projection']).toMatchObject({ runway_months: 4.6 })
  })

  it('3.8 → 4.1 emits nothing but still updates last_projection', async () => {
    const s1 = scenario('s1')
    const { db, events } = makeDb([s1])
    await runScenarioWatchlist(db)
    profile.emergency_fund.emergency_savings_minor = 1_230_000
    const summary = await runScenarioWatchlist(db)
    await flush()
    expect(summary.moved).toBe(0)
    expect(events).toHaveLength(0)
    expect(s1['last_projection']).toMatchObject({ runway_months: 4.1 })
  })

  it('a watch:false scenario is skipped entirely', async () => {
    const s1 = scenario('s1', false)
    const { db, events } = makeDb([s1])
    const summary = await runScenarioWatchlist(db)
    await flush()
    expect(summary).toMatchObject({ tenants: 0, scenarios: 0, moved: 0 })
    expect(events).toHaveLength(0)
    expect(s1['last_projection']).toBeUndefined()
  })
})
