# PRD-228: The yearly household refresh

Status: **PROPOSED**. Gated on Stage 1 metrics: build only after the second-brief
return and gate-conversion numbers (PRD-222) are readable.

## Problem

The paid household record is only valuable if it stays true, but the product gives a
family no recurring reason to reopen it. A household that finishes one brief returns
only when the next dated event arrives, which is rare, so retention and renewal of
the annual plan depend on luck.

## Who it's for

A household that has made at least one confirmed brief and holds, or is considering,
the paid annual record.

## What "done" looks like

1. **Refresh from a confirmed brief.** "Refresh this brief" creates a new brief of the
   same catalogue entry with last time's entered figures prefilled and editable, a new
   calculation date, and a link to the earlier snapshot.
2. **Immutable history.** A refresh is a new snapshot with new acknowledgements from
   both adults (Intent 78); earlier snapshots remain viewable and are labelled with
   their calculation date. Nothing is overwritten.
3. **Household-entered review date.** A brief may carry a "revisit on" date. When it
   is due, the app shows an in-app prompt on the briefs page and the home view
   ("Your brief from [date] may be out of date"). LifeKeel sends no message; it
   shows the prompt when the household opens the app.
4. **Sensitive facts** are carried into a refresh only after fresh consent and stay
   encrypted at rest (PRD-227 Part A).
5. **Entitlement.** Refreshing is part of the paid household record, using the
   existing entitlement gate from PRD-222 and PRD-223. The free first brief remains
   unaffected.
6. **Instrumentation.** `brief_refresh_started`, `brief_refresh_confirmed` and the
   share of paying households that refresh within 400 days of a brief are recorded
   without content.
7. **Copy.** Prompt and refresh copy are fixed factual text and pass
   `advice-rule.test.ts`: they say a date has arrived and figures may have changed,
   never what to do with money or cover.

## Constraints

- **Trust tier:** 0. No message is sent and nothing is executed; the date is
  entered by the household.
- **Regulated-advice check:** as in item 7.
- **Data/privacy:** `CLAUDE.md` rule 3: no model call on refresh content. Refresh
  history is covered by erasure and account export.

## Out of scope

Email, SMS and push reminders (they need a sending channel and a review of their own),
recomputation from bank or pension feeds, and any model-written summary of what
changed between snapshots.

## Builds on

Intent 78, PRD-222, PRD-223, PRD-227, Intent 81, `apps/api/src/briefs/briefs.ts`.

## Success metrics

Share of paying households that complete a refresh within 400 days of their last
brief (target set before launch, from Stage 1 data); share of due prompts that lead
to a started refresh; refresh-confirmed rate among both adults. If refresh rates are
low, treat that as evidence that the record is not the reason people pay, and
revisit the packaging rather than adding reminders.
