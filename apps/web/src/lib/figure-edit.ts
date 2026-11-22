/**
 * Changing one of the figures an estimate reads, in place. Pure rules only: which profile field a figure
 * lives in, turning typed pounds into pence (never NaN), and a one-line statement of what changed.
 * States what was entered; it says nothing about whether a figure is enough.
 */
import type { FinancialProfile } from './api'

type Section = 'household' | 'emergency_fund'

interface FigureField {
  section: Section
  field: string
  /** Zero is a real answer here (no income protection), nowhere else. */
  allowZero: boolean
}

export const FIGURE_FIELDS: Record<string, FigureField> = {
  savings_minor: { section: 'emergency_fund', field: 'emergency_savings_minor', allowZero: false },
  monthly_spend_minor: {
    section: 'emergency_fund',
    field: 'monthly_expenses_minor',
    allowZero: false,
  },
  monthly_inflow_minor: { section: 'household', field: 'monthly_salary_minor', allowZero: false },
  income_protection_monthly_minor: {
    section: 'household',
    field: 'income_protection_monthly_minor',
    allowZero: true,
  },
  life_cover_lump_sum_minor: { section: 'household', field: 'life_cover_minor', allowZero: false },
}

export const gbp = (minor: number) => `£${Math.round(minor / 100).toLocaleString('en-GB')}`

/** Pounds typed by a person to whole pence; null when blank, not a number, negative or too large. */
export function parsePounds(text: string, allowZero: boolean): number | null {
  const cleaned = text.replace(/[£,\s]/g, '')
  if (cleaned === '' || !/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const minor = Math.round(Number(cleaned) * 100)
  if (!Number.isSafeInteger(minor) || minor > 1_000_000_000_00) return null
  return minor === 0 && !allowZero ? null : minor
}

/** A copy of the profile with one figure changed; null for a figure this does not know. */
export function applyFigureEdit(
  profile: FinancialProfile,
  key: string,
  minor: number,
): FinancialProfile | null {
  const f = FIGURE_FIELDS[key]
  if (!f) return null
  return { ...profile, [f.section]: { ...profile[f.section], [f.field]: minor } }
}

export function changeSummary(label: string, from: number, to: number): string {
  return from === to
    ? `${label} is unchanged.`
    : `${label} changed from ${gbp(from)} to ${gbp(to)}.`
}
