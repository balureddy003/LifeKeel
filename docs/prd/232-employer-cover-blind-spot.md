# PRD-232: Employer cover the household does not know it has

Status: **PROPOSED.** From Intent 84. Tier 0; depth, never front door.

## Problem

Death-in-service, group income protection and health cover often sit only in
work email or an HR portal. People do not know what they have, so a job change
can end cover nobody was counting. UK survey evidence is dated and directional
(roughly 15% of workers unaware of employer-provided products; ~42% unclear on
workplace income-protection benefits — older surveys, not current facts), but
the mechanism is structural: group cover generally ends with the employment.

## Who it's for

A household where one or both adults may have employer-provided cover they have
not recorded — and who is about to change jobs.

## What "done" looks like

1. **Employer-cover facts on file, household-entered first.** A per-member set
   of cover facts stored on the family record: `{ type, name_as_printed,
   source, last_seen_at, ends_with_employment, confirmed }`. Each fact is
   entered by the household (or, later, lifted from a document they choose to
   share), links to its source, and can be corrected or removed. Extraction is
   `candidate_for_review` only: nothing extracted affects a brief until the
   household confirms it.
2. **Feeds the existing job-change brief.** When the `job_change` brief (or any
   `stop`/`mixed` entry) is built, the employer-cover facts pre-fill its
   `recorded_cover` field — the household reviews them in the form, they are
   not silently injected. Where the facts say cover ends with the employment,
   the brief sentence states "cover on file may end with the employment" and
   the end date the household entered. It never states what the household
   should do or buy.
3. **Continuation options stay the document's.** If a source mentions a
   continuation option, the surface says "your documents mention a continuation
   option; the terms and any deadline are in the policy documents". LifeKeel
   states no terms it has not read and no deadline it cannot see.
4. **Work mail is opt-in or forwarded only.** Any mailbox route is a confirmed
   opt-in or a household-managed forwarding address (open decision 4 in the
   channels review); nothing connects to work mail in this slice. This slice is
   entered facts only.
5. **Front door unchanged.** The job-change brief still produces its first
   number from the minimum fields with no cover facts and no connection —
   `first-value.test.ts` keeps passing.

## Constraints

- **Trust tier:** 0. Read-only facts and a pre-fill; nothing is sent or acted
  on.
- **Regulated-advice check:** copy describes cover on file and when it may end;
  never "replace it", never an insurer or product named as a suggestion, no
  "continue your cover". New strings join `advice-rule.test.ts`'s copy set.
- **Data/privacy:** only the extracted/entered facts are stored, never whole
  emails; rule 3 applies — no hosted extraction (`document.extract_fields` is
  blocked until an approved processor exists), so this slice uses entered facts
  only; work mail may breach an employer's IT policy, so any future mailbox
  route is opt-in or forwarding.
- **Friction:** depth (PRD-230 item 9) — improves the same brief's answer,
  never a prerequisite.

## Out of scope

Contacting the employer or insurer, completing or changing a nomination,
comparing cover, any statement about continuation terms not in a read source,
health-insurance claims, and any mailbox scanning (a separate slice once an
approved local path exists).

## Builds on

Intent 84; the `job_change`/`stop`/`mixed` catalogue entries and their
`recorded_cover` + `cover_end_date` inputs (`apps/api/src/briefs/catalogue.ts`);
`candidate_for_review` extraction pattern (PRD-143); PRD-230 item 9.

## Success metrics

- **Cheapest first test:** a household enters one employer-cover fact, opens
  the job-change brief, and the fact appears pre-filled in `recorded_cover` —
  assertable in a web form test and an API test.
- Share of job-change briefs that carry employer-cover facts when facts exist.
- Share of extracted candidates confirmed vs. corrected/removed (when
  extraction ships).
- Zero model calls and zero mailbox reads on this path (asserted by test).
