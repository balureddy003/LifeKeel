# PRD-116: detector-declared action intents — Tier 2, exercised

## Problem

The Act layer's execution machinery — approve → dispatch via SendGrid /
Twilio / CRM, the `action-preview` approval gate, `action_receipts`
idempotency, `auto-execute-trusted` — shipped and hardened before any
family detector ever produced an action it could run. Every detector
`actions:` entry is a free-text advisory string ("Review the renewal
terms"), and the executor classified each by regex keyword-matching —
which meant:

- Nothing in the family vertical ever dispatched; every action
  classified `log_only`. Tier 2 existed but was unexercised (flagged in
  the vision-vs-implementation audit, gap #10).
- Classification was *accidental*: a future action string that happened
  to contain "email" would silently classify as `send_email` with no
  detector author ever deciding that.
- The approval gate and the executor were coupled only by convention —
  both called the same regex, but nothing in the data model said which
  strings were meant to be executable.

## Who it's for

A family who wants Oak to *do* the small, reversible thing — email them
a renewal reminder — after they approve it, rather than only ever
rendering a checklist they must act on themselves.

## What "done" looks like

- Detector rules can declare `action_intents` — typed
  `{type, label, params?}` entries alongside free-text `actions` —
  defined in `packages/engine`'s `ActionIntentSchema` (the engine stays
  decoupled; the executor's `ActionType` mirrors it by value), carried
  through `detector.ts` onto the persisted `Insight`.
- The executor treats declared intents as **authoritative in both
  directions**: a declared `send_email` dispatches even when its label
  wouldn't keyword-match, and a declared `log_only` suppresses a label
  that would keyword-match — the safer direction is the one that matters
  more. Free-text actions with no declared intent classify by keyword as
  before.
- `/insights/:id/action-preview` consumes the same intents, so the
  approval gate names exactly the side effect that will run — now by
  shared data, not just shared code.
- `auto-execute-trusted` counts declared intents too: an external intent
  makes the insight permanently ineligible for auto-execution,
  regardless of earned trust.
- First declared intent: `policy_renewal_window` in
  `detectors/family/protection-gap.yaml` gains a `send_email` intent —
  "Email me a reminder before this policy renews." The executor's
  `send_email` is always a self-send to the family's own contact address
  (never to the insurer — that would be Tier 1 outreach, which stays
  prepare-don't-send).

## Trust tier

**Tier 2 — narrow, named, per-action consent.** Approving the renewal
insight dispatches exactly one email, to the family themselves, about a
policy already on file. The consent gate (`/insights/:id/approve` +
action-preview) is unchanged and now names a real side effect. Auto-
execute stays categorically `log_only`-only — declared external intents
are ineligible by construction.

CLAUDE.md's second rule applies unchanged: the email describes what's on
file and the timing — no product comparison, no provider steering.

## Scope

In: the engine schema + detector plumbing, executor + preview +
auto-execute call sites, the renewal-window intent, tests.

Out: intents that contact third parties (insurer notification remains
Tier-1 draft-only per PRD-103), params-driven templating beyond the
label, and any UI change — the approval gate already renders
`action-preview`'s output.

## Acceptance criteria

- [x] Declared `send_email` dispatches; declared `log_only` suppresses a
      keyword-matched label; undeclared actions classify as before.
- [x] `action-preview` and `execute` derive from the same
      `intentsFor()` — the gate cannot describe a different action than
      the one that runs.
- [x] Auto-execute excludes any insight with a declared external intent.
- [x] `action_intents` survives `InsightSchema.parse` and persists on
      the insight document.
- [x] Engine family-detector tests still pass against the updated YAML.

## Implementation status — 2026-09

Shipped this session: `ActionIntentSchema` + `action_intents` on
`DetectorRuleSchema`/`TriggerSchema` (`packages/engine`), detector.ts
carries them onto the insight, `intentsFor()` in `action-executor.ts`
(declared intents authoritative over keyword classification, both
directions), `previewActions(labels, intents)` at the gate and in
`auto-execute-trusted.ts`, and the first real `send_email` intent on
`policy_renewal_window`. Tests: four new cases in
`action-executor.test.ts`.
