/**
 * Ranking by what narrows the estimate (intent 94, R6; intent 93 A1). The only actions ranked are
 * informational: check, confirm, find an unconfirmed figure. Each is scored by how much the runway
 * range would shrink, at worst, once that figure is known. Nothing here ranks a purchase, a product
 * or a change of cover, and nothing is a recommendation. Pure and deterministic.
 */
import { DEFAULT_HORIZON_MONTHS } from './cashflow.js'
import { runwayRange, type Bounded, type RangeInput, type UncertainEvent } from './range.js'

export type UnknownFigure =
  'savings' | 'inflow' | 'spend' | 'protection_benefit' | 'payout' | 'mortgage_rise'

export interface RankedAction {
  unknown: UnknownFigure
  action: string
  /** Whole months the range would shrink by, in the worst case, once this figure is confirmed. */
  narrowingMonths: number
}

export const ACTION_TEXT: Record<UnknownFigure, string> = {
  savings: 'Check the savings balance entered in your profile',
  inflow: 'Confirm the monthly income figure entered in your profile',
  spend: 'Confirm the monthly spend figure entered in your profile',
  protection_benefit:
    'Find the income protection schedule: the monthly benefit, waiting period and end date',
  payout: 'Find the payout amount on the cover schedule',
  mortgage_rise: 'Check the mortgage offer for the new monthly payment',
}

export const CLOSING_ACTION = 'Ask a licensed professional what applies to your household'

type Side = 'lowMinor' | 'highMinor'

const exact = (b: Bounded) => typeof b === 'number' || b.lowMinor === b.highMinor
const pin = (b: Bounded, side: Side): number => (typeof b === 'number' ? b : b[side])

function unknownsOf(input: RangeInput): UnknownFigure[] {
  const out: UnknownFigure[] = []
  if (!exact(input.savingsMinor)) out.push('savings')
  if (!exact(input.monthlyInflowMinor)) out.push('inflow')
  if (!exact(input.monthlySpendMinor)) out.push('spend')
  for (const e of input.events) {
    if (e.kind === 'income_stops' && e.protection && !exact(e.protection.monthlyMinor))
      out.push('protection_benefit')
    if (e.kind === 'earner_dies' && !exact(e.lumpSumOnFileMinor)) out.push('payout')
    if (e.kind === 'mortgage_fix_ends' && !exact(e.monthlyIncreaseMinor)) out.push('mortgage_rise')
  }
  return [...new Set(out)]
}

function pinned(input: RangeInput, u: UnknownFigure, side: Side): RangeInput {
  const events: UncertainEvent[] = input.events.map((e) => {
    if (u === 'protection_benefit' && e.kind === 'income_stops' && e.protection) {
      return {
        ...e,
        protection: { ...e.protection, monthlyMinor: pin(e.protection.monthlyMinor, side) },
      }
    }
    if (u === 'payout' && e.kind === 'earner_dies')
      return { ...e, lumpSumOnFileMinor: pin(e.lumpSumOnFileMinor, side) }
    if (u === 'mortgage_rise' && e.kind === 'mortgage_fix_ends') {
      return { ...e, monthlyIncreaseMinor: pin(e.monthlyIncreaseMinor, side) }
    }
    return e
  })
  return {
    ...input,
    savingsMinor: u === 'savings' ? pin(input.savingsMinor, side) : input.savingsMinor,
    monthlyInflowMinor:
      u === 'inflow' ? pin(input.monthlyInflowMinor, side) : input.monthlyInflowMinor,
    monthlySpendMinor: u === 'spend' ? pin(input.monthlySpendMinor, side) : input.monthlySpendMinor,
    events,
  }
}

function width(input: RangeInput): number {
  const r = runwayRange(input)
  const cap = input.horizonMonths ?? DEFAULT_HORIZON_MONTHS
  return Math.min(r.highMonths, cap) - Math.min(r.lowMonths, cap)
}

export function rankInformationActions(input: RangeInput): RankedAction[] {
  const now = width(input)
  return unknownsOf(input)
    .map((unknown) => {
      const worstAfter = Math.max(
        width(pinned(input, unknown, 'lowMinor')),
        width(pinned(input, unknown, 'highMinor')),
      )
      return { unknown, action: ACTION_TEXT[unknown], narrowingMonths: now - worstAfter }
    })
    .filter((x) => x.narrowingMonths > 0)
    .sort((a, b) => b.narrowingMonths - a.narrowingMonths || a.unknown.localeCompare(b.unknown))
}
