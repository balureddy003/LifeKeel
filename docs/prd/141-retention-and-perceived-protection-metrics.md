# PRD-141: Retention metrics for a product people don't open

## Problem

MAU is the wrong north star for a background-protection product, and it is the
metric most likely to push the team toward nagging. There is no definition of what
"retained" means for a user who gets value without logging in, so decisions about
notifications, digests and pricing have nothing honest to optimise.

## Who it's for

Product and operator users reading the operator console; no end-user surface except
one optional quarterly question.

## What "done" looks like

1. A defined set of metrics, computed server-side:
   - **Quiet-care retention:** share of paying users still paying at month 3 and
     month 6 who did not log in during that month.
   - **Digest engagement:** open and click rate, split by "all clear" and "has a
     note" months (PRD-138).
   - **Data freshness:** share of detectors that can run on current inputs, per
     family and in aggregate.
   - **Notification health:** unsubscribe, digest-only and uninstall rates against
     the PRD-139 budget.
   - **Perceived protection:** one optional in-app question per quarter ("How
     confident are you that your family's key items are covered?"), stored as an
     aggregate-friendly score.
2. Surfaced in the operator metrics view using the existing daily rollup.
3. Each metric has an owner-written definition in the PRD's acceptance notes so it
   cannot drift.

## Constraints

- **Trust tier:** 0.
- **Regulated-advice check:** the perceived-protection question never asks about
  products or recommends any.
- **Data/privacy:** metadata-first. No message content or document content in
  analytics. Per-family values stay inside the tenant; operator views are
  aggregated, with a minimum cohort size before showing a number.

## Builds on

`apps/api/src/jobs/metrics-rollup.ts`, the operator metrics surface, PRD-138,
PRD-139, `readiness_events` from PRD-136.

## Success metrics

Metrics exist and are trusted: definitions reviewed, a baseline captured for four
weeks before any retention target is set.

## Out of scope

Third-party analytics tools, per-user behavioural profiling, cross-tenant learning
(CLAUDE.md rule 3).

## Becomes

docs/prd/141-retention-and-perceived-protection-metrics.md
