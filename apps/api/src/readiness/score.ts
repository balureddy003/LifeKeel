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
import type { EstateSignalData } from '../legacy/estate-signal.js'
import {
  educationFundingGapMinor,
  isUnsetTarget,
  projectRetirement,
} from '../routes/family-financial-profile.js'

export type ReadinessComponentKey =
  'emergency_fund' | 'protection' | 'retirement' | 'education' | 'estate'

export interface ReadinessComponent {
  key: ReadinessComponentKey
  label: string
  /** 0–100, or null when there's no data to judge this component by. */
  score: number | null
  /** Composite weight — renormalized over scored components only. */
  weight: number
  /** One plain-language line explaining the number ("covers ~4.2 months of expenses"). */
  detail: string
  /** The profile figures the score was computed from — the audit trail
   *  behind `detail`, so "why this score" shows real inputs, not just a
   *  conclusion. Minor units stay minor: the client formats. */
  drivers?: { label: string; value_minor?: number; value?: string }[]
  /** True when the caller can't see the underlying data at all (non-adult member and the estate vault). */
  gated?: boolean
  /** PRD-137: scope disclaimer the web must render with the score —
   *  lives in the component so no client can show the number without it. */
  caption?: string
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
  // Piecewise curve (intent 62): a straight months/6 ratio punished a
  // normal early-career profile — the ordinary 2–3 month buffer read ~35.
  // Zero runway stays punitive; 3 months is the common 'adequate' mark.
  const score =
    months <= 0
      ? 5
      : months >= MONTHS_OF_COVER_TARGET
        ? 100
        : Math.round(
            months <= 3
              ? 5 + (months / 3) * 60
              : 65 + ((months - 3) / (MONTHS_OF_COVER_TARGET - 3)) * 35,
          )
  const rounded = Math.round(months * 10) / 10
  return {
    key: 'emergency_fund',
    label: 'Emergency fund',
    score,
    weight: READINESS_WEIGHTS.emergency_fund,
    detail: `Savings cover ~${rounded} month${rounded === 1 ? '' : 's'} of expenses (target: ${MONTHS_OF_COVER_TARGET}).`,
    drivers: [
      { label: 'Emergency savings', value_minor: profile.emergency_fund.emergency_savings_minor },
      { label: 'Monthly expenses', value_minor: expenses },
      { label: 'Months covered', value: `${rounded} of ${MONTHS_OF_COVER_TARGET}` },
    ],
  }
}

type Earner = {
  employment_status: string
  income_protection_monthly_minor: number
  member_id?: string
}

/** Mirrors protection-gap.yaml's gates so a subscore and its explaining
 *  insight never disagree: life cover only counts when the family has a
 *  mortgage or dependents, income protection only for earners with income
 *  to protect and >1 year to target retirement, health/CI only with
 *  dependents on file. Each applicable check earns its share of 100. */
