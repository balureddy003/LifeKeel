import { describe, it, expect } from 'vitest'
import { rankInformationActions, CLOSING_ACTION, ACTION_TEXT } from '../rank.js'
import { runwayRange, type RangeInput, type UncertainEvent } from '../range.js'

// Intent 94, R6. Ranking is by how much confirming an unconfirmed figure would narrow the estimate.
// It never ranks a purchase or a product, only what to check, confirm, find or ask (intent 93 A1).
const ALLOWED_START = /^(check|confirm|add|find|note|ask)\b/i
const PRODUCT_STEERING =
  /\b(buy|purchase|switch|compare (quotes|policies|products)|apply for|upgrade|increase (your )?cover|top up|get (a )?(policy|cover|quote)|take out)\b/i

const stopsWithProtection: UncertainEvent = {
  kind: 'income_stops',
  fromMonth: 0,
  monthlyIncomeLostMinor: 250000,
  protection: { monthlyMinor: { lowMinor: 0, highMinor: 150000 }, waitMonths: 1 },
}
const input: RangeInput = {
  savingsMinor: 600000,
  monthlyInflowMinor: 250000,
  monthlySpendMinor: { lowMinor: 180000, highMinor: 220000 },
  events: [stopsWithProtection],
}

describe('rankInformationActions (R6)', () => {
  it('ranks the figure that narrows the estimate most first (hand-worked: benefit 4 months, spend 1)', () => {
    const r = rankInformationActions(input)
    expect(r.map((x) => [x.unknown, x.narrowingMonths])).toEqual([
      ['protection_benefit', 4],
      ['spend', 1],
    ])
  })

  it('returns nothing when every figure is exact', () => {
    expect(
      rankInformationActions({
        ...input,
        monthlySpendMinor: 200000,
        events: [{ ...stopsWithProtection, protection: { monthlyMinor: 100000, waitMonths: 1 } }],
      }),
    ).toEqual([])
  })

  it('leaves out a figure that would not change the estimate', () => {
    // inflow uncertain but income stops entirely at month 0, and the loss (2,500) is at least the whole inflow, so it cannot matter
    const r = rankInformationActions({
      ...input,
      monthlyInflowMinor: { lowMinor: 230000, highMinor: 250000 },
    })
    expect(r.map((x) => x.unknown)).not.toContain('inflow')
  })

  it('every action is informational: starts with an allowed verb and steers to no product', () => {
    const r = rankInformationActions(input)
    expect(r.length).toBeGreaterThan(0)
    for (const a of [...r.map((x) => x.action), CLOSING_ACTION]) {
      expect(a).toMatch(ALLOWED_START)
      expect(a).not.toMatch(PRODUCT_STEERING)
    }
    expect(CLOSING_ACTION).toMatch(/licensed professional/i)
  })

  it('every possible action text (not just the ones emitted here) is informational', () => {
    for (const a of Object.values(ACTION_TEXT)) {
      expect(a).toMatch(ALLOWED_START)
      expect(a).not.toMatch(PRODUCT_STEERING)
    }
  })

  it('is deterministic: the order of unknowns in the input does not change the ranking', () => {
    const a = rankInformationActions(input)
    const b = rankInformationActions({
      ...input,
      events: [{ ...stopsWithProtection }],
      monthlySpendMinor: { lowMinor: 180000, highMinor: 220000 },
    })
    expect(b).toEqual(a)
  })

  it('narrowing is never negative and never more than the current width', () => {
    for (const lo of [0, 100000, 400000]) {
      for (const width of [0, 100000, 300000]) {
        const i: RangeInput = { ...input, savingsMinor: { lowMinor: lo, highMinor: lo + width } }
        const now = runwayRange(i)
        const cap = Math.min(now.highMonths, 120) - Math.min(now.lowMonths, 120)
        for (const x of rankInformationActions(i)) {
          expect(x.narrowingMonths).toBeGreaterThan(0)
          expect(x.narrowingMonths).toBeLessThanOrEqual(cap)
        }
      }
    }
  })

  it('does not mutate its input', () => {
    const copy = JSON.stringify(input)
    rankInformationActions(input)
    expect(JSON.stringify(input)).toBe(copy)
  })
})

describe('payout timing is rankable', () => {
  it('asks for the claim timescale when the timing is a range that matters', () => {
    const out = rankInformationActions({
      savingsMinor: 300000,
      monthlyInflowMinor: 250000,
      monthlySpendMinor: 200000,
      events: [
        {
          kind: 'earner_dies',
          fromMonth: 0,
          monthlyIncomeLostMinor: 250000,
          lumpSumOnFileMinor: 1200000,
          payoutAfterMonths: { lowMonths: 1, highMonths: 2 },
        },
      ],
    })
    expect(out.map((a) => a.unknown)).toEqual(['payout_timing'])
    expect(out[0]!.narrowingMonths).toBeGreaterThan(0)
    expect(out[0]!.action).toMatch(/^Find /)
  })
})
