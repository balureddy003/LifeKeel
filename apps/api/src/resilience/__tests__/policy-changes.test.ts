import { describe, it, expect } from 'vitest'
import { policyChanges } from '../policy-changes.js'

describe('policyChanges', () => {
  const before = {
    coverage_amount_minor: 25_000_000,
    monthly_premium_minor: 4200,
    annual_premium_minor: 50_400,
  }
  it('lists what changed with before and after, and what stayed the same', () => {
    expect(policyChanges(before, { monthly_premium_minor: 4500 })).toEqual({
      changed: [
        { field: 'monthly_premium_minor', label: 'Monthly premium', before: 4200, after: 4500 },
      ],
      unchanged: [
        { field: 'coverage_amount_minor', label: 'Cover', value: 25_000_000 },
        { field: 'annual_premium_minor', label: 'Yearly premium', value: 50_400 },
      ],
    })
  })
  it('a value sent but equal to what was there is not a change', () => {
    expect(policyChanges(before, { monthly_premium_minor: 4200 }).changed).toEqual([])
  })
  it('a figure that was never entered counts as 0 and can be added', () => {
    const r = policyChanges({ monthly_premium_minor: 4200 }, { annual_premium_minor: 50_400 })
    expect(r.changed).toEqual([
      { field: 'annual_premium_minor', label: 'Yearly premium', before: 0, after: 50_400 },
    ])
    expect(r.unchanged).toEqual([
      { field: 'monthly_premium_minor', label: 'Monthly premium', value: 4200 },
    ])
  })
})
