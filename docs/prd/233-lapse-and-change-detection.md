# PRD-233: A stopped payment, noticed — lapse and change detection

Status: **PROPOSED.** From Intent 88. Tier 0; depth, never front door.

## Problem

A protection policy can end because a premium stops — a cancelled direct debit,
an expired card — and the household finds out at claim time. UK Ombudsman
decisions show insurers declining claims where cover had ended for non-payment.
A ~30-day grace period is commonly cited but is **not confirmed** (a broker
guide calls it a protection, not a regulation) — no copy may mention a grace
period until ICOBS/PRIN 2A confirm one.

## Who it's for

A household with policies recorded on file that has told LifeKeel (or had
read from a source) what the premium and payment pattern should look like.

## What "done" looks like

1. **Policy facts keep a history.** Premium amount, renewal date and the
   payment pattern on file are kept with a recorded-at date — extending the
   existing `premium_history` mechanism the `premium_increased` insight
   already uses.
2. **A missing expected payment surfaces.** When an expected renewal or
   premium has no record by its due date, an in-app signal reads: "no payment
   on file since `<date>`; check with your provider that cover is in force."
   It never says the policy has lapsed — LifeKeel cannot know that.
3. **Price creep stays factual.** Last premium vs this premium shown as
   figures and a date — extending `detectors/family/policy-review.yaml`'s
   `premium_increased` insight with the missed-payment sibling case
   (`missed`, `late`, `changed-premium` eval cases in `detector-evals/`).
4. **Dismissable, not naggy.** Signals can be dismissed with "I have checked"
   and are not re-raised for the same period. Dismissal is recorded per
   policy per period.
5. **No outbound message.** The signal appears in the app, in the digest and
   in the household's existing share, within PRD-139 caps. Nothing is sent.
6. **Entered facts get the same signal.** A household that enters renewal
   dates and premiums by hand gets the same detection — no feed required
   (PRD-230 item 9). Feed-sourced payment records, when Stage 3 exists, are
   just another source for the same facts.

## Constraints

- **Trust tier:** 0. Informational only.
- **Regulated-advice check:** never "reinstate your policy", never a provider
  or replacement named; point to the household's own provider ("check with
  your provider"). Passes `advice-rule.test.ts`; new detector copy lives in
  `policy-review.yaml`.
- **Data/privacy:** payment data, if any, is a read-only extracted fact with
  its source; no bank feed required; rule 3 applies.
- **Friction:** depth (PRD-230 item 9) — never a gate on first value.

## Out of scope

Contacting the provider, reinstating cover, payment initiation (a second
regulated activity), any claim-outcome statement, and any grace-period claim.

## Builds on

Intent 88; `detectors/family/policy-review.yaml` (`premium_increased`,
`policy_renewal_date_in_past`); `premium_history` in the financial profile;
the digest/share caps in PRD-139; dismissal storage used by existing insights.

## Success metrics

- **Cheapest first test:** a `detector-evals/family_policy_review.yaml` case
  where a premium due 40+ days ago has no record fires the signal; the same
  case with a recorded payment does not; a >5% change still fires
  `premium_increased` — all three asserted together.
- Share of stale-payment signals dismissed with "I have checked" (event via
  the property-guarded allow-list, counts only).
- Zero copy strings containing a grace-period claim or "reinstate" (asserted
  by `advice-rule.test.ts` on the YAML).
