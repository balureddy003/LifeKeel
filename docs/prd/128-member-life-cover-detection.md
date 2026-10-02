# PRD-128: Per-member life-cover detection

**Status:** Implemented
**Depends on:** PRD-104 (member earners), PRD-110 (policy `member_id` attribution)
**Trust tier:** 0 — informational detection only.

## Problem

`life_insurance_below_household_needs` checks *aggregate* life cover against household need — £250k attributed to the organizer passes the check even when the second earner's income carries no life cover at all. Member readiness (PRD-118) already scores this gap on the twin; nothing *detected* it.

## What shipped

### `member_no_life_cover` rule in `family_protection_gap`

Fires only on the per-member earner events (`member_earner == 1`), gated on real dependents (`member_has_dependents` — dependents are shared, both incomes support them) and `years_to_retirement > 1`, when the sum of `life` policies attributed to that member (`member_life_cover_minor`) is zero. Binary, not adequacy-scaled — the honest check is "any cover attributed to this earner," matching `memberProtectionComponent`'s non-organizer semantics.

Impact estimate uses the member's own salary (2–5 years of their gross income).

### Eval fields in `family-financial-profile.ts`

`evaluateHouseholdEarner` now emits three member-scoped fields on every event — explicit values on **both** sides so the rule can never mis-fire on the primary event:

| Field | Primary event | Member event |
|---|---|---|
| `member_earner` | 0 | 1 |
| `member_life_cover_minor` | `MAX_SAFE_INTEGER` (neutralized) | sum of attributed `life` policy coverage |
| `member_has_dependents` | 0 | real household `has_dependents` |

`member_id` lands in `feature_snapshot`/`entity_key` → attributed insights flow to `?member_id=`, the twin, the agent nudges, and stale-resolution automatically.

## Tests

`family-financial-profile.test.ts` (+4): member fire + attribution, attributed-policy suppression, no-dependents suppression, primary-event gating. Detector loads clean under `strictValidation: true`.
