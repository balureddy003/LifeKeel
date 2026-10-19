# PRD-148: Detector roadmap — breadth is the product

## Problem

The product's claim is that nine background detectors watch a family's readiness.
Eleven of the fourteen PRDs proposed in October 2026 (138-147, 203-206) are plumbing
around those nine: delivery, metrics, extraction, deletion, trust. The repo's own
flywheel review named detector breadth as the top lever, and nothing in the
portfolio extends it. A family that gets a perfect digest about the same nine checks
for a year has no new reason to stay.

Current detectors (`detectors/family/*.yaml`): debt health, education pacing,
education shortfall, emergency-fund adequacy, emergency trajectory, estate
readiness, policy review, protection gap, retirement gap.

## Who it's for

Every family; the roadmap itself is for product and engineering.

## What "done" looks like

1. **Admission criteria** every new detector must meet before it is built:
   1. derivable from data inside the trust boundary: typed by the family, or
      confirmed from a document (PRD-143). Never from a transaction feed, per PRD-111;
   2. explainable in one sentence naming the field it read;
   3. its output describes what is on file and estimates a possible gap; its copy passes
      `advice-rule.test.ts` and names no provider (CLAUDE.md rule 2);
   4. jurisdiction-tagged (PRD-149), so it never fires on rules from another country;
   5. has a golden dataset under `detector-evals/`;
   6. has a stated way to tell it worked: a gap that closes, or a dismissal that was
      correct.
2. **A ranked candidate list**, scored on how often the situation occurs, how costly it
   is when missed, whether the data is already collected, and the advice-rule risk of
   the copy. The ranking is made from evidence, not intuition: see item 3.
3. **Evidence before ranking:** use the distribution of gaps found in the anonymous
   readiness check (PRD-201/125) and in the first cohort of saved results (PRD-203) to
   see which situations real users have, and the dismissal rate of existing insights
   to see which detectors are noise.
4. **Event-driven detectors** triggered by a life event (PRD-108/111) alongside the
   daily sweep, because a new child, house purchase or job change is when a check is
   most valuable.
5. Each detector ships through the existing recipe (the `add-detector` skill): profile
   schema, detector YAML, evals, web form, and its explanation page (PRD-202).
6. **Published outcome evidence:** a count of gaps surfaced and closed, aggregated and
   with a minimum cohort size, for the trust page (PRD-208).

## Candidate detectors (hypotheses, unranked)

Each is derivable from data the product holds or can confirm. None is a commitment.

- **Cover term versus mortgage term:** life cover ends before the mortgage does.
- **Fixed-rate or policy end date approaching:** a date from a confirmed document, with
  informational copy only ("a fixed term on file ends on this date").
- **Guardian not named for a minor** (overlaps PRD-137's estate register).
- **Beneficiary on a policy does not match the will on file** (needs PRD-143).
- **Pension nomination or beneficiary record not on file.**
- **Document staleness after a life event:** a will older than a recorded change in
  circumstances (builds on PRD-145).
- **Emergency contacts and digital-access completeness.**
- **Dependants' timeline gaps** beyond the two education detectors.

Needs a rule-2 review before it is even drafted: anything about unused tax-advantaged
allowances, which can drift into steering.

## Constraints

- **Trust tier:** 0. Detectors observe and estimate; no action.
- **Regulated-advice check:** the highest-risk area of the portfolio. Every detector's
  `reasoning_template` and `actions` are checked by the existing test and by a human
  reviewer; counsel signs off the framing of the first few (see the review).
- **Data/privacy:** only fields already collected or confirmed; a detector that needs a
  new field adds it to the profile schema with a stated reason.

## Builds on

The nine existing detectors and `detector-evals/`, the `add-detector` skill,
PRD-108/111 (life events), PRD-137 (legacy register), PRD-143 (confirmed document
fields), PRD-145 (freshness), PRD-149 (jurisdiction tags), PRD-202 (content engine).

## Success metrics

Gaps surfaced per family; share of gaps closed within 90 days; share of insights
dismissed as wrong (a quality signal); share of families with at least one detector
that could not run for lack of data (PRD-145). Targets set after a baseline.

## Out of scope

Transaction-based detection, product comparison, any detector whose output reads as a
recommendation, and any autonomous action triggered by a detector.

## Open questions

Which three candidates first? Answer from the evidence in item 3, then with counsel on
the copy of the first one.

## Becomes

docs/prd/148-detector-roadmap.md
