# PRD-227: Brief catalogue expansion and engine hardening

Status: **PROPOSED**. Part A (hardening) is a defect fix and should land first.
Part B (new events, past dates, multi-step) is buildable but should be sized
against Stage 1 completion data before more entries are added.

## Problem

The shipped catalogue (`apps/api/src/briefs/catalogue.ts`, Intent 78) has 33
entries. A review found two kinds of gap.

**Safety gaps (Intent 79).** Sensitive handover facts (health and care details) are
stored as plain free text on `household_briefs`, although the tenant envelope module
(`apps/api/src/crypto/envelope.ts`) exists. Free-text handover fields can also hold
passwords or recovery codes, which the field labels ask people not to enter.

**Coverage and engine gaps (Intent 80).**
- Missing common events: renters, a lump sum arriving, planned big spend, care fees
  starting, illness with reduced hours, bereavement, a bill in one name.
- `solveCatalogueBrief` throws when `change_date < asOf`, so events already under
  way cannot be briefed.
- It supports one change plus one later change, so parental pay stages (full pay,
  a reduced period, a lower flat rate) cannot be stated, nor can a mortgage brief
  with "and if one income then stops".

## Who it's for

A couple already in a change (hours cut last week, fees already started), a renting
household, a family facing a parent's care fees, a couple weighing a large spend, and
every family that stores health or care details in a handover brief.

## What "done" looks like

### Part A: sensitive facts (Intent 79)

1. For entries with `sensitive: true`, `facts` is stored encrypted with the tenant
   key and decrypted only for the creator and the designated adult after the
   existing participant checks. The result hash and `template_sentence` stay
   computable without exposing the plaintext to other readers.
2. A test reads `household_briefs` directly and asserts no plaintext sensitive
   value is present; a second test asserts a non-participant read returns nothing.
3. Sensitive text never reaches logs, `system_events`, queue payloads or telemetry.
4. A deterministic credential-shape check rejects values that look like passwords
   or recovery codes in free-text handover fields, with a plain message, and field
   hints state what to record instead. No model is involved.
5. `scripts/ops/` includes an idempotent migration that re-writes existing
   sensitive briefs encrypted. Erasure and account export still include them.
   The script logs runs without plaintext and has a tested rollback.
6. A DPIA is completed before production, covering the lawful basis and the
   special-category condition and the third parties named in a brief. A retention
   period applies to handover facts (deletion on request by the creator or designated
   adult, expiry per the DPIA), and a content-free access log shows who viewed a
   sensitive brief and when.
7. The credential-shape check is a guard rail: it can miss passphrases and flag
   ordinary numbers, so copy and docs never claim secrets are blocked.

### Part B: coverage and engine (Intent 80)

8. **New entries**, each with a trigger label and fields in the catalogue:
   - `rent_change`: rent rise, tenancy ending or moving to rent; optional deposit as
     a one-off payment (`cost` mode with cash).
   - `windfall`: lump sum arriving (`cash_in`), with an optional later spend.
   - `planned_spend`: wedding, extension, car, gap year or holiday; one-off or
     recurring cost; shows runway before and after the household's own figures.
   - `care_fees_start`: a parent's care fees starting (`cost` mode), entered cost only.
   - `illness_reduced_hours`: partial income drop with an entered sick-pay end date
     (extends `hours_cut`; retitle it to cover illness and recovery).
   - `bereavement`: handover-style (accounts and policies on file, contacts, key
     paper locations); information only; marked sensitive.
   - `bill_in_one_name`: handover-style (which bill or account, who pays, how it is
     paid).
9. **Past change dates.** `change_date` may be earlier than today for events under
   way. The runway is always computed from the calculation date, the entered date is
   shown as entered, and the rule that financial dates must be today or later is
   removed for these modes only where the event can already have started.
10. **Multi-step input.** The input accepts an ordered list of up to eight dated
   steps (each with income, spending or one-off change). The result reports months
   after each step and the first step at which savings reach zero. The existing
   `return_date` fields remain accepted as a two-step shorthand.
11. **Copy and advice rule.** Every new fixed template and field label passes
   `advice-rule.test.ts` (extend the scanned places to the catalogue). `planned_spend`
   and `windfall` never say whether to spend or what to do with money; `care_fees_start`
   states nothing about funding, eligibility or providers.
12. **Web form** shows one step row per step with add/remove, shows past dates as
    allowed, and keeps one evening as the target: the default form for any entry has
    no more than the fields it needs.
13. **Quick brief.** Every entry offers a version that asks for three numbers and a
    date, shows the first result, and then offers the optional fields. Drop-off per
    field is measured, not only completion.
14. **What this does not cover.** Every money brief states what it does not cover (tax,
    benefits, investment returns, fee increases) and points to free guidance (for
    example MoneyHelper) and "a licensed professional". No brief says a household
    "can afford" something. The advice-rule scan covers catalogue titles, field
    labels and the generated sentence, with a test.
15. **Held entries.** `planned_spend` and `care_fees_start` do not ship until a
    compliance reviewer has approved their wording; the other new entries may ship
    first.
16. **Front doors by moment.** The catalogue is grouped by moment ("a baby is coming",
    "a job is changing", "a parent needs care", "a fix is ending"). The landing shows
    four; the rest are reachable by search. The door each family used is recorded.

## Constraints

- **Trust tier:** 0. Calculation, manual records, and a creator-initiated share link.
- **Regulated-advice check:** applies as in items 11 and 14; no rates, no benefit or
  entitlement inference, no product or provider named.
- **Data/privacy:** `CLAUDE.md` rule 3: no model call on sensitive or handover
  content; optional narration stays limited to non-handover money briefs. Sensitive
  facts are encrypted at rest (Part A).

## Out of scope

Separation and child-maintenance briefs (parked pending a safeguarding review),
statutory-pay or benefit estimation, bank and pension feeds, email or push
reminders, client-side end-to-end encryption, and any new paid plan.

## Builds on

Intent 78, PRD-222, PRD-223, `apps/api/src/scenarios/calculate.ts` (`ScenarioStep`),
`apps/api/src/crypto/envelope.ts`, `apps/api/src/erasure.ts`, Intents 79 and 80.

## Success metrics

Part A: zero plaintext sensitive values in storage, logs or telemetry (tests and a
production sample query). Part B: share of started briefs completed per new entry;
share of briefs created with a past date or more than two steps; zero advice-rule
failures. Entries with poor completion (below the Stage 1 floor) are removed rather
than kept, so the catalogue does not grow without evidence.
