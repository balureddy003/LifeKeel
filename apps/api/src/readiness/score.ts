/**
 * Composite Family Readiness Score — the server-side version of the number
 * apps/web used to derive client-side as `100 − Σ open-insight confidence
 * penalties` (fetchFamilyReadinessScore). That formula measured "how many
 * unresolved flags exist", not "how ready is this family" — a family with
 * a perfect profile and zero insights scored identically to one whose
 * detectors never ran, and the estate half of the readiness story (wills,
 * power of attorney) had no input at all.
 *
 * PRD-114: deterministic subscores computed from the real financial
 * profile + vault contents, mirroring the thresholds the four family
 * detectors already encode (3-month emergency floor, life-cover-need
 * formula, per-earner income protection, pension corpus projection,
 * per-child education targets). Insights explain a low subscore; they no
 * longer *are* the score.
 *
 * Every function is pure and defensive about absent data: a component the
 * family hasn't supplied data for returns score: null and drops out of
 * the composite's weighted mean entirely — "not entered yet" must never
 * read as 0, the same honesty rule useFamilyData's domainWasChecked
 * applies client-side.
 */

import type { FinancialProfile } from '../routes/family-financial-profile.js'
import { educationFundingGapMinor, isUnsetTarget, projectRetirement } from '../routes/family-financial-profile.js'

export type ReadinessComponentKey = 'emergency_fund' | 'protection' | 'retirement' | 'education' | 'estate'

export interface ReadinessComponent {
  key: ReadinessComponentKey
  label: string
  /** 0–100, or null when there's no data to judge this component by. */
  score: number | null
  /** Composite weight — renormalized over scored components only. */
  weight: number
  /** One plain-language line explaining the number ("covers ~4.2 months of expenses"). */
  detail: string
  /** True when the caller can't see the underlying data at all (non-adult member and the estate vault). */
  gated?: boolean
}

export interface ReadinessResult {
  /** Weighted mean over components that have a score; null when nothing was scorable. */
  score: number | null
  components: ReadinessComponent[]
}

export const READINESS_WEIGHTS: Record<ReadinessComponentKey, number> = {
  emergency_fund: 25,
  protection: 30,
  retirement: 20,
  education: 15,
  estate: 10,
}

const MONTHS_OF_COVER_TARGET = 6

/** Same fallback the detector evaluation applies (family-financial-profile.ts):
 *  a family that only entered annual living expenses still gets judged. */
function monthlyExpensesMinor(profile: FinancialProfile): number {
  return (
    profile.emergency_fund.monthly_expenses_minor ||
    Math.round(profile.household.annual_living_expenses_minor / 12)
  )
}

function emergencyFundComponent(profile: FinancialProfile): ReadinessComponent {
  const expenses = monthlyExpensesMinor(profile)
  if (expenses <= 0) {
    return {
      key: 'emergency_fund',
      label: 'Emergency fund',
      score: null,
      weight: READINESS_WEIGHTS.emergency_fund,
      detail: 'No expense figure on file to measure runway against.',
    }
  }
  const months = profile.emergency_fund.emergency_savings_minor / expenses
  const score = Math.min(100, Math.round((months / MONTHS_OF_COVER_TARGET) * 100))
  const rounded = Math.round(months * 10) / 10
  return {
    key: 'emergency_fund',
    label: 'Emergency fund',
    score,
    weight: READINESS_WEIGHTS.emergency_fund,
    detail: `Savings cover ~${rounded} month${rounded === 1 ? '' : 's'} of expenses (target: ${MONTHS_OF_COVER_TARGET}).`,
  }
}

type Earner = { employment_status: string; income_protection_monthly_minor: number; member_id?: string }

/** Mirrors protection-gap.yaml's gates so a subscore and its explaining
 *  insight never disagree: life cover only counts when the family has a
 *  mortgage or dependents, income protection only for earners with income
 *  to protect and >1 year to target retirement, health/CI only with
 *  dependents on file. Each applicable check earns its share of 100. */
function protectionComponent(profile: FinancialProfile): ReadinessComponent {
  const hasDependents = profile.education_funds.length > 0
  const need = profile.household.mortgage_outstanding_minor
    + educationFundingGapMinor(profile.education_funds)
    + profile.household.annual_living_expenses_minor * 5
  const yearsToRetirement = Math.max(0, profile.retirement.target_retirement_age - profile.retirement.current_age)

  const checks: Array<{ weight: number; earned: number; label: string; met: boolean }> = []

  if (hasDependents || profile.household.mortgage_outstanding_minor > 0) {
    checks.push({
      weight: 40,
      earned: Math.min(40, (profile.household.life_cover_minor / need) * 40),
      label: 'life cover',
      met: profile.household.life_cover_minor >= need,
    })
  }

  const earners: Earner[] = [profile.household, ...profile.household.members]
  const protectable = earners.filter(
    (e) => (e.employment_status === 'employed' || e.employment_status === 'self_employed') && yearsToRetirement > 1,
  )
  if (protectable.length > 0) {
    const covered = protectable.filter((e) => {
      if (e.income_protection_monthly_minor > 0) return true
      return profile.policies.some(
        (p) =>
          p.type === 'income_protection' &&
          // member_id links a policy to a named member earner; an
          // unattributed policy counts toward the primary (unattributed)
          // household earner — the same convention the wizard uses.
          (e.member_id ? p.member_id === e.member_id : p.member_id === undefined),
      )
    })
    checks.push({
      weight: 40,
      earned: (covered.length / protectable.length) * 40,
      label: 'income protection',
      met: covered.length === protectable.length,
    })
  }

  if (hasDependents) {
    const covered = profile.policies.some((p) => p.type === 'health' || p.type === 'critical_illness')
    checks.push({ weight: 20, earned: covered ? 20 : 0, label: 'health / critical illness', met: covered })
  }

  if (checks.length === 0) {
    return {
      key: 'protection',
      label: 'Protection',
      score: null,
      weight: READINESS_WEIGHTS.protection,
      detail: 'No protection needs apply to this household (no dependents, mortgage, or income to protect).',
    }
  }

  const applicable = checks.reduce((s, c) => s + c.weight, 0)
  const earned = checks.reduce((s, c) => s + c.earned, 0)
  const score = Math.min(100, Math.round((earned / applicable) * 100))
  const gaps = checks.filter((c) => !c.met).map((c) => c.label)
  return {
    key: 'protection',
    label: 'Protection',
    score,
    weight: READINESS_WEIGHTS.protection,
    detail: gaps.length === 0 ? 'All applicable cover is in place.' : `Gaps: ${gaps.join(', ')}.`,
  }
}

