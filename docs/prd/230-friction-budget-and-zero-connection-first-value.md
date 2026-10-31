# PRD-230: A friction budget, and first value that needs no connection

Status: **PROPOSED.** Targets below are starting points to baseline against real use
before they gate anything; they are the product owner's to set.

## Problem

The product direction is a frictionless, high-value platform. Today the roadmap's gates
(sign-ups, "finish setup", feature counts) do not measure either word. The household
brief already gives a useful number in under a minute from three figures, but the
channels meant to bring households in start from connecting an inbox or finishing a
profile. A partner who has to join before seeing anything is a second drop-off point.
Without a measured budget, new features can add steps without anyone noticing.

## Who it's for

A household member who wants one answer now; the second adult who is sent that answer;
an adviser or employer contact who wants to hand a client or colleague something useful
without asking them to set up an account first.

## What "done" looks like

1. **Friction is measured on the first-value path.** Events record, per household and
   without any figures: landing → first useful number time, fields entered before it,
   screens before it, and whether an account, connection or upload was required. The
   allow-list in `apps/api/src/routes/growth-events.ts` gains the new event names.
2. **Proposed targets, to be baselined first:**
   - median time to the first useful number: **60 seconds or less** from opening the brief form;
   - fields before that number: **3 money fields and 1 date**;
   - connections, uploads or accounts needed for it: **none**;
   - share of households whose second adult confirms within 7 days: **tracked from day
     one; target set after the first cohort**.
3. **Partial answers are the rule.** Every money brief shows a number once the minimum
   is in, says what is assumed, and names the one thing to add for the real answer. A
   new brief type does not ship without this.
4. **Brief link as front door.** A brief link opens a real result after one sign-in as
   the adult it was shared with (decided 2026-10-31: the privacy rule in Intent 82 and
   PRD-229 outranks a no-sign-up promise, because the result holds a household's
   income and savings). The link goes straight to a plain sign-in screen that returns
   the person to the brief afterwards; nothing else is asked first. A household member
   can create one; adviser and employer links stay gated (Intent 91). **Later option:**
   a months-only view with no sign-in, after PRD-229's safeguarding review is recorded.
   Joining or saving comes after the result is seen, never before.
5. **Second adult reads first.** The recipient confirms the exact version with one named
   action, then is offered to join. The creator can send **one** reminder, copied by
   them; LifeKeel sends none. Intent 82's rules stand: no creator-visible "not opened"
   state or read time.
6. **No repeated asks.** A field entered in one brief is pre-filled in the next
   suggested brief only where it still means the same thing (today's figures, not
   after-the-change amounts).
7. **One-thing-per-screen check** is part of the PR template for any screen on the
   first-value path, with the budget numbers attached for changes that touch it.
8. **Value ledger.** Where a feature claims money found, "found" and "confirmed saved"
   are separate numbers, and only the household's confirmation moves a figure to saved.
9. **Depth never gates the front door.** Use cases that need a feed (employer cover
   found, single-point-of-failure map, claim packet, beneficiary check, change
   detection) are added to the same number as depth. A test or review check confirms a
   brief still produces its first number with no connection present. Each such use case
   gets its own intent, with its own trust tier and advice-line check, before build;
   the ranking and friction cost of each is in
   [channels-and-use-cases-frictionless-2026-10.md](../reviews/channels-and-use-cases-frictionless-2026-10.md).
10. **Channels use the same budget.** Adviser, employer, UK-India-family and invite or
    gift channels each have a front-door version (a brief link, or a shared brief read
    before joining) and report the same first-value numbers. An adviser pilot is
    measured on time to first number and second-adult confirmation, not setup
    completion, and its wording is cleared with counsel first (PRD-207).
11. **Roadmap and gates.** `docs/reviews/product-roadmap-2026-10.md` Wave 6 and the
   pivot document gate the next stage on these numbers, not on "finished setup".

## Constraints

- **Trust tier:** 0. Nothing is sent or acted on for the household.
- **Regulated-advice check:** adviser and employer links carry factual numbers only; no
  product, provider or recommended action appears; no channel is paid per placement or
  switch. Copy passes `advice-rule.test.ts`.
- **Data/privacy:** budget events are counts and timings only. No figures, names or
  content in telemetry. A link recipient is never tracked in a way the creator can see
  (Intent 82). `CLAUDE.md` rule 3: no model call on family content for any of this.
- **Scale and cost:** the first-value path makes zero model calls and no document or
  connection call (Intent 76).

## Out of scope

Building any depth use case (each needs its own intent); staged emergency access
(parked: it touches irreversible action, so it needs an approval gate and counsel);
account-free storage of the household record; inbox, bank or pension feeds (Stage 3);
pricing; a partner or adviser portal; any feature in which an adviser reads a client's
figures (Stage 4, by household grant only).

## Builds on

Intents 70, 76, 78, 82; PRD-222, PRD-229; the partial-answer, share-page and
one-reminder work in `apps/web/src/app/briefs/` and `apps/web/src/app/b/[token]/`;
`apps/api/src/routes/growth-events.ts`.

## Success metrics

Median time to first useful number and its 90th percentile; share of first-value paths
that needed any connection (target zero); second-adult confirmation within 7 days;
share of adviser or employer links that produce a confirmed second adult; share of
households that create a second brief; and the found-versus-confirmed-saved ledger once
a feature reports one. A change that worsens the first four without a stated reason is
sent back.
