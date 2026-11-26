import { describe, it, expect } from 'vitest'
import { pinnedTiles, runwayMonths } from '../pinned-tiles'
import type { FinancialProfile } from '../api'

const base = (over: Partial<FinancialProfile>) =>
  ({
    household: {},
    emergency_fund: { emergency_savings_minor: 0, monthly_expenses_minor: 0 },
    retirement: { pension_balance_minor: 0 },
    policies: [],
    ...over,
  }) as unknown as FinancialProfile

const byId = (p: FinancialProfile | null, id: string) => pinnedTiles(p).find((t) => t.id === id)!

describe('pinnedTiles', () => {
  it('every tile is empty, with a hint, when there is no profile', () => {
    for (const t of pinnedTiles(null)) {
      expect(t.value).toBeNull()
      expect(t.emptyHint).not.toBe('')
    }
  })
  it('runway is savings over monthly costs, in whole months rounded down like every other screen', () => {
    const p = base({
      emergency_fund: { emergency_savings_minor: 700000, monthly_expenses_minor: 200000 } as never,
    })
    const t = byId(p, 'runway')
    expect(t.value).toBe('about 3 months')
    expect(t.detail).toBe('£7,000 savings, £2,000 a month in costs')
  })
  it('runway needs both figures and never divides by zero', () => {
    expect(runwayMonths(500000, 0)).toBeNull()
    expect(runwayMonths(0, 100000)).toBeNull()
    expect(runwayMonths(100000, 100000)).toBe(1)
    const one = base({
      emergency_fund: { emergency_savings_minor: 100000, monthly_expenses_minor: 100000 } as never,
    })
    expect(byId(one, 'runway').value).toBe('about 1 month')
  })
  it('counts policies and is empty at zero', () => {
    expect(byId(base({}), 'policies').value).toBeNull()
    const two = base({ policies: [{}, {}] as never })
    expect(byId(two, 'policies').value).toBe('2')
    expect(byId(two, 'policies').detail).toBe('2 policies recorded')
  })
  it('pension shows the balance only when entered', () => {
    expect(byId(base({}), 'pension').value).toBeNull()
    const p = base({ retirement: { pension_balance_minor: 4500000 } as never })
    expect(byId(p, 'pension').value).toBe('£45,000')
  })
})
