/**
 * POST /family/financial-profile — the missing link between "a family
 * connected real data" and the family vertical's four detectors actually
 * firing (family_protection_gap, family_emergency_fund_adequacy,
 * family_education_shortfall, family_retirement_gap — see detectors/family/).
 *
 * Those detectors require signal types (family.household, family.savings,
 * family.pension, family.education_fund) that nothing in the ingestion
 * pipeline ever emitted — OCR extraction stores free-text fields on the
 * document without evaluating detectors, and onboarding only collects
 * roster/demographic answers, never income/expense/savings/pension figures.
 * This follows the same persist-signal -> engine.evaluate() -> deliver
 * pattern already used by /property/manual-entry and /events, so a
 * submitted profile produces real insights instead of the client falling
 * back to sample data forever.
 *
 * GET  /family/financial-profile  — the tenant's last submitted profile, or null
 * POST /family/financial-profile  — submit/update the profile, evaluate detectors
 */

import crypto from 'node:crypto'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import type { Engine, Insight } from '@lifekeel/engine'
import { getTenantCollection } from '@lifekeel/platform'
import { getFamilyFinancialProfileCollection } from '../db.js'
import { persistSignal } from '../signals.js'
import { resolveStaleInsights } from '../insights-persist.js'
import {
  maybeFlagUnreportedLifeChange,
  type ProfileChangeSnapshot,
} from '../life-events/detect-unreported-change.js'
import { rewardReferralIfPending } from './referrals.js'
import { recordInsightAction } from '../insights/insight-attribution.js'
import { ageFromDob } from '../family/family-permissions.js'
import type { FamilyGroupDoc } from './family-group.js'
import { monthlyEquivalentMinor, type CashflowEntryDoc } from './family-cashflow.js'
import { buildEstateSignal } from '../legacy/estate-signal.js'
import { buildDedupeKey, emitReadinessEvent } from '../feed/emit.js'

const FAMILY_DETECTOR_IDS = [
  'family_protection_gap',
  'family_emergency_fund_adequacy',
  'family_retirement_gap',
  'family_education_shortfall',
  // Safe inside the stale-resolution loop only because evaluateProfile-
  // AndGenerateInsights emits a fresh family.estate event every submit —
  // vault.ts evaluates the same detector on upload/delete for the same
  // reason (PRD-121).
  'family_estate_readiness',
  // family_education_pacing + family_emergency_trajectory subscribe to
  // the same education_fund/savings events the originals emit — the extra
  // fields they read are added to those emissions below.
  'family_education_pacing',
  'family_emergency_trajectory',
  'family_debt_health',
  'family_policy_review',
] as const

export const FinancialProfileSchema = z.object({
  household: z.object({
    // A strict yes/no "employed" boolean meant self-employed and gig-income
    // households always answered "no" (they don't have an employer), which
    // silently exempted them from no_income_protection forever — even though
    // they typically have *no* employer sick pay to fall back on, so need
    // protection at least as much as traditionally-employed households.
    // Unemployed/retired are their own states: neither has income to
    // protect via this policy type (retired is covered by the retirement
    // detector instead).
    employment_status: z.enum(['employed', 'self_employed', 'unemployed', 'retired']),
    monthly_salary_minor: z.number().int().nonnegative(),
    annual_living_expenses_minor: z.number().int().nonnegative(),
    mortgage_outstanding_minor: z.number().int().nonnegative().default(0),
    life_cover_minor: z.number().int().nonnegative().default(0),
    income_protection_monthly_minor: z.number().int().nonnegative().default(0),
    // Total monthly debt-service payments excluding the mortgage (cards,
    // loans, finance agreements) — feeds family_debt_health's DTI check.
    // Mortgage is deliberately separate (mortgage_outstanding_minor
    // already exists, and the 36% guideline conventionally measures
    // non-housing debt service).
    monthly_debt_payments_minor: z.number().int().nonnegative().default(0),
    // PRD-104: the fields above are single-valued for the whole
    // household — a genuinely common shape (one partner retired, one
    // still working; one salaried, one self-employed) had no way to be
    // entered as what it actually is, so the family had to pick one
    // arbitrary label, and that choice — not the real underlying
    // finances — decided whether no_income_protection could ever fire
    // (KEEL-029). Each entry links to a real family-roster member
    // (member_id — see FamilyMemberDoc in family-group.ts) rather than
    // an anonymous second earner, which is what lets the wizard
    // pre-populate names and the assistant resolve "does my husband have
    // income protection?" to a real person. Additive and optional: when
    // empty, behavior is byte-for-byte unchanged from before this field
    // existed. See the multi-event evaluation in the route below for how
    // this avoids double-firing the household detector's other,
    // genuinely joint rules (life cover, renewal window, health cover).
    // Scoped to income + income protection, plus (PRD-119) optional
    // per-member pension figures so a second earner's twin can score
    // their own retirement trajectory instead of borrowing the
    // organizer's. Emergency fund stays household-level — it's a
    // shared pool, not any one member's.
    members: z
      .array(
        z.object({
          member_id: z.string().min(1),
          employment_status: z.enum(['employed', 'self_employed', 'unemployed', 'retired']),
          monthly_salary_minor: z.number().int().nonnegative(),
          income_protection_monthly_minor: z.number().int().nonnegative().default(0),
          pension_balance_minor: z.number().int().nonnegative().optional(),
          monthly_pension_contribution_minor: z.number().int().nonnegative().optional(),
        }),
      )
      .default([]),
  }),
  emergency_fund: z.object({
    emergency_savings_minor: z.number().int().nonnegative(),
    monthly_expenses_minor: z.number().int().nonnegative(),
    has_high_interest_debt: z.boolean().default(false),
    high_interest_debt_balance_minor: z.number().int().nonnegative().default(0),
  }),
  retirement: z.object({
    current_age: z.number().int().positive(),
    target_retirement_age: z.number().int().positive(),
    pension_balance_minor: z.number().int().nonnegative(),
    monthly_contribution_minor: z.number().int().nonnegative(),
    target_retirement_income_minor: z.number().int().nonnegative(),
    expected_annual_growth_pct: z.number().min(0).max(20).default(5),
  }),
  education_funds: z
    .array(
      z.object({
        child_name: z.string().min(1),
        child_age: z.number().int().nonnegative(),
        current_savings_minor: z.number().int().nonnegative(),
        target_savings_minor: z.number().int().nonnegative(),
        years_remaining: z.number().int().nonnegative(),
        // Optional link to a family_groups roster member (role 'child') —
        // mirrors policies[].member_id (PRD-110). Not validated against the
        // roster server-side (same posture as that field): a stale/removed
        // member id just means the frontend falls back to the free-text
        // child_name it already has.
        member_id: z.string().min(1).optional(),
      }),
    )
    .default([]),
  // Additive, not a replacement for household.life_cover_minor /
  // income_protection_monthly_minor — those two fields still feed the
  // original two protection-gap rules directly. This is a separate,
  // policy-level model (PRD-102) that powers the renewal-window and
  // coverage-type-gap rules without touching the existing data contract.
  policies: z
    .array(
      z.object({
        // PRD-105: car and home are two of the most commonly held household
        // policies and had no way to be recorded at all — confirmed live,
        // both the wizard's picker and this endpoint rejected them. No new
        // coverage-adequacy detector for either type yet (see PRD-105's own
        // "Out of scope") — recordable today, reasoned-about later.
        type: z.enum([
          'life',
          'income_protection',
          'health',
          'critical_illness',
          'car',
          'home',
          'travel',
        ]),
        provider: z.string().min(1),
        coverage_amount_minor: z.number().int().nonnegative().default(0),
        monthly_premium_minor: z.number().int().nonnegative().default(0),
        // ISO date string (e.g. "2027-03-01"), optional — a policy with no
        // known renewal date simply never contributes to the renewal-window
        // rule, rather than being rejected.
        renewal_date: z.string().optional(),
        // Not read by any detector — purely a reference field so a family
        // (or Keel, drafting a message on their behalf) can quote the right
        // number back to the insurer without digging out the original
        // document again.
        policy_number: z.string().optional(),
        // PRD-110: which roster member this policy belongs to. Optional and
        // additive — policies recorded before this field exist simply have
        // no attribution (car/home are household-wide by nature and stay
        // unset deliberately). Never guessed from OCR: attribution only ever
        // comes from an explicit user pick in the wizard or document review.
        member_id: z.string().min(1).optional(),
        // Who the policy *protects* — distinct from member_id (who holds/
        // pays for it). A parent's life policy held by the organizer can
        // name a child beneficiary; recording it lets family_policy_review
        // flag beneficiaries who've left the roster, and lets playbooks
        // answer "who does this cover?" without re-reading documents.
        // Optional and never guessed — attribution only comes from an
        // explicit user pick, same posture as member_id.
        beneficiary_member_id: z.string().min(1).optional(),
        // The number/address a life-event playbook's "contact" steps can
        // actually put in front of the family instead of "find the number
        // and call" — only ever what a document or a scanned email stated
        // (ocr/profile-mapping.ts, email/classify.ts) or what the family
        // typed in themselves; never guessed. Basic shape checks only
        // (not full RFC validation) — this is display/tel:/mailto: text,
        // not something the app itself dials or sends to.
        contact_phone: z.string().max(40).optional(),
        contact_email: z.string().max(254).optional(),
      }),
    )
    .default([]),
})

