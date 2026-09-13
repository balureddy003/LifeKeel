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

const FinancialProfileSchema = z.object({
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
    target_retirement_income_minor: z.number().int().positive(),
    expected_annual_growth_pct: z.number().min(0).max(20).default(5),
  }),
  education_funds: z
    .array(
      z.object({
        child_name: z.string().min(1),
        child_age: z.number().int().nonnegative(),
        current_savings_minor: z.number().int().nonnegative(),
        target_savings_minor: z.number().int().positive(),
        years_remaining: z.number().int().nonnegative(),
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
        type: z.enum(['life', 'income_protection', 'health', 'critical_illness']),
        provider: z.string().min(1),
        coverage_amount_minor: z.number().int().nonnegative().default(0),
        monthly_premium_minor: z.number().int().nonnegative().default(0),
        // ISO date string (e.g. "2027-03-01"), optional — a policy with no
        // known renewal date simply never contributes to the renewal-window
        // rule, rather than being rejected.
        renewal_date: z.string().optional(),
      }),
    )
    .default([]),
})

type FinancialProfile = z.infer<typeof FinancialProfileSchema>

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
 */
function projectRetirement(r: FinancialProfile['retirement']) {
  const rate = r.expected_annual_growth_pct / 100
  const requiredCorpusMinor = r.target_retirement_income_minor * 25
  const annualContribution = r.monthly_contribution_minor * 12
  const yearsToTarget = Math.max(0, r.target_retirement_age - r.current_age)

  let balance = r.pension_balance_minor
  let age = r.current_age
  const maxAge = r.current_age + 60
  while (balance < requiredCorpusMinor && age < maxAge) {
    balance = balance * (1 + rate) + annualContribution
    age += 1
  }
  const projected_retirement_age = age

  let additional_monthly_contribution_needed_minor = 0
  let achievable_retirement_income_minor = r.target_retirement_income_minor
  if (yearsToTarget > 0) {
    const growthFactor = Math.pow(1 + rate, yearsToTarget)
    const futureValueOfCurrentBalance = r.pension_balance_minor * growthFactor
    const annuityFactor = rate > 0 ? (growthFactor - 1) / rate : yearsToTarget
    const futureValueOfContributions = annualContribution * annuityFactor

    const requiredAnnualContribution = annuityFactor > 0
      ? (requiredCorpusMinor - futureValueOfCurrentBalance) / annuityFactor
      : 0
    const requiredMonthlyContribution = requiredAnnualContribution / 12
    additional_monthly_contribution_needed_minor = Math.max(
      0,
      Math.round(requiredMonthlyContribution - r.monthly_contribution_minor),
    )

    const achievableCorpusMinor = futureValueOfCurrentBalance + futureValueOfContributions
    achievable_retirement_income_minor = Math.max(0, Math.round(achievableCorpusMinor / 25))
  }

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
} {
  const now = Date.now()
  let best: { days: number; provider: string; type: string } | null = null
  for (const policy of policies) {
    if (!policy.renewal_date) continue
    const renewalMs = new Date(policy.renewal_date).getTime()
    if (Number.isNaN(renewalMs)) continue
    const days = Math.ceil((renewalMs - now) / 86_400_000)
    if (days < 0) continue
    if (!best || days < best.days) best = { days, provider: policy.provider, type: policy.type }
  }
  return best ?? { days: 9999, provider: '', type: '' }
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

  app.post<{ Body: FinancialProfile & { generate_insights?: boolean; version?: number } }>('/family/financial-profile', async (req, reply) => {
    const { generate_insights, version: clientVersion, ...body } = req.body
    const parsed = FinancialProfileSchema.safeParse(body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid financial profile', issues: parsed.error.issues })
    }
    const { tenant_id } = req.authContext
    const profile = parsed.data

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
      { $set: { ...profile, updated_at: new Date() }, $inc: { version: 1 } },
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

    const educationGap = educationFundingGapMinor(profile.education_funds)
    const generatedInsights: Insight[] = []

    // ── family_protection_gap ────────────────────────────────────────────
    {
      const eventId = crypto.randomUUID()
      // Both employed and self-employed households have income to protect
      // (self-employed arguably more so, with no employer sick pay) — only
      // unemployed/retired genuinely have none via this policy type.
      const hasIncomeToProtect =
        profile.household.employment_status === 'employed' ||
        profile.household.employment_status === 'self_employed'
      const soonestRenewal = soonestPolicyRenewal(profile.policies)
      const data = {
        employed: Number(hasIncomeToProtect),
        // Gates no_income_protection off for households within a year of
        // their target retirement age — a new income protection policy
        // isn't a meaningful gap to flag that close to (or past) retiring.
        years_to_retirement: Math.max(0, profile.retirement.target_retirement_age - profile.retirement.current_age),
        monthly_salary_minor: profile.household.monthly_salary_minor,
        annual_living_expenses_minor: profile.household.annual_living_expenses_minor,
        mortgage_outstanding_minor: profile.household.mortgage_outstanding_minor,
        life_cover_minor: profile.household.life_cover_minor,
        income_protection_monthly_minor: profile.household.income_protection_monthly_minor,
        education_funding_gap_minor: educationGap,
        // PRD-102: derived from the independent policies[] array, additive
        // to the fields above — see soonestPolicyRenewal's doc comment.
        has_dependents: Number(profile.education_funds.length > 0),
        has_health_or_ci_cover: Number(profile.policies.some((p) => p.type === 'health' || p.type === 'critical_illness')),
        soonest_renewal_days: soonestRenewal.days,
        soonest_renewal_provider: soonestRenewal.provider,
        soonest_renewal_type: soonestRenewal.type,
      }
      const signalId = await persistSignal({
        tenant_id,
        signal_type: 'family.household',
        source: 'manual-entry',
        external_id: eventId,
        data,
      })
      const result = await engine.evaluate({
        event_type: 'family.household',
        tenant_id,
        event_id: eventId,
        data,
        derived_from_signals: [signalId],
      })
      generatedInsights.push(...result.insights)
    }

    // ── family_emergency_fund_adequacy ───────────────────────────────────
    {
      const eventId = crypto.randomUUID()
      const data = {
        emergency_savings_minor: profile.emergency_fund.emergency_savings_minor,
        monthly_expenses_minor: profile.emergency_fund.monthly_expenses_minor,
        has_high_interest_debt: Number(profile.emergency_fund.has_high_interest_debt),
        high_interest_debt_balance_minor: profile.emergency_fund.high_interest_debt_balance_minor,
      }
      const signalId = await persistSignal({
        tenant_id,
        signal_type: 'family.savings',
        source: 'manual-entry',
        external_id: eventId,
        data,
      })
      const result = await engine.evaluate({
        event_type: 'family.savings',
        tenant_id,
        event_id: eventId,
        data,
        derived_from_signals: [signalId],
      })
      generatedInsights.push(...result.insights)
    }

    // ── family_retirement_gap ─────────────────────────────────────────────
    {
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
        tenant_id,
        signal_type: 'family.pension',
        source: 'manual-entry',
        external_id: eventId,
        data,
      })
      const result = await engine.evaluate({
        event_type: 'family.pension',
        tenant_id,
        event_id: eventId,
        data,
        derived_from_signals: [signalId],
      })
      generatedInsights.push(...result.insights)
    }

    // ── family_education_shortfall (one event per child) ─────────────────
    for (const fund of profile.education_funds) {
      const eventId = crypto.randomUUID()
      const data = {
        child_name: fund.child_name,
        child_age: fund.child_age,
        current_savings_minor: fund.current_savings_minor,
        target_savings_minor: fund.target_savings_minor,
        years_remaining: fund.years_remaining,
      }
      const signalId = await persistSignal({
        tenant_id,
        signal_type: 'family.education_fund',
        source: 'manual-entry',
        external_id: eventId,
        data,
      })
      const result = await engine.evaluate({
        event_type: 'family.education_fund',
        tenant_id,
        event_id: eventId,
        data,
        derived_from_signals: [signalId],
      })
      generatedInsights.push(...result.insights)
    }

    if (generatedInsights.length > 0 && onInsightsGenerated) {
      await onInsightsGenerated(generatedInsights, tenant_id)
    }

    return reply.send({ ok: true, insights_generated: generatedInsights.length, version: newVersion })
  })
}
