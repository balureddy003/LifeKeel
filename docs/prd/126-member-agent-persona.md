# PRD-126: member agent persona

## Problem

The member track had read models (117), scores (118), detection (120),
and conversation (122) — but nothing *proactive*. The vision's member
micro-agents are supposed to watch and surface, not wait to be asked:
the first tractable form of that is a persona surface that reads the
twin and leads with what it notices.

## Who it's for

Adults who want "what would this member's twin flag right now" without
formulating a question — and, for child members, the parents the
guardian-persona agent reports to.

## What "done" looks like

- `GET /family/members/:id/agent` builds on `getMemberTwin` — the agent
  is a deterministic read of the same twin the page renders, not a
  second data model that could drift. Pure, testable `buildMemberAgent`.
- `nudges`: three kinds, ordered insight → attention → progress:
  - `insight` — the member's open detector findings, linked back via
    `source.insight_id`.
  - `attention` — readiness components at ≤80, sourced to the component.
  - `progress` — components above 80, one quiet positive so the agent
    isn't only an alarm bell.
- `persona`: `adult` for grown members; **`guardian`** for minors —
  a child's agent speaks *about* the child *to* the adults ("Nihaan's
  education could use attention"), matching the no-child-login posture
  of PRD-123/124. There is no child-autonomous agent.
- `provisional`: true while the member is pending — their data was
  entered on their behalf.
- Strictly Tier 0 / informational: no persistence, no scheduler, no
  LLM generation, no product or provider steering, and nothing
  actionable — any real action stays behind the Act layer's explicit
  approval gates. No estate/vault content surfaces to non-adult viewers
  (the underlying twin already gates it).
- Web: the member page renders a "What Keel notices about {name}" card
  (guardian phrasing for minors) with the provisional badge; hidden in
  kid view, consistent with PRD-124.

## Acceptance criteria

- [x] Nudge ordering: member insights first, then attention gaps, then
      progress.
- [x] `provisional` set on pending members.
- [x] `guardian` persona for child members; attention nudges phrased
      about the child for the adults reading.
- [x] Copy regression: nudges carry no product/provider steering
      language.
- [x] 404 for unknown member; 14 tests green in `member-twin.test.ts`;
      web typecheck clean.

## Deliberately not done

Scheduled/persisted nudges, notification delivery, and any action-taking
remain future tracks — this PRD ships the persona surface only. The
agent also doesn't run on the youth twin projection (`mode=youth`): the
agent speaks to adults, so it reads the full twin.
