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
