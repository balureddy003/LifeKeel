# PRD-122: member-scoped Ask Oak

## Problem

PRDs 117–120 gave each family member a twin read model, member readiness,
per-member pension data, and member-attributed insights — but Ask Oak
still grounds every answer on the *household* context. "Is Sam's pension
on track?" was answerable only because the model happened to see Sam's
row in a household-level dump; there was no member-scoped reasoning
surface — the closest thing the vision's member micro-agents have to a
conversational interface.

## Who it's for

Family members asking about a specific person's slice — "is Sam's
pension on track?", "does Alex have income protection?", "how far is
Nihaan's fund from target" — and the member page that now hosts the
entry point.

## What "done" looks like

- `POST /assistant/ask` accepts an optional `member_id`. When present the
  answer grounds on that member's **twin read model** — the same
  `getMemberTwin` assembly the member page renders (extracted from the
  route so there's one source of truth): their earner slice incl.
  pension fields, attributed policies, attributed education funds with
  pace-to-target, member-attributed open insights, and their member
  readiness components with detail lines. Shared household figures
  (living expenses, emergency fund) ride along as labeled background.
- Unknown `member_id` → 404. A pending member's scope explicitly flags
  their figures as unconfirmed, same honesty rule as the household path.
- Estate visibility still follows the *viewer* — a non-adult asking
  about an adult member gets a gated estate component, never the doc
  list.
- Web: `fetchAIResponse(query, memberId)` threads the scope through; the
  member page gains an "Ask Oak about {name}" card with the same
  honest `isLive` labeling the assistant page uses.
- Tier 0 — read-only grounding on existing data; the same informational-
  only SYSTEM_PROMPT applies unchanged.

## Acceptance criteria

- [x] Member-scoped ask returns 200 with a prompt scoped to the member —
      their salary/pension figures, attributed insights — while
      household-only insights stay out.
- [x] 404 for a member_id not on the roster.
- [x] Pending member's figures are labeled unconfirmed in the context.
- [x] Household-scoped ask unchanged (existing tests green).
- [x] `getMemberTwin` is shared between the twin route and the
      assistant — no duplicated member-assembly logic.
- [x] Member page renders the ask card; web typecheck/lint clean.
