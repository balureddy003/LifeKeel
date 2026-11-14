import { describe, it, expect } from 'vitest'
import { flatTimeline, simulate } from '../cashflow.js'
import { applyEvent, type EngineEvent } from '../events.js'
import { applyEvents } from '../combine.js'

// Intent 94, R5. Household: 6,000 saved, 2,000 spend, 2,500 income.
const base = () => flatTimeline(60, 250000, 200000)
const covered = (events: EngineEvent[], savings = 600000) =>
  simulate(savings, applyEvents(base(), events)).monthsCovered

const stops: EngineEvent = {
  kind: 'income_stops',
  fromMonth: 0,
  monthlyIncomeLostMinor: 250000,
  protection: { monthlyMinor: 150000, waitMonths: 1 },
}
const fix: EngineEvent = { kind: 'mortgage_fix_ends', fromMonth: 4, monthlyIncreaseMinor: 100000 }
const dies: EngineEvent = {
  kind: 'earner_dies',
  fromMonth: 0,
  monthlyIncomeLostMinor: 250000,
  lumpSumOnFileMinor: 1200000,
  payoutAfterMonths: 2,
}

describe('events in combination (R5)', () => {
  it('a single event gives the same timeline as applyEvent', () => {
    for (const e of [stops, fix, dies]) {
      expect(applyEvents(base(), [e])).toEqual(applyEvent(base(), e))
    }
  })

  it('known answer: income stops with protection, then a mortgage rise in month 4, covers 5 months', () => {
    // m0 4,000; m1 3,500; m2 3,000; m3 2,500; m4 spend 3,000 vs inflow 1,500 -> 1,000; m5 short
    expect(covered([stops, fix])).toBe(5)
  })

  it('the same loss from two events is taken once, not twice', () => {
    const stopsOnly: EngineEvent = {
      kind: 'income_stops',
      fromMonth: 0,
      monthlyIncomeLostMinor: 250000,
    }
    const dieNoPayout: EngineEvent = { ...dies, lumpSumOnFileMinor: 0 }
    expect(covered([stopsOnly, dieNoPayout])).toBe(3)
  })

  it('a payout and protection are not eaten by another event that also removes income', () => {
    const lossOnly: EngineEvent = {
      kind: 'income_stops',
      fromMonth: 0,
      monthlyIncomeLostMinor: 250000,
    }
    // dies pays 12,000 in month 2; adding a second loss event must not reduce that payout
    expect(covered([dies, lossOnly])).toBe(covered([dies]))
  })

  it('order of events never changes the result (all permutations)', () => {
    const sets = [
      [stops, fix, dies],
      [fix, stops],
      [dies, fix],
    ]
    for (const set of sets) {
      const ref = JSON.stringify(applyEvents(base(), set))
      const perms = (a: EngineEvent[]): EngineEvent[][] =>
        a.length <= 1
          ? [a]
          : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]))
      for (const p of perms(set)) expect(JSON.stringify(applyEvents(base(), p))).toBe(ref)
    }
  })

  it('staggered: a later second event leaves the months before it unchanged', () => {
    const first = applyEvents(base(), [fix])
    const both = applyEvents(base(), [
      fix,
      { kind: 'income_stops', fromMonth: 10, monthlyIncomeLostMinor: 250000 },
    ])
    expect(both.slice(0, 10)).toEqual(first.slice(0, 10))
  })

  it('adding a loss event never lengthens the runway; adding protection never shortens it', () => {
    for (const savings of [0, 300000, 600000, 2000000]) {
      const a = covered([fix], savings)
      expect(
        covered(
          [fix, { kind: 'income_stops', fromMonth: 3, monthlyIncomeLostMinor: 250000 }],
          savings,
        ),
      ).toBeLessThanOrEqual(a)
      const noProt = covered(
        [{ kind: 'income_stops', fromMonth: 0, monthlyIncomeLostMinor: 250000 }, fix],
        savings,
      )
      expect(covered([stops, fix], savings)).toBeGreaterThanOrEqual(noProt)
    }
  })

  it('does not mutate its inputs', () => {
    const t = base()
    const copy = JSON.stringify(t)
    const ev = [stops, fix]
    const evCopy = JSON.stringify(ev)
    applyEvents(t, ev)
    expect(JSON.stringify(t)).toBe(copy)
    expect(JSON.stringify(ev)).toBe(evCopy)
  })
})
