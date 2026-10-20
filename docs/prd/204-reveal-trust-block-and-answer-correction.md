# PRD-204: Trust block and "Correct my answers" on the reveal page

## Problem

Two barriers sit between the score and an account: (a) financial-adjacent sites are
assumed to monetise contact details, and LifeKeel's zero-commission position is
stated on the page but not at the moment of doubt; (b) the six quick answers are
rough estimates, so the score can feel provisional, and people do not commit to a
number they think is wrong.

## Who it's for

Visitors on the `/readiness` reveal who are deciding whether to keep the result
(PRD-203).

## What "done" looks like

1. Directly under the email field on the reveal, a short **what we do / don't do**
   block. Every line must be literally true of the product today, for example: no
   commissions or referral fees, no provider named in results, no selling contact
   details. If a line stops being true, the block is wrong and must change.
2. **"Correct my answers"** on the reveal reopens the six fields prefilled, and
   rescoring replaces the shown result without a page reload.
3. The component breakdown (already returned by the quiz) is shown with what was
   and was not measured, so "estimated" is explicit rather than implied.
4. No urgency devices: no countdowns, scarcity or fear-based copy.

## Constraints

- **Trust tier:** 0.
- **Regulated-advice check:** copy describes what is on file and an estimated gap.
  No "you should buy", no named insurer. The block must pass the same review as
  detector copy; add it to the advice-rule test's copy set if it is stored as a
  constant.
- **Data/privacy:** correction happens client-side against the existing anonymous
  endpoint; nothing new is stored.

## Builds on

PRD-125 (component breakdown), PRD-201, `apps/web/src/app/readiness/page.tsx`.

## Success metrics

Edit-after-reveal rate (leading indicator of confidence); email-field completion
rate versus the pre-change baseline; no increase in score-page bounce.

## Out of scope

Third-party trust badges or reviews; any claim not backed by code or contract.

## Amendments from the October 2026 market review

See [prd-set-market-review-2026-10.md](../reviews/prd-set-market-review-2026-10.md)
for evidence quality. Numeric defaults below are hypotheses to test, not benchmarks.

1. **One line above the button:** "what happens to my email", stating exactly what is
   stored and when. Add an "answers used, tap to correct" summary above the ask.
2. **Do not claim "we never train AI on your content" yet.** CLAUDE.md says the
   registry that enforces rule 3 (PRD-142) is not wired, so the claim is not
   technically enforced. Publish it only when PRD-142's tripwire test exists.
3. **Copy under the advice-rule test.** The trust block and the summary copy are added
   to `advice-rule.test.ts`'s copy set.
4. **Guardrails** for this and PRD-203: page bounce rate, email bounce rate, spam
   complaints, unsubscribes, account deletions, and skew in the score-band
   distribution. Stop an experiment if complaints exceed 0.1% (a suggested threshold,
   not a benchmark).

## Becomes

docs/prd/204-reveal-trust-block-and-answer-correction.md

## Status (first build)

Built with PRD-203: trust block under the email field (`lib/result-save-copy.ts`), "Correct
my answers" (reopens the fields prefilled, rescoring replaces the result with no reload),
and an explicit "not measured by this quiz" list. The edit-after-reveal rate is recorded as
the `readiness_quiz_corrected` growth event.