function retirementComponent(profile: FinancialProfile): ReadinessComponent {
  const r = profile.retirement
  if (isUnsetTarget(r.target_retirement_income_minor)) {
    return {
      key: 'retirement',
      label: 'Retirement',
      score: null,
      weight: READINESS_WEIGHTS.retirement,
      detail: 'No retirement income target set.',
    }
  }
  const projection = projectRetirement(r)
  const score = Math.min(100, Math.round((projection.achievable_retirement_income_minor / r.target_retirement_income_minor) * 100))
  return {
    key: 'retirement',
    label: 'Retirement',
    score,
    weight: READINESS_WEIGHTS.retirement,
    detail:
      score >= 100
        ? `On track — projected to fund the target income by age ${r.target_retirement_age}.`
        : `Current trajectory funds ~${score}% of the target retirement income.`,
  }
}

function educationComponent(profile: FinancialProfile): ReadinessComponent {
  const funded = profile.education_funds.filter((f) => !isUnsetTarget(f.target_savings_minor))
  if (funded.length === 0) {
    return {
      key: 'education',
      label: 'Education',
      score: null,
      weight: READINESS_WEIGHTS.education,
      detail: profile.education_funds.length === 0 ? 'No education funds on file.' : 'No education targets set.',
    }
  }
  const scores = funded.map((f) => Math.min(100, (f.current_savings_minor / f.target_savings_minor) * 100))
  const score = Math.round(scores.reduce((s, x) => s + x, 0) / scores.length)
  return {
    key: 'education',
    label: 'Education',
    score,
    weight: READINESS_WEIGHTS.education,
    detail:
      funded.length === 1
        ? `${funded[0]!.child_name}'s fund is ~${score}% of target.`
        : `Average ${score}% of target across ${funded.length} funds.`,
  }
}

/** The two documents a household's estate readiness minimally needs.
 *  `insurance_policy` and `estate_instruction` uploads count as context
 *  but don't move the score — presence of a will and PoA is the signal. */
export const ESTATE_EXPECTED_DOC_TYPES = ['will', 'power_of_attorney'] as const

function estateComponent(docTypesPresent: string[] | null): ReadinessComponent {
  if (docTypesPresent === null) {
    return {
      key: 'estate',
      label: 'Estate',
      score: null,
      weight: READINESS_WEIGHTS.estate,
      detail: 'Vault contents are only visible to adult family members.',
      gated: true,
    }
  }
  const present = ESTATE_EXPECTED_DOC_TYPES.filter((t) => docTypesPresent.includes(t))
  const score = Math.round((present.length / ESTATE_EXPECTED_DOC_TYPES.length) * 100)
  const missing = ESTATE_EXPECTED_DOC_TYPES.filter((t) => !docTypesPresent.includes(t))
  return {
    key: 'estate',
    label: 'Estate',
    score,
    weight: READINESS_WEIGHTS.estate,
    detail:
      missing.length === 0
        ? 'Will and power of attorney are both in the vault.'
        : `Missing from the vault: ${missing.map((t) => (t === 'power_of_attorney' ? 'power of attorney' : t)).join(', ')}.`,
  }
}

/**
 * Computes the composite score. `estateDocTypes` is the list of doc_type
 * values on the tenant's vault documents — pass null when the caller
 * isn't an adult family member (the vault is adult-gated), which yields a
 * gated estate component excluded from the weighted mean.
 */
export function computeReadiness(profile: FinancialProfile, estateDocTypes: string[] | null): ReadinessResult {
  const components = [
    emergencyFundComponent(profile),
    protectionComponent(profile),
    retirementComponent(profile),
    educationComponent(profile),
    estateComponent(estateDocTypes),
  ]
  const scored = components.filter((c) => c.score !== null)
  const totalWeight = scored.reduce((s, c) => s + c.weight, 0)
  const score =
    totalWeight === 0
      ? null
      : Math.round(scored.reduce((s, c) => s + (c.score! * c.weight) / totalWeight, 0))
  return { score, components }
}
