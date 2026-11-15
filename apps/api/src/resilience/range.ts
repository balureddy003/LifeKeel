/**
 * Range display (intent 94, R7). A runway is never shown as a single point: figures that are not
 * confirmed are carried as intervals, the model runs at the pessimistic and the optimistic corner (it is
 * monotone in every input, so the corners are the bounds), and the text always says it is an estimate
 * and what it leaves out. Pure; no advice, no product named.
 */
import { DEFAULT_HORIZON_MONTHS, NO_END, flatTimeline, simulate } from './cashflow.js'
import { applyEvents } from './combine.js'
import type { EngineEvent } from './events.js'

export interface Interval {
  lowMinor: number
  highMinor: number
}
export type Bounded = number | Interval

/** Whole months, as one number or a range (a later payout is worse for the household). */
export interface MonthsRange {
  lowMonths: number
  highMonths: number
}
export type BoundedMonths = number | MonthsRange

/** An event whose "on file" figures may be unconfirmed (carried as intervals). */
export type UncertainEvent =
  | {
      kind: 'income_stops'
      fromMonth: number
      monthlyIncomeLostMinor: number
      protection?: { monthlyMinor: Bounded; waitMonths: number; maxMonths?: number }
    }
  | { kind: 'mortgage_fix_ends'; fromMonth: number; monthlyIncreaseMinor: Bounded }
  | {
      kind: 'earner_dies'
      fromMonth: number
      monthlyIncomeLostMinor: number
      lumpSumOnFileMinor: Bounded
      payoutAfterMonths: BoundedMonths
    }

export interface RangeInput {
  savingsMinor: Bounded
  monthlyInflowMinor: Bounded
  monthlySpendMinor: Bounded
  events: UncertainEvent[]
  horizonMonths?: number
}

export interface RunwayRange {
  lowMonths: number
  highMonths: number
  /** True when every figure was entered exactly, so low equals high only because nothing was uncertain. */
  exactInputs: boolean
}

type Side = 'pessimistic' | 'optimistic'

function bounds(label: string, b: Bounded): Interval {
  const i = typeof b === 'number' ? { lowMinor: b, highMinor: b } : b
  if (i.lowMinor > i.highMinor) throw new RangeError(`${label}: low is above high`)
  return i
}
const monthsOf = (b: BoundedMonths): MonthsRange =>
  typeof b === 'number' ? { lowMonths: b, highMonths: b } : b
const isExactMonths = (b: BoundedMonths) => typeof b === 'number' || b.lowMonths === b.highMonths
function payoutMonths(b: BoundedMonths, s: Side): number {
  const m = monthsOf(b)
  if (m.lowMonths > m.highMonths) throw new RangeError('payout timing: low is above high')
  return s === 'pessimistic' ? m.highMonths : m.lowMonths
}
const isExact = (b: Bounded) => typeof b === 'number' || b.lowMinor === b.highMinor

// "Good" figures: savings, inflow, protection, payout. "Bad" figures: spend, mortgage rise.
const good = (label: string, b: Bounded, s: Side) => {
  const i = bounds(label, b)
  return s === 'pessimistic' ? i.lowMinor : i.highMinor
}
const bad = (label: string, b: Bounded, s: Side) => {
  const i = bounds(label, b)
  return s === 'pessimistic' ? i.highMinor : i.lowMinor
}

function resolve(e: UncertainEvent, s: Side): EngineEvent {
  switch (e.kind) {
    case 'income_stops':
      return {
        ...e,
        protection: e.protection
          ? { ...e.protection, monthlyMinor: good('protection', e.protection.monthlyMinor, s) }
          : undefined,
      }
    case 'mortgage_fix_ends':
      return { ...e, monthlyIncreaseMinor: bad('mortgage rise', e.monthlyIncreaseMinor, s) }
    case 'earner_dies':
      return {
        ...e,
        lumpSumOnFileMinor: good('payout', e.lumpSumOnFileMinor, s),
        payoutAfterMonths: payoutMonths(e.payoutAfterMonths, s),
      }
  }
}

function run(input: RangeInput, s: Side): number {
  const months = input.horizonMonths ?? DEFAULT_HORIZON_MONTHS
  const timeline = flatTimeline(
    months,
    good('inflow', input.monthlyInflowMinor, s),
    bad('spend', input.monthlySpendMinor, s),
  )
  const events = input.events.map((e) => resolve(e, s))
  return simulate(good('savings', input.savingsMinor, s), applyEvents(timeline, events))
    .monthsCovered
}

export function runwayRange(input: RangeInput): RunwayRange {
  const exactInputs =
    isExact(input.savingsMinor) &&
    isExact(input.monthlyInflowMinor) &&
    isExact(input.monthlySpendMinor) &&
    input.events.every((e) => {
      if (e.kind === 'income_stops') return !e.protection || isExact(e.protection.monthlyMinor)
      if (e.kind === 'mortgage_fix_ends') return isExact(e.monthlyIncreaseMinor)
      return isExact(e.lumpSumOnFileMinor) && isExactMonths(e.payoutAfterMonths)
    })
  return {
    lowMonths: run(input, 'pessimistic'),
    highMonths: run(input, 'optimistic'),
    exactInputs,
  }
}

export const LEFT_OUT = [
  'waiting-period exceptions',
  'tax and benefits',
  'changes in spending',
  'inflation',
] as const

const months = (n: number) => `${n} month${n === 1 ? '' : 's'}`
const OPEN = `${DEFAULT_HORIZON_MONTHS / 12} years or more`

export function describeRange(r: RunwayRange, subject = 'Savings'): string {
  let body: string
  if (r.lowMonths === NO_END) body = `about ${OPEN}`
  else if (r.highMonths === NO_END) body = `from ${months(r.lowMonths)} to ${OPEN}`
  else if (r.lowMonths === r.highMonths) body = `about ${months(r.lowMonths)}`
  else body = `${r.lowMonths} to ${months(r.highMonths)}`
  const basis = r.exactInputs
    ? 'This is an estimate from the exact figures entered, so real life will vary.'
    : 'This is an estimate from the figures entered, with the unconfirmed ones shown as a range.'
  return `${subject} would cover ${body}. ${basis} It leaves out ${LEFT_OUT.join(', ')}.`
}
