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

## Amendments from the October 2026 market review

See [prd-set-market-review-2026-10.md](../reviews/prd-set-market-review-2026-10.md)
for evidence quality. Numeric defaults below are hypotheses to test, not benchmarks.

1. **Remove survivorship bias.** Conditioning on "still paying" and "did not log in"
   has no counterfactual. Add a randomised holdout, bounded monthly cohorts, and
   measure "received value" (a click on a digest item, a confirmed field, a resolved
   gap) rather than login.
2. **Baseline of 8 to 12 weeks, or two digest cycles,** not four weeks, which is
   shorter than one monthly cycle.
3. **Click-based engagement,** not opens.
4. **First metric:** scheduled versus delivered digests (PRD-138).
5. **Dependency:** billing is dormant (PRD-006), so paying-user metrics need cutover
   first; until then measure free-tier retention only.

## Status (first build) and metric definitions

The owner-written definitions live in `apps/api/src/metrics/retention.ts`
(`METRIC_DEFINITIONS`) so they are returned with every number and cannot drift; the
operator card prints each under its figure. In short:

- **Digests delivered:** scheduled (attempted) versus delivered (confirmed) over 90 days, from `job_runs`.
- **Data freshness:** mean over families of the share of applicable checks running on current inputs (PRD-145).
- **Digest engagement:** clicks per 100 digests sent, by variant (all clear, has a note, couldn't check). Clicks, not opens; no pixel.
- **Notification health:** heartbeat unsubscribes per 100 digests, plus digest-only and heartbeat-off shares.
- **Received-value retention:** free-tier families created 3 and 6 calendar months ago, still active, that received value in the last 30 days (signed-in digest click, confirmed profile review, resolved gap). Descriptive only.
- **Perceived protection:** current-quarter mean of the optional 1 to 5 answer; skips excluded.

Every figure is aggregated and returns null below a cohort of 10 families (a hypothesis),
shown as "Not enough families yet". Operator view: `GET /operator/retention` and a card on
the Operations page. Instrumentation added: `digest_click` growth event (variant only;
also a tenant-keyed `value_events` row when signed in), `heartbeat_unsubscribed`, a
`variant` on each `heartbeat_sends` row, and the quarterly question endpoint and home card.

Not built: the randomised holdout (it withholds the digest from real families, so it needs
its own decision), paying-user retention (waits for billing cutover, PRD-006), baseline
period tracking (the 8 to 12 week baseline starts when this deploys), and
uninstall rate (no source exists).

## Becomes

docs/prd/141-retention-and-perceived-protection-metrics.md
