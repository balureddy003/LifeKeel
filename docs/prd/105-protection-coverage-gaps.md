# PRD-105: Protection domain — car/home coverage and a correctness fix

## Problem

Two gaps found by driving real households through the live Protection
domain (PRD-102), not by reading the code:

1. `policies[].type` in `family-financial-profile.ts` accepts exactly
   `life`, `income_protection`, `health`, `critical_illness`. Confirmed
   live at both the UI (the "Add a policy" picker offers only those four)
   and the API (`POST /family/financial-profile` returns a 400
   `invalid_enum_value` for `car` or `home`). Car and home/buildings/
   contents are two of the most commonly held household policies and
   cannot be recorded anywhere in the product today.
2. `life_insurance_below_household_needs` fires regardless of whether
   anyone is financially dependent on the insured — unlike its sibling
   rule `no_health_or_critical_illness_cover`, which correctly gates on
   `has_dependents`. Verified live: a 23-year-old single renter with no
   dependents and no mortgage, a childless 63-year-old near-retiree, and a
   fully retired 70-year-old with no dependents all received a
   large-figure life-insurance shortfall nudge. A parallel scenario with a
   real mortgage and a real dependent fired the same rule appropriately —
   the rule works, it just isn't scoped to when the need is real.

## Market bar

See [000](000-market-landscape-and-positioning.md) and PRD-102's own
market-bar section. Policygenius/Ladder-style calculators compute a single
number against whatever inputs they're given and don't reason about
whether the inputs justify the recommendation at all — this PRD's second
item is exactly the kind of "continuously monitored, reasoning-backed"
gap those tools don't close either, since they'd apply the same 5x-income
heuristic to a childless renter without blinking. Getting this right is
part of the differentiated bar PRD-102 already committed to, not a new
promise.

## Who it's for

Families whose actual policy mix includes car and home insurance (nearly
all of them) and any household — young single, childless couple, empty
nester, retiree — where a life-insurance nudge shows up despite nobody
depending on that person's income.

## What "done" looks like

`policies[].type` accepts `car` and `home` alongside the existing four.
No new detector rules are required for the two new types in this PRD —
they simply become recordable, satisfying "can a family log what they
actually hold" before any coverage-adequacy reasoning is built for them
(a natural follow-up, not blocking this PRD). Separately,
`life_insurance_below_household_needs` in
[protection-gap.yaml](../../detectors/family/protection-gap.yaml) gains a
condition matching its sibling rule: fires only when `has_dependents >= 1
or mortgage_outstanding_minor > 0` — a household with neither genuinely
may not need life cover sized to 5 years of living expenses, and should
stop being told otherwise.

## Trust tier

**Tier 0 — Observe/Understand/Predict.** Schema extension and a detector
condition change. No new external side effect.

## Scope

1. Extend the `type` enum in `family-financial-profile.ts`'s policy schema
   with `car` and `home`.
2. Add `car: 'Car'` and `home: 'Home'` to `POLICY_TYPE_LABELS` in the
   financial-profile wizard (`apps/web/src/app/financial-profile/page.tsx`)
   so the picker actually offers them.
3. Add the `has_dependents >= 1 or mortgage_outstanding_minor > 0` gate to
   `life_insurance_below_household_needs`'s condition in
   `protection-gap.yaml`. `has_dependents` and `mortgage_outstanding_minor`
   are already computed and passed into this rule's data object today —
   no new signal required.

Out of scope: coverage-adequacy detectors for car/home policies (what's
"enough" car insurance is a materially different, jurisdiction-specific
problem from life-insurance-need math) and any insurer-integration or
quote-comparison capability — recording what a family holds, not shopping
for it.

## Success metrics

- **% of households with ≥1 car or home policy recorded** within 30 days
  of the type becoming available — same uptake framing PRD-102 already
  uses for its own policies[] metric.
- **`life_insurance_below_household_needs` fire-rate among no-dependents,
  no-mortgage households** pre/post-launch — the desired outcome is this
  drops close to zero, since that's precisely the population the gate
  removes.
- **Zero regression** in the rule's fire-rate for households that do have
  dependents or a mortgage (the single-parent self-employed scenario from
  this session's lifecycle testing is a good fixture: it should keep
  firing).

## Acceptance criteria

- `POST /family/financial-profile` accepts a policy with `type: 'car'` or
  `type: 'home'` and persists it; a fixture with `type: 'car'` no longer
  returns a 400.
- The "Add a policy" picker in the financial-profile wizard shows six
  options, not four.
- A household with `life_cover_minor: 0`, no dependents, and no mortgage
  no longer fires `life_insurance_below_household_needs`.
- The same rule still fires for a household with a mortgage and/or
  dependents and under-covered life insurance (regression against the
  existing engine test suite's life-insurance scenarios).
