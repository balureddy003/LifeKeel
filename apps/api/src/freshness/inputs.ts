/**
 * Detector input registry and freshness evaluation (PRD-145).
 *
 * Detector YAMLs declare signal types and rule conditions, not which inputs a
 * check needs or how old they may be, and the engine's strict schema is not
 * ours to extend. So the declaration lives here, beside the code that builds
 * the signals. A test fails if a detector in `detectors/family/` has no entry.
 *
 * Age is the profile's last human touch (`reviewed_at`, else `updated_at`):
 * the profile carries no per-field timestamps and document dates (PRD-143) do
 * not exist yet. Dated fields (policy renewal dates) are checked on their own.
 * Pure and deterministic: no model call, and only names are returned, never
 * values.
 */
import type { FinancialProfile } from '../routes/family-financial-profile.js'

export type FreshnessState = 'running' | 'paused_missing' | 'paused_stale' | 'not_applicable'

export interface InputRequirement {
  /** Field path as shown to people and stored, e.g. "household.monthly_salary_minor". */
  field: string
  present: (p: FinancialProfile) => boolean
}

export interface DetectorInputs {
  detector_id: string
  /** Plain-language name used in the digest and the app. */
  label: string
  /** When false the detector has nothing to check for this family (no children, no policies). */
  applies: (p: FinancialProfile) => boolean
  required: InputRequirement[]
  /** Profile older than this makes the check run on figures that may have moved. */
  max_age_days: number
  /** Extra staleness rule on a dated field, e.g. a renewal date already in the past. */
  stale_dated?: (p: FinancialProfile, now: Date) => string[]
}

const salary: InputRequirement = {
  field: 'household.monthly_salary_minor',
  present: (p) => p.household.monthly_salary_minor > 0,
}
const expenses: InputRequirement = {
  field: 'emergency_fund.monthly_expenses_minor',
  present: (p) => p.emergency_fund.monthly_expenses_minor > 0,
}

// Hypothesis defaults, to be revisited with real data: savings figures move
// faster than cover or pension figures.
const SIX_MONTHS = 180
const ONE_YEAR = 365

export const DETECTOR_INPUTS: DetectorInputs[] = [
  {
    detector_id: 'family_protection_gap',
    label: 'Protection',
    applies: () => true,
    required: [
      salary,
      {
        field: 'household.annual_living_expenses_minor',
        present: (p) => p.household.annual_living_expenses_minor > 0,
      },
    ],
    max_age_days: ONE_YEAR,
  },
  {
    detector_id: 'family_emergency_fund_adequacy',
    label: 'Emergency fund',
    applies: () => true,
    required: [expenses],
    max_age_days: SIX_MONTHS,
  },
  {
    detector_id: 'family_emergency_trajectory',
    label: 'Emergency fund pace',
    applies: () => true,
    required: [expenses, salary],
    max_age_days: SIX_MONTHS,
  },
  {
    detector_id: 'family_debt_health',
    label: 'Debt',
    applies: () => true,
    required: [salary],
    max_age_days: ONE_YEAR,
  },
  {
    detector_id: 'family_retirement_gap',
    label: 'Retirement',
    applies: () => true,
    required: [
      salary,
      { field: 'retirement.current_age', present: (p) => p.retirement.current_age > 0 },
      {
        field: 'retirement.target_retirement_age',
        present: (p) => p.retirement.target_retirement_age > 0,
      },
      {
        field: 'retirement.target_retirement_income_minor',
        present: (p) => p.retirement.target_retirement_income_minor > 0,
      },
    ],
    max_age_days: ONE_YEAR,
  },
  {
    detector_id: 'family_education_shortfall',
    label: 'Education savings',
    applies: (p) => p.education_funds.length > 0,
    required: [
      {
        field: 'education_funds.target_savings_minor',
        present: (p) => p.education_funds.every((f) => f.target_savings_minor > 0),
      },
    ],
    max_age_days: SIX_MONTHS,
  },
  {
    detector_id: 'family_education_pacing',
    label: 'Education savings pace',
    applies: (p) => p.education_funds.length > 0,
    required: [
      salary,
      {
        field: 'education_funds.target_savings_minor',
        present: (p) => p.education_funds.every((f) => f.target_savings_minor > 0),
      },
    ],
    max_age_days: SIX_MONTHS,
  },
  {
    detector_id: 'family_policy_review',
    label: 'Policies',
    applies: (p) => p.policies.length > 0,
    required: [],
    max_age_days: ONE_YEAR,
    stale_dated: (p, now) =>
      p.policies.some(
        (pol) => pol.renewal_date && new Date(pol.renewal_date).getTime() < now.getTime(),
      )
        ? ['policies.renewal_date']
        : [],
  },
  {
    // Reads the vault and the legacy register, not the profile, and "no will
    // on file" is itself a result, so there is nothing for it to be missing.
    detector_id: 'family_estate_readiness',
    label: 'Wills and legacy',
    applies: () => true,
    required: [],
    max_age_days: Number.POSITIVE_INFINITY,
  },
]

export interface DetectorFreshness {
  detector_id: string
  label: string
  state: FreshnessState
  /** Field names responsible; empty when running or not applicable. */
  input: string[]
}

const DAY_MS = 86_400_000

/**
 * @param profile null when the family has not created a profile at all.
 * @param touchedAt reviewed_at, else updated_at, of the profile document.
 */
export function evaluateFreshness(
  profile: FinancialProfile | null,
  touchedAt: Date | null,
  now: Date,
): DetectorFreshness[] {
  return DETECTOR_INPUTS.map((d) => {
    const base = { detector_id: d.detector_id, label: d.label }
    if (profile === null) {
      // Estate reads the vault, so it still runs with no profile.
      return d.required.length === 0 && d.stale_dated === undefined && d.max_age_days === Infinity
        ? { ...base, state: 'running' as const, input: [] }
        : {
            ...base,
            state: 'paused_missing' as const,
            input: d.required.map((r) => r.field),
          }
    }
    if (!d.applies(profile)) return { ...base, state: 'not_applicable' as const, input: [] }
    const missing = d.required.filter((r) => !r.present(profile)).map((r) => r.field)
    if (missing.length > 0) return { ...base, state: 'paused_missing' as const, input: missing }
    const stale: string[] = []
    if (touchedAt && now.getTime() - touchedAt.getTime() > d.max_age_days * DAY_MS) {
      stale.push(...d.required.map((r) => r.field))
    }
    if (d.stale_dated) stale.push(...d.stale_dated(profile, now))
    if (stale.length > 0)
      return { ...base, state: 'paused_stale' as const, input: [...new Set(stale)] }
    return { ...base, state: 'running' as const, input: [] }
  })
}

/** Share of applicable detectors running on current inputs, 0..1, or null if none apply. */
export function freshnessShare(rows: { state: FreshnessState }[]): number | null {
  const applicable = rows.filter((r) => r.state !== 'not_applicable')
  if (applicable.length === 0) return null
  return applicable.filter((r) => r.state === 'running').length / applicable.length
}