function protectionComponent(profile: FinancialProfile): ReadinessComponent {
  const hasDependents = profile.education_funds.length > 0
  const need =
    profile.household.mortgage_outstanding_minor +
    educationFundingGapMinor(profile.education_funds) +
    profile.household.annual_living_expenses_minor * 5
  const yearsToRetirement = Math.max(
    0,
    profile.retirement.target_retirement_age - profile.retirement.current_age,
  )

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
    (e) =>
      (e.employment_status === 'employed' || e.employment_status === 'self_employed') &&
      yearsToRetirement > 1,
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
    const covered = profile.policies.some(
      (p) => p.type === 'health' || p.type === 'critical_illness',
    )
    checks.push({
      weight: 20,
      earned: covered ? 20 : 0,
      label: 'health / critical illness',
      met: covered,
    })
  }

  if (checks.length === 0) {
    return {
      key: 'protection',
      label: 'Protection',
      score: null,
      weight: READINESS_WEIGHTS.protection,
      detail:
        'No protection needs apply to this household (no dependents, mortgage, or income to protect).',
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
    drivers: [
      ...(hasDependents || profile.household.mortgage_outstanding_minor > 0
        ? [
            { label: 'Life cover on file', value_minor: profile.household.life_cover_minor },
            { label: 'Estimated household need', value_minor: need },
          ]
        : []),
      ...(protectable.length > 0
        ? [
            {
              label: 'Earners with income protection',
              value: `${protectable.filter((e) => e.income_protection_monthly_minor > 0 || profile.policies.some((p) => p.type === 'income_protection' && (e.member_id ? p.member_id === e.member_id : p.member_id === undefined))).length} of ${protectable.length}`,
            },
          ]
        : []),
      ...(hasDependents
        ? [
            {
              label: 'Health / critical illness policy',
              value: profile.policies.some(
                (p) => p.type === 'health' || p.type === 'critical_illness',
              )
                ? 'On file'
                : 'Not on file',
            },
          ]
        : []),
    ],
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
  const score = Math.min(
    100,
    Math.round(
      (projection.achievable_retirement_income_minor / r.target_retirement_income_minor) * 100,
    ),
  )
  return {
    key: 'retirement',
    label: 'Retirement',
    score,
    weight: READINESS_WEIGHTS.retirement,
    detail:
      score >= 100
        ? `On track — projected to fund the target income by age ${r.target_retirement_age}.`
        : `Current trajectory funds ~${score}% of the target retirement income.`,
    drivers: [
      { label: 'Pension balance', value_minor: r.pension_balance_minor },
      { label: 'Monthly contribution', value_minor: r.monthly_contribution_minor },
      {
        label: 'Projected sustainable income',
        value_minor: projection.achievable_retirement_income_minor,
      },
      { label: 'Target income', value_minor: r.target_retirement_income_minor },
    ],
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
      detail:
        profile.education_funds.length === 0
          ? 'No education funds on file.'
          : 'No education targets set.',
    }
  }
  const scores = funded.map((f) =>
    Math.min(100, (f.current_savings_minor / f.target_savings_minor) * 100),
  )
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
    drivers: funded.map((f) => ({
      label: `${f.child_name}: saved vs target`,
      value: `${Math.round(f.current_savings_minor / 100).toLocaleString('en-GB')} / ${Math.round(f.target_savings_minor / 100).toLocaleString('en-GB')}`,
    })),
  }
}

/** The two documents a household's estate readiness minimally needs.
 *  `insurance_policy` and `estate_instruction` uploads count as context
 *  but don't move the score — presence of a will and PoA is the signal. */
export const ESTATE_EXPECTED_DOC_TYPES = ['will', 'power_of_attorney'] as const

// PRD-137 §4: the disclaimer every presentation of the estate score
// must carry — the register records what the family declared, so the
// number says nothing about legal validity.
const ESTATE_CAPTION = "Completeness and freshness of what's recorded — not legal validity."

/**
 * One scored check from PRD-137 §4: a label, the fraction of its
 * applicable population that's complete, and its weight. Checks with no
 * applicable population (no minors, no properties, no wills) return
 * null and drop out — the remaining weights renormalise to 100.
 */
function legacyCheck(
  label: string,
  total: number,
  complete: number,
  weight: number,
  unit: string,
): { earned: number; weight: number; driver: { label: string; value: string } } | null {
  if (total <= 0) return null
  return {
    earned: weight * (Math.min(complete, total) / total),
    weight,
    driver: { label, value: `${Math.min(complete, total)} of ${total} ${unit}` },
  }
}

