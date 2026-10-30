# PRD-234: Nominations that no longer match the family — the beneficiary check

Status: **PROPOSED.** From Intent 87. Tier 0; depth, never front door.

## Problem

Pension and death-in-service nominations often go stale after family changes.
Dated UK surveys (directional, not current facts) suggest a large share of
workers never completed an expression of wish and many forms are out of date.
A household that records who is nominated — and when — can see, factually,
where its own records no longer match its own family.

## Advice-line pass (recorded 2026-10-30)

This slice is judged **informational, not advice**, for these reasons:

- Every flag states a difference between two records the household itself
  entered ("the record says X; the roster says Y; the record is dated Z").
  Nothing infers what a nomination *should* say.
- Copy never says who should be named, never "change it to X", never
  estimates payout, tax, or inheritance consequences — all of which would
  cross into advice.
- The one allowed pointer is to the provider's own form or page **where one is
  already on file**; LifeKeel does not supply forms or suggest completing one.
- The scheme-decides statement is fixed: "trustees or the scheme decide —
  check the scheme's rules". LifeKeel states no scheme terms it has not read.
- Residual risk is the **ex-partner flag**: naming an ex is sensitive, not
  advice, but it is personal — mitigated by scoping that flag to the
  nominating adult only (no cross-adult disclosure, Intent 82).
- All strings join `advice-rule.test.ts`; detector evals cover the
  ex-partner, new-child and no-nomination cases.

## What "done" looks like

1. **Nominations on file, household-entered.** Per pension/policy:
   `{ nominated_label, nomination_date?, roster_link?, is_ex_partner?,
   provider_form_url? }`. Entered, or lifted from a document the household
   confirms — extraction stays `candidate_for_review`.
2. **Factual-differs flags.** A flag appears when:
   - the nominated person is recorded as an ex-partner;
   - a child joined the family after the nomination date;
   - no nomination is on file for a pension or death-in-service entry.
   The flag states what differs and the record's date. Nothing else.
3. **Fixed copy.** Each flag ends "trustees or the scheme decide — check the
   scheme's rules" and links the provider's own form/page **only if on file**.
4. **Clears on new information.** A flag disappears when a newer nomination
   date is recorded, and is never re-raised without new information.
5. **Scoped visibility.** An ex-partner flag is visible only to the
   nominating adult; children's data follows the children's-data posture;
   nothing crosses adults without confirmation (Intent 82).

## Constraints

- **Trust tier:** 0. Flag and link only — LifeKeel never completes, submits
  or changes a nomination.
- **Regulated-advice check:** medium risk; pass recorded above.
- **Data/privacy:** nominations are sensitive-adjacent; free-text names get
  the secret-shaped guard; no "last seen" data.

## Out of scope

Wills, trusts, inheritance tax, pension transfers, choosing beneficiaries,
any statement about how a scheme will pay out.

## Builds on

Intent 87; `beneficiary_member_id` and `policy_attributed_to_removed_member`
in `policy-review.yaml`; the roster's `relationship_label`/`added` metadata;
Intent 82 scope rules.

## Success metrics

- **Cheapest first test:** detector-eval cases — ex-partner, new-child-after-
  nomination, and no-nomination — each fires its flag; a current nomination
  stays silent.
- Share of pension/death-in-service records carrying a nomination within 30
  days of the feature (counts only).
- Zero flags re-raised after a newer nomination date (asserted by test).
