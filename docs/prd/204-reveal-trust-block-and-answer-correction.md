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

## Becomes

docs/prd/204-reveal-trust-block-and-answer-correction.md
