# PRD-119: per-member pension fields + member retirement scoring

## Problem

PRD-118 gave every adult twin a retirement component, but for anyone who
isn't the organizer it could only return an honest null — the financial
profile's `household.members[]` (PRD-104) was deliberately scoped to
income and income protection, so a second earner had nowhere to put a
pension. Their twin's retirement score was structurally stuck at
"not collected yet."

## Who it's for

Multi-earner households — the spouse/partner whose pension is a real and
often large part of the family's retirement picture but was invisible to
the twin.

## What "done" looks like

- `household.members[]` accepts optional `pension_balance_minor` and
  `monthly_pension_contribution_minor` — additive; old payloads and old
  member entries are byte-for-byte unaffected. Emergency fund stays
  household-level (a shared pool isn't one member's).
- The Financial Profile wizard's second-earner section collects both as
  optional fields — left blank stays "not on file," distinguishable from
  a declared £0.
- `computeMemberReadiness` now scores a non-organizer adult's retirement
  for real when pension data + a roster date of birth exist: their
  balance/contribution projected on the household's target age and
  growth rate via the same `projectRetirement`, compared against their
  **income share** of the household target income (the household target
  is a joint number; a member's slice is proportional to what they
  earn). Missing DOB, no salary, or no household target each produce a
  specific honest null, not a silent 0.
- The twin's `financial.earner` carries the pension fields;
  `/member/[id]` shows the monthly contribution on the earner line.
- Tier 0 — deterministic arithmetic on member-supplied data.

## Acceptance criteria

- [x] Schema accepts and stores the two fields; absent → undefined, not 0.
- [x] Second-earner retirement scores from their own pension; the score
      is monotonic in contribution.
- [x] No pension data / no DOB / no salary each yield a distinct honest
      null detail.
- [x] Organizer retirement unchanged (household projection).

## Implementation status — 2026-09

Shipped this session: schema fields on `members[]`, `memberRetirementComponent`
in `readiness/score.ts`, twin earner slice + age plumbing, wizard fields,
member-page pension display. Tests: `readiness/__tests__/score.test.ts`.
