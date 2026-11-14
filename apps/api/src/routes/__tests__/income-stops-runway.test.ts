import { describe, it, expect } from 'vitest'
import { incomeStopsRunway } from '../family-financial-profile.js'

// Intent 93, B1 layer 1 (known answers) and layer 2 (invariants).
describe('incomeStopsRunway', () => {
  it('known answers: 6,000 saved, 2,000 a month spent, 500 a month of protection on file', () => {
    expect(incomeStopsRunway(600000, 200000, 50000)).toEqual({
      income_protection_monthly_minor: 50000,
      runway_months_savings_only: 3,
      runway_months_with_income_protection: 4,
    })
  })

  it('protection that covers the whole spend gives no end date (9999), never a fake number', () => {
    expect(incomeStopsRunway(100000, 200000, 200000).runway_months_with_income_protection).toBe(
      9999,
    )
    expect(incomeStopsRunway(100000, 200000, 300000).runway_months_with_income_protection).toBe(
      9999,
    )
  })

  it('no spend entered gives no end date rather than a divide-by-zero', () => {
    const r = incomeStopsRunway(100000, 0, 0)
    expect(r.runway_months_savings_only).toBe(9999)
  })

  it('invariants over a grid: protection never shortens the runway, savings never shorten it, whole months only', () => {
    for (const savings of [0, 50000, 600000, 2500000]) {
      for (const spend of [100000, 200000, 350000]) {
        let prev = -1
        for (const ip of [0, 25000, 100000, 350000]) {
          const r = incomeStopsRunway(savings, spend, ip)
          expect(Number.isInteger(r.runway_months_with_income_protection)).toBe(true)
          expect(r.runway_months_with_income_protection).toBeGreaterThanOrEqual(
            r.runway_months_savings_only,
          )
          expect(r.runway_months_with_income_protection).toBeGreaterThanOrEqual(prev)
          prev = r.runway_months_with_income_protection
        }
        expect(
          incomeStopsRunway(savings + 100000, spend, 0).runway_months_savings_only,
        ).toBeGreaterThanOrEqual(incomeStopsRunway(savings, spend, 0).runway_months_savings_only)
      }
    }
  })
})
