import type { EmploymentStatus, FinancialProfile } from './api'
import { PERSON_SCOPED_POLICY_TYPES } from './policyTypes'

export interface MemberChip {
  label: string
  onFile: boolean
}

/**
 * Per-member "what's on file" chips — replaced the old 0%/100% completion
 * bar, which reduced "has any data at all" into a number that implied far
 * more completeness than it could honestly claim (a member with only a
 * salary entered still showed 100%). Chips name the actual signals:
 * Income / Protection / Pension for earners, Education for children, each
 * either "on file" or "not yet" — an honest empty state when it isn't.
 *
 * Honesty rules (UAT P8): the wizard's EMPTY_FORM defaults every field to
 * 'employed'/'0', so a saved-but-untouched profile must not light up.
 * 'employed' alone therefore does not count as income on file — only a
 * real salary or a deliberately different status does. Likewise a
 * household policy (car/home/travel) is not a member's personal
 * protection — only person-scoped types (life, income protection, health,
 * critical illness) count toward the earner Protection chip.
 */
export function chipsFor(
  memberId: string,
  role: string,
  name: string,
  profile: FinancialProfile | null,
): MemberChip[] {
  if (!profile) return []
  const policies = profile.policies ?? []
  // Household-wide policies (car/home/travel have no member_id) genuinely
  // cover a child, so the child's "Covered by policies" chip keeps them.
  const covered = policies.some(
    (p) => !PERSON_SCOPED_POLICY_TYPES.has(p.type) || !p.member_id || p.member_id === memberId,
  )
  // An earner's Protection chip is about *their* cover — person-scoped
  // policies only: attributed to them or left un-attributed (whose is
  // genuinely unknown), never a policy explicitly named for someone else.
  const hasProtectionPolicy = policies.some(
    (p) => PERSON_SCOPED_POLICY_TYPES.has(p.type) && (!p.member_id || p.member_id === memberId),
  )
  const incomeOnFile = (salaryMinor: number, status: EmploymentStatus) =>
    salaryMinor > 0 || status !== 'employed'

  if (role === 'child') {
    const fund = profile.education_funds.some(
      (f) => f.member_id === memberId || f.child_name.toLowerCase() === name.toLowerCase(),
    )
    return [
      { label: 'Education fund', onFile: fund },
      { label: 'Covered by policies', onFile: covered },
    ]
  }

  const earner =
    role === 'organizer'
      ? {
          income: incomeOnFile(
            profile.household.monthly_salary_minor,
            profile.household.employment_status,
          ),
          protection:
            profile.household.life_cover_minor > 0 ||
            profile.household.income_protection_monthly_minor > 0 ||
            hasProtectionPolicy,
          pension:
            (profile.retirement.pension_balance_minor ?? 0) > 0 ||
            (profile.retirement.monthly_contribution_minor ?? 0) > 0,
        }
      : (() => {
          const entry = profile.household.members.find((m) => m.member_id === memberId)
          return {
            income: !!entry && incomeOnFile(entry.monthly_salary_minor, entry.employment_status),
            protection:
              (!!entry && entry.income_protection_monthly_minor > 0) || hasProtectionPolicy,
            pension:
              !!entry &&
              ((entry.pension_balance_minor ?? 0) > 0 ||
                (entry.monthly_pension_contribution_minor ?? 0) > 0),
          }
        })()

  return [
    { label: 'Income', onFile: earner.income },
    { label: 'Protection', onFile: earner.protection },
    { label: 'Pension', onFile: earner.pension },
  ]
}
