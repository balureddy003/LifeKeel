# Intent 71: Stage 2 — Problem packs and annual record-keeping (~£59/yr)

> **Status: GATED — do not implement.** No evidence yet that a couple finishes a
> Stage 1 brief. Proceed only after PRD-222's kill/proceed thresholds are met
> (confirmed second-adult open rate and second-brief return rate). See PRD-223
> for the single pricing decision (new `household_record` SKU, not a re-skin of
> the OCR Plus plan).

**Problem** — Once couples finish and share their first brief, upcoming household changes (changing jobs, a mortgage fix ending, an insurance renewal jump, a childcare or school bill starting, a quiet self-employed month or tax bill, or a parent needing support) each alter the household's runway months or create a named gap. Today those scenarios are scattered across generic detectors, free-text notes, or unbuilt schema fields, and Keel Plus is framed around monthly OCR credits (`£7.99/mo` for AI document reading) rather than paying for the second brief or keeping the household record current (~£59/year).

**Done looks like**
- Six problem packs built on the **same deterministic engine** and cleaner policy/profile fields (gated on Stage 1 completion & share metrics):
  1. **Job change** — `policies[]` gains `source: 'employer' | 'personal'`; leaving a job zeroes out employer-tied life, income-protection, and health cover at the transition month and recomputes runway months + named cover gap.
  2. **Mortgage fix ending** — records fix end date and new monthly payment delta; injects a step at the fix-end month to recompute runway months.
  3. **Renewal price change** — compares last premium (`premium_history`) vs. this renewal premium (`monthly_premium_minor`) and feeds the monthly delta into the brief solver alongside the existing `premium_increased` hygiene check.
  4. **Childcare or school bill starting** — models a dated start (and optional end) monthly commitment step in `ScenarioStep[]` and recomputes runway months.
  5. **Quiet month or tax bill** — models a self-employed income dip or dated tax bill (e.g. January/July self-assessment) against emergency savings and runway months.
  6. **Parent needing support** — models a recurring monthly support commitment plus designated handover contacts in the brief.
- **Commercial packaging:** first brief is free; the household pays ~£59/year for the second brief or for keeping the household record current over time, checked via a **new `household_record` annual entitlement**. It may bill on the same £59.99/yr Stripe price (`keel_plus_gbp_annual`), but the entitlement and billing/landing copy must describe it as "second brief + keeping the record current" — never "AI document reading". The existing Plus/OCR framing is repackaged as part of the Stage 1 landing rewrite (PRD-222); document extraction moves to an add-on or secondary feature line rather than the paid headline.

**Constraints**
- Trust tier touched (0–3, see ARCHITECTURE.md): **Tier 0** (deterministic solver + persisted brief pack).
- Regulated-advice check: packs compute runway months and describe recorded cover/cost deltas (e.g. "employer life cover of £X ends when the role ends" or "recorded premium rose by £Y/month"); never recommend a replacement policy, lender, or broker (`CLAUDE.md` Rule 2).
- Data/privacy limits: deterministic math only; no LLM call required to run or update any problem pack.

**Out of scope** — Competing as a standalone document vault, mortgage brokerage, insurance comparison site, or switching service.

**Becomes** — [docs/prd/223-stage-2-problem-packs.md](../prd/223-stage-2-problem-packs.md)
