# PRD-145: Freshness and completeness signals

## Problem

Detectors can only run on current inputs. `policy-renewal-reminders.ts` already
handles renewal dates and `stale-profile-evaluation.ts` re-evaluates stale profiles
(PRD-136 uses a 180-day stale threshold), but there is no single signal for "this
check is paused because an input is missing or old". That makes quiet months
indistinguishable from stalled ones, and gives the Tier C notification (PRD-139) and
the upgrade prompt (PRD-206) nothing principled to key on.

## Who it's for

Every family; consumed by the digest, notifications and upgrade logic rather than
shown as its own screen.

## What "done" looks like

1. Each detector declares the inputs it needs and how old each may be.
2. A deterministic daily job computes, per family, which detectors can run on current
   inputs and which are paused and why. No model call.
3. The result is stored as a small record (detector, state, missing input, since
   when) and exposed to the digest (PRD-138), notifications (PRD-139), the upgrade
   prompt (PRD-206) and metrics (PRD-141).
4. A paused check becomes a Tier C message only after the PRD-139 budget and
   suppression rules, and never repeats for the same input within a quarter.
5. Staleness uses document dates from PRD-143 where available and profile field
   timestamps otherwise.
6. Existing renewal reminders keep working unchanged; the new job reads the same
   dates rather than duplicating them.

## Constraints

- **Trust tier:** 0. It computes state and may produce a notification. It takes no
  action in the world.
- **Regulated-advice check:** messages say "this check is paused because X is out of
  date", never what to do about a product.
- **Data/privacy:** stores detector names and field names only, not values.

## Builds on

`policy-renewal-reminders.ts`, `stale-profile-evaluation.ts`, the detector YAML
inputs in `detectors/family/*.yaml`, PRD-136.

## Success metrics

Share of detectors running on current inputs per family (the data-freshness metric
in PRD-141); time from "paused" to "resolved"; Tier C messages per family per quarter.

## Out of scope

Automatic data fetching to refresh inputs (that is PRD-143 and PRD-144), new detectors.

## Amendments from the October 2026 market review

See [prd-set-market-review-2026-10.md](../reviews/prd-set-market-review-2026-10.md)
for evidence quality. Numeric defaults below are hypotheses to test, not benchmarks.

1. A check paused for a missing input that never repeats within a quarter (as Tier C
   specifies) would otherwise sit "paused" with no further prompt. After the first
   mention, collapse the paused state to a single quiet line in the digest and keep it
   visible in the app.

## Status (first build)

Built: a code-side input registry for all 9 family detectors (`freshness/inputs.ts`; a
test fails if a detector has no entry), a deterministic daily job at 06:45
(`jobs/freshness-check.ts`) writing `freshness_state` (names and states only, `since`
kept across a pause, `resolved_at` and `last_pause_ms` on recovery), `GET /family/freshness`,
a "checks paused" card in Settings, and the Quiet Care digest's single quiet paused
line read from this record. Erased with the account.

Age is the profile's `reviewed_at`, else `updated_at`, because the profile has no
per-field timestamps and PRD-143 document dates do not exist yet. Age limits (180 days
for savings checks, 365 for the rest) are hypotheses.

Not built: the Tier C message from a paused check. It needs PRD-139's budget and
suppression rules, so nothing is sent from this job. `policy-renewal-reminders.ts` is
unchanged.

## Becomes

docs/prd/145-freshness-and-completeness-signals.md
