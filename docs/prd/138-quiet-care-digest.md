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

## Becomes

docs/prd/138-quiet-care-digest.md
