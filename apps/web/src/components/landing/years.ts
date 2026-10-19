/** Four stages of one sample family and what joins the chart at each. Only things available today. */
export interface Year {
  name: string
  season: string
  line: string
}

export const YEARS: Year[] = [
  {
    name: 'First home',
    season: 'Spring',
    line: 'Two adults and one home. Keel starts with the papers and policies you tell it about.',
  },
  {
    name: 'A first child',
    season: 'Summer',
    line: 'A smaller boat joins. The checks start to count a dependant.',
  },
  {
    name: 'Growing up',
    season: 'Autumn',
    line: 'The smaller boat grows and another joins. You update the chart instead of starting again.',
  },
  {
    name: 'Later years',
    season: 'Winter',
    line: 'The boats are full size. It is the same chart, with more on it.',
  },
]

export interface YearItem {
  /** Stage (1 to 4) at which this joins the chart. */
  stage: 1 | 2 | 3 | 4
  claim: string
  text: string
}

export const YEAR_ITEMS: YearItem[] = [
  { stage: 1, claim: 'papers-on-file', text: 'Wills and papers on file' },
  { stage: 1, claim: 'renewals-duplicates', text: 'Home policy and its renewal date' },
  { stage: 2, claim: 'retirement-education', text: 'Education savings checks' },
  { stage: 2, claim: 'cover-on-file', text: 'Cover estimate counts a dependant' },
  { stage: 3, claim: 'debt-health', text: 'Debt health, as costs change' },
  { stage: 4, claim: 'retirement-education', text: 'Retirement gap check' },
]
