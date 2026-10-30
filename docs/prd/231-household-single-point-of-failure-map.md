# PRD-231: What stops if one adult is out — the household single-point-of-failure map

Status: **PROPOSED.** From Intent 85. Tier 0, user-entered first; no connection,
feed or model call required for any of it.

## Problem

Households know what they own but not who holds each thread: whose name a policy
is in, whose card pays, whose phone receives the codes and renewal notices. The
useful question is "if one adult is out for six weeks, what stops, and when?" —
and nothing in the product answers it today. Handover briefs record free-text
facts (who to call, key papers) but nothing structured about recurring
obligations, who they depend on, or when they next come due.

## Who it's for

A two-adult household that wants a plain list of what would stop if one of them
were unavailable — and a trusted person (Intent 82 scope) who may one day need
the printable version of it.

## What "done" looks like

1. **Obligation rows, household-entered.** A `household_obligations`
   tenant-scoped collection holds one row per recurring obligation or account
   the household has told LifeKeel about:
   `{ id, tenant_id, label, category, named_person, pays_from, notices_to,
   next_due_date, recurrence, if_unavailable, source, created_by, created_at,
   updated_at }`. Every field is entered by the household; nothing is inferred.
   `pays_from`, `notices_to` and `named_person` are free labels ("Sam's card",
   "Alex's phone"), never linked identities or credentials.
2. **Creator's estimate, honestly labelled.** A row naming the *other* adult is
   marked `entered_by_creator` until that adult confirms it (same rule as
   Intent 82/PRD-229: another adult's facts are never shown as confirmed by
   that adult). Confirming is one tap by the named adult; no notification is
   sent.
3. **One summary line.** `GET /family/obligations/map` returns the rows plus
   `{ dependent_count, earliest_due_date, earliest_due_label }` — the number of
   obligations that depend on one named person, and the earliest date one comes
   due. **Counts and dates only: no scoring of a person, no "risk level", no
   per-person totals.**
4. **Reuse of what already exists.** Rows can be seeded — as editable drafts,
   never silent imports — from handover brief facts and the sources
   `emergency-sheet.ts` already reads (policy names on file, key papers). A
   seed row is shown as a suggestion until the household saves it. The map
   adds nothing that needs a connection, an inbox, or an upload to produce its
   first view (PRD-230 item 9).
5. **Web surface.** A map view listing the rows grouped by the person they
   depend on, each row showing the due date as a date ("next payment due 14
   Dec") and the entered "if unavailable" note; the summary line on top; edit
   and add in place. A printable view for a trusted person is included within
   Intent 82's scope rules (creator-chosen recipient, no account, fixed
   factual layout).
6. **Copy is fixed and factual.** The surface shows who is named and what is
   due. Never "add a second payer", never a product or provider suggestion.
   All strings join the `advice-rule.test.ts` copy set.

## Constraints

- **Trust tier:** 0. Informational only; nothing is sent, scheduled or acted
  on. No reminders by LifeKeel — a due date on a row is a fact, not a trigger.
- **Regulated-advice check:** factual display of entered data; passes
  `advice-rule.test.ts`.
- **Data/privacy:** handover-derived facts follow Intent 79 (sensitive facts
  encrypted; no password-shaped input — the existing `rejectSecrets` guard
  applies to free-text fields; nothing sensitive in logs or telemetry).
  **The map must not become a way for one adult to monitor another:** no
  "last active" or "last seen" data, no activity of a named person, no
  per-person aggregation beyond the one-line count. Sharing beyond the
  household's own adults needs the Intent 82 safeguarding review before it
  ships — the printable view is the only out-of-household surface and stays
  inside that review's scope.
- **Friction:** user-entered first. The first value path is untouched: a new
  household can still get a brief's first number with zero rows on the map.

## Out of scope

Joint-account visibility, bank or card feeds, changing who pays, reminders
sent by LifeKeel, inference about a person's behaviour or availability, and
any scoring of a person.

## Builds on

Intent 85; Intent 79 (sensitive-fact handling); Intent 82 (recipient scope,
no-surveillance); PRD-229 (creator's-estimate labelling); PRD-230 item 9
(depth never gates the front door); `apps/api/src/routes/emergency-sheet.ts`;
handover facts on `household_briefs`.

## Success metrics

- **Cheapest first test:** a seeded household enters three obligations and the
  summary line returns the right count and earliest date — assertable in an
  API test with no browser.
- Share of two-adult households with a brief who create at least one
  obligation row within 30 days (tracked via the existing `growth_events`
  allow-list; event names carry no content).
- Share of rows naming the other adult that get confirmed by that adult.
- Zero telemetry payloads containing row content (property guard pattern
  from PRD-230 applies to any new events).
- The `first-value` catalogue test still passes unchanged (no new gate on the
  front door).
