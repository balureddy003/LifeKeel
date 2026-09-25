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
import type { Engine, Insight } from '@agentoak/engine'
import { getTenantCollection } from '@agentoak/platform'
import { getFamilyFinancialProfileCollection } from '../db.js'
import { persistSignal } from '../signals.js'
import { resolveStaleInsights } from '../insights-persist.js'
import { maybeFlagUnreportedLifeChange, type ProfileChangeSnapshot } from '../life-events/detect-unreported-change.js'
import { rewardReferralIfPending } from './referrals.js'

const FAMILY_DETECTOR_IDS = [
  'family_protection_gap',
  'family_emergency_fund_adequacy',
  'family_retirement_gap',
  'family_education_shortfall',
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
    // PRD-104: the fields above are single-valued for the whole
    // household — a genuinely common shape (one partner retired, one
    // still working; one salaried, one self-employed) had no way to be
    // entered as what it actually is, so the family had to pick one
    // arbitrary label, and that choice — not the real underlying
    // finances — decided whether no_income_protection could ever fire
    // (OAK-029). Each entry links to a real family-roster member
    // (member_id — see FamilyMemberDoc in family-group.ts) rather than
    // an anonymous second earner, which is what lets the wizard
    // pre-populate names and the assistant resolve "does my husband have
    // income protection?" to a real person. Additive and optional: when
    // empty, behavior is byte-for-byte unchanged from before this field
    // existed. See the multi-event evaluation in the route below for how
    // this avoids double-firing the household detector's other,
    // genuinely joint rules (life cover, renewal window, health cover).
    // Scoped to income + income protection only — not retirement or
    // emergency-fund, which stay household-level (see PRD-104's own
    // "Out of scope").
    members: z
      .array(
        z.object({
          member_id: z.string().min(1),
          employment_status: z.enum(['employed', 'self_employed', 'unemployed', 'retired']),
          monthly_salary_minor: z.number().int().nonnegative(),
          income_protection_monthly_minor: z.number().int().nonnegative().default(0),
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
        type: z.enum(['life', 'income_protection', 'health', 'critical_illness', 'car', 'home', 'travel']),
        provider: z.string().min(1),
        coverage_amount_minor: z.number().int().nonnegative().default(0),
        monthly_premium_minor: z.number().int().nonnegative().default(0),
        // ISO date string (e.g. "2027-03-01"), optional — a policy with no
        // known renewal date simply never contributes to the renewal-window
        // rule, rather than being rejected.
        renewal_date: z.string().optional(),
        // Not read by any detector — purely a reference field so a family
        // (or Oak, drafting a message on their behalf) can quote the right
        // number back to the insurer without digging out the original
        // document again.
        policy_number: z.string().optional(),
        // PRD-110: which roster member this policy belongs to. Optional and
        // additive — policies recorded before this field exist simply have
        // no attribution (car/home are household-wide by nature and stay
        // unset deliberately). Never guessed from OCR: attribution only ever
        // comes from an explicit user pick in the wizard or document review.
        member_id: z.string().min(1).optional(),
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
const isUnsetTarget = (minor: number) => minor <= 100

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
function projectRetirement(r: FinancialProfile['retirement']) {
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

  const requiredAnnualContribution = annuityFactor > 0
    ? (requiredCorpusMinor - futureValueOfCurrentBalance) / annuityFactor
    : 0
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

function educationFundingGapMinor(funds: FinancialProfile['education_funds']): number {
  return funds.reduce((sum, f) => sum + Math.max(0, f.target_savings_minor - f.current_savings_minor), 0)
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
      best = { days, provider: policy.provider, type: policy.type, ...(policy.member_id ? { member_id: policy.member_id } : {}) }
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
    const yearsToRetirement = Math.max(0, profile.retirement.target_retirement_age - profile.retirement.current_age)
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
      has_health_or_ci_cover: Number(profile.policies.some((p) => p.type === 'health' || p.type === 'critical_illness')),
      soonest_renewal_days: soonestRenewal.days,
      soonest_renewal_provider: soonestRenewal.provider,
      soonest_renewal_type: soonestRenewal.type,
      // PRD-110: attributes the renewal insight to a roster member in the
      // feature snapshot when the policy carries one — same additive,
      // non-dedup-affecting pattern as member_id on household earner events.
      ...(soonestRenewal.member_id ? { soonest_renewal_member_id: soonestRenewal.member_id } : {}),
    }
    // OAK-029: neutralizes protection-gap.yaml's other 3 rules
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
      earner: { employment_status: string; monthly_salary_minor: number; income_protection_monthly_minor: number; member_id?: string },
      shared: typeof sharedHouseholdData,
    ) => {
      // Both employed and self-employed earners have income to protect
      // (self-employed arguably more so, with no employer sick pay) —
      // only unemployed/retired genuinely have none via this policy type.
      const hasIncomeToProtect = earner.employment_status === 'employed' || earner.employment_status === 'self_employed'
      const eventId = crypto.randomUUID()
      const data = {
        employed: Number(hasIncomeToProtect),
        monthly_salary_minor: earner.monthly_salary_minor,
        income_protection_monthly_minor: earner.income_protection_monthly_minor,
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

  // ── family_emergency_fund_adequacy ───────────────────────────────────
  {
    const eventId = crypto.randomUUID()
    const data = {
      emergency_savings_minor: profile.emergency_fund.emergency_savings_minor,
      // Not entered separately? Fall back to the household's stated annual
      // living expenses / 12 so the check runs on real numbers instead of 0.
      monthly_expenses_minor:
        profile.emergency_fund.monthly_expenses_minor > 0
          ? profile.emergency_fund.monthly_expenses_minor
          : Math.round(profile.household.annual_living_expenses_minor / 12),
      has_high_interest_debt: Number(profile.emergency_fund.has_high_interest_debt),
      high_interest_debt_balance_minor: profile.emergency_fund.high_interest_debt_balance_minor,
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
      additional_monthly_contribution_needed_minor: projection.additional_monthly_contribution_needed_minor,
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
  }

  // ── family_education_shortfall (one event per child) ─────────────────
  for (const fund of profile.education_funds) {
    if (isUnsetTarget(fund.target_savings_minor)) continue
    const eventId = crypto.randomUUID()
    const data = {
      child_name: fund.child_name,
      child_age: fund.child_age,
      current_savings_minor: fund.current_savings_minor,
      target_savings_minor: fund.target_savings_minor,
      years_remaining: fund.years_remaining,
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
function toChangeSnapshot(profile: Pick<FinancialProfile, 'household' | 'emergency_fund'>): ProfileChangeSnapshot {
  return {
    earners: [
      { employment_status: profile.household.employment_status, monthly_salary_minor: profile.household.monthly_salary_minor },
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
    getTenantCollection<FinancialProfile & { tenant_id: string; updated_at: Date; version?: number }>(
      db,
      'family_financial_profile',
      tenantId,
    )

  app.get('/family/financial-profile', async (req) => {
    const { tenant_id } = req.authContext
    const doc = await profileFor(tenant_id).findOne({})
    if (!doc) return { profile: null }
    const { tenant_id: _tenantId, updated_at, version, ...profile } = doc
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
    const { tenant_id: _t, updated_at: _u, version: _v, _id: _i, insights_evaluated_at: _e, ...rest } = doc as Record<string, unknown>
    const parsed = FinancialProfileSchema.safeParse(rest)
    if (!parsed.success) {
      return reply.status(422).send({ error: 'Saved profile is incomplete', issues: parsed.error.issues })
    }
    const insightsGenerated = await evaluateProfileAndGenerateInsights(parsed.data, tenant_id, engine, db, onInsightsGenerated)
    await profileFor(tenant_id).updateOne({}, { $set: { insights_evaluated_at: new Date() } })
    return reply.send({ ok: true, insights_generated: insightsGenerated })
  })

  app.post<{ Body: FinancialProfile & { generate_insights?: boolean; version?: number } }>('/family/financial-profile', async (req, reply) => {
    const { generate_insights, version: clientVersion, ...body } = req.body
    const parsed = FinancialProfileSchema.safeParse(body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid financial profile', issues: parsed.error.issues })
    }
    const { tenant_id } = req.authContext
    const profile = parsed.data

    // PRD-111: read before the write so an unreported-life-change nudge
    // can diff against what was actually there before — a plain read,
    // entirely separate from the optimistic-concurrency filter below.
    const previousDoc = await profileFor(tenant_id).findOne({})

    // OAK-006: optimistic concurrency. The multi-step wizard autosaves
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
      return reply.status(409).send({ error: 'This profile was updated elsewhere — reload and try again.' })
    }
    const newVersion = (result as unknown as { version?: number } | null)?.version ?? (clientVersion ?? 0) + 1

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

    const insightsGenerated = await evaluateProfileAndGenerateInsights(profile, tenant_id, engine, db, onInsightsGenerated)
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
  })
}
