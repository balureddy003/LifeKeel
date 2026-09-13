/**
 * PRD-202: rule_id -> blog slug, for "Learn more" links on real insight
 * cards and the public readiness quiz. Static lookup rather than a field
 * on the detector YAML — Insight construction (packages/engine/src/detector.ts)
 * only copies explicitly-named fields from a fired rule, so a YAML field
 * would need engine/schema changes and still wouldn't apply to insights
 * already persisted before it existed. rule_id is already reliable on
 * every insight, so this needs no backend change to consume.
 *
 * Only 6 of the family vertical's 10 detector rules have a matching post
 * today (see apps/api/src/detector-content-posts.ts) — the rest simply
 * render no link, not a broken one.
 */

export const RULE_ID_TO_BLOG_SLUG: Record<string, string> = {
  life_insurance_below_household_needs: 'life-insurance-coverage-gap',
  no_income_protection: 'income-protection-insurance-explained',
  emergency_fund_below_3_months: 'emergency-fund-three-months-rule',
  no_retirement_savings: 'havent-started-retirement-savings',
  education_fund_behind_target: 'education-fund-behind-target',
  education_fund_not_started: 'education-fund-not-started',
}

export function learnMoreHref(ruleId: string | null | undefined): string | null {
  if (!ruleId) return null
  const slug = RULE_ID_TO_BLOG_SLUG[ruleId]
  return slug ? `/blog/${slug}` : null
}
