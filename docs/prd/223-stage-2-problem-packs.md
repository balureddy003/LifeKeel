# PRD-223: Stage 2 — Problem packs and annual record-keeping (~£59/year)

## Problem

After a couple finishes and shares their first Stage 1 brief (PRD-222), real
household life introduces specific upcoming events that change their runway
months or open a named gap: changing jobs (where employer-provided life or
income protection ends with the job), a mortgage fix ending, a renewal price
jump, a childcare or school bill starting, a quiet self-employed month or tax
bill, or a parent needing support.

Today these are either split across separate screens (`/events`, `/insights`,
`/financial-profile`), missing one schema field (`policies[].source`), or not
wired into the brief solver, while Keel Plus is still framed around monthly OCR
document-reading credits rather than paying for the second brief or keeping the
household record current (~£59/year).

## Who it's for

Households that have completed and shared their first brief (PRD-222) and want
to run a second brief for a specific upcoming life change or keep their
household record current over the year.

## What "done" looks like

1. **Gated launch:** Stage 2 packs ship only after Stage 1 briefs are finished
   and shared by real couples. None of the packs is a separate app; every pack
   uses the **same deterministic solver** (`calculate.ts`) and updates the
   household's months or a named gap on `household_briefs`.
2. **Six problem packs on the shared solver:**
   - **Pack 1 — Job change (`job_change`):**
     - `policies[]` in `family-financial-profile.ts` gains
       `source: z.enum(['employer', 'personal']).default('personal')`.
     - When an earner changes jobs at `atMonth`, the solver applies the income
       delta (`ScenarioStep`) **and** drops any `source: 'employer'` cover
       attributed to that `member_id` from the post-transition protection view,
       surfacing both the new runway months and the named employer-cover gap.
   - **Pack 2 — Mortgage fix ending (`mortgage_fix_ending`):**
     - Captures `fix_end_month` (or ISO date) and `monthly_payment_delta_minor`
       (previous payment vs. new fixed/revert payment).
     - Adds a `ScenarioStep` at `atMonth` with `monthlyExpenseDeltaMinor` and
       recomputes runway months and `savingsAtChangeMinor`.
   - **Pack 3 — Renewal price change (`renewal_price_change`):**
     - Uses `policies[].premium_history` (Intent 38) vs. current
       `monthly_premium_minor`.
     - Computes the monthly/annual delta across renewing policies, feeds
       `monthlyExpenseDeltaMinor` into the brief solver, and displays last
       premium vs. this premium alongside the updated runway months.
   - **Pack 4 — Childcare or school bill starting (`childcare_or_school_bill`):**
     - Captures `start_month`, optional `end_month`, and `monthly_cost_minor`
       (linked optionally to a child roster `member_id`).
     - Models the start (and end) as ordered `ScenarioStep[]` entries and
       recomputes runway months and mid-timeline `fundDepletedAtMonth`.
   - **Pack 5 — Quiet month or tax bill (`quiet_month_or_tax_bill`):**
     - Captures a temporary income drop (`monthlyIncomeDeltaMinor` over a range
       of months) or a dated lump-sum tax bill (January/July self-assessment)
       modelled as a step expense spike, returning whether emergency savings
       survive the trough (`fundDepletedAtMonth`) and the post-bill runway.
   - **Pack 6 — Parent needing support (`parent_support`):**
     - Captures a recurring monthly support contribution
       (`monthlyExpenseDeltaMinor`) plus the parent/care handover entries in
       the brief (`who_to_call`, `key_papers`), recomputing household runway
       months and updating the shared brief.
3. **Commercial model (~£59/year):**
   - The first brief in a household is free (PRD-222).
   - Creating a **second brief**, running Stage 2 problem packs, or keeping the
     household record updated over time requires the annual household plan
     (`keel_plus_gbp_annual`, £59.99/year in `billing/stripe-price.ts`).
   - Billing copy on `/upgrade` and `Pricing.tsx` states this plainly: pay for
     the second brief and keeping the household record current — never for
     product recommendations or commissions.

## Constraints

- **Trust tier:** 0. All six packs are deterministic calculations over
  household-entered figures and policy metadata.
- **Regulated-advice check:** packs show how an event changes runway months or
  which employer/renewing policy changed; they never recommend a mortgage deal,
  insurer, or switching provider (`CLAUDE.md` Rule 2; verified by
  `advice-rule.test.ts`).
- **Data/privacy:** zero LLM calls required for any problem pack (`CLAUDE.md`
  Rule 3); narrow Mongo projections and `data_version` invalidation (PRD-226).

## Out of scope

Mortgage broking or rate comparison tables, insurance switching flows, tax-filing
submission, or building separate standalone calculators outside the brief engine.

## Builds on

PRD-222 (Stage 1 brief engine), PRD-132 (`ScenarioStep[]` multi-step solver),
Intent 38 (`premium_history`), PRD-006 / Intent 39 (`keel_plus_gbp_annual`),
Intent 71.

## Success metrics

Share of Stage 1 households that run a second brief / problem pack; conversion to
the ~£59/year annual plan at the second-brief gate; `opened_at` rate on Stage 2
briefs.
