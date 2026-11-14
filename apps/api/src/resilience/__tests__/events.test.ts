import { describe, it, expect } from 'vitest'
import { flatTimeline, simulate, NO_END } from '../cashflow.js'
import { applyEvent, type EngineEvent } from '../events.js'

// Intent 94, R2 to R4. Household: 6,000 saved, 2,000 spend, 2,500 income.
const SAVINGS = 600000
const base = () => flatTimeline(60, 250000, 200000)
const months = (events: EngineEvent[], savings = SAVINGS) =>
  simulate(
    savings,
    events.reduce((t, e) => applyEvent(t, e), base()),
  ).monthsCovered

describe('no event', () => {
  it('income above spend never runs out inside the horizon', () => {
    expect(months([])).toBe(NO_END)
  })
})

describe('income stops (R2)', () => {
  const lost = 250000
  it('known answer: pay ends in month 0, no protection: 6,000 / 2,000 = 3 months', () => {
    expect(months([{ kind: 'income_stops', fromMonth: 0, monthlyIncomeLostMinor: lost }])).toBe(3)
  })
  it('known answer: protection of 1,500 a month after a 1 month wait gives a longer runway', () => {
    // month 0 gap 2,000 (4,000 left); months 1+: gap 500 -> 8 more months -> 9 covered
    expect(
      months([
        {
          kind: 'income_stops',
          fromMonth: 0,
          monthlyIncomeLostMinor: lost,
          protection: { monthlyMinor: 150000, waitMonths: 1 },
        },
      ]),
    ).toBe(9)
  })
  it('protection that ends after its term stops helping', () => {
    const withTerm = months([
      {
        kind: 'income_stops',
        fromMonth: 0,
        monthlyIncomeLostMinor: lost,
        protection: { monthlyMinor: 200000, waitMonths: 0, maxMonths: 2 },
      },
    ])
    // months 0,1 free (gap 0); then gap 2,000 against 6,000 -> 3 more -> 5
    expect(withTerm).toBe(5)
  })
  it('an event that starts later leaves earlier months alone', () => {
    // 6 months at +500 -> 9,000; then 2,000 a month -> 4 more months -> 10 covered
    expect(months([{ kind: 'income_stops', fromMonth: 6, monthlyIncomeLostMinor: lost }])).toBe(10)
  })
})

describe('mortgage fix ends (R3)', () => {
  it('known answer: payment up by 1,000 from month 12 against a 500 surplus runs savings down', () => {
    // surplus 500 -> -500 from month 12: 12 months of +500 = 6,000 extra; 12,000 / 500 = 24 more
    const m = months([{ kind: 'mortgage_fix_ends', fromMonth: 12, monthlyIncreaseMinor: 100000 }])
    expect(m).toBe(12 + 24)
  })
  it('a rise the income can absorb gives no end', () => {
    expect(
      months([{ kind: 'mortgage_fix_ends', fromMonth: 12, monthlyIncreaseMinor: 40000 }]),
    ).toBe(NO_END)
  })
})

describe('death of an earner (R4)', () => {
  it('the cover payout on file arrives as a lump sum in the stated month', () => {
    const none = months([
      {
        kind: 'earner_dies',
        fromMonth: 0,
        monthlyIncomeLostMinor: 250000,
        lumpSumOnFileMinor: 0,
        payoutAfterMonths: 0,
      },
    ])
    const paid = months([
      {
        kind: 'earner_dies',
        fromMonth: 0,
        monthlyIncomeLostMinor: 250000,
        lumpSumOnFileMinor: 1200000,
        payoutAfterMonths: 2,
      },
    ])
    expect(none).toBe(3)
    // 6,000 lasts months 0,1 (2,000 each) -> 2,000 left in month 2; payout 12,000 arrives in month 2 -> 14,000 -> 7 more months (2..8) -> 9
    expect(paid).toBe(9)
  })
  it('a payout that arrives after savings ran out does not undo the shortfall', () => {
    const late = months([
      {
        kind: 'earner_dies',
        fromMonth: 0,
        monthlyIncomeLostMinor: 250000,
        lumpSumOnFileMinor: 5000000,
        payoutAfterMonths: 6,
      },
    ])
    expect(late).toBe(3)
  })
})

describe('invariants', () => {
  it('events never mutate the timeline they are given', () => {
    const t = base()
    const copy = JSON.parse(JSON.stringify(t))
    applyEvent(t, { kind: 'income_stops', fromMonth: 0, monthlyIncomeLostMinor: 250000 })
    expect(t).toEqual(copy)
  })
  it('over a grid: a loss never helps, protection never hurts, a payout never hurts', () => {
    for (const savings of [0, 300000, 600000, 2000000]) {
      for (const from of [0, 3, 12]) {
        const none = months([], savings)
        const stop = months(
          [{ kind: 'income_stops', fromMonth: from, monthlyIncomeLostMinor: 250000 }],
          savings,
        )
        expect(stop).toBeLessThanOrEqual(none)
        for (const prot of [0, 50000, 150000]) {
          const withProt = months(
            [
              {
                kind: 'income_stops',
                fromMonth: from,
                monthlyIncomeLostMinor: 250000,
                protection: { monthlyMinor: prot, waitMonths: 2 },
              },
            ],
            savings,
          )
          expect(withProt).toBeGreaterThanOrEqual(stop)
        }
        const die0 = months(
          [
            {
              kind: 'earner_dies',
              fromMonth: from,
              monthlyIncomeLostMinor: 250000,
              lumpSumOnFileMinor: 0,
              payoutAfterMonths: 1,
            },
          ],
          savings,
        )
        const die1 = months(
          [
            {
              kind: 'earner_dies',
              fromMonth: from,
              monthlyIncomeLostMinor: 250000,
              lumpSumOnFileMinor: 500000,
              payoutAfterMonths: 1,
            },
          ],
          savings,
        )
        expect(die1).toBeGreaterThanOrEqual(die0)
        const fix = months(
          [{ kind: 'mortgage_fix_ends', fromMonth: from, monthlyIncreaseMinor: 100000 }],
          savings,
        )
        expect(fix).toBeLessThanOrEqual(none)
      }
    }
  })
  it('rejects negative months and fractional money', () => {
    expect(() =>
      applyEvent(base(), { kind: 'income_stops', fromMonth: -1, monthlyIncomeLostMinor: 1 }),
    ).toThrow()
    expect(() =>
      applyEvent(base(), { kind: 'mortgage_fix_ends', fromMonth: 0, monthlyIncreaseMinor: 1.5 }),
    ).toThrow()
  })
})
