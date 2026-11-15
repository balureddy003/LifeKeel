import { describe, it, expect } from 'vitest'
import { NO_END } from '../cashflow.js'
import { runwayRange, describeRange, LEFT_OUT, type UncertainEvent } from '../range.js'

// Intent 94, R7. Household: 6,000 saved, 2,500 income, 2,000 spend (all exact unless stated).
const exact = { savingsMinor: 600000, monthlyInflowMinor: 250000, monthlySpendMinor: 200000 }
const stops: UncertainEvent = { kind: 'income_stops', fromMonth: 0, monthlyIncomeLostMinor: 250000 }

describe('runwayRange (R7)', () => {
  it('exact figures give low equal to high (and the text says so)', () => {
    const r = runwayRange({ ...exact, events: [stops] })
    expect(r.lowMonths).toBe(3)
    expect(r.highMonths).toBe(3)
    expect(r.exactInputs).toBe(true)
  })

  it('an uncertain spend widens the range: 1,800 to 2,200 on 6,000 gives 2 to 3 months', () => {
    const r = runwayRange({
      ...exact,
      monthlySpendMinor: { lowMinor: 180000, highMinor: 220000 },
      events: [stops],
    })
    // inflow 2,500 lost -> gap = spend. high spend 2,200 -> 2 months; low spend 1,800 -> 3 months
    expect(r.lowMonths).toBe(2)
    expect(r.highMonths).toBe(3)
    expect(r.exactInputs).toBe(false)
  })

  it('an unconfirmed protection benefit widens the range, and protection on file never hurts', () => {
    const withProt: UncertainEvent = {
      ...stops,
      protection: { monthlyMinor: { lowMinor: 0, highMinor: 150000 }, waitMonths: 1 },
    }
    const r = runwayRange({ ...exact, events: [withProt] })
    expect(r.lowMonths).toBe(3) // benefit of 0
    expect(r.highMonths).toBe(9) // benefit of 1,500 after a 1 month wait
    const noProt = runwayRange({ ...exact, events: [stops] })
    expect(r.lowMonths).toBeGreaterThanOrEqual(noProt.lowMonths)
  })

  it('an unconfirmed payout gives a lower bound with no payout and an upper bound with it', () => {
    const dies: UncertainEvent = {
      kind: 'earner_dies',
      fromMonth: 0,
      monthlyIncomeLostMinor: 250000,
      lumpSumOnFileMinor: { lowMinor: 0, highMinor: 1200000 },
      payoutAfterMonths: 2,
    }
    const r = runwayRange({ ...exact, events: [dies] })
    expect(r.lowMonths).toBe(3)
    expect(r.highMonths).toBe(9)
  })

  it('low never exceeds high, over a grid of intervals', () => {
    for (const lo of [0, 100000, 400000]) {
      for (const width of [0, 50000, 300000]) {
        for (const spend of [150000, 200000, 300000]) {
          const r = runwayRange({
            savingsMinor: { lowMinor: lo, highMinor: lo + width },
            monthlyInflowMinor: 250000,
            monthlySpendMinor: spend,
            events: [stops],
          })
          expect(r.lowMonths).toBeLessThanOrEqual(r.highMonths)
        }
      }
    }
  })

  it('rejects an interval whose low is above its high', () => {
    expect(() =>
      runwayRange({ ...exact, savingsMinor: { lowMinor: 10, highMinor: 5 }, events: [] }),
    ).toThrow()
  })

  it('no event and income above spend gives no end in both bounds', () => {
    const r = runwayRange({ ...exact, events: [] })
    expect(r.lowMonths).toBe(NO_END)
    expect(r.highMonths).toBe(NO_END)
  })
})

describe('describeRange (R7)', () => {
  const texts = [
    describeRange(runwayRange({ ...exact, events: [stops] })),
    describeRange(
      runwayRange({
        ...exact,
        monthlySpendMinor: { lowMinor: 180000, highMinor: 220000 },
        events: [stops],
      }),
    ),
    describeRange(runwayRange({ ...exact, events: [] })),
  ]

  it('never states a bare point: always "about" or a range, and the word estimate', () => {
    for (const t of texts) {
      expect(t).toMatch(/estimate/i)
      expect(t).toMatch(/\babout\b|\bto\b/i)
    }
  })

  it('every text states what is left out', () => {
    for (const t of texts) for (const item of LEFT_OUT) expect(t).toContain(item)
  })

  it('shows a range as "2 to 3 months" and an open end as 10 years or more', () => {
    expect(texts[1]).toContain('2 to 3 months')
    expect(texts[2]).toMatch(/10 years or more/)
  })

  it('names no product and recommends nothing', () => {
    for (const t of texts) {
      expect(t).not.toMatch(/\b(buy|purchase|switch|should|recommend|best|apply for|upgrade)\b/i)
    }
  })
})

describe('payout timing as a range (owner decision 2026-11-15: 1 to 2 months)', () => {
  const dies = (
    payoutAfterMonths: number | { lowMonths: number; highMonths: number },
  ): UncertainEvent => ({
    kind: 'earner_dies',
    fromMonth: 0,
    monthlyIncomeLostMinor: 250000,
    lumpSumOnFileMinor: 1200000,
    payoutAfterMonths,
  })
  const tight = { savingsMinor: 300000, monthlyInflowMinor: 250000, monthlySpendMinor: 200000 }

  it('a later payout is the low end and an earlier one the high end', () => {
    const r = runwayRange({ ...tight, events: [dies({ lowMonths: 1, highMonths: 2 })] })
    expect(r.lowMonths).toBe(1) // money runs out before a month-2 payout arrives
    expect(r.highMonths).toBe(7)
    expect(r.exactInputs).toBe(false)
  })

  it('a single number behaves as before and counts as exact', () => {
    const r = runwayRange({ ...tight, events: [dies(1)] })
    expect(r.lowMonths).toBe(7)
    expect(r.exactInputs).toBe(true)
  })

  it('an equal low and high is exact', () => {
    expect(
      runwayRange({ ...tight, events: [dies({ lowMonths: 2, highMonths: 2 })] }).exactInputs,
    ).toBe(true)
  })

  it('rejects low above high', () => {
    expect(() =>
      runwayRange({ ...tight, events: [dies({ lowMonths: 3, highMonths: 2 })] }),
    ).toThrow(RangeError)
  })

  it('describeRange can name what the range is about', () => {
    const t = describeRange(
      { lowMonths: 1, highMonths: 7, exactInputs: false },
      'Savings and the cover payout',
    )
    expect(t.startsWith('Savings and the cover payout would cover 1 to 7 months.')).toBe(true)
  })
})
