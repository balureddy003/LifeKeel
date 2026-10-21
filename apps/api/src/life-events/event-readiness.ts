/**
 * Computes a real, personalized "Family Readiness" score for a /events
 * "What If?" hypothetical scenario, reusing the exact formulas already
 * proven elsewhere in this codebase — render-playbook.ts's job-loss
 * runway math and detectors/family/protection-gap.yaml's life-cover-vs-
 * need comparison — rather than /events' previous hardcoded
 * EVENT_STABILITY fallback map (apps/web's EventDetailClient.tsx), which
 * showed the same number regardless of what was actually on file.
 *
 * Deliberately does not attempt every /events id:
 * - university/retirement reuse the same quantities their detectors
 *   weigh (education_funds current-vs-target; projectRetirement's
 *   achievable-vs-target income) — added for UAT D5/D6 so the frontend
 *   never substitutes an insight's gap-confidence for a readiness score.
 * - new-child/marriage have no defensible readiness formula anywhere in
 *   this codebase. Forcing a number for those would fabricate the kind
 *   of precision this app works hard everywhere else to avoid — they
 *   stay on the static sample explanation, honestly labeled as such.
 * - car/property/travel have no coverage-adequacy detector yet either
 *   (family-financial-profile.ts's own comment: "No new coverage-
 *   adequacy detector for either type yet... recordable today, reasoned-
 *   about later") — so a matching policy on file raises the score to
 *   reflect "you have real cover", not a fabricated gap percentage.
 */
import { formatMoney } from '@lifekeel/platform'
import type { FinancialProfile } from '../routes/family-financial-profile.js'
import { educationFundingGapMinor, projectRetirement } from '../routes/family-financial-profile.js'

export interface EventReadinessResult {
  stability: number
  explanation: string
  hasLiveData: boolean
}

const NO_DATA: EventReadinessResult = { stability: 0, explanation: '', hasLiveData: false }

// Never claim certainty (100%) or hopelessness (0%) from a single
// estimate — same posture as this codebase's other estimates, which
// always carry a "this is informational, not a guarantee" disclaimer.
function clampScore(n: number): number {
  return Math.max(5, Math.min(98, Math.round(n)))
}

function formatMonths(months: number): string {
  if (months < 1) return 'less than a month'
  if (months === 1) return '1 month'
  return `${Math.floor(months)} months`
}

function jobLossReadiness(profile: FinancialProfile): EventReadinessResult {
  const { emergency_savings_minor, monthly_expenses_minor } = profile.emergency_fund
  if (monthly_expenses_minor <= 0) return NO_DATA
  const months = emergency_savings_minor / monthly_expenses_minor
  return {
    stability: clampScore((months / 6) * 100),
    explanation: `Based on your real numbers, your emergency savings of ${formatMoney(emergency_savings_minor)} cover about ${formatMonths(months)} at your current spend of ${formatMoney(monthly_expenses_minor)}/month. A common guideline is 3-6 months.`,
    hasLiveData: true,
  }
}

// Shared by bereavement and medical — both are ultimately "would the
// household's life cover hold up against its real obligations", the same
// question detectors/family/protection-gap.yaml's
// life_insurance_below_household_needs rule already answers.
function lifeCoverReadiness(profile: FinancialProfile): EventReadinessResult {
  const { mortgage_outstanding_minor, life_cover_minor, annual_living_expenses_minor } =
    profile.household
  const need =
    mortgage_outstanding_minor +
    educationFundingGapMinor(profile.education_funds) +
    annual_living_expenses_minor * 5
  if (need <= 0) {
    return {
      stability: 95,
      explanation:
        "Based on your real data, your household has no mortgage, education savings gap, or living expenses on file to replace — there's no meaningful life-cover need to flag right now.",
      hasLiveData: true,
    }
  }
  return {
    stability: clampScore((life_cover_minor / need) * 100),
    explanation: `Based on your real data, your listed life insurance cover of ${formatMoney(life_cover_minor)} compares to an estimated household need of ${formatMoney(need)} (mortgage + education gap + 5 years of living expenses).`,
    hasLiveData: true,
  }
}

function policyPresenceReadiness(
  profile: FinancialProfile,
  type: FinancialProfile['policies'][number]['type'],
  label: string,
): EventReadinessResult {
  const policy = profile.policies.find((p) => p.type === type)
  if (!policy) return NO_DATA
  const coverage =
    policy.coverage_amount_minor > 0 ? ` (${formatMoney(policy.coverage_amount_minor)} cover)` : ''
  return {
    stability: 92,
    explanation: `Based on your real data, you have ${label} insurance with ${policy.provider} on file${coverage}.`,
    hasLiveData: true,
  }
}

// University: aggregate coverage of every education fund's target —
// the same quantities family_education_shortfall weighs per fund.
function universityReadiness(profile: FinancialProfile): EventReadinessResult {
  const funds = profile.education_funds.filter((f) => f.target_savings_minor > 0)
  if (funds.length === 0) return NO_DATA
  const saved = funds.reduce((s, f) => s + f.current_savings_minor, 0)
  const target = funds.reduce((s, f) => s + f.target_savings_minor, 0)
  const names = funds.map((f) => f.child_name).join(' and ')
  return {
    stability: clampScore((saved / target) * 100),
    explanation: `Based on your real data, ${names}'s education funds hold ${formatMoney(saved)} against a combined target of ${formatMoney(target)}.`,
    hasLiveData: true,
  }
}

// Retirement: the exact projection readiness/score.ts already uses —
// achievable retirement income vs the target income.
function retirementReadiness(profile: FinancialProfile): EventReadinessResult {
  const r = profile.retirement
  if (r.target_retirement_income_minor <= 0) return NO_DATA
  const p = projectRetirement(r)
  const pct = (p.achievable_retirement_income_minor / r.target_retirement_income_minor) * 100
  return {
    stability: clampScore(pct),
    explanation:
      r.current_age >= r.target_retirement_age
        ? `Based on your real data, the pension balance of ${formatMoney(r.pension_balance_minor)} supports about ${formatMoney(p.achievable_retirement_income_minor)}/yr against a ${formatMoney(r.target_retirement_income_minor)}/yr target.`
        : `Based on your real data, current contributions project to about ${formatMoney(p.achievable_retirement_income_minor)}/yr against a ${formatMoney(r.target_retirement_income_minor)}/yr target — on pace to retire around age ${p.projected_retirement_age}.`,
    hasLiveData: true,
  }
}

export function computeEventReadiness(
  eventId: string,
  profile: FinancialProfile,
): EventReadinessResult {
  switch (eventId) {
    case 'job-loss':
      return jobLossReadiness(profile)
    case 'bereavement':
    case 'medical':
      return lifeCoverReadiness(profile)
    case 'car':
      return policyPresenceReadiness(profile, 'car', 'car')
    case 'property':
      return policyPresenceReadiness(profile, 'home', 'home')
    case 'travel':
      return policyPresenceReadiness(profile, 'travel', 'travel')
    case 'university':
      return universityReadiness(profile)
    case 'retirement':
      return retirementReadiness(profile)
    default:
      return NO_DATA
  }
}
