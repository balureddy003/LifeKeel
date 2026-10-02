# PRD-120: per-member retirement detection

## Problem

PRD-119 put pension fields on `household.members[]`, but nothing *detected*
with them — `family_retirement_gap` evaluated one household-level event
(modeled on the organizer). A second earner whose pension trajectory was
off-track produced no insight, even though their twin's retirement
component could already score the gap.

## Who it's for

Multi-earner households where the second earner's retirement is a real,
independent risk — and the member twins that need member-attributed
insight to explain their readiness.

## What "done" looks like

- For each `household.members[]` entry with **pension data entered**
  (balance or contribution > 0), the profile submit emits a second
  `family.pension` event carrying the member's own projection: their
  balance/contribution, their roster-derived age (`family_groups` DOB),
  their salary for the affordability gate, and a target equal to their
  **income share** of the household retirement target — evaluated
  through the existing `family_retirement_gap` rules unchanged.
- `member_id` rides the event into `feature_snapshot`/entity_key, so the
  insight is attributed to the real member: `?member_id=` filters it,
  the twin's insight list picks it up, and `resolveStaleInsights` keys
  it separately from the household event's.
- **Absent fields are not zero.** A member who never entered pension
  figures emits no event — never collected vs declared £0 are
  indistinguishable, so no event is the honest answer. Removing pension
  data later stops reproducing the insight and stale-resolution retires
  it. Same for a member with no roster DOB — an invented age is worse
  than no insight.
- Tier 0 — detection only; the existing rules' informational copy and
  "consult a professional" actions are unchanged.

## Acceptance criteria

- [x] Member pension data + DOB → member-attributed retirement insight.
- [x] Affordability gate uses the member's own salary.
- [x] No pension data → no member event, no insight.
- [x] Pension data without roster DOB → skipped, not guessed.
- [x] Household event's insights remain unattributed (no cross-tagging).

## Implementation status — 2026-09

Shipped this session: the per-member `family.pension` eval loop in
`family-financial-profile.ts` (inside the existing
`!isUnsetTarget(target)` gate), shared `ageFromDob` in
`lib/family-permissions.ts` (member-twin's local copy now delegates).
Tests: `routes/__tests__/family-financial-profile.test.ts` PRD-120
describe (3 cases, real engine + real detector YAML).
