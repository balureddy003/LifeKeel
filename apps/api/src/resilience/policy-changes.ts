/**
 * What an edit to a policy changed and what stayed the same, for the three figures a household edits.
 * Pure: states old and new values only; it never says whether a change is good or what to do about it.
 */
export type PolicyFigure =
  'coverage_amount_minor' | 'monthly_premium_minor' | 'annual_premium_minor'

export const FIGURE_LABEL: Record<PolicyFigure, string> = {
  coverage_amount_minor: 'Cover',
  monthly_premium_minor: 'Monthly premium',
  annual_premium_minor: 'Yearly premium',
}

export interface PolicyChange {
  field: PolicyFigure
  label: string
  before: number
  after: number
}
export interface PolicyUnchanged {
  field: PolicyFigure
  label: string
  value: number
}

const FIELDS = Object.keys(FIGURE_LABEL) as PolicyFigure[]

export function policyChanges(
  before: Partial<Record<PolicyFigure, number>>,
  patch: Partial<Record<PolicyFigure, number>>,
): { changed: PolicyChange[]; unchanged: PolicyUnchanged[] } {
  const changed: PolicyChange[] = []
  const unchanged: PolicyUnchanged[] = []
  for (const field of FIELDS) {
    const was = before[field] ?? 0
    const now = patch[field] ?? was
    if (now !== was) changed.push({ field, label: FIGURE_LABEL[field], before: was, after: now })
    else if (was > 0) unchanged.push({ field, label: FIGURE_LABEL[field], value: was })
  }
  return { changed, unchanged }
}