function estateComponent(
  docTypesPresent: string[] | null,
  legacy?: EstateSignalData | null,
): ReadinessComponent {
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

  // PRD-137 §4: once the family has recorded anything in the legacy
  // register, the score reflects it — pro-rata per adult / minor /
  // property / will, with inapplicable checks dropped and the remaining
  // weights renormalised. No legacy records → the original vault-
  // boolean behaviour below.
  if (legacy?.has_legacy_records) {
    const wills = legacy.wills_total ?? 0
    const locationDocs = legacy.original_location_total ?? 0
    const checks = [
      legacyCheck('Wills recorded', legacy.adults_total, legacy.adults_with_will, 25, 'adults'),
      legacyCheck(
        'Powers of attorney recorded',
        legacy.adults_total,
        legacy.adults_with_poa,
        20,
        'adults',
      ),
      legacyCheck(
        'Guardian nominations',
        legacy.minors_total,
        legacy.minors_with_guardian_nomination,
        15,
        'minors',
      ),
      legacyCheck(
        'Executors resolvable',
        wills,
        wills - legacy.wills_with_dead_or_missing_executor,
        10,
        'wills',
      ),
      legacyCheck(
        'Property title evidence',
        legacy.properties_total,
        legacy.properties_total - legacy.properties_without_title_evidence,
        15,
        'properties',
      ),
      legacyCheck(
        'Original location known',
        locationDocs,
        locationDocs - legacy.documents_without_original_location,
        10,
        'documents',
      ),
      legacyCheck('Reviewed within 3 years', wills, wills - legacy.wills_stale, 5, 'wills'),
    ].filter((c): c is NonNullable<typeof c> => c !== null)

    const totalWeight = checks.reduce((s, c) => s + c.weight, 0)
    const score =
      totalWeight === 0
        ? null
        : Math.round((checks.reduce((s, c) => s + c.earned, 0) / totalWeight) * 100)
    const incomplete = checks.filter((c) => c.earned < c.weight).length
    return {
      key: 'estate',
      label: 'Estate',
      score,
      weight: READINESS_WEIGHTS.estate,
      detail:
        score === null
          ? 'Nothing in the legacy register is scorable yet.'
          : incomplete === 0
            ? 'Everything recorded in the legacy register is complete and current.'
            : `${incomplete} of ${checks.length} legacy checks need attention.`,
      drivers: checks.map((c) => c.driver),
      caption: ESTATE_CAPTION,
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
    caption: ESTATE_CAPTION,
  }
}

/**
 * Computes the composite score. `estateDocTypes` is the list of doc_type
 * values on the tenant's vault documents — pass null when the caller
 * isn't an adult family member (the vault is adult-gated), which yields a
 * gated estate component excluded from the weighted mean.
 */
export function computeReadiness(
  profile: FinancialProfile,
  estateDocTypes: string[] | null,
  legacy?: EstateSignalData | null,
): ReadinessResult {
  const components = [
    emergencyFundComponent(profile),
    protectionComponent(profile),
    retirementComponent(profile),
    educationComponent(profile),
    estateComponent(estateDocTypes, legacy),
  ]
  return combineComponents(components)
}

function combineComponents(components: ReadinessComponent[]): ReadinessResult {
  const scored = components.filter((c) => c.score !== null)
  const totalWeight = scored.reduce((s, c) => s + c.weight, 0)
  const score =
    totalWeight === 0
      ? null
      : Math.round(scored.reduce((s, c) => s + (c.score! * c.weight) / totalWeight, 0))
  return { score, components }
}

// ── Per-member readiness (PRD-118) ─────────────────────────────────────────
//
// The member twin's slice of readiness — same component vocabulary as the
// family score, scoped to what belongs to one member: their income
// protection, their life cover, their education funds. Emergency fund stays
// household-level (a shared pool isn't any one member's), and retirement is
// only scored for the organizer because the household pension projection is
// modeled on them — per-member pension contributions aren't collected yet,
// so other earners get an honest null rather than a borrowed number.

export const MEMBER_READINESS_WEIGHTS: Partial<Record<ReadinessComponentKey, number>> = {
  protection: 40,
  retirement: 25,
  education: 25,
  estate: 10,
}

export interface MemberSlice {
  memberId: string
  role: string
  /** Roster-derived age (date_of_birth) — feeds the member's own retirement projection. */
  age: number | null
  /** The member's earner record (members[] entry, or household fields for the organizer), null if not an earner. */
  earner: {
    employment_status: string
    monthly_salary_minor: number
    income_protection_monthly_minor: number
    pension_balance_minor?: number
    monthly_pension_contribution_minor?: number
  } | null
  /** Policies already filtered to this member (member_id attribution). */
  policies: { type: string; coverage_amount_minor?: number }[]
  /** Education funds already filtered to this member. */
  educationFunds: { current_savings_minor: number; target_savings_minor: number }[]
}

const ADULT_ROLES = new Set(['organizer', 'parent', 'adult'])

function memberProtectionComponent(
  profile: FinancialProfile | null,
  slice: MemberSlice,
): ReadinessComponent {
  const base = {
    key: 'protection' as const,
    label: 'Protection',
    weight: MEMBER_READINESS_WEIGHTS.protection!,
  }
  const need = profile
    ? profile.household.mortgage_outstanding_minor +
      educationFundingGapMinor(profile.education_funds) +
      profile.household.annual_living_expenses_minor * 5
    : 0
  const yearsToRetirement = profile
    ? Math.max(0, profile.retirement.target_retirement_age - profile.retirement.current_age)
    : 0

  const checks: Array<{ weight: number; earned: number; label: string; met: boolean }> = []

  const earner = slice.earner
  if (
    earner &&
    (earner.employment_status === 'employed' || earner.employment_status === 'self_employed') &&
    yearsToRetirement > 1
  ) {
    const covered =
      earner.income_protection_monthly_minor > 0 ||
      slice.policies.some((p) => p.type === 'income_protection')
    checks.push({ weight: 50, earned: covered ? 50 : 0, label: 'income protection', met: covered })
  }

  if (need > 0) {
    if (slice.role === 'organizer') {
      // The organizer's cover lives in two places: the household-level
      // life_cover figure plus any life policy explicitly attributed to
      // them. Scored as a fraction of need, like the family component.
      const attributedLife = slice.policies
        .filter((p) => p.type === 'life')
        .reduce((s, p) => s + (p.coverage_amount_minor ?? 0), 0)
      const fraction = Math.min(1, (profile!.household.life_cover_minor + attributedLife) / need)
      checks.push({ weight: 50, earned: fraction * 50, label: 'life cover', met: fraction >= 1 })
    } else {
      // No per-member need figure exists — an attributed life policy is
      // the binary signal that this member's cover was considered at all.
      const covered = slice.policies.some((p) => p.type === 'life')
      checks.push({ weight: 50, earned: covered ? 50 : 0, label: 'life cover', met: covered })
    }
  }

  if (checks.length === 0) {
    return { ...base, score: null, detail: 'No income to protect and no life-cover need applies.' }
  }
  const applicable = checks.reduce((s, c) => s + c.weight, 0)
  const earned = checks.reduce((s, c) => s + c.earned, 0)
  const score = Math.min(100, Math.round((earned / applicable) * 100))
  const gaps = checks.filter((c) => !c.met).map((c) => c.label)
  return {
    ...base,
    score,
    detail: gaps.length === 0 ? 'Cover is in place for this member.' : `Gaps: ${gaps.join(', ')}.`,
  }
}

/** Non-organizer retirement: scored from the member's own pension fields
 *  (PRD-119) projected on the household's target age/growth, compared
 *  against their income share of the household target income — the
 *  household target is a joint number, so the member's slice of it is
 *  proportional to what they earn. No pension data → honest null, same
 *  rule as the family score. */
function memberRetirementComponent(
  profile: FinancialProfile | null,
  slice: MemberSlice,
): ReadinessComponent {
  const base = {
    key: 'retirement' as const,
    label: 'Retirement',
    weight: MEMBER_READINESS_WEIGHTS.retirement!,
  }
  const earner = slice.earner
  const balance = earner?.pension_balance_minor ?? 0
  const contribution = earner?.monthly_pension_contribution_minor ?? 0
  if (!profile || !earner || (balance === 0 && contribution === 0)) {
    return {
      ...base,
      score: null,
      detail:
        'No pension figures on file for this member — add their balance and monthly contribution in the Financial Profile.',
    }
  }
  if (slice.age === null) {
    return {
      ...base,
      score: null,
      detail: "Set this member's date of birth to project their pension.",
    }
  }
  if (isUnsetTarget(profile.retirement.target_retirement_income_minor)) {
    return { ...base, score: null, detail: 'No household retirement income target set.' }
  }
  const totalSalary =
    profile.household.monthly_salary_minor +
    profile.household.members.reduce((s, m) => s + m.monthly_salary_minor, 0)
  if (totalSalary <= 0 || earner.monthly_salary_minor <= 0) {
    return {
      ...base,
      score: null,
      detail: "No salary on file to derive this member's share of the retirement target.",
    }
  }
  const memberTargetMinor = Math.round(
    (profile.retirement.target_retirement_income_minor * earner.monthly_salary_minor) / totalSalary,
  )
  const projection = projectRetirement({
    current_age: slice.age,
    target_retirement_age: profile.retirement.target_retirement_age,
    pension_balance_minor: balance,
    monthly_contribution_minor: contribution,
    target_retirement_income_minor: memberTargetMinor,
    expected_annual_growth_pct: profile.retirement.expected_annual_growth_pct,
  })
  const score = Math.min(
    100,
    Math.round((projection.achievable_retirement_income_minor / memberTargetMinor) * 100),
  )
  return {
    ...base,
    score,
    detail:
      score >= 100
        ? 'On track against their share of the household retirement target.'
        : `Trajectory funds ~${score}% of their share of the household retirement target.`,
  }
}

function memberEducationComponent(slice: MemberSlice): ReadinessComponent {
  const base = {
    key: 'education' as const,
    label: 'Education',
    weight: MEMBER_READINESS_WEIGHTS.education!,
  }
  const funded = slice.educationFunds.filter((f) => !isUnsetTarget(f.target_savings_minor))
  if (funded.length === 0) {
    return {
      ...base,
      score: null,
      detail:
        slice.educationFunds.length === 0
          ? 'No education fund linked to this member yet.'
          : 'No education target set.',
    }
  }
  const scores = funded.map((f) =>
    Math.min(100, (f.current_savings_minor / f.target_savings_minor) * 100),
  )
  const score = Math.round(scores.reduce((s, x) => s + x, 0) / scores.length)
  return {
    ...base,
    score,
    detail:
      funded.length === 1
        ? `Fund is ~${score}% of target.`
        : `Average ${score}% of target across ${funded.length} funds.`,
  }
}

/**
 * A member's readiness — deterministic, computed fresh from the same profile
 * the family score reads. `estateDocTypes` follows the same adult-gating as
 * computeReadiness: pass null when the *viewer* isn't an adult, and the
 * component comes back gated. Estate is only included for adult members —
 * it describes household estate planning, meaningless on a child's twin.
 */
export function computeMemberReadiness(
  profile: FinancialProfile | null,
  slice: MemberSlice,
  estateDocTypes: string[] | null,
  legacy?: EstateSignalData | null,
): ReadinessResult {
  const components: ReadinessComponent[] = []
  if (ADULT_ROLES.has(slice.role)) {
    components.push(memberProtectionComponent(profile, slice))
    if (slice.role === 'organizer' && profile) {
      const retirement = retirementComponent(profile)
      components.push({ ...retirement, weight: MEMBER_READINESS_WEIGHTS.retirement! })
    } else {
      components.push(memberRetirementComponent(profile, slice))
    }
  }
  if (slice.educationFunds.length > 0 || slice.role === 'child') {
    components.push(memberEducationComponent(slice))
  }
  if (ADULT_ROLES.has(slice.role)) {
    const estate = estateComponent(estateDocTypes, legacy)
    components.push({ ...estate, weight: MEMBER_READINESS_WEIGHTS.estate! })
  }
  return combineComponents(components)
}
