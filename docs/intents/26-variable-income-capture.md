# Intent 26: Variable and irregular income capture

**Problem** — QA rated self-employed/business-owner input a Pass but noted the
friction: the second-earner toggle is easy to miss and there's no way to
record that income is irregular or seasonal. The critic review lists "no
easy way to note irregular income" as the business-owner persona's biggest
missing piece. Scenario math then quietly assumes a flat monthly figure.

**Done looks like**
- The "second earner" question is prominent in the financial-profile wizard
  (not a buried toggle) — surfaced for every household shape that answered
  "partner" earlier.
- Each earner gains an optional free-text "income notes" field (e.g.
  "seasonal business", "varies £2–5k/mo") stored on the profile.
- Runway and scenario displays acknowledge stated variability in their
  framing ("based on £6,500/mo as entered — you noted income varies")
  without changing the deterministic math in this pass.
- Schema + web form + tests per the add-a-signal recipe; notes pass through
  no model call.

**Constraints**
- Trust tier: 0 — profile fields and display copy.
- Regulated-advice check: unchanged.
- Data/privacy: free text on the financial profile — same storage and
  erasure treatment as existing profile fields; excluded from telemetry.

**Out of scope** — variable-income scenario math (multi-step scenarios are
PRD-132; an income-volatility regime is a later PRD), bank-feed income
detection (PRD-133 is partnership-blocked), any detector consuming the note.

**Becomes** — PRD in docs/prd/, extending PRD-104/131's member-income slice.
