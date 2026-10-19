/**
 * The read-only sample day on the landing page. The family and every figure are
 * invented for illustration and must be labelled as an example wherever shown.
 */
export interface SampleFamily {
  income: number
  spend: number
  savings: number
  cover: number
}

export const SAMPLE_FAMILY: SampleFamily = {
  income: 3800,
  spend: 2900,
  savings: 8200,
  cover: 180000,
}

/** Months shown as a number; anything past this is drawn as "24+". */
export const RUNWAY_CAP = 24

export type SeaState = 'rough' | 'holding' | 'steady'

export interface Scenario {
  id: string
  chip: string
  title: string
  /** Monthly income and spend under the scenario, and the pot that pays for it. */
  calc: (s: SampleFamily) => { income: number; spend: number; fund: number; note: string }
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'income-stops',
    chip: 'Income stops',
    title: 'If income stops',
    calc: (s) => ({
      income: 0,
      spend: s.spend,
      fund: s.savings,
      note: 'No wages, benefits or other income counted.',
    }),
  },
  {
    id: 'income-halves',
    chip: 'One income drops',
    title: 'If one income drops by half',
    calc: (s) => ({
      income: s.income * 0.5,
      spend: s.spend,
      fund: s.savings,
      note: 'Example: the partner brings half of take-home. No benefits counted.',
    }),
  },
  {
    id: 'new-baby',
    chip: 'A new baby',
    title: 'If the household grows',
    calc: (s) => ({
      income: s.income * 0.7,
      spend: s.spend + 650,
      fund: s.savings,
      note: 'Example: spending up £650 a month, income down 30%.',
    }),
  },
  {
    id: 'main-earner',
    chip: 'Losing a main earner',
    title: 'If a main earner is no longer there',
    calc: (s) => ({
      income: 0,
      spend: s.spend,
      fund: s.savings + s.cover,
      note: 'Savings plus cover on file. No other income counted.',
    }),
  },
]

/** Months the pot lasts at the monthly shortfall. Infinity when income covers spend. */
export function runwayMonths(c: { income: number; spend: number; fund: number }): number {
  const gap = c.spend - c.income
  return gap <= 0 ? Infinity : c.fund / gap
}

export function seaState(months: number): SeaState {
  return months < 3 ? 'rough' : months < 6 ? 'holding' : 'steady'
}
