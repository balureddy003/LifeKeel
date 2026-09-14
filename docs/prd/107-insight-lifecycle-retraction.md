# PRD-107: Insight lifecycle — retract what's been resolved

## Problem

`persistAndDeliverInsights()` in
[insights-persist.ts](../../apps/api/src/insights-persist.ts) only
prevents inserting a *duplicate* of an already-open insight for the same
`(detector_id, rule_id, entity_key)` within a 24-hour dedup window.
Nothing anywhere re-evaluates or retracts an existing open insight once a
fresh evaluation determines the condition no longer holds.

Verified live: with `no_income_protection` and
`life_insurance_below_household_needs` already open for a tenant, a
completely gap-free profile was submitted — full income protection, full
life cover, no debt, on-track retirement, no dependents. Both insights
remained open, unchanged, same ids, same state, after the submission. The
only way an insight closes today is an explicit user dismiss/approve, or
the dedup window elapsing — after which a still-true condition simply
re-fires the same insight again, never resolves it.

## Market bar

See [000](000-market-landscape-and-positioning.md)'s "continuous, not
one-shot" bar — the entire differentiation claim against Policygenius/
Ladder-style calculators is that Agent Oak's detectors re-evaluate as the
family's real data changes. That claim is only half true today: they
re-evaluate for *new* problems, not for problems that have gone away. A
family that receives "no income protection," buys a policy, and updates
their profile keeps seeing that exact alert as an open, actionable item —
which risks prompting wasted re-shopping for coverage they already have,
and is the kind of visible inaccuracy that costs trust in every other
insight the moment a family checks its own work.

## Who it's for

Every family that acts on an insight and updates their profile to reflect
it — which is the entire intended loop the product is built around. This
is a precondition for PRD-108's crisis playbooks to be trusted: a
playbook that references a stale, already-resolved insight undermines the
exact moment it's supposed to earn confidence.

## What "done" looks like

On each detector evaluation, before persisting newly-fired insights, any
previously-open insight for the same `(detector_id, rule_id, entity_key)`
whose condition the fresh evaluation no longer reproduces is resolved
(marked `state: 'resolved'`, distinct from `dismissed`/`approved` so the
inbox and analytics can tell "the user acted" apart from "the data
changed and the gap went away on its own"). This is additive to the
existing evaluate → persist pipeline, not a redesign.

## Trust tier

**Tier 0 — Observe/Understand/Predict.** A data-lifecycle correctness fix
inside the existing insight pipeline. No new external side effect, no
change to any Act-layer surface.

## Scope

1. Extend `persistAndDeliverInsights()` (or the evaluation step that calls
   it) to compute, for each detector's rule set, which previously-open
   `(detector_id, rule_id, entity_key)` combinations are *not* among the
   rules that fired in the current evaluation, and resolve those.
2. Add the `resolved` state to the insight state machine in
   [insights.ts](../../apps/api/src/routes/insights.ts) alongside the
   existing `identified`/`approved`/`dismissed`/`archived` states.
3. Surface resolved insights distinctly in the inbox (e.g. a "Resolved"
   filter or a quiet inline confirmation — "no income protection: this is
   now covered" — rather than silently vanishing, so the family sees the
   product noticed their progress).

Out of scope: retroactively resolving insights that were already stale
before this PRD ships (a one-time backfill script is a reasonable
follow-up, not part of this PRD's acceptance criteria) and any change to
the existing dedup-window logic for genuinely new insights.

## Success metrics

- **Time-to-resolution** for insights that get retracted vs. the
  household's next profile update — validates the mechanism is actually
  catching real resolutions, not just theoretically correct.
- **Zero occurrences** of an insight remaining open across two consecutive
  evaluations where its condition provably no longer holds — a regression
  test derived directly from this session's exact repro (gap-free profile
  submitted with two open insights) is release-blocking.
- **Resolved-insight engagement** (does the family notice/appreciate the
  "this is now covered" surfacing) — a softer signal, worth a lightweight
  survey or dismiss-rate comparison once shipped.

## Acceptance criteria

- Given two open insights and a subsequent profile submission where
  neither condition still holds, both transition to `resolved` in the
  same evaluation that would otherwise have found nothing new to insert —
  this session's exact repro, now passing.
- A rule that still fires does not get spuriously resolved-then-refired;
  its existing open insight is left untouched (no duplicate, no state
  churn).
- The inbox distinguishes resolved insights from dismissed ones.
- All 24 of the existing live engine scenarios from this session's
  validation pass continue to match expected logic unchanged.
