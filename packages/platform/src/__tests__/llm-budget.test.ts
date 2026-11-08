import { describe, it, expect, vi } from 'vitest'
import { LlmBudgetGuard, DEFAULT_MONTHLY_LIMIT_USD } from '../llm-budget.js'

vi.mock('../cost-ledger.js', () => ({
  CostLedger: class {
    getSummary = async () => ({ total_cost_microdollars: spent })
  },
}))
let spent = 0

const guardFor = (settings: Record<string, unknown> | null) =>
  new LlmBudgetGuard({
    collection: () => ({
      findOne: async () => settings,
      updateOne: async () => ({}),
    }),
  } as never)

describe('LlmBudgetGuard default cap', () => {
  it('caps a tenant with no budget at the default and hard-stops past it', async () => {
    spent = DEFAULT_MONTHLY_LIMIT_USD * 1_000_000
    const d = await guardFor(null).check('t1')
    expect(DEFAULT_MONTHLY_LIMIT_USD).toBe(2)
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('budget_exhausted')
    expect(d.limit_microdollars).toBe(2_000_000)
  })

  it('allows a tenant with no budget while under the default', async () => {
    spent = 500_000
    const d = await guardFor(null).check('t1')
    expect(d.allowed).toBe(true)
    expect(d.limit_microdollars).toBe(2_000_000)
  })

  it("keeps a tenant's own budget, and its own hard_stop choice, in charge", async () => {
    spent = 5_000_000
    const d = await guardFor({ llm_budget: { monthly_limit_usd: 10 } }).check('t1')
    expect(d.allowed).toBe(true)
    expect(d.limit_microdollars).toBe(10_000_000)
    const stopped = await guardFor({
      llm_budget: { monthly_limit_usd: 4, hard_stop: true },
    }).check('t1')
    expect(stopped.allowed).toBe(false)
  })
})

describe('LlmBudgetGuard spend reservation (review F10)', () => {
  /** Reservation rows in memory; `aggregate` sums the live ones. */
  function reservingGuard(settings: Record<string, unknown> | null) {
    const rows: Array<{ _id: number; amount_microdollars: number }> = []
    let next = 0
    const guard = new LlmBudgetGuard({
      collection: (name: string) =>
        name === 'llm_budget_reservations'
          ? {
              insertOne: async (doc: { amount_microdollars: number }) => {
                const _id = ++next
                rows.push({ _id, amount_microdollars: doc.amount_microdollars })
                return { insertedId: _id }
              },
              deleteOne: async ({ _id }: { _id: number }) => {
                const i = rows.findIndex((r) => r._id === _id)
                if (i >= 0) rows.splice(i, 1)
                return {}
              },
              aggregate: () => ({
                next: async () => ({ total: rows.reduce((s, r) => s + r.amount_microdollars, 0) }),
              }),
            }
          : { findOne: async () => settings, updateOne: async () => ({}) },
    } as never)
    return { guard, rows }
  }

  it('refuses a call whose reservation, with those in flight, would pass the limit', async () => {
    spent = 1_000_000
    const { guard, rows } = reservingGuard(null) // default $2 hard stop
    const first = await guard.check('t1', undefined, 600_000)
    expect(first.allowed).toBe(true)
    const second = await guard.check('t1', undefined, 600_000)
    expect(second.allowed).toBe(false)
    expect(rows).toHaveLength(1) // the refused call left no reservation behind
    await first.release!()
    expect(rows).toHaveLength(0)
    expect((await guard.check('t1', undefined, 600_000)).allowed).toBe(true)
  })

  it('does not reserve when the tenant chose no hard stop', async () => {
    spent = 0
    const { guard, rows } = reservingGuard({ llm_budget: { monthly_limit_usd: 1 } })
    const d = await guard.check('t1', undefined, 5_000_000)
    expect(d.allowed).toBe(true)
    expect(d.release).toBeUndefined()
    expect(rows).toHaveLength(0)
  })
})
