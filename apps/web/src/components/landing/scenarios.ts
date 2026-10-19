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

export function gbp(n: number): string {
  return '£' + Math.round(n).toLocaleString('en-GB')
}

export interface Scenario {
  id: string
  chip: string
  title: string
  /** Three tags, one per step. */
  tags: [string, string, string]
  /** Shown when the day is a hard one to look at. */
  hard?: string
  /** What Keel would check, from the sample family's figures. */
  steps: (s: SampleFamily) => [string, string, string]
  /** Monthly income and spend under the scenario, and the pot that pays for it. */
  calc: (s: SampleFamily) => { income: number; spend: number; fund: number; note: string }
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'income-stops',
    chip: 'Income stops',
    title: 'If income stops',
    tags: ['Costs', 'Cover', 'Support'],
    calc: (s) => ({
      income: 0,
      spend: s.spend,
      fund: s.savings,
      note: 'No wages, benefits or other income counted.',
    }),
    steps: (s) => [
      `Bills on file: about ${gbp(s.spend)} a month.`,
      "Income protection or redundancy cover on file, shown with that provider's claim contact.",
      'Benefits and support: Keel cannot say what applies. A licensed professional can.',
    ],
  },
  {
    id: 'income-halves',
    chip: 'One income drops',
    title: 'If one income drops by half',
    tags: ['Gap', 'Cover', 'Support'],
    calc: (s) => ({
      income: s.income * 0.5,
      spend: s.spend,
      fund: s.savings,
      note: 'Example: the partner brings half of take-home. No benefits counted.',
    }),
    steps: (s) => [
      `Income that continues and costs that do not change: the monthly gap is ${gbp(s.spend - s.income * 0.5)}.`,
      'Critical illness or income protection cover on file.',
      'Employer sick-pay terms are in the contract, not in Keel.',
    ],
  },
  {
    id: 'new-baby',
    chip: 'A new baby',
    title: 'If the household grows',
    tags: ['Costs', 'Cover', 'Goals'],
    calc: (s) => ({
      income: s.income * 0.7,
      spend: s.spend + 650,
      fund: s.savings,
      note: 'Example: spending up £650 a month, income down 30%.',
    }),
    steps: (s) => [
      `Spending estimated at about ${gbp(s.spend + 650)} a month.`,
      'Cover on file: Keel can only see what was entered, not whether it names a new dependant.',
      'Long-term costs are not measured.',
    ],
  },
  {
    id: 'main-earner',
    chip: 'Losing a main earner',
    title: 'If a main earner is no longer there',
    tags: ['Cover', 'Papers', 'Support'],
    hard: 'This is a hard one to look at. You can skip it.',
    calc: (s) => ({
      income: 0,
      spend: s.spend,
      fund: s.savings + s.cover,
      note: 'Savings plus cover on file. No other income counted.',
    }),
    steps: (s) => [
      `Cover on file of ${gbp(s.cover)} is held by the provider.`,
      'Will and power of attorney: whether documents are on file, and where the originals are kept.',
      'Decisions about any lump sum are for a licensed professional.',
    ],
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
