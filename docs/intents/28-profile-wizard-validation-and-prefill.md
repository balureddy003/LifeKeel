# Intent 28: Profile wizard inline validation and return-visit pre-fill

**Problem** — QA found two returning-user frictions in the financial-profile
wizard: extreme values (negative numbers, implausible ages, savings wildly
disproportionate to income) sail through intermediate steps and only fail at
final save, and saved fields don't pre-fill on return so users re-enter or
abandon. The critic review lists pre-fill under "data freshness and
pre-fill" as a top-six gap.

**Done looks like**
- Inline validation on blur per field — red border + helper text —
  enforcing the same bounds the final save enforces (no negative amounts,
  age bounds, savings/income sanity ratio), so bad data is caught at the
  step where it's typed. On mobile the message must be visible without
  scrolling back past the open keyboard — late validation is worst exactly
  there (device-test finding).
- Returning to the wizard pre-fills previously saved values from the
  profile; a visible "saved" state removes doubt about whether the last
  change took.
- Validation bounds are shared between client and the profile route's own
  checks — no rule that exists only in the browser.
- Tests: invalid values blocked inline at each step; saved profile renders
  pre-filled.

**Constraints**
- Trust tier: 0 — form UX on existing fields.
- Regulated-advice check: none.
- Data/privacy: none new.

**Out of scope** — new profile fields (that's the add-a-signal recipe),
autosave redesign, cross-device draft sync.

**Becomes** — PRD in docs/prd/, extending PRD-002's profile surface.
