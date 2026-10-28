# PRD-223: Stage 2 — Problem packs and annual record-keeping (~£59/year)

> **Status: GATED — do not implement.** No evidence yet that a couple finishes a
> Stage 1 brief. Proceed only if PRD-222's kill/proceed thresholds are met
> (confirmed second-adult open rate; second-brief return rate). This document
> exists so Stage 1 does not paint into a corner on pricing and schema — not as
> a build order.

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
3. **Commercial model — the one pricing decision:**
   - **SKU:** a new `lifekeel_record_annual` entitlement — "unlimited briefs +
     the household record kept current" — priced at **£59.99/yr**. (The ~£59
     shorthand elsewhere in these docs means this price; the two spellings are
     never used as if they were different offers.)
   - **Not a silent reuse of the Plus SKU.** `keel_plus_gbp_annual` today buys
     AI document reading (`Pricing.tsx`, `PlusSpotlight.tsx`). The record
     entitlement gets its own Stripe price id and server-side entitlement
     flag; nothing checks `plan === 'plus'` or a shared price id to unlock
     briefs.
   - **Existing Plus subscribers:** keep their paid OCR extraction unchanged —
     grandfathered on the existing `plus` entitlement. They are **not** silently
     migrated to `household_record`; if record-keeping is folded into Plus
     later, that is a separate, announced migration. New subscribers see only
     the record plan on the rewritten `/upgrade` and `Pricing.tsx`.
   - **One free brief per household** (PRD-222): the three Stage 1 problems are
     alternatives for the single free brief, not three free briefs. Every
     subsequent brief — including Stage 2 packs — requires `household_record`.
   - **The second-brief gate is the likely drop-off point** of the funnel; it
     is instrumented (`brief_gate_hit` / `brief_gate_converted`) and the
     pricing decision above is revisited if confirmed-open rates are strong
     but gate conversion is near zero.
   - **Kill/proceed:** if PRD-222's Stage 1 metrics miss the stated thresholds
     (confirmed-open <~30% in 7 days, second-brief return <~15% in 30 days),
     this PRD does not build — the problem is the brief, not the packs.

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