/**
 * A target of 0 means "not set yet". Profiles saved before this was
 * allowed carry a client-side 1-minor-unit (£0.01) placeholder instead —
 * no real target is under £1, so anything at or below that is unset too.
 * Evaluating a detector against an unset target produces either silence
 * (nothing to fall short of) or nonsense, so those checks are skipped.
 */
export const isUnsetTarget = (minor: number) => minor <= 100

export type FinancialProfile = z.infer<typeof FinancialProfileSchema>

/**
 * Projects pension balance forward year-by-year (annual compounding) against
 * a required-corpus estimate (25x target annual retirement income — the
 * standard 4%-safe-withdrawal-rate heuristic) to find the age the family is
 * actually on track to hit that corpus, plus the extra monthly contribution
 * that would close the gap by their target age. This is an estimate, not
 * a guarantee — surfaced to the user with that caveat everywhere it's shown.
 *
 * Also computes achievable_retirement_income_minor: for a near-retiree with
 * a large gap and few years left, additional_monthly_contribution_needed_minor
 * can come out to an absurd, practically-unusable figure (dividing a large
 * shortfall by very few remaining years) — verified against a real scenario
 * this session (a 2-years-to-retirement household). The route gates on this
 * to decide whether to show that number at all, or switch to the two
 * realistic alternative levers: delay retirement (projected_retirement_age,
 * already computed below) or accept a lower income at the original target
 * age (achievable_retirement_income_minor — the same growing-annuity math,
 * solved forward at the *current* contribution rate instead of solving
 * backward for a required one).
 *
 * PRD-106: all of the above only applies pre-target-age
 * (current_age < target_retirement_age) — see the early return below for
 * current_age >= target_retirement_age, which reports today's real
 * sustainability instead of compounding forward as if still accumulating.
 */
// Exported for readiness/score.ts — the composite readiness score reuses
// exactly this projection (achievable_retirement_income_minor vs the
// target) rather than duplicating the compounding math.
export function projectRetirement(r: FinancialProfile['retirement']) {
  const rate = r.expected_annual_growth_pct / 100
  const requiredCorpusMinor = r.target_retirement_income_minor * 25
  const annualContribution = r.monthly_contribution_minor * 12

  // PRD-106: current_age >= target_retirement_age means there's no future
  // "keep contributing until X" timeline left to project forward — the
  // old code ran the compounding loop below anyway and produced a literal
  // "your projected retirement age is approximately 130" for a genuinely
  // retired 70-year-old. Report today's real sustainability instead: what
  // income the CURRENT balance supports right now, at the same 4%-SWR
  // heuristic (divide by 25) used everywhere else in this function — not
  // a fictional future date reached by compounding forward as if still
  // accumulating.
  if (r.current_age >= r.target_retirement_age) {
    return {
      projected_retirement_age: r.current_age,
      // Sentinel, not a real "contribution to close the gap" figure — a
      // retiree can't out-contribute their way to a bigger pot on a
      // timeline that's already ended. Deliberately larger than any real
      // monthly_salary_minor * 0.5 so retirement_behind_target_age's
      // existing gate (retirement-gap.yaml) can never fire for this
      // population — retirement_gap_unaffordable_by_contributions's
      // extended condition is the rule for this population instead.
      additional_monthly_contribution_needed_minor: Number.MAX_SAFE_INTEGER,
      achievable_retirement_income_minor: Math.max(0, Math.round(r.pension_balance_minor / 25)),
      requiredCorpusMinor,
    }
  }

  const yearsToTarget = r.target_retirement_age - r.current_age
  let balance = r.pension_balance_minor
  let age = r.current_age
  const maxAge = r.current_age + 60
  while (balance < requiredCorpusMinor && age < maxAge) {
    balance = balance * (1 + rate) + annualContribution
    age += 1
  }
  const projected_retirement_age = age

  // yearsToTarget is always > 0 here — the current_age >= target_retirement_age
  // case already returned above.
  const growthFactor = Math.pow(1 + rate, yearsToTarget)
  const futureValueOfCurrentBalance = r.pension_balance_minor * growthFactor
  const annuityFactor = rate > 0 ? (growthFactor - 1) / rate : yearsToTarget
  const futureValueOfContributions = annualContribution * annuityFactor

  const requiredAnnualContribution =
    annuityFactor > 0 ? (requiredCorpusMinor - futureValueOfCurrentBalance) / annuityFactor : 0
  const requiredMonthlyContribution = requiredAnnualContribution / 12
  const additional_monthly_contribution_needed_minor = Math.max(
    0,
    Math.round(requiredMonthlyContribution - r.monthly_contribution_minor),
  )

  const achievableCorpusMinor = futureValueOfCurrentBalance + futureValueOfContributions
  const achievable_retirement_income_minor = Math.max(0, Math.round(achievableCorpusMinor / 25))

  return {
    projected_retirement_age,
    additional_monthly_contribution_needed_minor,
    achievable_retirement_income_minor,
    requiredCorpusMinor,
  }
}

