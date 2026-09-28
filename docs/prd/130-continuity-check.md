# PRD-130: Continuity check — the dead man's switch, shaped to the product

**Status:** Implemented
**Trust tier:** 0/1 — email notifications to named humans only. No access is granted, nothing is released, nothing irreversible happens.

## Design decision

The audit's gap 4 noted a classic dead man's switch would contradict the vault model — nothing is locked, so there's nothing to "release." The honest shape for this product is therefore a **notification state machine**, not a release mechanism: the vault's standing adult access already means the right people can reach the documents; what's missing is someone being *told to look*.

## What shipped

### Activity heartbeat

`users.last_seen_at` — written in the auth middleware, throttled to one write per hour per user. A login timestamp alone can't distinguish an active long-lived session from a genuinely absent organizer.

### `family_continuity_state` + `runContinuityCheck` (daily cron, 07:45)

Three phases per opted-in family:

- **watching** — organizer seen within `check_in_after_days` (default 30).
- **check_in_sent** — past threshold → one "still there?" email to the organizer. Any activity resets silently.
- **alerted** — still silent after `grace_days` (default 14) → designated members get a continuity email pointing at the vault/plans they already have access to.

Properties: self-resetting on any organizer activity (even post-alert), idempotent across replicas (persisted phases + cron lock), and organizer-only opt-in. Designated contacts are re-validated at send time — pending members and children are never emailed.

### `GET/PATCH /family/continuity`

Organizer-only PATCH with validation: designated contacts must be active adult members with an email on file (rejected at save, not silently skipped at send). Changes audited (`family.continuity_updated`; sends audited as `family.continuity_check_in_sent`/`family.continuity_alert_sent`).

### Web

Settings → "Continuity Plan": enable toggle, per-member designate checkboxes, check-in threshold picker, and a live state line so the organizer can see the machine's current phase.

## Tests

- `jobs/__tests__/continuity-check.test.ts` (6): active organizer untouched, check-in fires once, grace→alert with child/pending skipped, activity resets even from alerted, disabled families untouched, `joined_at` fallback.
- `routes/__tests__/family-continuity.test.ts` (4): non-organizer 403, ineligible designees 400, round-trip, no-family 404.
