# PRD-115: time-shifted and persisted scenario simulation

## Problem

`POST /assistant/simulate` already computed real, deterministic what-if
math — income delta → projected runway, extra savings → education-fund
pace — but with two structural limits versus the vision's "what happens
to our runway if a job transition occurs in 6 months?":

1. **No time dimension.** The change applied instantly, so the answer
   measured runway from *today's* balance. A family with six months of
   warning would actually arrive at the job loss with a larger fund —
   the honest answer differs, and the old math couldn't produce it.
2. **Nothing persisted.** A scenario was computed and narrated once,
   inside Ask Oak, then gone. There was no way to keep "job loss in 6
   months" around and watch it improve as the family saved — and no web
   surface ever called `/simulate` at all; the endpoint was dead code in
   the UI.

## Who it's for

A family who can see a change coming — a planned job transition, a
contract ending, a partner's return to work — and wants to track whether
they'll be ready when it lands, not just whether they'd be ready today.

## What "done" looks like

- `calculateScenario` accepts `monthsUntilChange`: the household lives
  under today's numbers until the change lands — a positive surplus
  accrues to the emergency fund, a negative one drains it — and the
  projected runway is measured from `savingsAtChangeMinor`, the balance
  at that moment (floored at 0). `monthsUntilChange` 0/omitted is the
  pre-PRD-115 instant behavior. New savings habits
  (`monthlyExtraSavingsMinor`) start immediately — they're the family's
  decision now, not the event they're bracing for.
- New `family_scenarios` collection + routes
  ([family-scenarios.ts](../../apps/api/src/routes/family-scenarios.ts)):
  `POST /family/scenarios/preview` (pure math, no LLM, persists nothing —
  sliders can call it freely), `POST /family/scenarios` (save named
  inputs), `GET` list/one (each **recomputed against the live profile on
  read** — the same "numbers stay live" posture as `/family/readiness`),
  `DELETE` (creator or any family adult — deleting someone else's saved
  projection isn't a child's call).
- `POST /assistant/simulate` accepts `monthsUntilChange` and narrates the
  timing explicitly, so Ask Oak answers "in six months" questions
  correctly.
- The `/events/job-loss` tile gains "If it happened later" — horizon
  chips (now / 3 / 6 / 12 months), the projected runway sentence,
  "Save this scenario," and a saved-scenario list that stays live.

## Trust tier

**Tier 0** — pure read/arithmetic plus scenario bookkeeping. No external
effect, no LLM on the preview path, no advice language (results are
numbers and months, not recommendations).

## Scope

In: horizon math, the CRUD + preview routes, the job-loss tile surface,
tests at unit and route level.

Out: scenarios for event types without a defensible formula (the
per-event readiness module already refuses to fabricate numbers for
new-child/marriage — same posture here); LLM narration on saved-scenario
reads (the numbers are self-explanatory); multi-step sequenced scenarios
("job loss, *then* a partner returns") — the horizon is a single
transition, not a timeline engine.

## Acceptance criteria

- [x] Horizon grows/drains the fund before the change; runway measured
      from the horizon balance; floor at 0.
- [x] Saved scenarios recompute on read — editing the profile changes
      the result without touching the stored inputs.
- [x] Preview persists nothing; delete gated to creator-or-adult.
- [x] Tenant-scoped throughout; malformed input → 400.

## Implementation status — 2026-09

Shipped this session: `monthsUntilChange` + `savingsAtChangeMinor` in
`scenarios/calculate.ts`, `scenarios/profile-input.ts` (extracted from
`assistant.ts`), `routes/family-scenarios.ts`, `SimulateSchema` horizon
field + narration, job-loss tile scenario card in `EventDetailClient.tsx`,
scenario client fns in `api.ts`. Tests: horizon cases in
`scenarios/__tests__/calculate.test.ts`,
`routes/__tests__/family-scenarios.test.ts`.
