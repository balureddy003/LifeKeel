/**
 * What a cohort may show (intent 96): coarse bands only, counts only, never below a minimum cohort size,
 * and small cells suppressed so no household can be picked out. Pure: no ids, no figures, no I/O.
 */
export type Band = '0-3' | '3-6' | '6-12' | '12+'

/** Provisional minimum number of contributing households before any count is shown. Owner to confirm. */
export const MIN_COHORT = 20
/** Cells smaller than this are reported as null. */
const MIN_CELL = 5

const BANDS: Band[] = ['0-3', '3-6', '6-12', '12+']

/** Months of runway into a coarse band. Open-ended (null) is the top band. */
export function bandOf(lowMonths: number | null): Band {
  if (lowMonths === null || lowMonths >= 12) return '12+'
  if (lowMonths >= 6) return '6-12'
  if (lowMonths >= 3) return '3-6'
  return '0-3'
}

export interface CohortSummary {
  total: number
  bands: Record<Band, number | null>
}

export function aggregateCohort(
  bands: readonly Band[],
  minCohort = MIN_COHORT,
): CohortSummary | null {
  if (bands.length < minCohort) return null
  const out = {} as Record<Band, number | null>
  for (const b of BANDS) {
    const n = bands.filter((x) => x === b).length
    out[b] = n >= MIN_CELL ? n : null
  }
  return { total: bands.length, bands: out }
}
