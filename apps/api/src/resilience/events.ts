/**
 * Life events as pure changes to a monthly timeline (intent 94, R2 to R4).
 * Each event returns a new timeline; nothing is mutated. These are estimates from the figures the
 * household entered. They ignore waiting-period exceptions, tax, benefits and changes in spending, and
 * they state facts about money only: no event names or steers to a product.
 */
import type { MonthFlow } from './cashflow.js'

export interface IncomeProtection {
  /** Monthly benefit on file. */
  monthlyMinor: number
  /** Whole months after the income stops before the benefit starts. */
  waitMonths: number
  /** Whole months the benefit is paid for; omitted means to the end of the horizon. */
  maxMonths?: number
}

export type EngineEvent =
  | {
      kind: 'income_stops'
      fromMonth: number
      monthlyIncomeLostMinor: number
      protection?: IncomeProtection
    }
  | { kind: 'mortgage_fix_ends'; fromMonth: number; monthlyIncreaseMinor: number }
  | {
      kind: 'earner_dies'
      fromMonth: number
      monthlyIncomeLostMinor: number
      /** Cover payout on file, as a single lump sum. */
      lumpSumOnFileMinor: number
      /** Whole months after the death before the payout arrives. */
      payoutAfterMonths: number
    }

function whole(label: string, n: number): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`${label} must be a whole, non-negative number`)
  }
}

function loseIncome(m: MonthFlow, lost: number): MonthFlow {
  return { ...m, inflowMinor: m.inflowMinor - Math.min(m.inflowMinor, lost) }
}

export function applyEvent(timeline: MonthFlow[], event: EngineEvent): MonthFlow[] {
  whole('fromMonth', event.fromMonth)
  switch (event.kind) {
    case 'income_stops': {
      whole('monthlyIncomeLostMinor', event.monthlyIncomeLostMinor)
      const p = event.protection
      if (p) {
        whole('protection.monthlyMinor', p.monthlyMinor)
        whole('protection.waitMonths', p.waitMonths)
        if (p.maxMonths !== undefined) whole('protection.maxMonths', p.maxMonths)
      }
      return timeline.map((m, i) => {
        if (i < event.fromMonth) return m
        const lostNow = loseIncome(m, event.monthlyIncomeLostMinor)
        if (!p) return lostNow
        const since = i - event.fromMonth
        const started = since >= p.waitMonths
        const ended = p.maxMonths !== undefined && since >= p.waitMonths + p.maxMonths
        return started && !ended
          ? { ...lostNow, inflowMinor: lostNow.inflowMinor + p.monthlyMinor }
          : lostNow
      })
    }
    case 'mortgage_fix_ends': {
      whole('monthlyIncreaseMinor', event.monthlyIncreaseMinor)
      return timeline.map((m, i) =>
        i >= event.fromMonth ? { ...m, spendMinor: m.spendMinor + event.monthlyIncreaseMinor } : m,
      )
    }
    case 'earner_dies': {
      whole('monthlyIncomeLostMinor', event.monthlyIncomeLostMinor)
      whole('lumpSumOnFileMinor', event.lumpSumOnFileMinor)
      whole('payoutAfterMonths', event.payoutAfterMonths)
      const payoutMonth = event.fromMonth + event.payoutAfterMonths
      return timeline.map((m, i) => {
        if (i < event.fromMonth) return m
        const lostNow = loseIncome(m, event.monthlyIncomeLostMinor)
        return i === payoutMonth
          ? { ...lostNow, inflowMinor: lostNow.inflowMinor + event.lumpSumOnFileMinor }
          : lostNow
      })
    }
  }
}