export function educationFundingGapMinor(funds: FinancialProfile['education_funds']): number {
  return funds.reduce(
    (sum, f) => sum + Math.max(0, f.target_savings_minor - f.current_savings_minor),
    0,
  )
}

/**
 * Finds the policy with the nearest future renewal_date. Returns the 9999
 * sentinel (not an error, not 0) when no policy has a parseable, future
 * renewal date — the policy_renewal_window rule's condition
 * (`soonest_renewal_days <= 60`) simply never fires against it, the same
 * "absence of data means the rule can't fire" pattern the existing
 * no_income_protection rule already relies on for `employed`.
 */
function soonestPolicyRenewal(policies: FinancialProfile['policies']): {
  days: number
  provider: string
  type: string
  member_id?: string
} {
  const now = Date.now()
  let best: { days: number; provider: string; type: string; member_id?: string } | null = null
  for (const policy of policies) {
    if (!policy.renewal_date) continue
    const renewalMs = new Date(policy.renewal_date).getTime()
    if (Number.isNaN(renewalMs)) continue
    const days = Math.ceil((renewalMs - now) / 86_400_000)
    if (days < 0) continue
    if (!best || days < best.days) {
      best = {
        days,
        provider: policy.provider,
        type: policy.type,
        ...(policy.member_id ? { member_id: policy.member_id } : {}),
      }
    }
  }
  return best ?? { days: 9999, provider: '', type: '' }
}

/**
 * Runs the full detector pass against a complete financial profile and
 * returns how many insights were generated. Extracted from the POST
 * handler so the document-apply endpoints (PRD-109 bridge) can regenerate
 * insights in the same request that mutates the profile — applying
 * extracted fields used to require a second manual "Save & Generate
 * Insights" for anything to change.
 */
