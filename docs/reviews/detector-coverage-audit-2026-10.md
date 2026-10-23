# Detector coverage audit — protection surface vs. what LifeKeel notices

**Date:** 2026-10-22 · **Scope:** PRD-213 "done" item 1 — every major
protection state has a detector or a documented reason not to.
**Method:** inventory of `detectors/family/*.yaml` (9 families, 25 rules)
mapped against the family's protection surface as defined by the
financial-profile schema (`family-financial-profile.ts`), the legacy
register, and the non-detector noticing mechanisms (life-events, freshness,
continuity). Read-only — proposes candidates, implements nothing.

## 1. Inventory — what exists today

| Detector family | Rules | What it watches |
|---|---|---|
| `family_protection_gap` | 5 | Household life-cover adequacy, income protection presence, renewal window, second-earner life cover, health/CI cover presence |
| `family_policy_review` | 3 | Register hygiene: duplicate policies, orphaned attribution (holder **and** beneficiary), past-dated renewals |
| `family_emergency_fund_adequacy` | 3 | Fund <3 months, high-interest debt outstanding, fund >12 months (overfunded) |
| `family_emergency_trajectory` | 2 | Fund not growing, slow build toward target (uses real cashflow entries when present) |
| `family_debt_health` | 2 | DTI above guideline, DTI severe |
| `family_retirement_gap` | 3 | Behind target for age, gap unaffordable by contributions, no retirement savings |
| `family_education_shortfall` | 2 | Fund behind target, fund not started |
| `family_education_pacing` | 2 | Behind expected pace, catch-up needs large contribution |
| `family_estate_readiness` | 6 | No will, no PoA, will may predate recorded change, guardianship gap, unreachable executor, property-title gap |

**Non-detector noticing (not YAML — listed so the map is honest):**
unreported-life-change nudge (PRD-111 + PRD-213 M4 shadow calibration),
freshness pause/stale per detector (PRD-145), continuity check-in
(PRD-130), rehearsal gap insights (PRD-214 M3), policy-renewal reminders,
vault-reminder on reported life events.

## 2. Coverage matrix by protection-surface axis

### Income & earners

| Protection state | Coverage | Status |
|---|---|---|
| Earner loses employment / salary → 0 | PRD-111 nudge (`employment_status_change`, `salary_to_zero`) | Covered — information-only by design (PRD-111) |
| Sub-total income shocks (pay cut, drawdown, roster change) | M4 calibration candidates — shadow-only, not yet a nudge | **Calibrating** — widens only when `calibrationSummary` shows precision |
| No income protection (household) | `no_income_protection` | Covered |
| Second earner: no life cover | `member_no_life_cover` | Covered |
| Second earner: no income protection | — | **Gap.** `members[].income_protection_monthly_minor` is in the schema but no rule reads it. Candidate: `member_no_income_protection`. |

### Savings & cash flow

| Protection state | Coverage | Status |
|---|---|---|
| Fund adequacy vs. expenses | `emergency_fund_*` (3) | Covered |
| Fund trajectory | `emergency_fund_stalled`, `emergency_fund_slow_build` | Covered — already reads real `family_cashflow_entries` for pace |
| High-interest debt | `high_interest_debt_unaddressed` | Covered |
| Cash-flow *pattern* shifts (spending spike, income volatility, savings-rate decline across entries) | — | **Gap.** The entries exist and are only used for a pace estimate. This is the largest uncovered surface and the natural home for drift-style detectors. |
| Debt-to-income | `debt_to_income_*` (2) | Covered |

### Policies

| Protection state | Coverage | Status |
|---|---|---|
| Life cover adequacy | `life_insurance_below_household_needs` | Covered (expenses + mortgage basis) |
| Health / critical-illness presence | `no_health_or_critical_illness_cover` | Covered |
| Register hygiene (duplicates, orphaned holders + beneficiaries, stale dates) | `family_policy_review` (3) | Covered |
| Renewal approaching / passed | `policy_renewal_window`, `policy_renewal_date_in_past` | Covered |
| **car / home / travel adequacy** | — | **Documented non-gap.** PRD-105 made these types *recordable* and explicitly scoped adequacy out: without vehicle/property value data any adequacy rule is noise. Reason stands — revisit only if the schema grows those values. |
| Total premium burden vs. income | — | **Gap.** `monthly_premium_minor` × count vs. salary is computable today. Candidate: `premium_burden_elevated`. |
| Beneficiary off-roster | folded into `policy_attributed_to_removed_member` (`family-financial-profile.ts:845`) | Covered |

