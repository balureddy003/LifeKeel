# PRD-002 (backfill): Financial domain — profile, detectors, readiness score

*Retroactive PRD. See [001](001-family-onboarding-twin-graph.md) for the
template note.*

## Problem it solves

Families don't know, in specific numbers, where they're exposed —
"3-6 months of savings" is generic advice; "your emergency savings of
£1,000.00 cover approximately 0.33 months of expenses" is a fact about
*this* household. ARCHITECTURE.md calls this "genuine Understand/Predict,"
and it's the only domain where the vision is fully real today.

## Market bar

See [000](000-market-landscape-and-positioning.md). Policygenius/Ladder
compute a number once, on demand. Agent Oak's version already beats that
bar structurally — it re-evaluates whenever the profile is resubmitted —
but doesn't yet re-evaluate on a schedule or in response to new data
(a document upload, a connected account), which is the next increment
toward "continuous."

## Who it's for

Every family who completes the 4-step financial-profile form — the
product's core value-delivery moment.

## What's shipped

A 4-step form (Household & Protection → Emergency Fund → Retirement →
Education Funds,
[family-financial-profile.ts](../../apps/api/src/routes/family-financial-profile.ts))
that on final submit runs `engine.evaluate()` against 4 real YAML
detectors in `detectors/family/`: protection-gap (2 rules: life cover
below household need, no income protection), emergency-fund-adequacy,
retirement-gap, education-shortfall. Verified live this session: every
rule's arithmetic is correct against real submitted numbers (e.g. "£0.00
appears below the estimated household need of £449500.00 — mortgage +
education gap + 5 years of living expenses"), autosave-per-step persists
progress without prematurely firing detectors on incomplete data, and a
confidence-weighted domain health score
(`100 - Σ(open insight confidence) × 10`, in
[useFamilyData.ts](../../apps/web/src/lib/useFamilyData.ts)) distinguishes
"no data yet" (sample/labeled score) from "data submitted, genuinely
clean" (real 100) — a real, non-trivial correctness detail the code's own
comments document as a fixed bug (previously every domain scored a
misleading 0% the moment any insight existed).

## Trust tier

**Tier 0 — Observe/Understand/Predict.** Every detector's `reasoning_template`
ends in "this is an informational estimate — consult a qualified
professional," consistently, across all 6 rules.

## Gaps to reach world-class

- **One-shot, not continuous.** Detectors only re-run on explicit form
  resubmission. A document upload (a new mortgage statement, a payslip)
  or PRD-102's policy data doesn't trigger re-evaluation. Real-world life
  changes (a raise, a new child) currently require the family to remember
  to come back and re-fill the form.
- **Retirement-gap math has an honest edge case already documented in
  code** ([family-financial-profile.ts](../../apps/api/src/routes/family-financial-profile.ts)'s
  `projectRetirement` comment): for a near-retiree with a large gap,
  "additional monthly contribution needed" can come out absurd. The route
  already gates on this and offers two realistic alternatives
  (`projected_retirement_age`, `achievable_retirement_income_minor`) — this
  is good defensive product thinking already in place, worth calling out
  so it isn't accidentally regressed.
- **No trend, only snapshot.** The UI shows current state, not "your
  emergency fund coverage improved from 0.2 to 0.4 months since last
  quarter" — a natural next increment once detectors run continuously
  (see above), and a strong retention hook (watching a number improve).
- **Detector coverage is genuinely thin vs. ARCHITECTURE.md's ambition.**
  4 detectors, 6 rules total, one domain. PRD-102 (Protection) is the
  next domain; the roadmap explicitly sequences depth-in-financial before
  width-across-domains, which this backfill confirms was the right call —
  even this one domain has real gaps (continuous evaluation, trend) before
  going wide makes sense.

## Success metrics

- **Detector fire rate and resolution rate** (approved/dismissed vs. left
  open) per rule — a rule nobody ever acts on is either miscalibrated or
  not useful; track per-rule, not just in aggregate.
- **Form completion → insight-generation rate** — how many households that
  start the 4-step form actually reach "Save & Generate Insights" vs.
  abandoning mid-form (the autosave-per-step design exists specifically to
  reduce this drop-off; verify it's working).
- **Re-submission rate** (as a proxy for the "one-shot" gap above) — if
  households never come back to update the profile, the one-shot
  limitation matters more than it would in a low-re-submission product.
