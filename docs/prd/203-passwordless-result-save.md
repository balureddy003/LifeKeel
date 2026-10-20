# PRD-203: Passwordless "hold this result" save — turn the score into something owned

> **Retired 2026-10-20.** The public readiness quiz (`/readiness`, `POST /readiness-quiz`, the share card) was removed by decision; signup is the front door ([PRD-209](209-landing-chart-story.md)). This document is kept for history and is not being built.

## Problem

PRD-201/125 give a cold visitor a real readiness score with no signup. The reveal
page then offers "Start monitoring for free", which sends them to a full signup
(`/welcome`). A score is a verdict, not an asset: there is nothing on the page
the visitor would lose by leaving, and the quiz copy deliberately says "nothing
is saved or linked to you". The password step is the largest single piece of
friction between "interested" and "account".

Hypotheses (to be confirmed by the funnel, see Success metrics): the visitor does
not feel ownership of the score; a password and profile form read as "start
managing my finances"; and contact details feel risky on a financial-adjacent site.

## Who it's for

Anonymous visitors who just completed `/readiness`, on any device (web, PWA,
Capacitor shell).

## What "done" looks like

1. After the score, the reveal offers **"Keep this result"** with one field: email.
   No password, no name, no profile.
2. Submitting sends a single-use magic link. Opening it creates the account (or
   signs in an existing one) and attaches the snapshot as the first entry on the
   user's readiness history.
3. The response to the email form is identical whether or not the address has an
   account, so it cannot be used to discover who is a user.
4. The link works on the device that opens it, not only the one that took the
   quiz (users open email on a phone after taking the quiz on a laptop).
5. Until the user opts in, behaviour is unchanged: nothing is stored server-side.
   The "nothing is saved" copy stays true up to that point and is replaced only on
   the post-save screen.
6. After verification the user lands on a page that shows the saved snapshot with
   its date and **the date of the next check** (see PRD-138).
7. A marketing-email consent box is present, unticked, and stored separately from
   account creation.

## Constraints

- **Trust tier:** 0. Read model plus account creation. No action on the family's behalf.
- **Regulated-advice check:** the snapshot is the existing component breakdown from
  `computeReadiness`: what is on file and an estimated gap. No product or provider
  is named; "speak to a licensed professional" framing is inherited.
- **Data/privacy:** store only the six quiz answers and derived components, tied to
  the new account after verification. Magic-link tokens are single-use, expire
  quickly, and are stored hashed. Rate-limit per IP and per address. The unverified
  email address is not added to any marketing list.
- Works under the strict CSP (`script-src 'self'`): no inline scripts.

## Builds on

PRD-125 (quiz uses `computeReadiness`), PRD-201 (anonymous posture), the existing
email-verification token path in `apps/api/src/routes/auth-users.ts`, and the
`/auth/callback` page.

## Success metrics

Baseline first, targets set after one week of data. Reveal → verified email rate;
email-field abandonment; verified → first return visit within 30 days; share of
saves that happen on a second device.

## Out of scope

Social login on the reveal page; saving partial quiz progress; any payment step.

## Open questions

- Resolved by amendment 2: a short-lived pending record created when the user clicks
  "Keep this result", because resending answers from the client breaks the
  cross-device case.
- Does the Capacitor shell open the magic link in-app? (Needs `allowNavigation` and
  an App Links / universal-link entry; see apps/mobile/README.md.)

## Amendments from the October 2026 market review

See [prd-set-market-review-2026-10.md](../reviews/prd-set-market-review-2026-10.md)
for evidence quality. Numeric defaults below are hypotheses to test, not benchmarks.

1. **Link plus code.** The email carries a link and a 6-digit code. The link's GET
   renders a "Continue" page and never consumes the token; a POST does. Acceptance
   criterion: a GET never consumes the token, so mail scanners that prefetch links
   cannot burn it. The code covers opening mail on a different device.
2. **Pending record, created on consent.** Resolve the open question above: when the
   user clicks "Keep this result", store a short-lived pending record (answers and
   derived components, hashed token, short TTL) so the saved result survives opening
   the link on another device. Nothing is stored before that click, and the copy says
   what happens to the email at that moment.
3. **Enumeration and abuse.** Identical response bodies are not enough: use uniform
   timing, send asynchronously on both paths, cap sends per address and per IP per
   hour, protect against mail-bombing, and keep the score out of the email body.
4. **Link hygiene.** Hard-code the link host, send `Referrer-Policy: no-referrer` on
   the landing page, set link TTL and a resend cooldown, and make expiry recoverable
   without losing the answers.
5. **Existing accounts.** Append the snapshot to an existing account's history; never
   overwrite.
6. **Operations.** SPF, DKIM and DMARC are in place before launch. Marketing consent
   text is versioned and the consent record stores which version was shown. A saved
   snapshot can be deleted in one step.
7. **Analytics.** Funnel events must not create a profile before consent. Test that
   "nothing is saved" is true of analytics, logs and CDN as well as the database.
8. **Something worth losing.** After the save, show a "what changed" view and offer a
   PDF export, so the account holds more than a single number.
9. **Measurement.** Do not plan a one-week baseline at small volume. Test one change
   at a time at the top of the funnel (ask copy, trust-block placement, link plus code
   against link only), and watch the guardrails in PRD-204.

## Becomes

docs/prd/203-passwordless-result-save.md
