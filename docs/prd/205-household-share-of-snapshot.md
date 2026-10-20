# PRD-205: Share the readiness snapshot with a partner

> **Retired 2026-10-20.** The public readiness quiz (`/readiness`, `POST /readiness-quiz`, the share card) was removed by decision; signup is the front door ([PRD-209](209-landing-chart-story.md)). This document is kept for history and is not being built.

## Problem

Family finances are shared, and the person at the keyboard often cannot decide for
the household alone. A visitor who wants to "check this together" has no way to do
so except screenshots, and the conversion path stalls on a permission they do not
hold. PRD-110/123 share a family *after* an account exists; nothing helps before.

## Who it's for

A saved-result user (PRD-203) or a signed-in user who wants a second adult to see
their snapshot, on any device.

## What "done" looks like

1. **"Send this to [partner]"** produces a read-only link to the snapshot.
2. The link shows the component breakdown and date, nothing about identity, and
   expires; the owner can revoke it from settings.
3. From the shared view, the second adult can start their own account or, if the
   owner invites them, join via the existing member-invite flow (PRD-123). The
   share link itself never grants access to the family.
4. Opening the link needs no account.

## Constraints

- **Trust tier:** 0. Read-only.
- **Regulated-advice check:** same content as the owner's snapshot.
- **Data/privacy:** the link carries an unguessable token, shows no email, name or
  amounts beyond what the quiz result already displays, is `noindex`, and is
  rate-limited. Revocation is immediate. No sharing of vault or document data.

## Builds on

PRD-203, PRD-110 and PRD-123 (family sharing and member invites), `Referrer-Policy`
header already set in `firebase.json`.

## Success metrics

Share-link creation rate; share → second-adult account rate; revocation rate as a
signal that the feature feels unsafe.

## Out of scope

Child accounts, full-family access, editing from the shared view.

## Amendments from the October 2026 market review

See [prd-set-market-review-2026-10.md](../reviews/prd-set-market-review-2026-10.md)
for evidence quality. Numeric defaults below are hypotheses to test, not benchmarks.

1. **Defaults:** 7-day expiry, a visible "not for me / report this" control, and
   immediate revocation.
2. **No LifeKeel-sent email to the third party.** Use the device share sheet or copy
   link only; sending mail to someone who did not sign up is a consent problem.
3. **Link hygiene:** `Referrer-Policy: no-referrer`, no third-party scripts on the
   shared page, `noindex`, rate limits.
4. **Partner onboarding starts a new snapshot** rather than inheriting the sharer's
   answers.
5. This PRD is a candidate to **defer** (see the review's decisions list); it is the
   least evidenced of the conversion set.

## Becomes

docs/prd/205-household-share-of-snapshot.md