export async function evaluateProfileAndGenerateInsights(
  profile: FinancialProfile,
  tenantId: string,
  engine: Engine,
  db: Db,
  onInsightsGenerated?: (insights: Insight[], tenantId: string) => Promise<void>,
): Promise<number> {
  const educationGap = educationFundingGapMinor(profile.education_funds)
  const generatedInsights: Insight[] = []

  // ── family_protection_gap ────────────────────────────────────────────
  {
    const soonestRenewal = soonestPolicyRenewal(profile.policies)
    // Gates no_income_protection off for households within a year of
    // their target retirement age — a new income protection policy isn't
    // a meaningful gap to flag that close to (or past) retiring.
    const yearsToRetirement = Math.max(
      0,
      profile.retirement.target_retirement_age - profile.retirement.current_age,
    )
    // These 4 fields are genuinely joint/household-level (one mortgage,
    // one life policy, one household's dependents and soonest renewal) —
    // shared by both evaluate() calls below so a second-earner event
    // never re-derives them from scratch.
    const sharedHouseholdData = {
      years_to_retirement: yearsToRetirement,
      annual_living_expenses_minor: profile.household.annual_living_expenses_minor,
      mortgage_outstanding_minor: profile.household.mortgage_outstanding_minor,
      life_cover_minor: profile.household.life_cover_minor,
      education_funding_gap_minor: educationGap,
      // PRD-102: derived from the independent policies[] array, additive
      // to the fields above — see soonestPolicyRenewal's doc comment.
      has_dependents: Number(profile.education_funds.length > 0),
      has_health_or_ci_cover: Number(
        profile.policies.some((p) => p.type === 'health' || p.type === 'critical_illness'),
      ),
      soonest_renewal_days: soonestRenewal.days,
      soonest_renewal_provider: soonestRenewal.provider,
      soonest_renewal_type: soonestRenewal.type,
      // PRD-110: attributes the renewal insight to a roster member in the
      // feature snapshot when the policy carries one — same additive,
      // non-dedup-affecting pattern as member_id on household earner events.
      ...(soonestRenewal.member_id ? { soonest_renewal_member_id: soonestRenewal.member_id } : {}),
    }
    // KEEL-029: neutralizes protection-gap.yaml's other 3 rules
    // (life_insurance_below_household_needs, policy_renewal_window,
    // no_health_or_critical_illness_cover) for the second-earner event
    // below, so they cannot mathematically fire a second time — they
    // already evaluated once, correctly, against the real shared data in
    // the primary-earner event. Insight dedup only catches duplicates
    // already persisted from a *previous* submission (see
    // insights-persist.ts), not duplicates generated within the same
    // batch, so without this a second household event would double-fire
    // every joint rule and double-penalize the readiness score. Only
    // no_income_protection can fire from this event, since it's the only
    // rule whose condition depends on fields that actually differ (employed
    // / monthly_salary_minor / income_protection_monthly_minor).
    const neutralSharedHouseholdData = {
      years_to_retirement: yearsToRetirement,
      annual_living_expenses_minor: 0,
      mortgage_outstanding_minor: 0,
      life_cover_minor: Number.MAX_SAFE_INTEGER,
      education_funding_gap_minor: 0,
      has_dependents: 0,
      has_health_or_ci_cover: 1,
      soonest_renewal_days: 9999,
      soonest_renewal_provider: '',
      soonest_renewal_type: '',
    }

    const evaluateHouseholdEarner = async (
      earner: {
        employment_status: string
        monthly_salary_minor: number
        income_protection_monthly_minor: number
        member_id?: string
      },
      shared: typeof sharedHouseholdData,
    ) => {
      // Both employed and self-employed earners have income to protect
      // (self-employed arguably more so, with no employer sick pay) —
      // only unemployed/retired genuinely have none via this policy type.
      const hasIncomeToProtect =
        earner.employment_status === 'employed' || earner.employment_status === 'self_employed'
      // PRD-128: member_no_life_cover needs this earner's own attributed
      // life cover (the household life_cover_minor is aggregate-only).
      // Explicit values on BOTH events — the primary earner's
      // member_earner: 0 is the flag that keeps the rule from firing
      // twice alongside the household-level check.
      const memberLifeCoverMinor = earner.member_id
        ? profile.policies
            .filter((p) => p.member_id === earner.member_id && p.type === 'life')
            .reduce((sum, p) => sum + p.coverage_amount_minor, 0)
        : 0
      const eventId = crypto.randomUUID()
      const data = {
        employed: Number(hasIncomeToProtect),
        monthly_salary_minor: earner.monthly_salary_minor,
        income_protection_monthly_minor: earner.income_protection_monthly_minor,
        member_earner: earner.member_id ? 1 : 0,
        member_life_cover_minor: earner.member_id ? memberLifeCoverMinor : Number.MAX_SAFE_INTEGER,
        // Real dependents value on member events (the household rules it
        // feeds are neutralized elsewhere in `shared`; this field only
        // exists for member-scoped rules).
        member_has_dependents: earner.member_id ? sharedHouseholdData.has_dependents : 0,
        // PRD-104: carried through to feature_snapshot so a fired
        // insight can be attributed back to a real roster member, not
        // just an anonymous "second earner" — and now load-bearing for
        // dedup + entity-aware stale resolution, since ENTITY_KEY_FIELDS
        // in packages/engine/src/detector.ts includes member_id.
        ...(earner.member_id ? { member_id: earner.member_id } : {}),
        ...shared,
      }
      const signalId = await persistSignal({
        tenant_id: tenantId,
        signal_type: 'family.household',
        source: 'manual-entry',
        external_id: eventId,
        data,
      })
      const result = await engine.evaluate({
        event_type: 'family.household',
        tenant_id: tenantId,
        event_id: eventId,
        data,
        derived_from_signals: [signalId],
      })
      generatedInsights.push(...result.insights)
    }

    await evaluateHouseholdEarner(profile.household, sharedHouseholdData)
    for (const member of profile.household.members) {
      await evaluateHouseholdEarner(member, neutralSharedHouseholdData)
    }
  }

  // ── family_emergency_fund_adequacy + family_emergency_trajectory ─────
  // One family.savings event feeds both detectors — adequacy reads the
  // level fields it always has; the trajectory detector reads the surplus
  // fields added here (real cashflow entries win over the income-minus-
  // expenses estimate, same source the /family/cashflow summary computes).
  {
    const monthlyExpenses =
      profile.emergency_fund.monthly_expenses_minor > 0
        ? profile.emergency_fund.monthly_expenses_minor
        : Math.round(profile.household.annual_living_expenses_minor / 12)
    const monthlyIncome =
      profile.household.monthly_salary_minor +
      profile.household.members.reduce((s, m) => s + m.monthly_salary_minor, 0)
    // The real ledger is an enhancement over the declared figures, not a
    // requirement — an unreadable/partial cashflow collection degrades to
    // the income-minus-expenses estimate rather than failing the whole
    // evaluation.
    let cashflowEntries: Pick<CashflowEntryDoc, 'kind' | 'amount_minor' | 'recurrence'>[] = []
    try {
      const found: unknown = await getTenantCollection<CashflowEntryDoc>(
        db,
        'family_cashflow_entries',
        tenantId,
      )
        .find({})
        .toArray()
      if (Array.isArray(found)) cashflowEntries = found
    } catch {
      /* fall through to declared figures */
    }
    const monthlyFromEntries = (kind: string) =>
      cashflowEntries
        .filter((e) => e.kind === kind)
        .reduce((s, e) => s + monthlyEquivalentMinor(e), 0)
    // Declared income minus the figure the rest of the profile already
    // uses as the monthly spend — or the real ledger when the family has
    // started recording actual inflows/outflows.
    const monthlySurplusMinor =
      cashflowEntries.length > 0
        ? monthlyFromEntries('income') - monthlyFromEntries('expense')
        : monthlyIncome - monthlyExpenses
    const sixMonthTargetMinor = monthlyExpenses * 6
    const shortfallMinor = Math.max(
      0,
      sixMonthTargetMinor - profile.emergency_fund.emergency_savings_minor,
    )
    const monthsToTarget =
      shortfallMinor === 0
        ? 0
        : monthlySurplusMinor > 0
          ? Math.ceil(shortfallMinor / monthlySurplusMinor)
          : 9999

    const eventId = crypto.randomUUID()
    const data = {
      emergency_savings_minor: profile.emergency_fund.emergency_savings_minor,
      // Not entered separately? Fall back to the household's stated annual
      // living expenses / 12 so the check runs on real numbers instead of 0.
      monthly_expenses_minor: monthlyExpenses,
      has_high_interest_debt: Number(profile.emergency_fund.has_high_interest_debt),
      high_interest_debt_balance_minor: profile.emergency_fund.high_interest_debt_balance_minor,
      // family_emergency_trajectory fields — 9999 is the "can't get there"
      // sentinel, same posture as soonest_renewal_days.
      monthly_surplus_minor: monthlySurplusMinor,
      months_to_six_month_target: monthsToTarget,
    }
    const signalId = await persistSignal({
      tenant_id: tenantId,
      signal_type: 'family.savings',
      source: 'manual-entry',
      external_id: eventId,
      data,
    })
    const result = await engine.evaluate({
      event_type: 'family.savings',
      tenant_id: tenantId,
      event_id: eventId,
      data,
      derived_from_signals: [signalId],
    })
    generatedInsights.push(...result.insights)
  }

  // ── family_retirement_gap ─────────────────────────────────────────────
  if (!isUnsetTarget(profile.retirement.target_retirement_income_minor)) {
    const projection = projectRetirement(profile.retirement)
    const eventId = crypto.randomUUID()
    const data = {
      current_age: profile.retirement.current_age,
      target_retirement_age: profile.retirement.target_retirement_age,
      pension_balance_minor: profile.retirement.pension_balance_minor,
      target_retirement_income_minor: profile.retirement.target_retirement_income_minor,
      projected_retirement_age: projection.projected_retirement_age,
      additional_monthly_contribution_needed_minor:
        projection.additional_monthly_contribution_needed_minor,
      achievable_retirement_income_minor: projection.achievable_retirement_income_minor,
      // Only signal this detector has of income, to judge whether the
      // contribution increase above is a realistic single lever or not.
      monthly_salary_minor: profile.household.monthly_salary_minor,
    }
    const signalId = await persistSignal({
      tenant_id: tenantId,
      signal_type: 'family.pension',
      source: 'manual-entry',
      external_id: eventId,
      data,
    })
    const result = await engine.evaluate({
      event_type: 'family.pension',
      tenant_id: tenantId,
      event_id: eventId,
      data,
      derived_from_signals: [signalId],
    })
    generatedInsights.push(...result.insights)

    // PRD-120: the same detector evaluated once per earner with real
    // pension figures — a second earner's retirement gap is theirs, not
    // a share of the organizer's. Only members with pension fields
    // entered qualify: absent fields can't mean "zero pension" (never
    // collected vs declared £0 are indistinguishable), so no event is
    // emitted for them — which is also the honest stale-resolution path:
    // removing a member's pension data stops reproducing their insight.
    const membersWithPension = profile.household.members.filter(
      (m) => (m.pension_balance_minor ?? 0) > 0 || (m.monthly_pension_contribution_minor ?? 0) > 0,
    )
    if (membersWithPension.length > 0) {
      const roster = await getTenantCollection<FamilyGroupDoc>(
        db,
        'family_groups',
        tenantId,
      ).findOne({})
      const ageByMemberId = new Map(
        (roster?.members ?? []).map((m) => [m.id, ageFromDob(m.date_of_birth)]),
      )
      const totalSalaryMinor =
        profile.household.monthly_salary_minor +
        profile.household.members.reduce((s, m) => s + m.monthly_salary_minor, 0)
      for (const member of membersWithPension) {
        const age = ageByMemberId.get(member.member_id)
        // No real DOB → no projection; an invented age is worse than no
        // insight (same posture as the twin's readiness detail).
        if (age === null || age === undefined) continue
        // Their share of the joint target is proportional to what they
        // earn — can't derive one without a salary on file.
        if (totalSalaryMinor <= 0 || member.monthly_salary_minor <= 0) continue
        const memberTargetMinor = Math.round(
          (profile.retirement.target_retirement_income_minor * member.monthly_salary_minor) /
            totalSalaryMinor,
        )
        const memberProjection = projectRetirement({
          current_age: age,
          target_retirement_age: profile.retirement.target_retirement_age,
          pension_balance_minor: member.pension_balance_minor ?? 0,
          monthly_contribution_minor: member.monthly_pension_contribution_minor ?? 0,
          target_retirement_income_minor: memberTargetMinor,
          expected_annual_growth_pct: profile.retirement.expected_annual_growth_pct,
        })
        const memberEventId = crypto.randomUUID()
        const memberData = {
          current_age: age,
          target_retirement_age: profile.retirement.target_retirement_age,
          pension_balance_minor: member.pension_balance_minor ?? 0,
          target_retirement_income_minor: memberTargetMinor,
          projected_retirement_age: memberProjection.projected_retirement_age,
          additional_monthly_contribution_needed_minor:
            memberProjection.additional_monthly_contribution_needed_minor,
          achievable_retirement_income_minor: memberProjection.achievable_retirement_income_minor,
          // Affordability gate uses *their* salary, not the household's.
          monthly_salary_minor: member.monthly_salary_minor,
          // member_id lands in feature_snapshot → entity_key — the twin
          // and ?member_id= insight filter pick the insight up from it.
          member_id: member.member_id,
        }
        const memberSignalId = await persistSignal({
          tenant_id: tenantId,
          signal_type: 'family.pension',
          source: 'manual-entry',
          external_id: memberEventId,
          data: memberData,
        })
        const memberResult = await engine.evaluate({
          event_type: 'family.pension',
          tenant_id: tenantId,
          event_id: memberEventId,
          data: memberData,
          derived_from_signals: [memberSignalId],
        })
        generatedInsights.push(...memberResult.insights)
      }
    }
  }

  // ── family_education_shortfall + family_education_pacing ─────────────
  // One family.education_fund event per child feeds both detectors —
  // shortfall reads the level fields; pacing reads the pace fields added
  // here (where a linear trajectory from birth would have the fund by
  // now, and the monthly contribution catching up requires).
  const householdMonthlyIncomeMinor =
    profile.household.monthly_salary_minor +
    profile.household.members.reduce((s, m) => s + m.monthly_salary_minor, 0)
  for (const fund of profile.education_funds) {
    if (isUnsetTarget(fund.target_savings_minor)) continue
    const monthsRemaining = Math.max(0, Math.round(fund.years_remaining * 12))
    const remainingMinor = Math.max(0, fund.target_savings_minor - fund.current_savings_minor)
    const eventId = crypto.randomUUID()
    const data = {
      child_name: fund.child_name,
      child_age: fund.child_age,
      current_savings_minor: fund.current_savings_minor,
      target_savings_minor: fund.target_savings_minor,
      years_remaining: fund.years_remaining,
      // family_education_pacing fields. pace_expected is the linear-share
      // checkpoint — at age A with Y years left, an even trajectory that
      // started at birth would hold target * A/(A+Y) by now. 0 when the
      // baseline doesn't apply (child_age 0), which the rule conditions
      // gate on rather than trusting a degenerate 0.
      pace_expected_minor:
        fund.child_age > 0 && fund.years_remaining > 0
          ? Math.round(
              (fund.target_savings_minor * fund.child_age) /
                (fund.child_age + fund.years_remaining),
            )
          : 0,
      required_monthly_minor: monthsRemaining > 0 ? Math.ceil(remainingMinor / monthsRemaining) : 0,
      household_monthly_income_minor: householdMonthlyIncomeMinor,
      // Stable entity binding: a linked roster member gives the insight a
      // durable identity (entity_key via ENTITY_KEY_FIELDS) so per-child
      // dedup and stale-resolution work; child_name already in this event
      // is the fallback key for unlinked funds.
      ...(fund.member_id ? { member_id: fund.member_id } : {}),
    }
    const signalId = await persistSignal({
      tenant_id: tenantId,
      signal_type: 'family.education_fund',
      source: 'manual-entry',
      external_id: eventId,
      data,
    })
    const result = await engine.evaluate({
      event_type: 'family.education_fund',
      tenant_id: tenantId,
      event_id: eventId,
      data,
      derived_from_signals: [signalId],
    })
    generatedInsights.push(...result.insights)
  }

  // ── family_debt_health ───────────────────────────────────────────────
  // Non-mortgage debt service vs gross household income. Emitted even
  // when payments are 0 so a family that pays off their last card sees
  // the insight resolve on the next evaluation rather than lingering.
  {
    const monthlyIncomeMinor = householdMonthlyIncomeMinor
    // Profiles saved before this field existed carry no key at all — ?? 0,
    // not a NaN ratio that silently poisons every rule comparison.
    const debtPaymentsMinor = profile.household.monthly_debt_payments_minor ?? 0
    const eventId = crypto.randomUUID()
    const data = {
      monthly_debt_payments_minor: debtPaymentsMinor,
      monthly_income_minor: monthlyIncomeMinor,
      // Debt service against zero income is the worst case the detector
      // exists to flag — the ratio floors at 1 rather than dividing by 0.
      debt_to_income_ratio:
        monthlyIncomeMinor > 0
          ? debtPaymentsMinor / monthlyIncomeMinor
          : debtPaymentsMinor > 0
            ? 1
            : 0,
    }
    const signalId = await persistSignal({
      tenant_id: tenantId,
      signal_type: 'family.debt',
      source: 'manual-entry',
      external_id: eventId,
      data,
    })
    const result = await engine.evaluate({
      event_type: 'family.debt',
      tenant_id: tenantId,
      event_id: eventId,
      data,
      derived_from_signals: [signalId],
    })
    generatedInsights.push(...result.insights)
  }

  // ── family_policy_review ─────────────────────────────────────────────
  // Register hygiene, one event per finding subject so entity_key stays
  // per-(member,type): a life-cover overlap on dad resolves without
  // clearing a health overlap on mum.
  {
    const roster = await getTenantCollection<FamilyGroupDoc>(db, 'family_groups', tenantId).findOne(
      {},
    )
    const rosterIds = new Set((roster?.members ?? []).map((m) => m.id))
    const rosterName = new Map((roster?.members ?? []).map((m) => [m.id, m.name]))

    const holderKey = (p: FinancialProfile['policies'][number]) => p.member_id ?? 'household'
    const holderLabel = (p: FinancialProfile['policies'][number]) =>
      p.member_id ? (rosterName.get(p.member_id) ?? 'a former member') : 'the household'

    // Duplicate cover: same type + same holder, more than one policy.
    const groups = new Map<string, FinancialProfile['policies']>()
    for (const p of profile.policies) {
      const key = `${p.type}|${holderKey(p)}`
      groups.set(key, [...(groups.get(key) ?? []), p])
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const first = group[0]!
      const eventId = crypto.randomUUID()
      const data = {
        overlap_count: group.length,
        overlap_type: first.type,
        overlap_holder: holderLabel(first),
        overlap_providers: group.map((p) => p.provider).join(' + '),
        overlap_monthly_premium_minor: group.reduce((s, p) => s + p.monthly_premium_minor, 0),
        // Composite so two overlap types for the same holder stay
        // distinct entities for dedup/stale-resolution.
        member_id: `${holderKey(first)}:${first.type}`,
      }
      const signalId = await persistSignal({
        tenant_id: tenantId,
        signal_type: 'family.policy_review',
        source: 'manual-entry',
        external_id: eventId,
        data,
      })
      const result = await engine.evaluate({
        event_type: 'family.policy_review',
        tenant_id: tenantId,
        event_id: eventId,
        data,
        derived_from_signals: [signalId],
      })
      generatedInsights.push(...result.insights)
    }

    // Orphaned attribution: a policy (or its beneficiary) still points at
    // a member who's since left the roster.
    const orphaned = profile.policies.filter(
      (p) =>
        (p.member_id && !rosterIds.has(p.member_id)) ||
        (p.beneficiary_member_id && !rosterIds.has(p.beneficiary_member_id)),
    )
    // Emitted even when orphaned.length is 0 — the event itself is what
    // lets stale-resolution retract a previously-fired orphan insight
    // once the family re-attributes or removes the policy.
    {
      const eventId = crypto.randomUUID()
      const data = {
        orphaned_policy_count: orphaned.length,
        orphaned_policy_descriptions: orphaned
          .map((p) => `${p.type} policy with ${p.provider}`)
          .slice(0, 4)
          .join('; '),
      }
      const signalId = await persistSignal({
        tenant_id: tenantId,
        signal_type: 'family.policy_review',
        source: 'manual-entry',
        external_id: eventId,
        data,
      })
      const result = await engine.evaluate({
        event_type: 'family.policy_review',
        tenant_id: tenantId,
        event_id: eventId,
        data,
        derived_from_signals: [signalId],
      })
      generatedInsights.push(...result.insights)
    }
  }

  // ── family_estate_readiness (PRD-121) ────────────────────────────────
  // Vault doc types drive the estate component of the readiness score —
  // this detector makes "missing will / PoA" an actual insight, not just
  // a score detail string. Household-level: no member attribution.
  {
    // PRD-137: the same enriched signal every emission site shares —
    // legacy register fields layered on top of the vault doc types.
    const data = await buildEstateSignal(db, tenantId)
    const eventId = crypto.randomUUID()
    const signalId = await persistSignal({
      tenant_id: tenantId,
      signal_type: 'family.estate',
      source: 'manual-entry',
      external_id: eventId,
      data,
    })
    const result = await engine.evaluate({
      event_type: 'family.estate',
      tenant_id: tenantId,
      event_id: eventId,
      data,
      derived_from_signals: [signalId],
    })
    generatedInsights.push(...result.insights)
  }

  if (generatedInsights.length > 0 && onInsightsGenerated) {
    await onInsightsGenerated(generatedInsights, tenantId)
  }

  // PRD-107: this handler is the one place that just re-evaluated a
  // detector's entire rule set for this tenant in one pass (one
  // engine.evaluate() call per earner/child, aggregated into
  // generatedInsights above) — the only call site with a complete
  // enough picture to safely retract insights the fresh data no longer
  // reproduces — per (rule_id, entity_key) pair now, so resolving child
  // A's education insight doesn't wrongly keep child B's alive or vice
  // versa. See resolveStaleInsights's own doc comment.
  const inventory = engine.inventory()
  for (const detectorId of FAMILY_DETECTOR_IDS) {
    const checkedRuleIds = inventory.find((d) => d.id === detectorId)?.rules.map((r) => r.id) ?? []
    if (checkedRuleIds.length === 0) continue
    const firedEntities = generatedInsights
      .filter((i) => i.detector_id === detectorId)
      .map((i) => ({ rule_id: i.rule_id, entity_key: i.entity_key ?? '' }))
    await resolveStaleInsights(db, tenantId, detectorId, checkedRuleIds, firedEntities)
  }

  return generatedInsights.length
}

