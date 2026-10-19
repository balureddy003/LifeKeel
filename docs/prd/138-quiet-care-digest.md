# PRD-138: Quiet Care digest — proof the system is working, monthly, even when nothing changed

## Problem

LifeKeel's value is background protection. For a product people do not need to open,
silence is ambiguous: it can mean "all clear" or "broken". Users who cannot tell
which will eventually stop paying. PRD-136 specifies a weekly heartbeat and, for a
zero-change week, "a one-line message or nothing, per preference". The heartbeat
job exists (`apps/api/src/jobs/family-heartbeat.ts`, email-only, idempotent per
tenant, member and window). Two things are missing: a **proof-of-work** framing
(what was checked, not only what moved), and a default that always sends a calm
monthly message.

## Who it's for

Every active adult on a family, including Keel Plus subscribers who rarely log in.

## What "done" looks like

Builds on PRD-136; amends its cadence and zero-change behaviour.

1. A **monthly Quiet Care digest**, fixed day of the month and local time, sent even
   when nothing changed. The weekly heartbeat stays opt-in for people who want it.
2. Fixed structure, readable in about 20 seconds:
   1. headline: "All N checks ran. X need nothing. Y have a note."
   2. what we checked: counts and the date range, not a list of every detector
   3. what changed since last month, a diff that may be empty ("No changes" is the
      reassurance)
   4. at most one thing worth a look, absent if there is none
   5. what is on file: a gentle completeness indicator
   6. the date of the next check
3. A user can change cadence (monthly / weekly / off) and see that setting from the
   first digest, and from the post-save screen in PRD-203.
4. Every claim in the digest links to its source (the detector run, score snapshot or
   document) using the evidence links PRD-136 already specifies.
5. The "what we checked" counts come from real run records, not constants. If the
   sweep did not run, the digest says so instead of claiming all clear.

## Constraints

- **Trust tier:** 0. Read model and notification.
- **Regulated-advice check:** the "one thing worth a look" uses detector
  `reasoning_template` copy, which already passes `advice-rule.test.ts`; no new
  recommendation language. New digest chrome copy is added to the same test.
- **Data/privacy:** metadata-first. Digest content is composed from stored events and
  scores; no new model call is needed. Children see the redacted slice.

## Builds on

PRD-136 (feed, `readiness_events`, `heartbeat_sends`), PRD-127 (daily agent sweep),
`apps/api/src/feed/render-heartbeat.ts`.

## Success metrics

Digest open and click-through rate, split by "all clear" months and "has a note"
months; unsubscribe rate against the pre-change baseline; month-3 and month-6
retention of paying users who never log in (PRD-141).

## Out of scope

Push delivery of the digest (PRD-140), per-insight alerts (PRD-139), any new detector.

## Open questions

Whether a month with no completed sweep should send a "we couldn't check" message or
page an operator first. Default: both, operator first.

## Amendments from the October 2026 market review

See [prd-set-market-review-2026-10.md](../reviews/prd-set-market-review-2026-10.md)
for evidence quality. Numeric defaults below are hypotheses to test, not benchmarks.

1. **Fix delivery before adding content.** `sendHeartbeatEmail` must return a delivery
   result; the `heartbeat_sends` row is written only on success; bounces are handled;
   a missed cycle alerts the operator. "Scheduled versus delivered" is the first
   metric. Today a failed or skipped send is recorded as sent.
2. **Fix the monthly window.** The window must be the previous month (today it is the
   current month so far, about eight hours at 08:00 on the 1st), and send time must be
   the family's local time, not the server's.
3. **Strictly informational.** No Keel Plus upsell, no promotion. A promotional element
   would make the digest direct marketing under PECR and change its legal basis.
   Include one-click unsubscribe (`List-Unsubscribe`) and a signed-token opt-out.
4. **Lead with specifics, not counts.** "Last full check 14 Oct; policy renewal 2 Dec"
   reads as proof; a constant "N checks ran" reads as boilerplate. Show a completeness
   line only when a check is actually paused. "Counts from real run records" needs a
   run record that does not exist yet (`sweep_quiet` is feed-only); build it or drop
   the claim.
5. **Failure variant:** a digest that says "we couldn't check this month" (and pages an
   operator), rather than silence.
6. **First 30 days:** add a short welcome digest around day 7, because early silence is
   the most ambiguous.
7. **Cadence is a hypothesis.** Monthly, fortnightly, quarterly and tapered are all
   unproven here; test cadence, specific-fact versus count copy, and always-send versus
   suppress on all-clear months. This supersedes PRD-136's weekly default.
8. **Inclusion:** WCAG 2.2 AA, Slovenian localisation (plural forms, CET/CEST) and a
   pause for bereavement and for the multi-adult privacy split.
9. **Sender authentication:** SPF, DKIM, DMARC; decide whether tracking pixels fit the
   metadata-first policy (prefer click-based measurement).

## Becomes

docs/prd/138-quiet-care-digest.md
