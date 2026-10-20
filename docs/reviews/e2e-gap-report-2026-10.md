# End-to-end functional gap report, 2026-10-20

Method: real local stack (API on a throwaway database, Redis, Mongo, `next dev`) on `main` at 19d3eed.
A fresh account was created through the UI and taken through signup, the family-setup chat, the five-step
financial profile, the insights, document upload, and then 32 routes at 390px and 1280px, with
automated checks per page (console and HTTP errors, h1, horizontal scroll, accessible names, labels,
junk text) plus manual probes of the main actions. Screenshots live in the session scratchpad, not in the repo.

Test data was arbitrary, so numbers below are flagged as inconsistencies between screens, not as wrong maths.

## What works end to end

- Signup (email), family-setup chat (now skips name and email), financial profile (5 steps), first insights
  with plain-language reasoning, assistant answer from the profile, What-If scenario, document upload, vault
  upload, data export (downloads JSON), logout and login, bad-login error, reset-password and verify-email
  pages, invite-code join page, Stripe checkout opens for Keel Plus.
- No horizontal scroll on any route at phone or desktop width. No `undefined` / `NaN` / raw rule ids in visible text.
- No API errors in the server log during the run.

## P1: wrong or misleading

1. **Connect page contradicts the email connector.** `/connect` says "We never store your passwords". The email
   connector stores the mailbox password (encrypted) and says so on `/connect/email` ("Your password is
   encrypted at rest and used only to read your inbox"). One of the two is wrong for IMAP users.
   Fix: change `/connect` to what is true; add a claims-registry entry for connector credentials.
2. **Family page chips may not say whether an item is on file.** The text of each chip ("Education fund", "Covered by policies")
   is the same whether or not the item exists; if the on/off state is colour only, it is invisible to screen readers
   and easy to misread (`app/family/page.tsx` `chipsFor`). Needs a visible or accessible on/off cue. Not confirmed visually.
3. **Runway numbers disagree across screens.** On `/events/job-loss` the header says readiness 98% and
   "savings would cover about 56.2 months", while "AI Explains" on the same page says £2,000 covers about
   8 months at £225 a month. `/cashflow` after adding £1,200 rent says 1.7 months. The assistant says life cover
   is £0 and a gap while the scenario says "financially stable". Needs one runway source.
4. **Broken link: Finances > Documents** goes to `/documents`, which has no index page (404).
   Same for bare `/insights`, `/health`, `/invite`: reachable by trimming a URL, all 404.
5. **Stripe checkout says "Trellis Plus"**, not Keel Plus, and the merchant name is a sandbox placeholder.
   Stale product name from before the rebrand.
6. **Partner and child show "Pending" with Remove** in Settings and Family although no invite was ever sent.
   A child cannot accept an invite. The state should read "Not invited" with an Invite action, or "Added".
7. **Cash flow ignores the profile.** Salary entered in the financial profile does not appear as "In" on
   `/cashflow` (In £0). Two places for the same fact, no link between them.

## P2: accessibility and polish

8. Every signed-in route has the same `<title>` ("LifeKeel — your family's cover"). Only legacy, readiness, support
   and the public pages set their own.
9. Two toggle switches in Settings have no accessible name (buttons with no text or `aria-label`).
10. Placeholder-only inputs (no label or `aria-label`): Cash flow (name, amount), Legacy (name, relationship),
    Support question, Assistant input, Settings household-context textarea, a date input on Home.
11. `/family-setup` has no `<h1>`.
12. The 404 page for a signed-in user renders inside the app shell with the public layout: a "Sign in" link
    is shown to someone already signed in, and the card is narrower than the viewport on phones.
13. Referral link is shown as a relative path (`/signup?ref=...`); confirm what Copy puts on the clipboard
    and make it a full URL.
14. Upgrade page: "Priority support" is listed with no evidence in the claims registry; the example policy names
    a real insurer ("Allstate"); keep examples provider-neutral per the advice rule.

## P3: performance and noise

15. Simple reads are slow against a local database: `/auth/me` about 1.1s average (102 calls), `/family/readiness`
    up to 2.4s, `/family/assets`, `/family/legacy/*`, `/family/notifications` 0.7 to 1.9s each; assistant 5.1s.
    The home page fires about a dozen of these on load. Worth profiling the auth middleware and per-request DEK/tenant lookups.
16. Anonymous visits log a 401 on `/auth/me` in the browser console on every page. Expected, but noisy; a
    session-hint cookie would avoid the request.

## Not covered (needs real credentials, devices or longer set-up)

Real policy extraction (only a blank image was used), email IMAP connect with a real mailbox, Open Banking,
push notifications, MFA enrolment, account deletion, the child, adult and elderly experience modes, the `.si` region,
Stripe webhooks and plan changes, offline and PWA install, the operator console, and real-device checks (SOS
button next to Ask Keel, sticky header over scroll). Reminders and renewals were not reachable without a policy
with a renewal date.

## Suggested order

Fix 1 to 4 first (copy that says something untrue or a dead link), then 5 to 7, then the accessibility batch
(8 to 11) as one PR with a test that fails on a missing `<title>` or unnamed control. Profile item 15 before any
load testing.
