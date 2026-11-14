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

/**
 * What an event does to the money, as order-independent effects: losses are taken from the household's
 * own inflow (capped at what it receives), spend rises add, credits (protection, a payout) arrive on top.
 * Combining events sums effects, so the result never depends on the order events are listed in.
 */
export type Effect =
  | { type: 'loss'; fromMonth: number; amountMinor: number }
  | { type: 'spend'; fromMonth: number; amountMinor: number }
  | { type: 'credit'; month: number; amountMinor: number }

export function effectsOf(event: EngineEvent, months: number): Effect[] {
  whole('fromMonth', event.fromMonth)
  switch (event.kind) {
    case 'income_stops': {
      whole('monthlyIncomeLostMinor', event.monthlyIncomeLostMinor)
      const effects: Effect[] = [
        { type: 'loss', fromMonth: event.fromMonth, amountMinor: event.monthlyIncomeLostMinor },
      ]
      const p = event.protection
      if (p) {
        whole('protection.monthlyMinor', p.monthlyMinor)
        whole('protection.waitMonths', p.waitMonths)
        if (p.maxMonths !== undefined) whole('protection.maxMonths', p.maxMonths)
        const start = event.fromMonth + p.waitMonths
        const end = p.maxMonths === undefined ? months : Math.min(months, start + p.maxMonths)
        for (let m = start; m < end; m++) {
          effects.push({ type: 'credit', month: m, amountMinor: p.monthlyMinor })
        }
      }
      return effects
    }
    case 'mortgage_fix_ends': {
      whole('monthlyIncreaseMinor', event.monthlyIncreaseMinor)
      return [
        { type: 'spend', fromMonth: event.fromMonth, amountMinor: event.monthlyIncreaseMinor },
      ]
    }
    case 'earner_dies': {
      whole('monthlyIncomeLostMinor', event.monthlyIncomeLostMinor)
      whole('lumpSumOnFileMinor', event.lumpSumOnFileMinor)
      whole('payoutAfterMonths', event.payoutAfterMonths)
      return [
        { type: 'loss', fromMonth: event.fromMonth, amountMinor: event.monthlyIncomeLostMinor },
        {
          type: 'credit',
          month: event.fromMonth + event.payoutAfterMonths,
          amountMinor: event.lumpSumOnFileMinor,
        },
      ]
    }
  }
}

export function applyEffects(timeline: MonthFlow[], effects: Effect[]): MonthFlow[] {
  return timeline.map((m, i) => {
    let lost = 0
    let spend = 0
    let credit = 0
    for (const e of effects) {
      if (e.type === 'loss' && i >= e.fromMonth) lost += e.amountMinor
      else if (e.type === 'spend' && i >= e.fromMonth) spend += e.amountMinor
      else if (e.type === 'credit' && i === e.month) credit += e.amountMinor
    }
    return {
      inflowMinor: m.inflowMinor - Math.min(m.inflowMinor, lost) + credit,
      spendMinor: m.spendMinor + spend,
    }
  })
}

export function applyEvent(timeline: MonthFlow[], event: EngineEvent): MonthFlow[] {
  return applyEffects(timeline, effectsOf(event, timeline.length))
}
