import type { FamilyInsight, Obligation } from '@/lib/api'
import { RESOLVED_INSIGHT_STATES } from '@/lib/api'
import { countdownText, daysUntil } from '@/app/briefs/what-if'

/**
 * The one thing worth checking today, chosen by a rule anyone can read:
 *   1. something with a date inside 14 days (soonest first), then
 *   2. a payment that stopped or a nomination that does not match the family
 *      (newest first), then
 *   3. the missing fact that sharpens the biggest number.
 * A prioritisation of what is already on file. It recommends nothing.
 */
export type TodayItem =
  | { tier: 'date'; title: string; why: string; href: string; cta: string }
  | { tier: 'check'; title: string; why: string; href: string; cta: string; detail: string }
  | { tier: 'missing'; title: string; why: string; href: string; cta: string }
  | { tier: 'none'; title: string }

export const DATE_WINDOW_DAYS = 14

/** Detector rules that point at a low-effort, high-stakes check. */
export const CHECK_RULES = [
  'premium_possibly_stopped',
  'nomination_names_ex_partner',
  'nomination_none_on_file',
  'nomination_predates_new_child',
] as const

export function pickTodayItem(input: {
  obligations: Obligation[]
  insights: FamilyInsight[]
  profileCompleteness: number
  today: string
}): TodayItem {
  const { obligations, insights, profileCompleteness, today } = input

  const dated = obligations
    .map((o) => ({ o, days: daysUntil(o.next_due_date, today) }))
    .filter((x) => Number.isFinite(x.days) && x.days <= DATE_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days)[0]
  if (dated) {
    const { o, days } = dated
    return {
      tier: 'date',
      title: `${o.label} ${countdownText(days).replace('starts', 'is due').replace('started', 'was due')}`,
      why: 'Why this one: it has a date inside the next two weeks.',
      href: '/map',
      cta: 'See it on the map',
    }
  }

  const check = insights
    .filter(
      (i) =>
        !RESOLVED_INSIGHT_STATES.includes(i.state) &&
        (CHECK_RULES as readonly string[]).includes(i.rule_id),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  if (check) {
    return {
      tier: 'check',
      title: check.hypothesis,
      detail: check.reasoning,
      why: 'Why this one: it is quick to check and matters if it is wrong.',
      href: '/inbox',
      cta: 'Open it',
    }
  }

  if (profileCompleteness > 0 && profileCompleteness < 100) {
    return {
      tier: 'missing',
      title: 'One more detail would sharpen your numbers',
      why: `Why this one: your profile is ${profileCompleteness}% complete, and the rest changes the answers above.`,
      href: '/financial-profile',
      cta: 'Add it',
    }
  }

  return { tier: 'none', title: 'Nothing needs checking today.' }
}
