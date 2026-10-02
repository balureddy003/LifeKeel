# PRD-118: per-member readiness on the twin

## Problem

PRD-114 gave the *family* a server-owned composite score, and PRD-117
gave each member a twin read model — but the twin still couldn't answer
"how ready is *this* person?" A second earner with no income protection
and no life policy showed identically to a fully covered one; a child's
twin had no number at all.

## Who it's for

Every family member — and the member micro-agents the twin read model is
the foundation for: a per-member score is the first piece of member-
scoped *reasoning*, not just member-scoped data.

## What "done" looks like

- `computeMemberReadiness()` in
  [score.ts](../../apps/api/src/readiness/score.ts) scores a member's own
  slice using the same component vocabulary as the family composite:
  - **protection** — their income protection (earner field or an
    attributed `income_protection` policy) and their life cover. For the
    organizer, life cover = household `life_cover_minor` + attributed
    `life` policy coverage vs. the household need (same formula as the
    family component). For other adults, an attributed `life` policy is
    the binary signal — no per-member need figure exists to fraction
    against.
  - **retirement** — scored for the organizer only (the household
    pension projection is modeled on them); other earners get an honest
    null — per-member pension contributions aren't collected yet.
  - **education** — the member's attributed funds' % of target.
  - **estate** — adult members only, gated by the *viewer's* adult
    status exactly like `/family/readiness`.
  - **emergency_fund is deliberately absent** — a shared household pool
    isn't any one member's.
- Same honesty rules as the family score: not-applicable components
  return `score: null` and renormalize out; a child with no linked fund
  reads null, not 0.
- `GET /family/members/:id/twin` now returns `readiness`; `/member/[id]`
  renders the composite + per-component detail lines.
- Tier 0 — deterministic arithmetic over already-visible data, no side
  effects, no advice ("cover is in place" / "gaps: income protection"
  are descriptions of what's on file, not product recommendations).

## Acceptance criteria

- [x] Organizer readiness uses household-level earner fields + their
      attributed policies.
- [x] An uncovered earner's protection reads 0 on *their* twin even when
      the family is covered.
- [x] Child twins score on education only.
- [x] Estate gated for non-adult viewers; omitted for child members.
- [x] `member/[id]` shows score + component details; `Money` redaction
      unchanged.

## Implementation status — 2026-09

Shipped this session: `computeMemberReadiness` in `readiness/score.ts`,
`readiness` on the twin route, the readiness block in
`MemberProfileClient.tsx`. Tests: `readiness/__tests__/score.test.ts`
(5 new cases), `routes/__tests__/member-twin.test.ts` (3 assertions).
