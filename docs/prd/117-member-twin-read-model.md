# PRD-117: member twin read model + member-scoped insights

## Problem

The vision's member micro-agents — Adult Twins (career, pension,
protection, estate) and Youth Twins (education funds, savings buckets,
financial literacy) — presuppose something the codebase didn't have: a
per-member *view* of the Family Twin. PRD-104 shipped per-member
financial identity (`household.members[]` earners, `member_id` on
policies and education funds, member-attributed detector signals), but
nothing assembled it back into "what does Oak know about *this*
person?" — the `/member/[id]` page showed only name, role, and DOB and
explicitly told users per-member finances "aren't collected per-member
yet" (stale copy — they were, by then).

## Who it's for

Every family member — and the future member-level agent surfaces that
need a single, correct place to read one member's slice of the twin.

## What "done" looks like

- `GET /family/members/:id/twin`
  ([member-twin.ts](../../apps/api/src/routes/member-twin.ts)) returns
  the member's roster record + derived age, their earner slice
  (per-member entry, or the household-level fields when the member is
  the organizer — those fields predate member-level earners and are the
  organizer's own), `member_id`-attributed policies, education funds
  (attributed via `member_id`, with a first-name `child_name` fallback
  for funds recorded before linking existed — plus the monthly pace
  needed to hit the target), and open family insights attributed via
  `feature_snapshot.member_id` / `entity_key` / renewal attribution.
- Everything is computed **fresh on read** — a twin is a read model, not
  a stored document, so it can never drift from profile/roster.
- `GET /insights` accepts `member_id=` — composes with `goal_id` under
  `$and` rather than clobbering a shared `$or`.
- `/member/[id]` renders "Their financial picture" — earner, policies,
  education-fund progress, open member insights — replacing the stale
  "not collected per-member yet" copy. Amounts go through `Money` so
  child-mode redaction still applies.

## Trust tier

**Tier 0 — pure read.** No side effects, no advice; the fund's
"needed per month" is arithmetic, not a recommendation.

## Scope

In: the read model, the insights filter, the member page surface.

Out: member *personas* (reasoning per member, youth-twin literacy
surfaces), per-member field permissions (same open question PRD-110
flagged), and any write path — twins change by editing the profile,
never directly.

## Acceptance criteria

- [x] Organizer twin falls back to household-level earner fields;
      partner twin reads their `members[]` entry; child twin gets
      education funds + pace, no earner.
- [x] Insights attributed by `feature_snapshot.member_id`,
      renewal-member attribution, and `entity_key`; resolved/dismissed
      excluded.
- [x] 404 for unknown member id; tenant-scoped throughout.
- [x] Member page renders the twin; money respects `Money` redaction.

## Implementation status — 2026-09

Shipped this session: `routes/member-twin.ts`, `?member_id=` on
`/insights`, `fetchMemberTwin`/`fetchMemberInsights` in `api.ts`, the
twin section in `MemberProfileClient.tsx`. Tests:
`routes/__tests__/member-twin.test.ts`.
