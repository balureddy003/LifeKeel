/**
 * Offering a brief's figures to the family list. Pure rules only: which of the numbers typed into a brief
 * are worth saving, and what is on file for them now. It states what was typed and what is on file; it says
 * nothing about whether a figure is enough. Zero is kept only where it is a real answer (no savings, no
 * income protection), never for spending or income.
 */
import type { BriefInputs, FinancialProfile } from './api'

interface Source {
  key: string
  label: string
  input: keyof BriefInputs
  allowZero: boolean
  /** Where the figure lives on the profile, for "on file now". */
  section: 'household' | 'emergency_fund'
  field: string
}

const SOURCES: Source[] = [
  {
    key: 'savings_minor',
    label: 'Savings',
    input: 'liquid_savings_minor',
    allowZero: true,
    section: 'emergency_fund',
    field: 'emergency_savings_minor',
  },
  {
    key: 'monthly_spend_minor',
    label: 'Monthly spending',
    input: 'monthly_essentials_minor',
    allowZero: false,
    section: 'emergency_fund',
    field: 'monthly_expenses_minor',
  },
  {
    key: 'monthly_inflow_minor',
    label: 'Monthly income',
    input: 'monthly_income_minor',
    allowZero: false,
    section: 'household',
    field: 'monthly_salary_minor',
  },
  {
    key: 'income_protection_monthly_minor',
    label: 'Income protection per month',
    input: 'income_protection_monthly_minor',
    allowZero: true,
    section: 'household',
    field: 'income_protection_monthly_minor',
  },
]

export interface PendingFigure {
  key: string
  label: string
  minor: number
  /** What the family list holds now; null when nothing is on file. */
  current: number | null
}

const sensible = (n: unknown, allowZero: boolean): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && (allowZero ? n >= 0 : n > 0)

export function pendingFigures(
  inputs: BriefInputs | null | undefined,
  profile: FinancialProfile | null | undefined,
): PendingFigure[] {
  if (!inputs) return []
  const out: PendingFigure[] = []
  for (const s of SOURCES) {
    const minor = inputs[s.input]
    if (!sensible(minor, s.allowZero)) continue
    const raw = (profile?.[s.section] as Record<string, unknown> | undefined)?.[s.field]
    const current = typeof raw === 'number' ? raw : null
    if (current === minor) continue
    out.push({ key: s.key, label: s.label, minor, current })
  }
  return out
}

export function saveBody(rows: PendingFigure[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.key, r.minor]))
}
