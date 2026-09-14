# PRD-106: Retirement projection correctness at and past target age

## Problem

`projectRetirement()` in
[family-financial-profile.ts](../../apps/api/src/routes/family-financial-profile.ts)
only computes `additional_monthly_contribution_needed_minor` inside an
`if (yearsToTarget > 0)` block. For any household already at or past its
target retirement age, that value hard-defaults to `0`, and the
forward-compounding projection loop (capped at `current_age + 60`) keeps
running without ever checking whether retirement has already happened.

Verified live: a genuinely retired 70-year-old (target age 65, £5,000
pension) received *"your projected retirement age is approximately 130
... increasing monthly contributions by £0.00 could close the gap."* A
63-year-old with a severe, real shortfall received *"you're on track to
retire around age 111."* Both numbers are the literal, unedited output of
the projection loop. Because the needed-contribution figure is
structurally locked at 0 past the target age, `retirement_gap_
unaffordable_by_contributions` (the rule that would give a more honest
"the gap is too large for contributions alone" framing) can mathematically
never fire for this population — only the always-£0-fix
`retirement_behind_target_age` can, regardless of how underfunded the
household actually is.

## Market bar

See [000](000-market-landscape-and-positioning.md)'s "reasoning grounded
in the family's real data, not templated advice" bar. A literal "retire at
age 130" is the opposite of that — visibly-wrong output erodes trust in
every other insight the moment an older family member reads it, which is
a materially worse outcome than a missing feature. Not a novel
ask: it's the same bar PRD-102 and PRD-103 are already held to.

## Who it's for

Every household in the arc's Transition and Stewardship stages (see
[007](007-life-stage-and-crisis-response-research.md)) — retirees and
near-retirees, the population this bug affects by construction, since it
only triggers once `current_age` reaches `target_retirement_age`.

## What "done" looks like

For any household with `current_age >= target_retirement_age`, the
insight speaks in terms an already-retired person can act on: whether the
current pension balance can sustain the target income at the current
drawdown rate, not a fictional future retirement date. The
contribution-based framing (`retirement_behind_target_age`'s "increase
contributions by £X") is skipped entirely for this population — a retiree
can't out-contribute their way to a bigger pot on a timeline that's
already ended.

## Trust tier

**Tier 0 — Observe/Understand/Predict.** Pure calculation fix inside an
existing Tier 0 detector. No new external side effect.

## Scope

1. Add an explicit branch to `projectRetirement()` for
   `current_age >= target_retirement_age`: report sustainability directly
   (e.g. `years_of_sustainable_income` at the current drawdown rate, or an
   explicit `shortfall_minor` against the target annual income) instead of
   projecting a future `projected_retirement_age`.
2. Update `retirement-gap.yaml`'s two behind-target rules so
   `retirement_behind_target_age` cannot fire for this population (its
   condition already requires `additional_monthly_contribution_needed_
   minor <= monthly_salary_minor * 0.5`, which the fix above should make
   structurally false rather than trivially true at 0), and add — or
   extend `retirement_gap_unaffordable_by_contributions` to cover — a
   clean past-target-age shortfall condition using the new field.
3. Update the affected reasoning templates so neither rule's copy
   references a "projected retirement age" for someone who has already
   retired.

Out of scope: any change to the pre-target-age projection math (already
verified correct across this session's 24-scenario engine pass) and any
long-term-care or drawdown-sequencing modeling — this PRD only fixes the
boundary condition at and past the target age.

## Success metrics

- **Zero occurrences** of a `projected_retirement_age` value beyond a
  sanity bound (e.g. `target_retirement_age + 15`) in any generated
  insight — a release-blocking regression check, not a soft target, given
  how directly this touches trust.
- **`retirement_behind_target_age` fire-rate among current_age >=
  target_retirement_age households** — expected to drop to zero post-fix,
  replaced by the new past-target-age framing where a real shortfall
  exists.

## Acceptance criteria

- A household with `current_age: 70, target_retirement_age: 65,
  pension_balance_minor: 500000` (this session's exact repro) no longer
  produces a `projected_retirement_age` insight; it produces a shortfall
  insight stated in sustainability terms.
- A household with `current_age: 63, target_retirement_age: 65` and a
  severe shortfall no longer references "retire around age 111."
- The existing pre-target-age scenarios (on-track empty-nester, moderate
  behind-target, severe near-retiree gap) continue to pass unchanged —
  regression against the existing engine test suite.