### Renewal windows

Covered by `policy_renewal_window` (approaching), `policy_renewal_date_in_past` (recorded past), plus the reminder job that dispatches on the window. No gap.

### Retirement

| Protection state | Coverage | Status |
|---|---|---|
| Household retirement gap | `retirement_*` (3) | Covered |
| Per-member pension | — | **Gap.** `members[].pension_balance_minor` / `monthly_pension_contribution_minor` exist; retirement-gap reads the household `retirement` object only. Candidate: `member_retirement_behind`. |

### Education

Covered — shortfall + pacing, 4 rules across both detectors.

### Estate & continuity

Covered — 6 estate-readiness rules + rehearsal gap insights + continuity
check-in + freshness. Deepest surface in the map.

### Drift & data quality

| Protection state | Coverage | Status |
|---|---|---|
| Unreported life change | PRD-111 nudge + M4 shadow calibration | Covered, Tier 0 |
| Stale/missing inputs | PRD-145 freshness pauses + cards | Covered |

## 3. Gap summary — candidates for expansion

Ordered by expected perceived-protection value (the PRD's open question —
this table is the evidence for the pick, not the pick itself):

| # | Candidate detector | Axis | Data ready? | Notes |
|---|---|---|---|---|
| 1 | `cashflow_spending_shift` (+ `income_volatility`, `savings_rate_decline`) | Cash flow | Yes — `family_cashflow_entries` | Largest uncovered surface; needs baseline window + abstention band from the start (M4 lesson — wire calibration in day one) |
| 2 | `member_no_income_protection` | Members | Yes — `members[].income_protection_monthly_minor` | Mirrors `member_no_life_cover`; cheapest new signal |
| 3 | `member_retirement_behind` | Members | Yes — `members[].pension_*` | Needs a per-member age source — member DOB may not be in the roster schema; check first |
| 4 | `premium_burden_elevated` | Policies | Yes — premiums + salary | Threshold needs product review (what share of income is "elevated" is a judgment call, not a rule of thumb we should assert) |

All four ship through the add-detector path: schema check → YAML →
golden evals → web form → `advice-rule.test.ts`. Copy stays informational
— describe what's on file and the estimated gap, never a product or
provider.

## 4. Documented non-gaps (reasons, not holes)

- **car/home/travel adequacy** — deliberate (PRD-105): no value data to
  judge adequacy against; recording exists, reasoning deferred.
- **Health/CI *adequacy* (vs. presence)** — same shape as above:
  adequacy against medical costs needs data we don't hold and edges
  toward regulated territory; presence-check is the safe boundary.
- **External-transaction-driven drift** — permanently out (CLAUDE.md:
  drift runs on in-infra data only; no transaction feeds).
- **Cross-tenant scorer signals from Gmail** — excluded by PRD-142
  amendment; not a coverage gap, a data-governance choice.
- **Premium drift per policy** (premiums increasing at renewal): needs a
  price history the profile doesn't store. Candidate schema extension;
  deferred until the profile records premium history or renewal offers.
- **Provider concentration** (all policies with one insurer): recordable but
  weak signal — concentration isn't a protection gap, and flagging it risks
  reading as a "diversify providers" recommendation (rule 2). Deferred;
  revisit only if copy can stay purely descriptive.
- **Per-member education-fund staleness** (fund not contributed to recently):
  contribution cadence isn't stored — `years_remaining` is a target, not a
  transaction log. Covered indirectly by education_pacing; revisit if
  contribution events land.
- **Mortgage term/rate windows**: mortgage is a balance figure only; no
  term or rate-fix expiry field exists. Candidate schema extension if
  families ask for it.