// PRD-111: reduces a full profile doc down to just the fields the
// unreported-life-change nudge diffs between saves. The top-level
// household earner has no member_id (matched positionally — there's
// always exactly one); household.members[] entries carry their own.
function toChangeSnapshot(
  profile: Pick<FinancialProfile, 'household' | 'emergency_fund'>,
): ProfileChangeSnapshot {
  return {
    earners: [
      {
        employment_status: profile.household.employment_status,
        monthly_salary_minor: profile.household.monthly_salary_minor,
      },
      ...profile.household.members.map((m) => ({
        member_id: m.member_id,
        employment_status: m.employment_status,
        monthly_salary_minor: m.monthly_salary_minor,
      })),
    ],
    emergency_savings_minor: profile.emergency_fund.emergency_savings_minor,
  }
}

export async function registerFamilyFinancialProfileRoutes(
  app: FastifyInstance,
  db: Db,
  engine: Engine,
  onInsightsGenerated?: (insights: Insight[], tenantId: string) => Promise<void>,
): Promise<void> {
  const rawProfiles = getFamilyFinancialProfileCollection(db)
  rawProfiles.createIndex({ tenant_id: 1 }, { unique: true }).catch(() => {})

  const profileFor = (tenantId: string) =>
    getTenantCollection<
      FinancialProfile & {
        tenant_id: string
        updated_at: Date
        version?: number
        reviewed_at?: Date
        review_snoozed_until?: Date
        review_snapshot?: Record<string, unknown>
      }
    >(db, 'family_financial_profile', tenantId)

  app.get('/family/financial-profile', async (req) => {
    const { tenant_id } = req.authContext
    const doc = await profileFor(tenant_id).findOne({})
    if (!doc) return { profile: null }
    // reviewed_at/review_snapshot/review_snoozed_until are the annual
    // review flow's bookkeeping — never part of the profile contract the
    // client round-trips (the snapshot is a full duplicate of the doc).
    const {
      tenant_id: _tenantId,
      updated_at,
      version,
      reviewed_at: _r,
      review_snapshot: _s,
      review_snoozed_until: _sn,
      ...profile
    } = doc
    return { profile, updatedAt: updated_at, version: version ?? 0 }
  })

  // Runs the detectors against the profile already on file — for a family
  // whose wizard autosaved every step but never reached the final submit,
  // so they don't have to re-enter anything to see their gaps. Tier 0:
  // informational insights only, nothing is sent or executed anywhere.
  app.post('/family/financial-profile/evaluate', async (req, reply) => {
    const { tenant_id } = req.authContext
    const doc = await profileFor(tenant_id).findOne({})
    if (!doc) return reply.status(404).send({ error: 'No financial profile on file yet' })
    const {
      tenant_id: _t,
      updated_at: _u,
      version: _v,
      _id: _i,
      insights_evaluated_at: _e,
      ...rest
    } = doc as Record<string, unknown>
    const parsed = FinancialProfileSchema.safeParse(rest)
    if (!parsed.success) {
      return reply
        .status(422)
        .send({ error: 'Saved profile is incomplete', issues: parsed.error.issues })
    }
    const insightsGenerated = await evaluateProfileAndGenerateInsights(
      parsed.data,
      tenant_id,
      engine,
      db,
      onInsightsGenerated,
    )
    await profileFor(tenant_id).updateOne({}, { $set: { insights_evaluated_at: new Date() } })
    return reply.send({ ok: true, insights_generated: insightsGenerated })
  })

  // ── Annual profile review ────────────────────────────────────────────
  // A family's numbers drift — salary rises, debts clear, children age —
  // but nothing asks "is this still accurate?" on a schedule, so scores
  // quietly compute on stale data. Once a year the profile surfaces a
  // "confirm or update" prompt: one tap confirms (stamps reviewed_at and
  // stores a snapshot so next year's prompt can say what changed), an
  // edit refreshes updated_at, or the family snoozes for 30 days.
  //
  // reviewed_at is deliberate human confirmation, distinct from
  // updated_at (any autosave touches it) — a mid-wizard keystroke must
  // not read as "the family says this is still right."
  const REVIEW_INTERVAL_MS = 365 * 86_400_000
  const REVIEW_SNOOZE_MS = 30 * 86_400_000

  // Human labels for the "what changed since your last review" list —
  // a dotted path can always fall back to its humanized leaf name.
  const REVIEW_FIELD_LABELS: Record<string, string> = {
    'household.employment_status': 'employment status',
    'household.monthly_salary_minor': 'monthly income',
    'household.annual_living_expenses_minor': 'living expenses',
    'household.mortgage_outstanding_minor': 'mortgage balance',
    'household.life_cover_minor': 'life cover',
    'household.income_protection_monthly_minor': 'income protection',
    'household.monthly_debt_payments_minor': 'monthly debt payments',
    'emergency_fund.emergency_savings_minor': 'emergency savings',
    'emergency_fund.monthly_expenses_minor': 'monthly expenses',
    'emergency_fund.has_high_interest_debt': 'high-interest debt',
    'emergency_fund.high_interest_debt_balance_minor': 'debt balance',
    'retirement.current_age': 'age',
    'retirement.target_retirement_age': 'retirement age',
    'retirement.pension_balance_minor': 'pension balance',
    'retirement.monthly_contribution_minor': 'pension contribution',
    'retirement.target_retirement_income_minor': 'retirement income target',
  }

  function flattenLeaves(value: unknown, prefix: string, out: Record<string, unknown>): void {
    if (Array.isArray(value)) {
      // Array identity is meaningful ("a policy was added"), not each row's
      // internals — compare the array's shape as one leaf.
      out[prefix] = value.length
      return
    }
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        flattenLeaves(v, prefix ? `${prefix}.${k}` : k, out)
      }
      return
    }
    out[prefix] = value
  }

  function diffSinceReview(
    snapshot: Record<string, unknown> | undefined,
    current: Record<string, unknown>,
  ): string[] {
    if (!snapshot) return []
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    flattenLeaves(snapshot, '', before)
    flattenLeaves(current, '', after)
    const changed: string[] = []
    for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[path] === after[path]) continue
      const leaf = path.split('.').pop() ?? path
      changed.push(
        REVIEW_FIELD_LABELS[path] ??
          leaf.replace(/_minor$|_/g, ' ').trim() +
            (path.includes('policies') || path.includes('education_funds') ? ' count' : ''),
      )
      if (changed.length === 8) break
    }
    return changed
  }

  // Same humanizer as diffSinceReview but keeps the dotted path — the
  // readiness feed's profile_changed event needs it for the deep link.
  function diffProfileChanges(
    previous: Record<string, unknown>,
    current: Record<string, unknown>,
  ): { path: string; label: string }[] {
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    flattenLeaves(previous, '', before)
    flattenLeaves(current, '', after)
    const changed: { path: string; label: string }[] = []
    for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[path] === after[path]) continue
      const leaf = path.split('.').pop() ?? path
      changed.push({
        path,
        label:
          REVIEW_FIELD_LABELS[path] ??
          leaf.replace(/_minor$|_/g, ' ').trim() +
            (path.includes('policies') || path.includes('education_funds') ? ' count' : ''),
      })
    }
    return changed
  }

  app.get('/family/financial-profile/review', async (req) => {
    const { tenant_id } = req.authContext
    const doc = await profileFor(tenant_id).findOne({})
    if (!doc) return { due: false, last_reviewed_at: null, changed: [] }
    const now = Date.now()
    // Reference point = last explicit confirmation, else when the data
    // was last touched — a profile edited this month isn't due regardless
    // of when it was first created.
    const reference = doc.reviewed_at?.getTime() ?? doc.updated_at?.getTime() ?? now
    const snoozed = doc.review_snoozed_until && doc.review_snoozed_until.getTime() > now
    const due = !snoozed && now - reference > REVIEW_INTERVAL_MS
    const {
      tenant_id: _t,
      updated_at: _u,
      version: _v,
      _id: _i,
      reviewed_at: _r,
      review_snoozed_until: _s,
      review_snapshot: _snap,
      ...current
    } = doc as Record<string, unknown>
    return {
      due,
      last_reviewed_at: doc.reviewed_at ?? null,
      changed: due ? diffSinceReview(doc.review_snapshot, current) : [],
    }
  })

  app.post<{ Body: { action?: 'confirm' | 'later' } }>(
    '/family/financial-profile/review',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const doc = await profileFor(tenant_id).findOne({})
      if (!doc) return reply.status(404).send({ error: 'No financial profile on file yet' })
      if (req.body?.action === 'later') {
        await profileFor(tenant_id).updateOne(
          {},
          { $set: { review_snoozed_until: new Date(Date.now() + REVIEW_SNOOZE_MS) } },
        )
        return { ok: true, reviewed_at: doc.reviewed_at ?? null }
      }
      // Confirm: stamp the moment and snapshot the profile so next year's
      // prompt can answer "what changed since you last confirmed".
      const {
        tenant_id: _t,
        updated_at: _u,
        version: _v,
        _id: _i,
        reviewed_at: _r,
        review_snoozed_until: _s,
        review_snapshot: _snap,
        ...snapshot
      } = doc as Record<string, unknown>
      const reviewedAt = new Date()
      await profileFor(tenant_id).updateOne(
        {},
        {
          $set: { reviewed_at: reviewedAt, review_snapshot: snapshot },
          $unset: { review_snoozed_until: '' },
        },
      )
      return { ok: true, reviewed_at: reviewedAt }
    },
  )

  app.post<{ Body: FinancialProfile & { generate_insights?: boolean; version?: number } }>(
    '/family/financial-profile',
    async (req, reply) => {
      const { generate_insights, version: clientVersion, ...body } = req.body
      const parsed = FinancialProfileSchema.safeParse(body)
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: 'Invalid financial profile', issues: parsed.error.issues })
      }
      const { tenant_id } = req.authContext
      const profile = parsed.data

      // PRD-111: read before the write so an unreported-life-change nudge
      // can diff against what was actually there before — a plain read,
      // entirely separate from the optimistic-concurrency filter below.
      const previousDoc = await profileFor(tenant_id).findOne({})

      // KEEL-006: optimistic concurrency. The multi-step wizard autosaves
      // after every step, and two tabs/devices editing the same profile
      // used to silently last-writer-wins overwrite each other's fields —
      // the whole document is $set wholesale with no merge. A client that
      // has read a version (every GET/POST response includes one) sends it
      // back; if another write already moved the version on, this filter
      // matches nothing and the caller gets a 409 instead of silently
      // clobbering someone else's edits. A client on its first-ever save
      // (no version yet) omits it and always succeeds.
      const filter = clientVersion !== undefined ? { version: clientVersion } : {}
      const result = await profileFor(tenant_id).findOneAndUpdate(
        filter,
        {
          $set: {
            ...profile,
            updated_at: new Date(),
            // Marks that detectors have actually run against this profile.
            // Without it the client can't tell "evaluated, no gaps" from
            // "saved by autosave, never evaluated" — both have zero
            // insights, and the latter must not read as a perfect score.
            ...(generate_insights ? { insights_evaluated_at: new Date() } : {}),
          },
          $inc: { version: 1 },
        },
        { upsert: true, returnDocument: 'after' },
      )
      if (clientVersion !== undefined && !result) {
        return reply
          .status(409)
          .send({ error: 'This profile was updated elsewhere — reload and try again.' })
      }
      const newVersion =
        (result as unknown as { version?: number } | null)?.version ?? (clientVersion ?? 0) + 1

      // The multi-step form autosaves after every step (Continue), not just
      // the final "Save & Generate Insights" — evaluating detectors on every
      // autosave meant a rule like no_retirement_savings could fire against
      // whatever the retirement step's fields still defaulted to before the
      // user had even reached it, leaving a stale, contradictory insight
      // sitting open once the real numbers arrived on the next step. Only the
      // caller-declared final submit generates insights; earlier steps just
      // persist progress so closing the tab mid-form doesn't lose it.
      if (!generate_insights) {
        return reply.send({ ok: true, insights_generated: 0, version: newVersion })
      }

      // Insight→action attribution: a final submit while insights are open
      // (or recently fired) is the family *responding* — record the
      // association before this pass runs, so insights created by this very
      // evaluation don't get credited to the save that produced them.
      // 'policy_added' is the sharper signal when the register grew;
      // otherwise the generic 'profile_updated'.
      if (previousDoc) {
        const prevPolicyCount = Array.isArray(previousDoc.policies)
          ? previousDoc.policies.length
          : 0
        const actionType =
          profile.policies.length > prevPolicyCount ? 'policy_added' : 'profile_updated'
        await recordInsightAction(db, tenant_id, actionType).catch(() => {})

        // PRD-136: narrate the save itself — after attribution, before the
        // evaluation runs. First-ever save has no baseline, so nothing to
        // narrate; a save with no field changes isn't a move either.
        try {
          const {
            tenant_id: _t,
            updated_at: _u,
            version: _v,
            _id: _i,
            reviewed_at: _r,
            review_snapshot: _rs,
            review_snoozed_until: _sn,
            insights_evaluated_at: _e,
            ...previousProfile
          } = previousDoc as Record<string, unknown>
          const changed = diffProfileChanges(
            previousProfile,
            profile as unknown as Record<string, unknown>,
          )
          if (changed.length > 0) {
            const names = changed.slice(0, 3).map((c) => c.label)
            const list =
              names.length === 1
                ? names[0]!
                : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
            emitReadinessEvent(db, tenant_id, {
              type: 'profile_changed',
              severity: 'info',
              direction: null,
              member_id: null,
              domain: null,
              title: `${list[0]!.toUpperCase()}${list.slice(1)} changed`,
              summary: `Your financial profile was updated: ${list}.`,
              evidence: changed.slice(0, 3).map((c) => ({ label: c.label })),
              links: [{ kind: 'profile_field', id: changed[0]!.path }],
              next_check_at: null,
              dedupe_key: buildDedupeKey('profile_changed', tenant_id),
            })
          }
        } catch {
          // feed bookkeeping never breaks the save path
        }
      }

      const insightsGenerated = await evaluateProfileAndGenerateInsights(
        profile,
        tenant_id,
        engine,
        db,
        onInsightsGenerated,
      )
      await maybeFlagUnreportedLifeChange(
        req,
        previousDoc ? toChangeSnapshot(previousDoc) : null,
        toChangeSnapshot(profile),
        db,
      )
      // PRD-112: "first-ever final submit" is the referral reward's
      // meaningful-action milestone — real use has started, not just an
      // account existing. No-op for every submit after the first, and a
      // silent no-op when there's no pending referral (the common case).
      if (!previousDoc) {
        await rewardReferralIfPending(db, tenant_id)
      }
      return reply.send({ ok: true, insights_generated: insightsGenerated, version: newVersion })
    },
  )
}
