/**
 * Monthly cash-flow model (intent 94, R1). Pure and deterministic: no I/O, no model call, no advice.
 * Figures are whole minor units. A runway is a count of whole months the savings cover, or NO_END when
 * the figures give no end inside the horizon. It is an estimate from the figures entered.
 */
export const NO_END = 9999
export const DEFAULT_HORIZON_MONTHS = 120

export interface MonthFlow {
  inflowMinor: number
  spendMinor: number
}

export interface SimulationResult {
  /** Whole months covered before savings would run short, or NO_END within the horizon. */
  monthsCovered: number
  /** Balance after each simulated month (stops at the first short month). */
  balanceByMonthMinor: number[]
}

function assertMoney(label: string, n: number): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`${label} must be a whole, non-negative amount in minor units`)
  }
}

export function flatTimeline(months: number, inflowMinor: number, spendMinor: number): MonthFlow[] {
  return Array.from({ length: months }, () => ({ inflowMinor, spendMinor }))
}

export function simulate(savingsMinor: number, timeline: MonthFlow[]): SimulationResult {
  assertMoney('savings', savingsMinor)
  const balanceByMonthMinor: number[] = []
  let balance = savingsMinor
  for (let i = 0; i < timeline.length; i++) {
    const m = timeline[i]!
    assertMoney('inflow', m.inflowMinor)
    assertMoney('spend', m.spendMinor)
    balance += m.inflowMinor - m.spendMinor
    if (balance < 0) return { monthsCovered: i, balanceByMonthMinor }
    balanceByMonthMinor.push(balance)
  }
  return { monthsCovered: NO_END, balanceByMonthMinor }
}

export function runwayMonths(input: {
  savingsMinor: number
  monthlySpendMinor: number
  monthlyInflowMinor: number
  horizonMonths?: number
}): number {
  const timeline = flatTimeline(
    input.horizonMonths ?? DEFAULT_HORIZON_MONTHS,
    input.monthlyInflowMinor,
    input.monthlySpendMinor,
  )
  return simulate(input.savingsMinor, timeline).monthsCovered
}
